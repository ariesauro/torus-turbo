//! GPU-compatible data types with fixed layout matching WGSL shaders.
//!
//! These structs use `#[repr(C)]` and `bytemuck` for zero-copy GPU upload.
//! Field layout must match `hashGridParticleComputeManager.js` exactly.

use bytemuck::{Pod, Zeroable};

pub const FLOATS_PER_PARTICLE: usize = 24;
pub const BYTES_PER_PARTICLE: usize = FLOATS_PER_PARTICLE * 4; // 96
pub const PARAM_VEC4_COUNT: usize = 11;
pub const PARAM_BUFFER_SIZE: usize = PARAM_VEC4_COUNT * 4 * 4; // 176
pub const COUNTER_FIELD_COUNT: usize = 8;
pub const COUNTER_BUFFER_SIZE: usize = COUNTER_FIELD_COUNT * 4; // 32
pub const WORKGROUP_SIZE: u32 = 64;

/// GPU particle layout — 96 bytes, 24 × f32.
///
/// Must match WGSL:
/// ```wgsl
/// struct ParticleData {
///   positionLife    : vec4<f32>,
///   velocityAge     : vec4<f32>,
///   angleState      : vec4<f32>,
///   vorticityGamma  : vec4<f32>,
///   coreFlow        : vec4<f32>,
///   identity        : vec4<f32>,
/// }
/// ```
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuParticle {
    /// [x, y, z, life]
    pub position_life: [f32; 4],
    /// [vx, vy, vz, age]
    pub velocity_age: [f32; 4],
    /// [theta, phi, jet_psi, has_injected_twist (0.0 or 1.0)]
    pub angle_state: [f32; 4],
    /// [ωx, ωy, ωz, γ]
    pub vorticity_gamma: [f32; 4],
    /// [σ (core_radius), flow_vx, flow_vy, flow_vz]
    pub core_flow: [f32; 4],
    /// [id, inject_vx, inject_vy, inject_vz]
    pub identity: [f32; 4],
}

/// GPU simulation parameters — 176 bytes, 11 × vec4<f32>.
///
/// Flat array matching WGSL `struct SimParams { values: array<vec4<f32>, 11> }`.
///
/// Index mapping:
/// - values[0]: dt, particleCount, pulseDuration, timeScale
/// - values[1]: nozzleX, alpha(rad), thetaSpeed, ringMajor
/// - values[2]: ringMinor, viscosity, gamma, useBiotSavart
/// - values[3]: twistCoreRadius, twistAxialDecay, twistToRingCoupling, jetSpeed
/// - values[4]: jetTwist, spinSign, flipSign, reverseFactor
/// - values[5]: stretchingStrength, reconnectionDistance, minCoreRadius, diffusionViscosity
/// - values[6]: maxVelocity, maxVorticity, gridCellSize, neighborCellRadius
/// - values[7]: hashTableSize, bucketCapacity, interactionRadius, vpmEnabled
/// - values[8]: scriptedDynamics, reconnectionMinAge, autoCoreRadiusSigma, maxSigmaRatio
/// - values[9]: guidedDynamics, guidedStrength, vorticityConfinementStrength, coreRadiusSigmaParam
/// - values[10]: lesEnabled, lesSmagorinskyCs, 0, 0
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuSimParams {
    pub values: [[f32; 4]; PARAM_VEC4_COUNT],
}

/// GPU counter data — 32 bytes, 8 × u32.
///
/// Accumulated by compact shader via atomicAdd/atomicMax.
/// Energy/enstrophy/circulation use fixed-point encoding (×1000).
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct GpuCounterData {
    pub active_count: u32,
    pub overflow: u32,
    pub collisions: u32,
    pub occupied_buckets: u32,
    /// Energy × 1000, fixed-point via atomicAdd
    pub diag_energy_fp: u32,
    /// Enstrophy × 1000
    pub diag_enstrophy_fp: u32,
    /// Circulation × 1000
    pub diag_circulation_fp: u32,
    /// max(speed) × 1000, via atomicMax
    pub diag_max_speed_fp: u32,
}

impl GpuCounterData {
    pub fn energy(&self) -> f64 {
        self.diag_energy_fp as f64 / 1000.0
    }

    pub fn enstrophy(&self) -> f64 {
        self.diag_enstrophy_fp as f64 / 1000.0
    }

    pub fn circulation(&self) -> f64 {
        self.diag_circulation_fp as f64 / 1000.0
    }

    pub fn max_speed(&self) -> f64 {
        self.diag_max_speed_fp as f64 / 1000.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem;

    #[test]
    fn gpu_particle_layout() {
        assert_eq!(mem::size_of::<GpuParticle>(), BYTES_PER_PARTICLE);
        assert_eq!(mem::size_of::<GpuParticle>(), 96);
        assert_eq!(mem::align_of::<GpuParticle>(), 4);
    }

    #[test]
    fn gpu_sim_params_layout() {
        assert_eq!(mem::size_of::<GpuSimParams>(), PARAM_BUFFER_SIZE);
        assert_eq!(mem::size_of::<GpuSimParams>(), 176);
    }

    #[test]
    fn gpu_counter_data_layout() {
        assert_eq!(mem::size_of::<GpuCounterData>(), COUNTER_BUFFER_SIZE);
        assert_eq!(mem::size_of::<GpuCounterData>(), 32);
    }

    #[test]
    fn gpu_particle_as_f32_slice() {
        let p = GpuParticle {
            position_life: [1.0, 2.0, 3.0, 100.0],
            velocity_age: [0.1, 0.2, 0.3, 5.0],
            angle_state: [0.0; 4],
            vorticity_gamma: [0.0, 0.0, 1.0, 0.5],
            core_flow: [0.03, 0.0, 0.0, 0.0],
            identity: [42.0, 0.1, 0.2, 0.3],
        };
        let bytes: &[u8] = bytemuck::bytes_of(&p);
        assert_eq!(bytes.len(), 96);

        let floats: &[f32] = bytemuck::cast_slice(bytes);
        assert_eq!(floats.len(), 24);
        assert_eq!(floats[0], 1.0); // x
        assert_eq!(floats[3], 100.0); // life
        assert_eq!(floats[15], 0.5); // gamma
        assert_eq!(floats[16], 0.03); // core_radius
        assert_eq!(floats[20], 42.0); // id
    }

    #[test]
    fn counter_data_fixed_point_decode() {
        let c = GpuCounterData {
            active_count: 100,
            overflow: 0,
            collisions: 5,
            occupied_buckets: 50,
            diag_energy_fp: 12345,
            diag_enstrophy_fp: 6789,
            diag_circulation_fp: 1000,
            diag_max_speed_fp: 5500,
        };
        assert!((c.energy() - 12.345).abs() < 1e-10);
        assert!((c.enstrophy() - 6.789).abs() < 1e-10);
        assert!((c.circulation() - 1.0).abs() < 1e-10);
        assert!((c.max_speed() - 5.5).abs() < 1e-10);
    }
}
