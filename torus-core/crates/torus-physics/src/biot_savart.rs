//! Biot-Savart velocity computation — direct O(N²).
//!
//! Port of `src/simulation/physics/vpm/biotSavart.js`.
//! v(x_i) = Σ_j (γ_j / 4π) · (r × ω_j) / (|r|² + σ²)^(3/2)

use glam::DVec3;
use rayon::prelude::*;

use crate::particle::Particle;
use crate::params::SimParams;

const FOUR_PI: f64 = 4.0 * std::f64::consts::PI;

fn get_core_radius(particle: &Particle, params: &SimParams) -> f64 {
    let min_core = params.min_core_radius.max(1e-4);
    particle.core_radius.max(min_core)
}

fn injected_velocity_contribution(particle: &Particle, params: &SimParams) -> DVec3 {
    let jet_duration = params.pulse_duration.max(1e-4);
    let age = particle.age.max(0.0);

    if age >= jet_duration {
        return DVec3::ZERO;
    }

    let weight = 1.0 - age / jet_duration;
    particle.inject_velocity * weight
}

/// Direct Biot-Savart: O(N²), parallelized with rayon.
///
/// Updates `particle.flow_velocity` for each particle.
pub fn compute_velocity_biot_savart(particles: &mut [Particle], params: &SimParams) {
    let count = particles.len();
    if count == 0 {
        return;
    }

    let interaction_radius2 = if params.interaction_radius > 0.0 {
        params.interaction_radius * params.interaction_radius
    } else {
        0.0
    };
    let use_interaction_cutoff = params.interaction_radius > 0.0;

    // Snapshot immutable data for parallel read
    let positions: Vec<DVec3> = particles.iter().map(|p| p.position).collect();
    let vorticities: Vec<DVec3> = particles.iter().map(|p| p.vorticity).collect();
    let gammas: Vec<f64> = particles.iter().map(|p| p.gamma).collect();
    let sigmas: Vec<f64> = particles.iter().map(|p| get_core_radius(p, params)).collect();

    let flows: Vec<DVec3> = (0..count)
        .into_par_iter()
        .map(|i| {
            let inject = injected_velocity_contribution(&particles[i], params);
            let mut v = inject;

            if params.use_biot_savart {
                let pos_i = positions[i];

                for j in 0..count {
                    if i == j {
                        continue;
                    }

                    let r = pos_i - positions[j];
                    let r2 = r.length_squared();

                    if use_interaction_cutoff && r2 > interaction_radius2 {
                        continue;
                    }

                    let sigma = sigmas[j];
                    let denom = (r2 + sigma * sigma).powf(1.5);

                    if denom <= 1e-8 {
                        continue;
                    }

                    let omega = vorticities[j];
                    let cross = r.cross(omega);
                    let gamma = gammas[j];
                    let factor = gamma / (FOUR_PI * denom);

                    v += cross * factor;
                }
            }

            v
        })
        .collect();

    for (i, particle) in particles.iter_mut().enumerate() {
        particle.flow_velocity = flows[i];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_particles_no_panic() {
        let params = SimParams::default();
        let mut particles: Vec<Particle> = vec![];
        compute_velocity_biot_savart(&mut particles, &params);
    }

    #[test]
    fn single_particle_gets_inject_velocity() {
        let params = SimParams {
            pulse_duration: 1.0,
            ..SimParams::default()
        };
        let mut particles = vec![Particle {
            inject_velocity: DVec3::new(1.0, 0.0, 0.0),
            age: 0.0,
            ..Particle::new(0, DVec3::ZERO)
        }];
        compute_velocity_biot_savart(&mut particles, &params);
        assert!((particles[0].flow_velocity.x - 1.0).abs() < 1e-10);
    }

    #[test]
    fn two_particles_induce_velocity() {
        let params = SimParams {
            use_biot_savart: true,
            pulse_duration: 0.0,
            gamma: 1.0,
            min_core_radius: 0.1,
            ..SimParams::default()
        };
        let mut particles = vec![
            Particle {
                gamma: 1.0,
                vorticity: DVec3::new(0.0, 0.0, 1.0),
                core_radius: 0.1,
                age: 100.0,
                ..Particle::new(0, DVec3::new(0.0, 0.0, 0.0))
            },
            Particle {
                gamma: 1.0,
                vorticity: DVec3::new(0.0, 0.0, 1.0),
                core_radius: 0.1,
                age: 100.0,
                ..Particle::new(1, DVec3::new(1.0, 0.0, 0.0))
            },
        ];
        compute_velocity_biot_savart(&mut particles, &params);

        // Particle 0 should have non-zero flow from particle 1
        let flow0 = particles[0].flow_velocity;
        assert!(flow0.length() > 1e-6, "Expected non-zero flow, got {:?}", flow0);
    }

    #[test]
    fn biot_savart_antisymmetric() {
        let params = SimParams {
            use_biot_savart: true,
            pulse_duration: 0.0,
            min_core_radius: 0.1,
            ..SimParams::default()
        };
        let mut particles = vec![
            Particle {
                gamma: 1.0,
                vorticity: DVec3::new(0.0, 0.0, 1.0),
                core_radius: 0.1,
                age: 100.0,
                ..Particle::new(0, DVec3::new(-0.5, 0.0, 0.0))
            },
            Particle {
                gamma: 1.0,
                vorticity: DVec3::new(0.0, 0.0, 1.0),
                core_radius: 0.1,
                age: 100.0,
                ..Particle::new(1, DVec3::new(0.5, 0.0, 0.0))
            },
        ];
        compute_velocity_biot_savart(&mut particles, &params);

        // Flow should be antisymmetric in y for symmetric placement along x
        let vy0 = particles[0].flow_velocity.y;
        let vy1 = particles[1].flow_velocity.y;
        assert!(
            (vy0 + vy1).abs() < 1e-10,
            "Expected antisymmetric vy: {} vs {}",
            vy0,
            vy1
        );
    }
}
