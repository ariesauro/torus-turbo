//! Analytic vortex stretching: (ω·∇)u from differentiated Biot-Savart kernel.
//!
//! Port of `src/simulation/physics/vpm/vortexStretching.js`.
//!
//! (ω_i·∇)u = Σ_j (γ_j/4π) · [ (ω_i × ω_j)/(r²+σ²)^(3/2)
//!                               − 3(ω_i·r)(r × ω_j)/(r²+σ²)^(5/2) ]

use glam::DVec3;
use rayon::prelude::*;

use crate::particle::Particle;
use crate::params::SimParams;

const FOUR_PI: f64 = 4.0 * std::f64::consts::PI;

/// Analytic stretching — O(N²), parallelized.
pub fn analytic_stretching(
    particles: &mut [Particle],
    params: &SimParams,
    dt: f64,
    strength: f64,
) {
    let count = particles.len();
    if count <= 1 {
        return;
    }

    let min_core = params.min_core_radius.max(1e-4);
    let interaction_radius2 = if params.interaction_radius > 0.0 {
        params.interaction_radius * params.interaction_radius
    } else {
        0.0
    };
    let use_cutoff = params.interaction_radius > 0.0;

    let positions: Vec<DVec3> = particles.iter().map(|p| p.position).collect();
    let vorticities: Vec<DVec3> = particles.iter().map(|p| p.vorticity).collect();
    let gammas: Vec<f64> = particles.iter().map(|p| p.gamma).collect();
    let sigmas: Vec<f64> = particles
        .iter()
        .map(|p| p.core_radius.max(min_core))
        .collect();

    let d_omega: Vec<DVec3> = (0..count)
        .into_par_iter()
        .map(|i| {
            let omega_i = vorticities[i];
            let omega_mag = omega_i.length();
            if omega_mag <= 1e-8 {
                return DVec3::ZERO;
            }

            let pos_i = positions[i];
            let mut d = DVec3::ZERO;

            for j in 0..count {
                if i == j {
                    continue;
                }

                let r = pos_i - positions[j];
                let r2 = r.length_squared();

                if use_cutoff && r2 > interaction_radius2 {
                    continue;
                }

                let sigma = sigmas[j];
                let sigma2 = sigma * sigma;
                let r2s2 = r2 + sigma2;

                if r2s2 <= 1e-16 {
                    continue;
                }

                let gamma_j = gammas[j];
                if gamma_j.abs() <= 1e-12 {
                    continue;
                }

                let omega_j = vorticities[j];
                let r2s2_15 = r2s2.powf(1.5);
                let r2s2_25 = r2s2_15 * r2s2;

                // ω_i × ω_j
                let cross_omega = omega_i.cross(omega_j);

                // ω_i · r
                let omega_dot_r = omega_i.dot(r);

                // r × ω_j
                let r_cross_omega = r.cross(omega_j);

                let f3 = gamma_j / (FOUR_PI * r2s2_15);
                let f5 = -3.0 * gamma_j * omega_dot_r / (FOUR_PI * r2s2_25);

                d += cross_omega * f3 + r_cross_omega * f5;
            }

            d
        })
        .collect();

    for (i, particle) in particles.iter_mut().enumerate() {
        particle.vorticity += d_omega[i] * (dt * strength);
    }
}

/// Main stretching entry point.
pub fn vortex_stretching(particles: &mut [Particle], params: &SimParams, dt: f64) {
    let strength = params.stretching_strength.max(0.0);
    if strength <= 0.0 || particles.len() <= 1 {
        return;
    }

    analytic_stretching(particles, params, dt, strength);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stretching_modifies_vorticity() {
        let params = SimParams {
            stretching_strength: 1.0,
            min_core_radius: 0.1,
            ..SimParams::default()
        };

        let mut particles = vec![
            Particle {
                gamma: 1.0,
                vorticity: DVec3::new(0.0, 0.0, 1.0),
                core_radius: 0.1,
                ..Particle::new(0, DVec3::new(0.0, 0.0, 0.0))
            },
            Particle {
                gamma: 1.0,
                vorticity: DVec3::new(1.0, 0.0, 0.0),
                core_radius: 0.1,
                ..Particle::new(1, DVec3::new(0.5, 0.0, 0.0))
            },
        ];

        let before_0 = particles[0].vorticity;
        vortex_stretching(&mut particles, &params, 0.01);

        let after_0 = particles[0].vorticity;
        assert!(
            (after_0 - before_0).length() > 1e-10,
            "Stretching should modify vorticity"
        );
    }

    #[test]
    fn zero_strength_no_change() {
        let params = SimParams {
            stretching_strength: 0.0,
            ..SimParams::default()
        };

        let mut particles = vec![
            Particle {
                gamma: 1.0,
                vorticity: DVec3::new(0.0, 0.0, 1.0),
                core_radius: 0.1,
                ..Particle::new(0, DVec3::ZERO)
            },
            Particle {
                gamma: 1.0,
                vorticity: DVec3::new(1.0, 0.0, 0.0),
                core_radius: 0.1,
                ..Particle::new(1, DVec3::new(1.0, 0.0, 0.0))
            },
        ];

        let before = particles[0].vorticity;
        vortex_stretching(&mut particles, &params, 0.01);
        assert_eq!(particles[0].vorticity, before);
    }
}
