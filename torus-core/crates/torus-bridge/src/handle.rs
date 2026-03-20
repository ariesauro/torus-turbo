//! Simulation handle — shared state for Tauri commands.

use std::sync::Mutex;

use torus_physics::compute_backend::{BackendType, VelocityComputer};
use torus_physics::params::SimParams;
use torus_physics::particle::Particle;
use torus_physics::pipeline::{PipelineDiagnostics, run_vpm_pipeline_with_backend};

/// Serializable diagnostics for the JS frontend.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DiagnosticsSnapshot {
    pub energy: f64,
    pub enstrophy: f64,
    pub circulation: f64,
    pub particle_count: usize,
    pub max_speed: f64,
    pub cfl_dt: f64,
    pub effective_dt: f64,
    pub substeps: u32,
    pub velocity_clamp_count: u32,
    pub vorticity_clamp_count: u32,
    pub energy_drift_percent: f64,
    pub circulation_drift_percent: f64,
    pub backend: String,
}

impl DiagnosticsSnapshot {
    pub fn from_diag(d: &PipelineDiagnostics) -> Self {
        Self {
            energy: d.energy_after,
            enstrophy: d.enstrophy_after,
            circulation: d.circulation_after,
            particle_count: d.particle_count_after,
            max_speed: d.max_speed,
            cfl_dt: d.cfl_dt,
            effective_dt: d.effective_dt,
            substeps: d.substeps,
            velocity_clamp_count: d.clamp_stats.velocity_clamp_count,
            vorticity_clamp_count: d.clamp_stats.vorticity_clamp_count,
            energy_drift_percent: d.energy_drift_percent,
            circulation_drift_percent: d.circulation_drift_percent,
            backend: d.backend.to_string(),
        }
    }
}

/// Serializable particle snapshot for rendering.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ParticleSnapshot {
    pub count: usize,
    pub positions: Vec<[f32; 3]>,
    pub vorticities: Vec<[f32; 3]>,
    pub gammas: Vec<f32>,
    pub core_radii: Vec<f32>,
}

impl ParticleSnapshot {
    pub fn from_particles(particles: &[Particle]) -> Self {
        Self {
            count: particles.len(),
            positions: particles
                .iter()
                .map(|p| [p.position.x as f32, p.position.y as f32, p.position.z as f32])
                .collect(),
            vorticities: particles
                .iter()
                .map(|p| [p.vorticity.x as f32, p.vorticity.y as f32, p.vorticity.z as f32])
                .collect(),
            gammas: particles.iter().map(|p| p.gamma as f32).collect(),
            core_radii: particles.iter().map(|p| p.core_radius as f32).collect(),
        }
    }
}

/// Core simulation state with auto-detected compute backend.
pub struct SimulationHandle {
    pub particles: Vec<Particle>,
    pub params: SimParams,
    pub last_diagnostics: Option<PipelineDiagnostics>,
    pub step_count: u64,
    pub backend: Box<dyn VelocityComputer>,
    pub camera_azimuth: f32,
    pub camera_elevation: f32,
    pub camera_distance: f32,
    pub camera_target: [f32; 3],
    pub camera_aspect: f32,
}

impl SimulationHandle {
    pub fn new() -> Self {
        let backend = torus_gpu::gpu_backend::auto_detect_backend(4096);
        Self {
            particles: Vec::new(),
            params: SimParams::default(),
            last_diagnostics: None,
            step_count: 0,
            backend,
            camera_azimuth: 0.0,
            camera_elevation: 0.3,
            camera_distance: 8.0,
            camera_target: [0.0, 0.0, 0.0],
            camera_aspect: 1.5,
        }
    }

    pub fn step(&mut self, dt: f64) -> &PipelineDiagnostics {
        let diag = run_vpm_pipeline_with_backend(
            &mut self.particles,
            &self.params,
            dt,
            self.backend.as_ref(),
        );
        self.last_diagnostics = Some(diag);
        self.step_count += 1;
        self.last_diagnostics.as_ref().unwrap()
    }

    pub fn snapshot(&self) -> ParticleSnapshot {
        ParticleSnapshot::from_particles(&self.particles)
    }

    pub fn diagnostics(&self) -> Option<DiagnosticsSnapshot> {
        self.last_diagnostics.as_ref().map(DiagnosticsSnapshot::from_diag)
    }

    pub fn backend_type(&self) -> BackendType {
        self.backend.backend_type()
    }

    pub fn backend_label(&self) -> &str {
        self.backend.backend_label()
    }
}

/// Global simulation state.
pub static SIMULATION: Mutex<Option<SimulationHandle>> = Mutex::new(None);

pub fn ensure_initialized() -> bool {
    let mut lock = SIMULATION.lock().unwrap();
    if lock.is_none() {
        *lock = Some(SimulationHandle::new());
    }
    true
}
