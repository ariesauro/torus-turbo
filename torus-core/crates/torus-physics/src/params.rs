//! Simulation parameters — typed CPU struct + GPU-compatible flat layout.

use serde::{Deserialize, Serialize};

use crate::gpu_types::GpuSimParams;

/// Typed simulation parameters for CPU pipeline.
///
/// All physical quantities in SI-like units (meters, seconds, etc.).
/// Matches the parameter set from `defaultParams.js`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimParams {
    // --- Time ---
    pub dt: f64,
    pub particle_count: u32,
    pub pulse_duration: f64,
    pub time_scale: f64,

    // --- Geometry ---
    pub nozzle_x: f64,
    pub alpha_deg: f64,
    pub theta_speed: f64,
    pub ring_major: f64,
    pub ring_minor: f64,

    // --- Physics ---
    pub viscosity: f64,
    pub gamma: f64,
    pub use_biot_savart: bool,

    // --- Twist ---
    pub twist_core_radius: f64,
    pub twist_axial_decay: f64,
    pub twist_to_ring_coupling: f64,
    pub jet_speed: f64,
    pub jet_twist: f64,

    // --- Symmetry ---
    pub spin_sign: f64,
    pub flip_sign: f64,
    pub reverse_factor: f64,

    // --- VPM operators ---
    pub stretching_strength: f64,
    pub reconnection_distance: f64,
    pub min_core_radius: f64,
    pub diffusion_viscosity: f64,

    // --- Stability clamps ---
    pub max_velocity: f64,
    pub max_vorticity: f64,

    // --- Hash grid ---
    pub grid_cell_size: f64,
    pub neighbor_cell_radius: u32,
    pub hash_table_size: u32,
    pub bucket_capacity: u32,
    pub interaction_radius: f64,

    // --- Modes ---
    pub vpm_enabled: bool,
    pub scripted_dynamics: bool,
    pub reconnection_min_age: f64,

    // --- Core radius ---
    pub auto_core_radius_sigma: f64,
    pub max_sigma_ratio: f64,
    pub core_radius_sigma: f64,

    // --- Guidance ---
    pub guided_dynamics: bool,
    pub guided_strength: f64,
    pub vorticity_confinement_strength: f64,

    // --- LES ---
    pub les_enabled: bool,
    pub les_smagorinsky_cs: f64,
}

impl Default for SimParams {
    fn default() -> Self {
        Self {
            dt: 0.016,
            particle_count: 0,
            pulse_duration: 0.05,
            time_scale: 1.0,

            nozzle_x: 0.0,
            alpha_deg: -45.0,
            theta_speed: 0.176,
            ring_major: 3.48,
            ring_minor: 1.45,

            viscosity: 0.0,
            gamma: 5.01,
            use_biot_savart: true,

            twist_core_radius: 1.49,
            twist_axial_decay: 0.0,
            twist_to_ring_coupling: 1.0,
            jet_speed: 3.0,
            jet_twist: 0.3,

            spin_sign: 1.0,
            flip_sign: 1.0,
            reverse_factor: 1.0,

            stretching_strength: 0.16,
            reconnection_distance: 0.02,
            min_core_radius: 0.02,
            diffusion_viscosity: 0.0,

            max_velocity: 6.0,
            max_vorticity: 0.2,

            grid_cell_size: 0.12,
            neighbor_cell_radius: 1,
            hash_table_size: 4096,
            bucket_capacity: 48,
            interaction_radius: 1.0,

            vpm_enabled: true,
            scripted_dynamics: false,
            reconnection_min_age: 0.05,

            auto_core_radius_sigma: 0.0,
            max_sigma_ratio: 0.25,
            core_radius_sigma: 0.2,

            guided_dynamics: false,
            guided_strength: 0.2,
            vorticity_confinement_strength: 0.08,

            les_enabled: false,
            les_smagorinsky_cs: 0.15,
        }
    }
}

