//! FMM Biot-Savart solver: O(N log N) velocity computation.
//!
//! Port of `src/simulation/physics/fmm/biotSavartFmm.js`.
//! Tree walk traversal: far nodes → multipole (M2L), near leaves → direct P2P.

use glam::DVec3;
use rayon::prelude::*;

use torus_physics::params::SimParams;
use torus_physics::particle::Particle;

use crate::multipole::{FmmSource, m2l_contribution, p2p_kernel};
use crate::octree::{OctreeNode, build_node, compute_bounds, upward_pass};

fn build_source_data(particles: &[Particle], params: &SimParams) -> Vec<FmmSource> {
    particles
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let gamma = p.gamma;
            let min_core = params.min_core_radius.max(1e-4);
            let sigma = p.core_radius.max(min_core);

            FmmSource {
                id: p.id,
                index: i,
                position: p.position,
                gamma,
                sigma,
                omega_gamma: p.vorticity * gamma,
            }
        })
        .collect()
}

fn injected_velocity(particle: &Particle, params: &SimParams) -> DVec3 {
    let jet_duration = params.pulse_duration.max(1e-4);
    let age = particle.age.max(0.0);
    if age >= jet_duration {
        return DVec3::ZERO;
    }
    let weight = 1.0 - age / jet_duration;
    particle.inject_velocity * weight
}

/// Tree walk: compute velocity at query point by traversing the octree.
fn tree_walk_velocity(
    query: DVec3,
    exclude_id: u32,
    node: &OctreeNode,
    theta: f64,
    softening2: f64,
    interaction_radius2: f64,
    sources: &[FmmSource],
) -> DVec3 {
    let d = query - node.center;
    let dist = d.length();
    let size = node.half_size * 2.0;

    // MAC criterion: if well-separated, use multipole
    if !node.leaf && dist > 0.0 && size / dist < theta {
        return m2l_contribution(query, &node.multipole, softening2, interaction_radius2);
    }

    // Leaf: direct P2P
    if node.leaf {
        let mut v = DVec3::ZERO;
        for &idx in &node.indices {
            let src = &sources[idx];
            if src.id == exclude_id {
                continue;
            }
            v += p2p_kernel(query, src, softening2, interaction_radius2);
        }
        return v;
    }

    // Internal non-leaf: recurse into children
    let mut v = DVec3::ZERO;
    for child in &node.children {
        if let Some(c) = child {
            v += tree_walk_velocity(query, exclude_id, c, theta, softening2, interaction_radius2, sources);
        }
    }
    v
}

/// FMM Biot-Savart: O(N log N) velocity computation.
///
/// Updates `particle.flow_velocity` for each particle.
pub fn compute_velocity_fmm(particles: &mut [Particle], params: &SimParams) {
    let count = particles.len();
    if count == 0 {
        return;
    }

    let theta = 0.65_f64.clamp(0.2, 1.2);
    let leaf_size = 16usize.clamp(4, 64);
    let softening = 0.02_f64.clamp(1e-5, 2.0);
    let softening2 = softening * softening;
    let max_depth = 20;
    let interaction_radius2 = if params.interaction_radius > 0.0 {
        params.interaction_radius * params.interaction_radius
    } else {
        0.0
    };

    let sources = build_source_data(particles, params);
    if sources.len() < 2 {
        for p in particles.iter_mut() {
            p.flow_velocity = injected_velocity(p, params);
        }
        return;
    }

    let bounds = compute_bounds(&sources);
    let indices: Vec<usize> = (0..sources.len()).collect();
    let root = build_node(
        &sources,
        &indices,
        bounds.center,
        bounds.half_size,
        leaf_size,
        0,
        max_depth,
    );

    let Some(mut root) = root else {
        for p in particles.iter_mut() {
            p.flow_velocity = injected_velocity(p, params);
        }
        return;
    };

    upward_pass(&mut root);

    // Parallel velocity evaluation
    let flows: Vec<DVec3> = (0..count)
        .into_par_iter()
        .map(|i| {
            let inject = injected_velocity(&particles[i], params);
            if !params.use_biot_savart {
                return inject;
            }
            let walk = tree_walk_velocity(
                particles[i].position,
                particles[i].id,
                &root,
                theta,
                softening2,
                interaction_radius2,
                &sources,
            );
            inject + walk
        })
        .collect();

    for (i, p) in particles.iter_mut().enumerate() {
        p.flow_velocity = flows[i];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ring(n: usize, radius: f64, gamma: f64) -> Vec<Particle> {
        (0..n)
            .map(|i| {
                let t = 2.0 * std::f64::consts::PI * i as f64 / n as f64;
                Particle {
                    gamma,
                    vorticity: DVec3::new(-t.sin() * 0.1, t.cos() * 0.1, 0.0),
                    core_radius: 0.1,
                    age: 100.0,
                    life: 100.0,
                    ..Particle::new(i as u32, DVec3::new(radius * t.cos(), radius * t.sin(), 0.0))
                }
            })
            .collect()
    }

    #[test]
    fn fmm_produces_nonzero_flow() {
        let params = SimParams {
            use_biot_savart: true,
            pulse_duration: 0.0,
            min_core_radius: 0.05,
            ..SimParams::default()
        };

        let mut particles = make_ring(32, 1.0, 1.0);
        compute_velocity_fmm(&mut particles, &params);

        let total_flow: f64 = particles.iter().map(|p| p.flow_velocity.length()).sum();
        assert!(total_flow > 1e-6, "FMM should produce non-zero velocities, got {}", total_flow);
    }

    #[test]
    fn fmm_agrees_with_direct_roughly() {
        use torus_physics::biot_savart::compute_velocity_biot_savart;

        let params = SimParams {
            use_biot_savart: true,
            pulse_duration: 0.0,
            min_core_radius: 0.05,
            core_radius_sigma: 0.1,
            interaction_radius: 0.0,
            ..SimParams::default()
        };

        let mut particles_fmm = make_ring(16, 1.0, 1.0);
        let mut particles_direct = particles_fmm.clone();

        compute_velocity_fmm(&mut particles_fmm, &params);
        compute_velocity_biot_savart(&mut particles_direct, &params);

        let mut max_err = 0.0;
        let mut max_mag = 0.0;
        for (fmm, direct) in particles_fmm.iter().zip(particles_direct.iter()) {
            let err = (fmm.flow_velocity - direct.flow_velocity).length();
            let mag = direct.flow_velocity.length();
            if err > max_err { max_err = err; }
            if mag > max_mag { max_mag = mag; }
        }

        let relative = if max_mag > 1e-10 { max_err / max_mag } else { max_err };
        assert!(
            relative < 0.3,
            "FMM should roughly agree with direct (relative error {})",
            relative
        );
    }

    #[test]
    fn fmm_handles_empty_and_single() {
        let params = SimParams::default();

        let mut empty: Vec<Particle> = vec![];
        compute_velocity_fmm(&mut empty, &params);

        let mut single = vec![Particle::new(0, DVec3::ZERO)];
        compute_velocity_fmm(&mut single, &params);
    }
}
