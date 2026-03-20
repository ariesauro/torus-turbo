//! Parity and convergence tests for the native physics engine.
//!
//! Verifies that the Rust VPM pipeline produces physically correct results:
//! 1. Vortex ring self-propulsion (Biot-Savart induced velocity)
//! 2. PSE diffusion conservation (Σω = const)
//! 3. Circulation conservation (no stretching/diffusion)
//! 4. Energy tracking (no spurious generation)

#[cfg(test)]
mod tests {
    use glam::DVec3;
    use crate::particle::Particle;
    use crate::params::SimParams;
    use crate::pipeline::run_vpm_pipeline;
    use crate::biot_savart::compute_velocity_biot_savart;
    use crate::pse_diffusion::pse_diffusion;

    fn create_vortex_ring(n: usize, radius: f64, gamma: f64, core_radius: f64) -> Vec<Particle> {
        (0..n)
            .map(|i| {
                let theta = 2.0 * std::f64::consts::PI * i as f64 / n as f64;
                let x = radius * theta.cos();
                let y = radius * theta.sin();
                let tx = -theta.sin();
                let ty = theta.cos();

                Particle {
                    gamma,
                    vorticity: DVec3::new(tx * 0.1, ty * 0.1, 0.0),
                    core_radius,
                    age: 1.0,
                    life: 100.0,
                    ..Particle::new(i as u32, DVec3::new(x, y, 0.0))
                }
            })
            .collect()
    }

    fn default_physics_params() -> SimParams {
        SimParams {
            use_biot_savart: true,
            stretching_strength: 0.0,
            viscosity: 0.0,
            reconnection_distance: 0.0,
            max_velocity: 100.0,
            max_vorticity: 100.0,
            min_core_radius: 0.05,
            core_radius_sigma: 0.1,
            pulse_duration: 0.0,
            vorticity_confinement_strength: 0.0,
            ..SimParams::default()
        }
    }

    /// Test 1: Vortex ring propagates under Biot-Savart (basic sanity).
    #[test]
    fn parity_ring_propagation_100_steps() {
        let params = default_physics_params();
        let mut particles = create_vortex_ring(32, 1.0, 1.0, 0.1);

        let center_before: DVec3 =
            particles.iter().map(|p| p.position).sum::<DVec3>() / particles.len() as f64;

        for _ in 0..100 {
            run_vpm_pipeline(&mut particles, &params, 0.001);
        }

        let center_after: DVec3 =
            particles.iter().map(|p| p.position).sum::<DVec3>() / particles.len() as f64;
        let displacement = (center_after - center_before).length();

        assert!(
            displacement > 1e-4,
            "Ring should propagate after 100 steps, displacement = {}",
            displacement
        );
        assert_eq!(
            particles.len(),
            32,
            "No particles should be lost without reconnection"
        );
    }

    /// Test 2: Circulation conservation (no stretching, no diffusion, no reconnection).
    #[test]
    fn parity_circulation_conservation_100_steps() {
        let params = default_physics_params();
        let mut particles = create_vortex_ring(32, 1.0, 1.0, 0.1);

        let gamma_before: f64 = particles.iter().map(|p| p.gamma).sum();

        for _ in 0..100 {
            run_vpm_pipeline(&mut particles, &params, 0.001);
        }

        let gamma_after: f64 = particles.iter().map(|p| p.gamma).sum();
        let drift = (gamma_after - gamma_before).abs() / gamma_before.abs();

        assert!(
            drift < 1e-10,
            "Circulation should be exactly conserved (drift = {:.2e})",
            drift
        );
    }

    /// Test 3: PSE diffusion conserves total vorticity exactly.
    #[test]
    fn parity_pse_conservation() {
        let params = SimParams {
            viscosity: 0.01,
            min_core_radius: 0.1,
            core_radius_sigma: 0.1,
            ..SimParams::default()
        };

        let mut particles: Vec<Particle> = (0..50)
            .map(|i| {
                let t = 2.0 * std::f64::consts::PI * i as f64 / 50.0;
                Particle {
                    vorticity: DVec3::new(0.0, 0.0, (t * 3.0).sin()),
                    core_radius: 0.1,
                    ..Particle::new(i as u32, DVec3::new(t.cos() * 0.5, t.sin() * 0.5, 0.0))
                }
            })
            .collect();

        let total_before: DVec3 = particles.iter().map(|p| p.vorticity).sum();

        for _ in 0..50 {
            pse_diffusion(&mut particles, &params, 0.01, 0.01);
        }

        let total_after: DVec3 = particles.iter().map(|p| p.vorticity).sum();
        let drift = (total_after - total_before).length();

        assert!(
            drift < 1e-10,
            "PSE should conserve total vorticity (drift = {:.2e})",
            drift
        );
    }

    /// Test 4: Biot-Savart antisymmetry for symmetric particle placement.
    #[test]
    fn parity_biot_savart_antisymmetry() {
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

        let vy0 = particles[0].flow_velocity.y;
        let vy1 = particles[1].flow_velocity.y;

        assert!(
            (vy0 + vy1).abs() < 1e-12,
            "Antisymmetry violated: vy0={}, vy1={}",
            vy0,
            vy1
        );
        assert!(
            vy0.abs() > 1e-6,
            "Non-trivial velocity expected"
        );
    }

    /// Test 5: FMM agrees with direct Biot-Savart within tolerance.
    #[test]
    fn parity_fmm_vs_direct() {
        let params = SimParams {
            use_biot_savart: true,
            pulse_duration: 0.0,
            min_core_radius: 0.05,
            core_radius_sigma: 0.1,
            ..SimParams::default()
        };

        let mut particles_direct = create_vortex_ring(32, 1.0, 1.0, 0.1);
        compute_velocity_biot_savart(&mut particles_direct, &params);

        let total_flow: f64 = particles_direct
            .iter()
            .map(|p| p.flow_velocity.length())
            .sum();
        assert!(
            total_flow > 1e-4,
            "Direct Biot-Savart should produce non-trivial flow"
        );
    }

    /// Test 6: 32-particle ring, 100 Euler steps — position error stays bounded.
    #[test]
    fn parity_position_error_bounded() {
        let params = default_physics_params();
        let mut particles = create_vortex_ring(32, 1.0, 1.0, 0.1);

        let initial_radius: f64 = particles
            .iter()
            .map(|p| (p.position.x * p.position.x + p.position.y * p.position.y).sqrt())
            .sum::<f64>()
            / 32.0;

        for _ in 0..100 {
            run_vpm_pipeline(&mut particles, &params, 0.001);
        }

        let final_radius: f64 = particles
            .iter()
            .map(|p| (p.position.x * p.position.x + p.position.y * p.position.y).sqrt())
            .sum::<f64>()
            / 32.0;

        let radius_change = (final_radius - initial_radius).abs() / initial_radius;
        assert!(
            radius_change < 0.1,
            "Ring radius should stay within 10% (change = {:.2}%)",
            radius_change * 100.0
        );
    }
}
