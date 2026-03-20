//! Hash grid configuration for spatial neighbor queries on GPU.
//!
//! Mirrors the adaptive hash grid from `hashGridParticleComputeManager.js`.

/// Hash grid parameters controlling spatial acceleration structure.
///
/// The hash grid maps 3D particle positions to buckets for O(N·k) neighbor queries
/// instead of O(N²) brute force.
#[derive(Debug, Clone)]
pub struct HashGridConfig {
    pub cell_size: f32,
    pub neighbor_cell_radius: u32,
    pub hash_table_size: u32,
    pub bucket_capacity: u32,
    pub interaction_radius: f32,
}

impl HashGridConfig {
    /// Compute config from simulation parameters.
    ///
    /// Matches JS logic:
    /// - `gridCellSize = max(sigma * cellSizeMultiplier, 0.01)`
    /// - `hashTableSize = nextPowerOfTwo(max(1024, capacity * 4))`
    /// - `bucketCapacity = clamp(16, 256, gpuChunkSize / 2)`
    pub fn from_params(
        core_radius_sigma: f32,
        cell_size_multiplier: f32,
        capacity: u32,
        gpu_chunk_size: u32,
    ) -> Self {
        let cell_size = (core_radius_sigma * cell_size_multiplier).max(0.01);
        let hash_table_size = next_power_of_two(1024u32.max(capacity * 4)).min(1 << 20);
        let bucket_capacity = 16u32.max((gpu_chunk_size / 2).min(256));

        Self {
            cell_size,
            neighbor_cell_radius: 1,
            hash_table_size,
            bucket_capacity,
            interaction_radius: 1.0,
        }
    }

    /// Total size in bytes for grid counts buffer.
    pub fn counts_buffer_size(&self) -> u64 {
        self.hash_table_size as u64 * 4
    }

    /// Total size in bytes for grid indices buffer.
    pub fn indices_buffer_size(&self) -> u64 {
        self.hash_table_size as u64 * self.bucket_capacity as u64 * 4
    }

    /// Spatial hash function matching WGSL: `(x*73856093 ^ y*19349663 ^ z*83492791) & (size-1)`.
    pub fn hash_cell(&self, cx: i32, cy: i32, cz: i32) -> u32 {
        let h = (cx as u32).wrapping_mul(73856093)
            ^ (cy as u32).wrapping_mul(19349663)
            ^ (cz as u32).wrapping_mul(83492791);
        h & (self.hash_table_size - 1)
    }
}

fn next_power_of_two(v: u32) -> u32 {
    v.next_power_of_two()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config() {
        let cfg = HashGridConfig::from_params(0.03, 4.0, 256, 96);
        assert!((cfg.cell_size - 0.12).abs() < 1e-6);
        assert_eq!(cfg.neighbor_cell_radius, 1);
        assert!(cfg.hash_table_size.is_power_of_two());
        assert!(cfg.hash_table_size >= 1024);
        assert!(cfg.bucket_capacity >= 16);
        assert!(cfg.bucket_capacity <= 256);
    }

    #[test]
    fn hash_table_size_scaling() {
        let cfg_small = HashGridConfig::from_params(0.03, 4.0, 100, 96);
        assert_eq!(cfg_small.hash_table_size, 1024); // min 1024

        let cfg_large = HashGridConfig::from_params(0.03, 4.0, 10000, 96);
        assert!(cfg_large.hash_table_size >= 40000);
        assert!(cfg_large.hash_table_size.is_power_of_two());
    }

    #[test]
    fn hash_deterministic() {
        let cfg = HashGridConfig::from_params(0.03, 4.0, 256, 96);
        let h1 = cfg.hash_cell(1, 2, 3);
        let h2 = cfg.hash_cell(1, 2, 3);
        assert_eq!(h1, h2);
        assert!(h1 < cfg.hash_table_size);
    }

    #[test]
    fn buffer_sizes() {
        let cfg = HashGridConfig::from_params(0.03, 4.0, 256, 96);
        assert_eq!(cfg.counts_buffer_size(), cfg.hash_table_size as u64 * 4);
        assert_eq!(
            cfg.indices_buffer_size(),
            cfg.hash_table_size as u64 * cfg.bucket_capacity as u64 * 4
        );
    }
}
