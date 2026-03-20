//! CPU particle representation (float64) and GPU conversion.

use glam::DVec3;
use serde::{Deserialize, Serialize};

use crate::gpu_types::GpuParticle;

/// CPU-native particle with full precision (f64).
///
/// Used for CPU physics pipeline (Biot-Savart, PSE, stretching, etc.).
/// Converts to/from `GpuParticle` for GPU compute dispatch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Particle {
    pub id: u32,
    pub position: DVec3,
    pub prev_position: DVec3,
    pub velocity: DVec3,
    pub flow_velocity: DVec3,
    pub vorticity: DVec3,
    pub inject_velocity: DVec3,
    pub gamma: f64,
    pub core_radius: f64,
    pub age: f64,
    pub life: f64,
    pub theta: f64,
    pub phi: f64,
    pub jet_psi: f64,
    pub has_injected_twist: bool,
}

impl Particle {
    pub fn new(id: u32, position: DVec3) -> Self {
        Self {
            id,
            position,
            prev_position: position,
            velocity: DVec3::ZERO,
            flow_velocity: DVec3::ZERO,
            vorticity: DVec3::ZERO,
            inject_velocity: DVec3::ZERO,
            gamma: 0.0,
            core_radius: 0.03,
            age: 0.0,
            life: 0.0,
            theta: 0.0,
            phi: 0.0,
            jet_psi: 0.0,
            has_injected_twist: false,
        }
    }

    /// Pack into GPU-compatible 96-byte struct (f32 precision loss).
    ///
    /// Layout matches `hashGridParticleComputeManager.js` packParticles().
    pub fn to_gpu(&self) -> GpuParticle {
        GpuParticle {
            position_life: [
                self.position.x as f32,
                self.position.y as f32,
                self.position.z as f32,
                self.life as f32,
            ],
            velocity_age: [
                self.velocity.x as f32,
                self.velocity.y as f32,
                self.velocity.z as f32,
                self.age as f32,
            ],
            angle_state: [
                self.theta as f32,
                self.phi as f32,
                self.jet_psi as f32,
                if self.has_injected_twist { 1.0 } else { 0.0 },
            ],
            vorticity_gamma: [
                self.vorticity.x as f32,
                self.vorticity.y as f32,
                self.vorticity.z as f32,
                self.gamma as f32,
            ],
            core_flow: [
                self.core_radius as f32,
                self.flow_velocity.x as f32,
                self.flow_velocity.y as f32,
                self.flow_velocity.z as f32,
            ],
            identity: [
                self.id as f32,
                self.inject_velocity.x as f32,
                self.inject_velocity.y as f32,
                self.inject_velocity.z as f32,
            ],
        }
    }

    /// Unpack from GPU struct back to CPU particle.
    ///
    /// Precision: f32 → f64 (no further loss, but already reduced by to_gpu).
    pub fn from_gpu(gpu: &GpuParticle) -> Self {
        Self {
            id: gpu.identity[0] as u32,
            position: DVec3::new(
                gpu.position_life[0] as f64,
                gpu.position_life[1] as f64,
                gpu.position_life[2] as f64,
            ),
            prev_position: DVec3::new(
                gpu.position_life[0] as f64,
                gpu.position_life[1] as f64,
                gpu.position_life[2] as f64,
            ),
            velocity: DVec3::new(
                gpu.velocity_age[0] as f64,
                gpu.velocity_age[1] as f64,
                gpu.velocity_age[2] as f64,
            ),
            flow_velocity: DVec3::new(
                gpu.core_flow[1] as f64,
                gpu.core_flow[2] as f64,
                gpu.core_flow[3] as f64,
            ),
            vorticity: DVec3::new(
                gpu.vorticity_gamma[0] as f64,
                gpu.vorticity_gamma[1] as f64,
                gpu.vorticity_gamma[2] as f64,
            ),
            inject_velocity: DVec3::new(
                gpu.identity[1] as f64,
                gpu.identity[2] as f64,
                gpu.identity[3] as f64,
            ),
            gamma: gpu.vorticity_gamma[3] as f64,
            core_radius: gpu.core_flow[0] as f64,
            age: gpu.velocity_age[3] as f64,
            life: gpu.position_life[3] as f64,
            theta: gpu.angle_state[0] as f64,
            phi: gpu.angle_state[1] as f64,
            jet_psi: gpu.angle_state[2] as f64,
            has_injected_twist: gpu.angle_state[3] > 0.5,
        }
    }
}