impl SimParams {
    /// Convert to GPU-compatible flat layout (176 bytes).
    ///
    /// Index mapping matches `writeParams()` in `hashGridParticleComputeManager.js`.
    pub fn to_gpu(&self) -> GpuSimParams {
        let alpha_rad = (self.alpha_deg * std::f64::consts::PI / 180.0) as f32;

        GpuSimParams {
            values: [
                // [0]: dt, particleCount, pulseDuration, timeScale
                [
                    self.dt as f32,
                    self.particle_count as f32,
                    self.pulse_duration as f32,
                    self.time_scale as f32,
                ],
                // [1]: nozzleX, alpha(rad), thetaSpeed, ringMajor
                [
                    self.nozzle_x as f32,
                    alpha_rad,
                    self.theta_speed as f32,
                    self.ring_major as f32,
                ],
                // [2]: ringMinor, viscosity, gamma, useBiotSavart
                [
                    self.ring_minor as f32,
                    self.viscosity as f32,
                    self.gamma as f32,
                    if self.use_biot_savart { 1.0 } else { 0.0 },
                ],
                // [3]: twistCoreRadius, twistAxialDecay, twistToRingCoupling, jetSpeed
                [
                    self.twist_core_radius as f32,
                    self.twist_axial_decay as f32,
                    self.twist_to_ring_coupling as f32,
                    self.jet_speed as f32,
                ],
                // [4]: jetTwist, spinSign, flipSign, reverseFactor
                [
                    self.jet_twist as f32,
                    self.spin_sign as f32,
                    self.flip_sign as f32,
                    self.reverse_factor as f32,
                ],
                // [5]: stretchingStrength, reconnectionDistance, minCoreRadius, diffusionViscosity
                [
                    self.stretching_strength as f32,
                    self.reconnection_distance as f32,
                    self.min_core_radius as f32,
                    self.diffusion_viscosity as f32,
                ],
                // [6]: maxVelocity, maxVorticity, gridCellSize, neighborCellRadius
                [
                    self.max_velocity as f32,
                    self.max_vorticity as f32,
                    self.grid_cell_size as f32,
                    self.neighbor_cell_radius as f32,
                ],
                // [7]: hashTableSize, bucketCapacity, interactionRadius, vpmEnabled
                [
                    self.hash_table_size as f32,
                    self.bucket_capacity as f32,
                    self.interaction_radius as f32,
                    if self.vpm_enabled { 1.0 } else { 0.0 },
                ],
                // [8]: scriptedDynamics, reconnectionMinAge, autoCoreRadiusSigma, maxSigmaRatio
                [
                    if self.scripted_dynamics { 1.0 } else { 0.0 },
                    self.reconnection_min_age as f32,
                    self.auto_core_radius_sigma as f32,
                    self.max_sigma_ratio as f32,
                ],
                // [9]: guidedDynamics, guidedStrength, vorticityConfinementStrength, coreRadiusSigmaParam
                [
                    if self.guided_dynamics { 1.0 } else { 0.0 },
                    self.guided_strength as f32,
                    self.vorticity_confinement_strength as f32,
                    self.core_radius_sigma as f32,
                ],
                // [10]: lesEnabled, lesSmagorinskyCs, 0, 0
                [
                    if self.les_enabled { 1.0 } else { 0.0 },
                    self.les_smagorinsky_cs as f32,
                    0.0,
                    0.0,
                ],
            ],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_params_are_valid() {
        let p = SimParams::default();
        assert!(p.dt > 0.0);
        assert!(p.max_velocity > 0.0);
        assert!(p.gamma > 0.0);
        assert!(p.vpm_enabled);
        assert!(!p.les_enabled);
    }

    #[test]
    fn to_gpu_layout_matches() {
        let p = SimParams {
            dt: 0.002,
            particle_count: 256,
            pulse_duration: 0.05,
            time_scale: 1.0,
            alpha_deg: -45.0,
            viscosity: 0.001,
            gamma: 5.0,
            vpm_enabled: true,
            les_enabled: true,
            les_smagorinsky_cs: 0.15,
            ..SimParams::default()
        };

        let gpu = p.to_gpu();

        // values[0]
        assert!((gpu.values[0][0] - 0.002).abs() < 1e-6); // dt
        assert!((gpu.values[0][1] - 256.0).abs() < 1e-6); // particleCount

        // values[1].y = alpha in radians
        let expected_alpha = (-45.0_f64 * std::f64::consts::PI / 180.0) as f32;
        assert!((gpu.values[1][1] - expected_alpha).abs() < 1e-6);

        // values[2].y = viscosity
        assert!((gpu.values[2][1] - 0.001).abs() < 1e-6);

        // values[2].z = gamma
        assert!((gpu.values[2][2] - 5.0).abs() < 1e-6);

        // values[7].w = vpmEnabled
        assert_eq!(gpu.values[7][3], 1.0);

        // values[10].x = lesEnabled
        assert_eq!(gpu.values[10][0], 1.0);
        assert!((gpu.values[10][1] - 0.15).abs() < 1e-6);

        // padding zeros
        assert_eq!(gpu.values[10][2], 0.0);
        assert_eq!(gpu.values[10][3], 0.0);
    }

    #[test]
    fn gpu_params_byte_size() {
        let gpu = SimParams::default().to_gpu();
        let bytes: &[u8] = bytemuck::bytes_of(&gpu);
        assert_eq!(bytes.len(), 176);
    }
}
