//! Compute backend abstraction — CPU (rayon) or GPU (wgpu).
//!
//! The pipeline calls `compute_velocities()` which dispatches to
//! either CPU Biot-Savart (rayon parallel) or GPU wgpu compute shaders.

use crate::params::SimParams;
use crate::particle::Particle;
use crate::biot_savart::compute_velocity_biot_savart;

/// Backend type identifier for diagnostics/splash.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub enum BackendType {
    CpuRayon,
    GpuNative,
}

impl std::fmt::Display for BackendType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BackendType::CpuRayon => write!(f, "Native CPU (rayon)"),
            BackendType::GpuNative => write!(f, "Native GPU (wgpu)"),
        }
    }
}

/// Trait for velocity computation backends.
///
/// Implemented by CPU (rayon) and GPU (wgpu) backends.
/// The pipeline calls this to compute flow velocities for all particles.
pub trait VelocityComputer: Send + Sync {
    fn compute_velocities(&self, particles: &mut [Particle], params: &SimParams);
    fn backend_type(&self) -> BackendType;
    fn backend_label(&self) -> &str;
}

/// CPU backend using rayon-parallelized direct Biot-Savart.
pub struct CpuBackend;

impl VelocityComputer for CpuBackend {
    fn compute_velocities(&self, particles: &mut [Particle], params: &SimParams) {
        compute_velocity_biot_savart(particles, params);
    }

    fn backend_type(&self) -> BackendType {
        BackendType::CpuRayon
    }

    fn backend_label(&self) -> &str {
        "Native CPU (rayon)"
    }
}

impl Default for CpuBackend {
    fn default() -> Self {
        Self
    }
}