/// Pack a slice of particles into a GPU buffer (contiguous f32 array).
pub fn pack_particles(particles: &[Particle]) -> Vec<GpuParticle> {
    particles.iter().map(|p| p.to_gpu()).collect()
}

/// Unpack a GPU buffer into CPU particles.
pub fn unpack_particles(gpu_particles: &[GpuParticle]) -> Vec<Particle> {
    gpu_particles.iter().map(Particle::from_gpu).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_preserves_fields() {
        let p = Particle {
            id: 42,
            position: DVec3::new(1.0, 2.0, 3.0),
            prev_position: DVec3::new(0.9, 1.9, 2.9),
            velocity: DVec3::new(0.1, 0.2, 0.3),
            flow_velocity: DVec3::new(0.01, 0.02, 0.03),
            vorticity: DVec3::new(0.0, 0.0, 1.0),
            inject_velocity: DVec3::new(0.1, 0.2, 0.3),
            gamma: 5.0,
            core_radius: 0.03,
            age: 10.0,
            life: 100.0,
            theta: 1.5,
            phi: 0.7,
            jet_psi: 0.3,
            has_injected_twist: true,
        };

        let gpu = p.to_gpu();
        let restored = Particle::from_gpu(&gpu);

        assert_eq!(restored.id, 42);
        assert!((restored.position.x - 1.0).abs() < 1e-6);
        assert!((restored.position.y - 2.0).abs() < 1e-6);
        assert!((restored.position.z - 3.0).abs() < 1e-6);
        assert!((restored.velocity.x - 0.1).abs() < 1e-6);
        assert!((restored.flow_velocity.x - 0.01).abs() < 1e-6);
        assert!((restored.vorticity.z - 1.0).abs() < 1e-6);
        assert!((restored.gamma - 5.0).abs() < 1e-6);
        assert!((restored.core_radius - 0.03).abs() < 1e-6);
        assert!((restored.age - 10.0).abs() < 1e-6);
        assert!((restored.life - 100.0).abs() < 1e-6);
        assert!((restored.theta - 1.5).abs() < 1e-6);
        assert!((restored.phi - 0.7).abs() < 1e-6);
        assert!(restored.has_injected_twist);
    }

    #[test]
    fn pack_unpack_batch() {
        let particles: Vec<Particle> = (0..100)
            .map(|i| {
                let mut p = Particle::new(i, DVec3::new(i as f64 * 0.1, 0.0, 0.0));
                p.gamma = 1.0 + i as f64 * 0.01;
                p.vorticity = DVec3::new(0.0, 0.0, 0.1);
                p
            })
            .collect();

        let gpu_buf = pack_particles(&particles);
        assert_eq!(gpu_buf.len(), 100);

        let restored = unpack_particles(&gpu_buf);
        assert_eq!(restored.len(), 100);

        for (orig, rest) in particles.iter().zip(restored.iter()) {
            assert_eq!(orig.id, rest.id);
            assert!((orig.position.x - rest.position.x).abs() < 1e-5);
            assert!((orig.gamma - rest.gamma).abs() < 1e-5);
        }
    }

    #[test]
    fn default_particle_values() {
        let p = Particle::new(0, DVec3::ZERO);
        assert_eq!(p.id, 0);
        assert_eq!(p.velocity, DVec3::ZERO);
        assert_eq!(p.gamma, 0.0);
        assert!((p.core_radius - 0.03).abs() < 1e-10);
        assert!(!p.has_injected_twist);
    }

    #[test]
    fn has_injected_twist_encoding() {
        let mut p = Particle::new(0, DVec3::ZERO);

        p.has_injected_twist = false;
        let gpu = p.to_gpu();
        assert_eq!(gpu.angle_state[3], 0.0);
        assert!(!Particle::from_gpu(&gpu).has_injected_twist);

        p.has_injected_twist = true;
        let gpu = p.to_gpu();
        assert_eq!(gpu.angle_state[3], 1.0);
        assert!(Particle::from_gpu(&gpu).has_injected_twist);
    }
}
