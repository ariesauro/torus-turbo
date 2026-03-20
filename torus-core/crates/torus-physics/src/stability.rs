//! Stability constraints: velocity/vorticity clamps, core radius limits.
//!
//! Port of `src/simulation/physics/vpm/stability.js`.
//!
//! These are SAFETY NETS, not physics. Every activation is an energy violation.

use glam::DVec3;

use crate::particle::Particle;
use crate::params::SimParams;

/// Per-step clamp activation statistics.
#[derive(Debug, Clone, Default)]
pub struct StabilityClampStats {
    pub velocity_clamp_count: u32,
    pub vorticity_clamp_count: u32,
    pub core_radius_clamp_min_count: u32,
    pub core_radius_clamp_max_count: u32,
    pub core_radius_override_count: u32,
    pub total_energy_destroyed_by_velocity_clamp: f64,
    pub total_enstrophy_destroyed_by_vorticity_clamp: f64,
}

fn clamp_magnitude(v: DVec3, max_value: f64) -> (DVec3, bool, f64) {
    if max_value <= 0.0 {
        return (v, false, 0.0);
    }
    let len = v.length();
    if len <= max_value || len <= 1e-8 {
        return (v, false, 0.0);
    }
    let scale = max_value / len;
    let destroyed = 0.5 * (len * len - max_value * max_value);
    (v * scale, true, destroyed)
}

/// Apply velocity and vorticity clamps.
fn clamp_velocity_and_vorticity(
    particles: &mut [Particle],
    params: &SimParams,
    stats: &mut StabilityClampStats,
) {
    let max_velocity = params.max_velocity.max(0.0);
    let max_vorticity = params.max_vorticity.max(0.0);

    if max_velocity <= 0.0 && max_vorticity <= 0.0 {
        return;
    }

    for p in particles.iter_mut() {
        if max_velocity > 0.0 {
            let (clamped, was_clamped, destroyed) =
                clamp_magnitude(p.flow_velocity, max_velocity);
            p.flow_velocity = clamped;
            if was_clamped {
                stats.velocity_clamp_count += 1;
                stats.total_energy_destroyed_by_velocity_clamp += destroyed;
            }
        }

        if max_vorticity > 0.0 {
            let (clamped, was_clamped, destroyed) =
                clamp_magnitude(p.vorticity, max_vorticity);
            p.vorticity = clamped;
            if was_clamped {
                stats.vorticity_clamp_count += 1;
                stats.total_enstrophy_destroyed_by_vorticity_clamp += destroyed;
            }
        }
    }
}

/// Force σ = R · sigmaRatio (scripted mode only).
fn stabilize_core_radius(
    particles: &mut [Particle],
    params: &SimParams,
    stats: &mut StabilityClampStats,
) {
    if params.auto_core_radius_sigma <= 0.0 {
        return;
    }

    let target_sigma = params.ring_major * params.max_sigma_ratio.max(0.01);

    for p in particles.iter_mut() {
        if (p.core_radius - target_sigma).abs() > 1e-8 {
            stats.core_radius_override_count += 1;
        }
        p.core_radius = target_sigma;
    }
}

/// Clamp σ to [minCoreRadius, R·maxSigmaRatio].
fn limit_core_radius(
    particles: &mut [Particle],
    params: &SimParams,
    stats: &mut StabilityClampStats,
) {
    let max_sigma = params.ring_major * params.max_sigma_ratio;
    let min_sigma = params.min_core_radius;

    for p in particles.iter_mut() {
        if p.core_radius > max_sigma {
            p.core_radius = max_sigma;
            stats.core_radius_clamp_max_count += 1;
        }
        if p.core_radius < min_sigma {
            p.core_radius = min_sigma;
            stats.core_radius_clamp_min_count += 1;
        }
    }
}

/// Apply all stability constraints, returning clamp statistics.
pub fn apply_stability_constraints(
    particles: &mut [Particle],
    params: &SimParams,
) -> StabilityClampStats {
    let mut stats = StabilityClampStats::default();
    clamp_velocity_and_vorticity(particles, params, &mut stats);
    stabilize_core_radius(particles, params, &mut stats);
    limit_core_radius(particles, params, &mut stats);
    stats
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_excessive_velocity() {
        let params = SimParams {
            max_velocity: 5.0,
            max_vorticity: 0.0,
            ..SimParams::default()
        };

        let mut particles = vec![Particle {
            flow_velocity: DVec3::new(10.0, 0.0, 0.0),
            ..Particle::new(0, DVec3::ZERO)
        }];

        let stats = apply_stability_constraints(&mut particles, &params);
        assert_eq!(stats.velocity_clamp_count, 1);
        assert!((particles[0].flow_velocity.length() - 5.0).abs() < 1e-10);
        assert!(stats.total_energy_destroyed_by_velocity_clamp > 0.0);
    }

    #[test]
    fn no_clamp_within_limits() {
        let params = SimParams {
            max_velocity: 10.0,
            max_vorticity: 1.0,
            ..SimParams::default()
        };

        let mut particles = vec![Particle {
            flow_velocity: DVec3::new(1.0, 0.0, 0.0),
            vorticity: DVec3::new(0.0, 0.0, 0.1),
            ..Particle::new(0, DVec3::ZERO)
        }];

        let stats = apply_stability_constraints(&mut particles, &params);
        assert_eq!(stats.velocity_clamp_count, 0);
        assert_eq!(stats.vorticity_clamp_count, 0);
    }

    #[test]
    fn limits_core_radius() {
        let params = SimParams {
            min_core_radius: 0.01,
            ring_major: 1.0,
            max_sigma_ratio: 0.25,
            max_velocity: 0.0,
            max_vorticity: 0.0,
            ..SimParams::default()
        };

        let mut particles = vec![
            Particle {
                core_radius: 0.001,
                ..Particle::new(0, DVec3::ZERO)
            },
            Particle {
                core_radius: 0.5,
                ..Particle::new(1, DVec3::ZERO)
            },
        ];

        let stats = apply_stability_constraints(&mut particles, &params);
        assert_eq!(stats.core_radius_clamp_min_count, 1);
        assert_eq!(stats.core_radius_clamp_max_count, 1);
        assert!(particles[0].core_radius >= 0.01);
        assert!(particles[1].core_radius <= 0.25);
    }
}
