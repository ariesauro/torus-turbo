//! wgpu compute pipeline manager for VPM physics.
//!
//! Manages GPU device, buffers, shader pipelines, and dispatch.
//! WGSL shaders are embedded at compile time from `src/shaders/`.

use torus_physics::gpu_types::*;
use crate::grid::HashGridConfig;

const COMMON_WGSL: &str = include_str!("shaders/common.wgsl");

fn shader_with_common(shader_src: &str) -> String {
    format!("{}\n{}", COMMON_WGSL, shader_src)
}

/// All embedded WGSL shader sources — 13 shaders covering the full VPM pipeline.
pub struct ShaderSources {
    pub clear_grid: String,
    pub bin_particles: String,
    pub compute_flow: String,
    pub advect: String,
    pub stability: String,
    pub compact: String,
    pub stretching: String,
    pub diffusion: String,
    pub confinement: String,
    pub find_merge_target: String,
    pub resolve_merge_owner: String,
    pub merge_particles: String,
    pub clear_counter: String,
}

impl ShaderSources {
    pub fn load() -> Self {
        Self {
            clear_grid: shader_with_common(include_str!("shaders/clear_grid.wgsl")),
            bin_particles: shader_with_common(include_str!("shaders/bin_particles.wgsl")),
            compute_flow: shader_with_common(include_str!("shaders/compute_flow.wgsl")),
            advect: shader_with_common(include_str!("shaders/advect.wgsl")),
            stability: shader_with_common(include_str!("shaders/stability.wgsl")),
            compact: shader_with_common(include_str!("shaders/compact.wgsl")),
            stretching: shader_with_common(include_str!("shaders/stretching.wgsl")),
            diffusion: shader_with_common(include_str!("shaders/diffusion.wgsl")),
            confinement: shader_with_common(include_str!("shaders/confinement.wgsl")),
            find_merge_target: shader_with_common(include_str!("shaders/find_merge_target.wgsl")),
            resolve_merge_owner: shader_with_common(include_str!("shaders/resolve_merge_owner.wgsl")),
            merge_particles: shader_with_common(include_str!("shaders/merge_particles.wgsl")),
            clear_counter: shader_with_common(include_str!("shaders/clear_counter.wgsl")),
        }
    }

    pub fn shader_count() -> usize {
        13
    }
}

/// GPU buffer set for the VPM compute pipeline.
pub struct GpuBuffers {
    pub particle_a: wgpu::Buffer,
    pub particle_b: wgpu::Buffer,
    pub params: wgpu::Buffer,
    pub grid_counts: wgpu::Buffer,
    pub grid_indices: wgpu::Buffer,
    pub merge_target: wgpu::Buffer,
    pub merge_owner: wgpu::Buffer,
    pub alive_flags: wgpu::Buffer,
    pub counter: wgpu::Buffer,
    pub counter_readback: wgpu::Buffer,
    pub particle_readback: wgpu::Buffer,
    pub capacity: u32,
    pub grid_config: HashGridConfig,
}

/// Compute pipeline handles.
pub struct ComputePipelines {
    pub clear_grid: wgpu::ComputePipeline,
    pub bin_particles: wgpu::ComputePipeline,
    pub compute_flow: wgpu::ComputePipeline,
    pub advect: wgpu::ComputePipeline,
    pub stability: wgpu::ComputePipeline,
    pub compact: wgpu::ComputePipeline,
    pub bind_group_layout: wgpu::BindGroupLayout,
}

/// The main GPU compute manager.
pub struct GpuComputeManager {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub buffers: Option<GpuBuffers>,
    pub pipelines: Option<ComputePipelines>,
}

impl GpuComputeManager {
    /// Create GPU device and queue. Returns None if no adapter found.
    pub async fn new() -> Option<Self> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await?;

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("torus-gpu"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .ok()?;

        Some(Self {
            device,
            queue,
            buffers: None,
            pipelines: None,
        })
    }

