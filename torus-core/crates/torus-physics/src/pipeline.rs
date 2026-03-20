//! VPM pipeline orchestrator.
//!
//! Port of `src/simulation/physics/vpm/pipeline.js`.
//!
//! Step order:
//! 1. Biot-Savart velocity (via VelocityComputer — CPU or GPU)
//! 2. Vorticity confinement
//! 3. Stability clamps
//! 4. Advection (Euler or RK2)
//! 5. Physical stages (stretching, diffusion)
//! 6. Reconnection
//! 7. Stability clamps (post-reconnection)

use crate::advection::{
    advect_euler, advect_rk2_final, capture_positions, compute_cfl_dt,
};
use crate::compute_backend::{BackendType, CpuBackend, VelocityComputer};
use crate::params::SimParams;
use crate::particle::Particle;
use crate::pse_diffusion::viscous_diffusion;
use crate::reconnection::vortex_reconnection;
use crate::stability::{apply_stability_constraints, StabilityClampStats};
use crate::vortex_stretching::vortex_stretching;
use crate::vorticity_confinement::apply_vorticity_confinement;

/// Conservation metrics snapshot.
#[derive(Debug, Clone, Default)]
pub struct ConservationMetrics {
    pub energy: f64,
    pub enstrophy: f64,
    pub circulation: f64,
    pub count: usize,
}

