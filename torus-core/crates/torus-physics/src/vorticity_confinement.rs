//! Vorticity confinement: counteracts numerical diffusion of vorticity.
//!
//! Port of `src/simulation/physics/vpm/vorticityConfinement.js`.
//!
//! Computes gradient of |ω| via neighbor queries, then adds
//! f_conf = ε · (N × ω) as a velocity correction.

use glam::DVec3;

use crate::particle::Particle;
use crate::params::SimParams;

pub fn apply_vorticity_confinement(particles: &mut [Particle], params: &SimParams) {
    let count = particles.len();
    let strength = params.vorticity_confinement_strength;
    let min_core = params.min_core_radius.max(1e-4);
    let base_core = params.core_radius_sigma.max(min_core);

    if strength.abs() <= 1e-6 || count <= 1 {
        return;
    }

    let interaction_radius2 = if params.interaction_radius > 0.0 {
        params.interaction_radius * params.interaction_radius
    } else {
        0.0
    };
    let use_cutoff = params.interaction_radius > 0.0;
    let confinement_scale = strength * 1.0_f64.max(1.0); // cellSizeMultiplier default 1

    let positions: Vec<DVec3> = particles.iter().map(|p| p.position).collect();
    let omega_mags: Vec<f64> = particles.iter().map(|p| p.vorticity.length()).collect();
    let vorticities: Vec<DVec3> = particles.iter().map(|p| p.vorticity).collect();
    let sigmas: Vec<f64> = particles
        .iter()
        .map(|p| p.core_radius.max(base_core))
        .collect();

    let corrections: Vec<DVec3> = (0..count)
        .map(|i| {
            let omega_mag_i = omega_mags[i];
            if omega_mag_i <= 1e-6 {
                return DVec3::ZERO;
            }

            let pos_i = positions[i];
            let mut grad = DVec3::ZERO;

            for j in 0..count {
                if i == j {
                    continue;
                }

                let r = positions[j] - pos_i;
                let r2 = r.length_squared();
                if use_cutoff && r2 > interaction_radius2 {
                    continue;
                }

                let r_len = (r2 + 1e-6).sqrt();
                if r_len <= 1e-6 {
                    continue;
                }

                let sigma = sigmas[j];
                let influence = (-r2 / (2.0 * sigma * sigma)).exp();
                if influence < 1e-4 {
                    continue;
                }

                let d_omega = (omega_mags[j] - omega_mag_i) * influence;
                grad += (r / r_len) * d_omega;
            }

            let grad_len = grad.length();
            if grad_len <= 1e-6 {
                return DVec3::ZERO;
            }

            let n = grad / grad_len;
            let omega = vorticities[i];

            // f_conf = ε · (N × ω)
            n.cross(omega) * confinement_scale
        })
        .collect();

    for (i, p) in particles.iter_mut().enumerate() {
        p.flow_velocity += corrections[i];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_confinement_when_strength_zero() {
        let params = SimParams {
            vorticity_confinement_strength: 0.0,
            ..SimParams::default()
        };

        let mut particles = vec![
            Particle {
                vorticity: DVec3::new(0.0, 0.0, 1.0),
                ..Particle::new(0, DVec3::ZERO)
            },
            Particle {
                vorticity: DVec3::new(0.0, 0.0, 0.5),
                ..Particle::new(1, DVec3::new(0.1, 0.0, 0.0))
            },
        ];

        let flow_before = particles[0].flow_velocity;
        apply_vorticity_confinement(&mut particles, &params);
        assert_eq!(particles[0].flow_velocity, flow_before);
    }
}
