//! PSE (Particle Strength Exchange) diffusion.
//!
//! Port of `src/simulation/physics/vpm/vortexDiffusion.js`.
//!
//! dω_i/dt = (2ν/ε²) · Σ_j (ω_j − ω_i) · η_ε(r_ij) · V
//! η_ε(r) = exp(−r²/(4ε²)) / (4πε²)^(3/2)
//!
//! The antisymmetric form (ω_j − ω_i) guarantees Σ dω = 0.

use glam::DVec3;

use crate::particle::Particle;
use crate::params::SimParams;

const FOUR_PI_CUBED_SQRT: f64 = 31.006_276_680_299_82; // (4π)^1.5

/// PSE inter-particle diffusion — O(N²).
///
/// Antisymmetric kernel conserves total vorticity exactly.
pub fn pse_diffusion(particles: &mut [Particle], params: &SimParams, dt: f64, viscosity: f64) {
    let count = particles.len();
    if count <= 1 {
        return;
    }

    let min_core = params.min_core_radius.max(1e-4);
    let eps = params.core_radius_sigma.max(min_core);
    let eps2 = eps * eps;
    let four_eps2 = 4.0 * eps2;
    let volume = eps * eps * eps;
    let kernel_norm = 1.0 / (FOUR_PI_CUBED_SQRT * eps2 * eps);
    let prefactor = 2.0 * viscosity * volume * kernel_norm / eps2;

    let interaction_radius2 = if params.interaction_radius > 0.0 {
        params.interaction_radius * params.interaction_radius
    } else {
        0.0
    };
    let use_cutoff = params.interaction_radius > 0.0;

    let mut d_omega: Vec<DVec3> = vec![DVec3::ZERO; count];

    for i in 0..count {
        let omega_i = particles[i].vorticity;
        let pos_i = particles[i].position;

        for j in (i + 1)..count {
            let r = pos_i - particles[j].position;
            let r2 = r.length_squared();

            if use_cutoff && r2 > interaction_radius2 {
                continue;
            }

            let exp_val = (-r2 / four_eps2).exp();
            if exp_val < 1e-8 {
                continue;
            }

            let factor = prefactor * exp_val;
            let diff = particles[j].vorticity - omega_i;
            let contribution = diff * factor;

            d_omega[i] += contribution;
            d_omega[j] -= contribution;
        }
    }

    for (i, particle) in particles.iter_mut().enumerate() {
        particle.vorticity += d_omega[i] * dt;
    }
}

/// Lamb-Oseen core spreading: σ² += 4νdt.
///
/// Correct for single isolated blob but does NOT exchange vorticity between particles.
pub fn core_spread_diffusion(particles: &mut [Particle], params: &SimParams, dt: f64, viscosity: f64) {
    let min_core = params.min_core_radius.max(1e-4);

    for particle in particles.iter_mut() {
        let sigma = particle.core_radius.max(min_core);
        particle.core_radius = (sigma * sigma + 4.0 * viscosity * dt).sqrt();
    }
}

/// Main diffusion entry point — dispatches to PSE or core spreading.
pub fn viscous_diffusion(particles: &mut [Particle], params: &SimParams, dt: f64) {
    let viscosity = params.viscosity.max(0.0);
    if viscosity <= 0.0 || particles.len() <= 1 {
        return;
    }

    // Default to PSE
    pse_diffusion(particles, params, dt, viscosity);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pse_conserves_total_vorticity() {
        let params = SimParams {
            viscosity: 0.01,
            min_core_radius: 0.1,
            core_radius_sigma: 0.1,
            ..SimParams::default()
        };

        let mut particles = vec![
            Particle {
                vorticity: DVec3::new(0.0, 0.0, 1.0),
                core_radius: 0.1,
                ..Particle::new(0, DVec3::new(0.0, 0.0, 0.0))
            },
            Particle {
                vorticity: DVec3::new(0.0, 0.0, 0.5),
                core_radius: 0.1,
                ..Particle::new(1, DVec3::new(0.15, 0.0, 0.0))
            },
            Particle {
                vorticity: DVec3::new(0.0, 0.0, 0.2),
                core_radius: 0.1,
                ..Particle::new(2, DVec3::new(0.0, 0.15, 0.0))
            },
        ];

        let total_before: DVec3 = particles.iter().map(|p| p.vorticity).sum();
        pse_diffusion(&mut particles, &params, 0.01, 0.01);
        let total_after: DVec3 = particles.iter().map(|p| p.vorticity).sum();

        let drift = (total_after - total_before).length();
        assert!(
            drift < 1e-12,
            "PSE should conserve total vorticity, drift = {}",
            drift
        );
    }

    #[test]
    fn pse_diffuses_vorticity() {
        let params = SimParams {
            viscosity: 0.1,
            min_core_radius: 0.1,
            core_radius_sigma: 0.1,
            ..SimParams::default()
        };

        let mut particles = vec![
            Particle {
                vorticity: DVec3::new(0.0, 0.0, 1.0),
                core_radius: 0.1,
                ..Particle::new(0, DVec3::new(0.0, 0.0, 0.0))
            },
            Particle {
                vorticity: DVec3::ZERO,
                core_radius: 0.1,
                ..Particle::new(1, DVec3::new(0.1, 0.0, 0.0))
            },
        ];

        pse_diffusion(&mut particles, &params, 0.1, 0.1);

        // Particle 0 should have lost vorticity, particle 1 should have gained
        assert!(particles[0].vorticity.z < 1.0);
        assert!(particles[1].vorticity.z > 0.0);
    }

    #[test]
    fn core_spread_increases_radius() {
        let params = SimParams {
            min_core_radius: 0.01,
            ..SimParams::default()
        };

        let mut particles = vec![Particle {
            core_radius: 0.1,
            ..Particle::new(0, DVec3::ZERO)
        }];

        let before = particles[0].core_radius;
        core_spread_diffusion(&mut particles, &params, 0.01, 0.01);
        assert!(particles[0].core_radius > before);
    }
}