/// Full pipeline diagnostics for one step.
#[derive(Debug, Clone)]
pub struct PipelineDiagnostics {
    pub energy_before: f64,
    pub energy_after: f64,
    pub energy_drift_percent: f64,
    pub enstrophy_before: f64,
    pub enstrophy_after: f64,
    pub circulation_before: f64,
    pub circulation_after: f64,
    pub circulation_drift_percent: f64,
    pub particle_count_before: usize,
    pub particle_count_after: usize,
    pub clamp_stats: StabilityClampStats,
    pub substeps: u32,
    pub effective_dt: f64,
    pub cfl_dt: f64,
    pub max_speed: f64,
    pub integrator: Integrator,
    pub backend: BackendType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Integrator {
    Euler,
    Rk2,
}

fn compute_conservation_metrics(particles: &[Particle]) -> ConservationMetrics {
    let mut energy = 0.0;
    let mut enstrophy = 0.0;
    let mut circulation = 0.0;

    for p in particles {
        energy += 0.5 * p.flow_velocity.length_squared();
        enstrophy += p.vorticity.length_squared();
        circulation += p.gamma;
    }

    ConservationMetrics {
        energy,
        enstrophy,
        circulation,
        count: particles.len(),
    }
}

fn run_substep_euler(
    particles: &mut [Particle],
    params: &SimParams,
    sub_dt: f64,
    backend: &dyn VelocityComputer,
) {
    backend.compute_velocities(particles, params);
    apply_vorticity_confinement(particles, params);
    apply_stability_constraints(particles, params);
    advect_euler(particles, sub_dt);
    vortex_stretching(particles, params, sub_dt);
    viscous_diffusion(particles, params, sub_dt);
}

fn run_substep_rk2(
    particles: &mut [Particle],
    params: &SimParams,
    sub_dt: f64,
    backend: &dyn VelocityComputer,
) {
    backend.compute_velocities(particles, params);
    apply_vorticity_confinement(particles, params);
    apply_stability_constraints(particles, params);

    let saved_positions = capture_positions(particles);
    advect_euler(particles, sub_dt * 0.5);

    backend.compute_velocities(particles, params);
    apply_vorticity_confinement(particles, params);
    apply_stability_constraints(particles, params);

    advect_rk2_final(particles, sub_dt, &saved_positions);
    vortex_stretching(particles, params, sub_dt);
    viscous_diffusion(particles, params, sub_dt);
}

/// Run the full VPM pipeline using CPU backend (convenience wrapper).
pub fn run_vpm_pipeline(
    particles: &mut Vec<Particle>,
    params: &SimParams,
    dt: f64,
) -> PipelineDiagnostics {
    run_vpm_pipeline_with_backend(particles, params, dt, &CpuBackend)
}

/// Run the full VPM pipeline with a specified compute backend.
pub fn run_vpm_pipeline_with_backend(
    particles: &mut Vec<Particle>,
    params: &SimParams,
    dt: f64,
    backend: &dyn VelocityComputer,
) -> PipelineDiagnostics {
    let integrator = Integrator::Euler;
    let use_adaptive_dt = true;
    let max_substeps = 4u32;
    let backend_type = backend.backend_type();

    let before = compute_conservation_metrics(particles);
    let mut total_clamp_stats = StabilityClampStats::default();

    let mut substeps = 1u32;
    let mut effective_dt = dt;
    let mut cfl_dt = f64::INFINITY;
    let mut max_speed = 0.0;

    if use_adaptive_dt && particles.len() > 1 {
        backend.compute_velocities(particles, params);
        let cfl = compute_cfl_dt(particles, params);
        cfl_dt = cfl.cfl_dt;
        max_speed = cfl.max_speed;

        if cfl_dt.is_finite() && cfl_dt < dt {
            substeps = max_substeps.min(1.max((dt / cfl_dt).ceil() as u32));
            effective_dt = dt / substeps as f64;
        }

        apply_vorticity_confinement(particles, params);
        let stats = apply_stability_constraints(particles, params);
        merge_clamp_stats(&mut total_clamp_stats, &stats);
        advect_euler(particles, effective_dt);
        vortex_stretching(particles, params, effective_dt);
        viscous_diffusion(particles, params, effective_dt);

        for _ in 1..substeps {
            match integrator {
                Integrator::Rk2 => run_substep_rk2(particles, params, effective_dt, backend),
                Integrator::Euler => run_substep_euler(particles, params, effective_dt, backend),
            }
        }
    } else {
        match integrator {
            Integrator::Rk2 => run_substep_rk2(particles, params, dt, backend),
            Integrator::Euler => run_substep_euler(particles, params, dt, backend),
        }
    }

    vortex_reconnection(particles, params);
    let post_stats = apply_stability_constraints(particles, params);
    merge_clamp_stats(&mut total_clamp_stats, &post_stats);

    let after = compute_conservation_metrics(particles);

    let circulation_drift = if before.circulation.abs() > 1e-8 {
        (after.circulation - before.circulation) / before.circulation.abs() * 100.0
    } else {
        0.0
    };
    let energy_drift = if before.energy > 1e-12 {
        (after.energy - before.energy) / before.energy * 100.0
    } else {
        0.0
    };

    PipelineDiagnostics {
        energy_before: before.energy,
        energy_after: after.energy,
        energy_drift_percent: energy_drift,
        enstrophy_before: before.enstrophy,
        enstrophy_after: after.enstrophy,
        circulation_before: before.circulation,
        circulation_after: after.circulation,
        circulation_drift_percent: circulation_drift,
        particle_count_before: before.count,
        particle_count_after: after.count,
        clamp_stats: total_clamp_stats,
        substeps,
        effective_dt,
        cfl_dt,
        max_speed,
        integrator,
        backend: backend_type,
    }
}

fn merge_clamp_stats(total: &mut StabilityClampStats, step: &StabilityClampStats) {
    total.velocity_clamp_count += step.velocity_clamp_count;
    total.vorticity_clamp_count += step.vorticity_clamp_count;
    total.core_radius_clamp_min_count += step.core_radius_clamp_min_count;
    total.core_radius_clamp_max_count += step.core_radius_clamp_max_count;
    total.core_radius_override_count += step.core_radius_override_count;
    total.total_energy_destroyed_by_velocity_clamp +=
        step.total_energy_destroyed_by_velocity_clamp;
    total.total_enstrophy_destroyed_by_vorticity_clamp +=
        step.total_enstrophy_destroyed_by_vorticity_clamp;
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::DVec3;

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

    #[test]
    fn pipeline_runs_without_panic() {
        let params = SimParams {
            use_biot_savart: true,
            stretching_strength: 0.1,
            viscosity: 0.001,
            reconnection_distance: 0.001,
            min_core_radius: 0.02,
            core_radius_sigma: 0.1,
            max_velocity: 10.0,
            max_vorticity: 1.0,
            reconnection_min_age: 0.0,
            pulse_duration: 0.0,
            ..SimParams::default()
        };

        let mut particles = create_vortex_ring(32, 1.0, 1.0, 0.1);
        let diag = run_vpm_pipeline(&mut particles, &params, 0.001);

        assert!(diag.particle_count_after > 0);
        assert!(diag.effective_dt > 0.0);
        assert_eq!(diag.backend, BackendType::CpuRayon);
    }

    #[test]
    fn pipeline_tracks_conservation() {
        let params = SimParams {
            use_biot_savart: true,
            stretching_strength: 0.0,
            viscosity: 0.0,
            reconnection_distance: 0.0,
            max_velocity: 100.0,
            max_vorticity: 100.0,
            min_core_radius: 0.05,
            core_radius_sigma: 0.1,
            pulse_duration: 0.0,
            ..SimParams::default()
        };

        let mut particles = create_vortex_ring(16, 1.0, 1.0, 0.1);
        let diag = run_vpm_pipeline(&mut particles, &params, 0.001);

        assert!(
            diag.circulation_drift_percent.abs() < 1e-6,
            "Circulation drift: {}%",
            diag.circulation_drift_percent
        );
        assert_eq!(diag.particle_count_before, diag.particle_count_after);
    }

    #[test]
    fn vortex_ring_propagates() {
        let params = SimParams {
            use_biot_savart: true,
            stretching_strength: 0.0,
            viscosity: 0.0,
            reconnection_distance: 0.0,
            max_velocity: 100.0,
            max_vorticity: 100.0,
            min_core_radius: 0.05,
            core_radius_sigma: 0.1,
            pulse_duration: 0.0,
            ..SimParams::default()
        };

        let mut particles = create_vortex_ring(32, 1.0, 1.0, 0.1);
        let center_before: DVec3 =
            particles.iter().map(|p| p.position).sum::<DVec3>() / particles.len() as f64;

        for _ in 0..10 {
            run_vpm_pipeline(&mut particles, &params, 0.001);
        }

        let center_after: DVec3 =
            particles.iter().map(|p| p.position).sum::<DVec3>() / particles.len() as f64;
        let displacement = (center_after - center_before).length();

        assert!(
            displacement > 1e-6,
            "Vortex ring should self-propel, displacement = {}",
            displacement
        );
    }

    #[test]
    fn pipeline_with_explicit_cpu_backend() {
        let params = SimParams {
            use_biot_savart: true,
            pulse_duration: 0.0,
            min_core_radius: 0.05,
            core_radius_sigma: 0.1,
            max_velocity: 100.0,
            max_vorticity: 100.0,
            ..SimParams::default()
        };

        let backend = CpuBackend;
        let mut particles = create_vortex_ring(16, 1.0, 1.0, 0.1);
        let diag = run_vpm_pipeline_with_backend(&mut particles, &params, 0.001, &backend);

        assert_eq!(diag.backend, BackendType::CpuRayon);
        assert!(diag.particle_count_after > 0);
    }
}