    /// Initialize buffers and compile shaders for given capacity.
    pub fn initialize(&mut self, capacity: u32, grid_config: HashGridConfig) {
        let sources = ShaderSources::load();

        let bind_group_layout = self.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("vpm_compute_layout"),
            entries: &(0..9u32)
                .map(|i| wgpu::BindGroupLayoutEntry {
                    binding: i,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: if i == 2 {
                            wgpu::BufferBindingType::Storage { read_only: true }
                        } else if i == 0 {
                            wgpu::BufferBindingType::Storage { read_only: true }
                        } else {
                            wgpu::BufferBindingType::Storage { read_only: false }
                        },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                })
                .collect::<Vec<_>>(),
        });

        let pipeline_layout = self.device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("vpm_pipeline_layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let create_pipeline = |label: &str, source: &str| -> wgpu::ComputePipeline {
            let module = self.device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(label),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            });
            self.device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(label),
                layout: Some(&pipeline_layout),
                module: &module,
                entry_point: Some("main"),
                compilation_options: Default::default(),
                cache: None,
            })
        };

        let pipelines = ComputePipelines {
            clear_grid: create_pipeline("clear_grid", &sources.clear_grid),
            bin_particles: create_pipeline("bin_particles", &sources.bin_particles),
            compute_flow: create_pipeline("compute_flow", &sources.compute_flow),
            advect: create_pipeline("advect", &sources.advect),
            stability: create_pipeline("stability", &sources.stability),
            compact: create_pipeline("compact", &sources.compact),
            bind_group_layout,
        };

        let particle_size = (capacity as u64) * BYTES_PER_PARTICLE as u64;
        let per_particle_u32 = capacity as u64 * 4;

        let buffers = GpuBuffers {
            particle_a: self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("particles_a"),
                size: particle_size,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            }),
            particle_b: self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("particles_b"),
                size: particle_size,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            }),
            params: self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("sim_params"),
                size: PARAM_BUFFER_SIZE as u64,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }),
            grid_counts: self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("grid_counts"),
                size: grid_config.counts_buffer_size(),
                usage: wgpu::BufferUsages::STORAGE,
                mapped_at_creation: false,
            }),
            grid_indices: self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("grid_indices"),
                size: grid_config.indices_buffer_size(),
                usage: wgpu::BufferUsages::STORAGE,
                mapped_at_creation: false,
            }),
            merge_target: self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("merge_target"),
                size: per_particle_u32,
                usage: wgpu::BufferUsages::STORAGE,
                mapped_at_creation: false,
            }),
            merge_owner: self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("merge_owner"),
                size: per_particle_u32,
                usage: wgpu::BufferUsages::STORAGE,
                mapped_at_creation: false,
            }),
            alive_flags: self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("alive_flags"),
                size: per_particle_u32,
                usage: wgpu::BufferUsages::STORAGE,
                mapped_at_creation: false,
            }),
            counter: self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("counter"),
                size: COUNTER_BUFFER_SIZE as u64,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            }),
            counter_readback: self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("counter_readback"),
                size: COUNTER_BUFFER_SIZE as u64,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }),
            particle_readback: self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("particle_readback"),
                size: particle_size,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }),
            capacity,
            grid_config,
        };

        self.buffers = Some(buffers);
        self.pipelines = Some(pipelines);
    }

    /// Upload particle data to GPU.
    pub fn upload_particles(&self, particles: &[GpuParticle]) {
        if let Some(ref buffers) = self.buffers {
            self.queue.write_buffer(
                &buffers.particle_a,
                0,
                bytemuck::cast_slice(particles),
            );
        }
    }

    /// Upload simulation parameters to GPU.
    pub fn upload_params(&self, params: &GpuSimParams) {
        if let Some(ref buffers) = self.buffers {
            self.queue.write_buffer(
                &buffers.params,
                0,
                bytemuck::bytes_of(params),
            );
        }
    }

    /// Dispatch workgroups for a count of threads.
    pub fn workgroup_count(count: u32) -> u32 {
        (count + WORKGROUP_SIZE - 1) / WORKGROUP_SIZE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shaders_load_without_panic() {
        let sources = ShaderSources::load();
        assert!(sources.clear_grid.contains("ParticleData"));
        assert!(sources.compute_flow.contains("FOUR_PI"));
        assert!(sources.advect.contains("paramDt"));
        assert!(sources.compact.contains("atomicAdd"));
    }

    #[test]
    fn workgroup_count_rounds_up() {
        assert_eq!(GpuComputeManager::workgroup_count(1), 1);
        assert_eq!(GpuComputeManager::workgroup_count(64), 1);
        assert_eq!(GpuComputeManager::workgroup_count(65), 2);
        assert_eq!(GpuComputeManager::workgroup_count(128), 2);
        assert_eq!(GpuComputeManager::workgroup_count(129), 3);
    }
}
