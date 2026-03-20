//! Particle advection: Euler and RK2 (midpoint).
//!
//! Port of `src/simulation/physics/vpm/advection.js`.

use glam::DVec3;

use crate::particle::Particle;
use crate::params::SimParams;

/// Forward Euler: x_{n+1} = x_n + dt · v(x_n). O(h).
pub fn advect_euler(particles: &mut [Particle], dt: f64) {
    for p in particles.iter_mut() {
        p.prev_position = p.position;
        p.position += p.flow_velocity * dt;
        p.velocity = p.flow_velocity * dt;
    }
}

/// Capture current positions for RK2 restore.
pub fn capture_positions(particles: &[Particle]) -> Vec<DVec3> {
    particles.iter().map(|p| p.position).collect()
}

/// Restore positions from snapshot.
pub fn restore_positions(particles: &mut [Particle], positions: &[DVec3]) {
    let count = particles.len().min(positions.len());
    for i in 0..count {
        particles[i].position = positions[i];
    }
}

/// RK2 final step: x_{n+1} = x_0 + dt · v(x_mid). O(h²).
///
/// Called after second velocity evaluation at midpoint positions.
pub fn advect_rk2_final(particles: &mut [Particle], dt: f64, saved_positions: &[DVec3]) {
    let count = particles.len().min(saved_positions.len());
    for i in 0..count {
        let x0 = saved_positions[i];
        particles[i].prev_position = x0;
        particles[i].position = x0 + particles[i].flow_velocity * dt;
        particles[i].velocity = particles[i].flow_velocity * dt;
    }
}

/// CFL-limited time step: dt_cfl = C · h / max|v|.
pub fn compute_cfl_dt(particles: &[Particle], params: &SimParams) -> CflResult {
    if particles.is_empty() {
        return CflResult {
            cfl_dt: f64::INFINITY,
            max_speed: 0.0,
        };
    }

    let max_speed = particles
        .iter()
        .map(|p| p.flow_velocity.length())
        .fold(0.0_f64, f64::max);

    if max_speed <= 1e-8 {
        return CflResult {
            cfl_dt: f64::INFINITY,
            max_speed,
        };
    }

    let h = params.core_radius_sigma.max(params.min_core_radius).max(1e-4);
    let cfl_safety = 0.4_f64.max(0.05); // default 0.4
    let cfl_dt = cfl_safety * h / max_speed;

    CflResult { cfl_dt, max_speed }
}

#[derive(Debug, Clone, Copy)]
pub struct CflResult {
    pub cfl_dt: f64,
    pub max_speed: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn euler_advection_moves_particle() {
        let mut particles = vec![Particle {
            flow_velocity: DVec3::new(1.0, 0.0, 0.0),
            ..Particle::new(0, DVec3::ZERO)
        }];

        advect_euler(&mut particles, 0.1);
        assert!((particles[0].position.x - 0.1).abs() < 1e-10);
        assert_eq!(particles[0].prev_position, DVec3::ZERO);
    }

    #[test]
    fn rk2_uses_saved_positions() {
        let saved = vec![DVec3::new(1.0, 2.0, 3.0)];
        let mut particles = vec![Particle {
            flow_velocity: DVec3::new(0.5, 0.0, 0.0),
            ..Particle::new(0, DVec3::new(999.0, 999.0, 999.0))
        }];

        advect_rk2_final(&mut particles, 0.1, &saved);
        assert!((particles[0].position.x - 1.05).abs() < 1e-10);
        assert!((particles[0].position.y - 2.0).abs() < 1e-10);
    }

    #[test]
    fn cfl_dt_finite_for_moving_particles() {
        let params = SimParams {
            core_radius_sigma: 0.1,
            ..SimParams::default()
        };
        let particles = vec![Particle {
            flow_velocity: DVec3::new(10.0, 0.0, 0.0),
            ..Particle::new(0, DVec3::ZERO)
        }];

        let result = compute_cfl_dt(&particles, &params);
        assert!(result.cfl_dt.is_finite());
        assert!(result.cfl_dt > 0.0);
        assert!((result.max_speed - 10.0).abs() < 1e-10);
    }

    #[test]
    fn cfl_dt_infinite_for_stationary() {
        let params = SimParams::default();
        let particles = vec![Particle::new(0, DVec3::ZERO)];

        let result = compute_cfl_dt(&particles, &params);
        assert!(result.cfl_dt.is_infinite());
    }
}
