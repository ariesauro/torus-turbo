//! Vortex reconnection — merge nearby particles.
//!
//! Port of `src/simulation/physics/vpm/vortexReconnection.js`.
//!
//! For each eligible pair within reconnection distance: merge into
//! weighted-average position, sum vorticity/gamma, average core radius.

use crate::particle::Particle;
use crate::params::SimParams;

fn is_reconnection_eligible(particle: &Particle, params: &SimParams) -> bool {
    let min_age = params.reconnection_min_age.max(0.0);
    particle.age >= min_age
}

/// Vortex reconnection: merge nearby particles in-place.
///
/// Modifies `particles` vec, removing merged particles.
pub fn vortex_reconnection(particles: &mut Vec<Particle>, params: &SimParams) {
    let threshold = params.reconnection_distance.max(0.0);
    if threshold <= 0.0 || particles.len() <= 1 {
        return;
    }

    let threshold2 = threshold * threshold;
    let count = particles.len();
    let mut targets: Vec<i32> = vec![-1; count];
    let mut owners: Vec<i32> = vec![-1; count];

    // Find closest merge target for each eligible particle
    for i in 0..count {
        if !is_reconnection_eligible(&particles[i], params) {
            continue;
        }

        let pos_i = particles[i].position;

        for j in (i + 1)..count {
            if !is_reconnection_eligible(&particles[j], params) {
                continue;
            }

            let dist2 = (pos_i - particles[j].position).length_squared();
            if dist2 >= threshold2 {
                continue;
            }

            if targets[i] == -1 {
                targets[i] = j as i32;
            } else {
                let current_dist2 =
                    (pos_i - particles[targets[i] as usize].position).length_squared();
                if dist2 < current_dist2 {
                    targets[i] = j as i32;
                }
            }
        }
    }

    // Resolve ownership
    for i in 0..count {
        let target = targets[i];
        if target == -1 {
            continue;
        }
        let t = target as usize;
        if owners[t] == -1 || (i as i32) < owners[t] {
            owners[t] = i as i32;
        }
    }

    // Build merged particle list
    let min_core = params.min_core_radius.max(0.01);
    let default_core = params.core_radius_sigma.max(min_core);
    let mut merged = Vec::with_capacity(count);

    for i in 0..count {
        if owners[i] != -1 {
            continue; // This particle is owned by another — it will be merged into owner
        }

        let target_idx = targets[i];
        if target_idx != -1 && owners[target_idx as usize] == i as i32 {
            let j = target_idx as usize;
            let base_weight = particles[i].gamma.abs() + 1e-6;
            let candidate_weight = particles[j].gamma.abs() + 1e-6;
            let weight_sum = base_weight + candidate_weight;

            let mut merged_particle = particles[i].clone();

            merged_particle.position = (particles[i].position * base_weight
                + particles[j].position * candidate_weight)
                / weight_sum;

            merged_particle.vorticity = particles[i].vorticity + particles[j].vorticity;
            merged_particle.gamma = particles[i].gamma + particles[j].gamma;
            merged_particle.core_radius = (particles[i].core_radius.max(default_core)
                + particles[j].core_radius.max(default_core))
                / 2.0;

            merged.push(merged_particle);
        } else {
            merged.push(particles[i].clone());
        }
    }

    *particles = merged;
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::DVec3;

    #[test]
    fn no_reconnection_when_distance_zero() {
        let params = SimParams {
            reconnection_distance: 0.0,
            ..SimParams::default()
        };

        let mut particles = vec![
            Particle::new(0, DVec3::ZERO),
            Particle::new(1, DVec3::new(0.001, 0.0, 0.0)),
        ];

        vortex_reconnection(&mut particles, &params);
        assert_eq!(particles.len(), 2);
    }

    #[test]
    fn merges_close_particles() {
        let params = SimParams {
            reconnection_distance: 0.1,
            reconnection_min_age: 0.0,
            min_core_radius: 0.01,
            core_radius_sigma: 0.05,
            ..SimParams::default()
        };

        let mut particles = vec![
            Particle {
                gamma: 1.0,
                vorticity: DVec3::new(0.0, 0.0, 1.0),
                core_radius: 0.05,
                age: 1.0,
                ..Particle::new(0, DVec3::new(0.0, 0.0, 0.0))
            },
            Particle {
                gamma: 1.0,
                vorticity: DVec3::new(0.0, 0.0, 0.5),
                core_radius: 0.05,
                age: 1.0,
                ..Particle::new(1, DVec3::new(0.01, 0.0, 0.0))
            },
        ];

        vortex_reconnection(&mut particles, &params);
        assert_eq!(particles.len(), 1, "Two close particles should merge into one");
        assert!((particles[0].gamma - 2.0).abs() < 1e-10, "Gamma should be summed");
        assert!(
            (particles[0].vorticity.z - 1.5).abs() < 1e-10,
            "Vorticity z should be summed"
        );
    }

    #[test]
    fn respects_min_age() {
        let params = SimParams {
            reconnection_distance: 0.1,
            reconnection_min_age: 10.0,
            ..SimParams::default()
        };

        let mut particles = vec![
            Particle {
                age: 1.0,
                ..Particle::new(0, DVec3::ZERO)
            },
            Particle {
                age: 1.0,
                ..Particle::new(1, DVec3::new(0.01, 0.0, 0.0))
            },
        ];

        vortex_reconnection(&mut particles, &params);
        assert_eq!(particles.len(), 2, "Young particles should not merge");
    }
}
