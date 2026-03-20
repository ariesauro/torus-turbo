//! wgpu native renderer — fullscreen particle rendering with zero-copy from compute.
//!
//! Creates a wgpu render surface on a raw window handle, draws particles
//! directly from the compute buffer (no readback), and accepts camera
//! matrices from the JS UI via Tauri IPC.

use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

const RENDER_WGSL: &str = include_str!("shaders/particle_render.wgsl");
const COMMON_WGSL: &str = include_str!("shaders/common.wgsl");

/// Camera uniform — matches WGSL `Camera` struct.
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct CameraUniform {
    pub view_proj: [[f32; 4]; 4],
    pub eye_pos: [f32; 3],
    pub _pad: f32,
}

impl Default for CameraUniform {
    fn default() -> Self {
        Self {
            view_proj: [
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 0.0, 0.0, 1.0],
            ],
            eye_pos: [0.0, 0.0, 5.0],
            _pad: 0.0,
        }
    }
}

impl CameraUniform {
    /// Build a perspective + orbit camera matrix.
    pub fn from_orbit(
        azimuth: f32,
        elevation: f32,
        distance: f32,
        target: [f32; 3],
        aspect: f32,
    ) -> Self {
        let (sa, ca) = azimuth.sin_cos();
        let (se, ce) = elevation.sin_cos();

        let eye = [
            target[0] + distance * ce * sa,
            target[1] + distance * se,
            target[2] + distance * ce * ca,
        ];

        let forward = [
            target[0] - eye[0],
            target[1] - eye[1],
            target[2] - eye[2],
        ];
        let fwd_len = (forward[0] * forward[0] + forward[1] * forward[1] + forward[2] * forward[2]).sqrt();
        let f = [forward[0] / fwd_len, forward[1] / fwd_len, forward[2] / fwd_len];

        let up = [0.0_f32, 1.0, 0.0];
        let right = [
            f[1] * up[2] - f[2] * up[1],
            f[2] * up[0] - f[0] * up[2],
            f[0] * up[1] - f[1] * up[0],
        ];
        let r_len = (right[0] * right[0] + right[1] * right[1] + right[2] * right[2]).sqrt().max(1e-6);
        let r = [right[0] / r_len, right[1] / r_len, right[2] / r_len];

        let u = [
            r[1] * f[2] - r[2] * f[1],
            r[2] * f[0] - r[0] * f[2],
            r[0] * f[1] - r[1] * f[0],
        ];

        let view = [
            [r[0], u[0], -f[0], 0.0],
            [r[1], u[1], -f[1], 0.0],
            [r[2], u[2], -f[2], 0.0],
            [
                -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]),
                -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]),
                f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2],
                1.0,
            ],
        ];

        let fov = 60.0_f32.to_radians();
        let near = 0.01_f32;
        let far = 1000.0_f32;
        let f_val = 1.0 / (fov / 2.0).tan();
        let proj = [
            [f_val / aspect, 0.0, 0.0, 0.0],
            [0.0, f_val, 0.0, 0.0],
            [0.0, 0.0, (far + near) / (near - far), -1.0],
            [0.0, 0.0, 2.0 * far * near / (near - far), 0.0],
        ];

        let mut vp = [[0.0_f32; 4]; 4];
        for i in 0..4 {
            for j in 0..4 {
                vp[i][j] = view[i][0] * proj[0][j]
                    + view[i][1] * proj[1][j]
                    + view[i][2] * proj[2][j]
                    + view[i][3] * proj[3][j];
            }
        }

        Self {
            view_proj: vp,
            eye_pos: eye,
            _pad: 0.0,
        }
    }
}

/// Native wgpu particle renderer.
pub struct ParticleRenderer {
    pub surface: wgpu::Surface<'static>,
    pub surface_config: wgpu::SurfaceConfiguration,
    pub render_pipeline: wgpu::RenderPipeline,
    pub camera_buffer: wgpu::Buffer,
    pub camera_bind_group: wgpu::BindGroup,
    pub camera: CameraUniform,
    pub particle_count: u32,
}

impl ParticleRenderer {
    /// Create renderer on an existing wgpu device with a window surface.
    pub fn new(
        device: &wgpu::Device,
        surface: wgpu::Surface<'static>,
        width: u32,
        height: u32,
        adapter: &wgpu::Adapter,
    ) -> Self {
        let caps = surface.get_capabilities(adapter);
        let format = caps
            .formats
            .iter()
            .find(|f| f.is_srgb())
            .copied()
            .unwrap_or(caps.formats[0]);

        let surface_config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width,
            height,
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode: wgpu::CompositeAlphaMode::Opaque,
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(device, &surface_config);

        let shader_src = format!("{}\n{}", COMMON_WGSL, RENDER_WGSL);
        let shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("particle_render"),
            source: wgpu::ShaderSource::Wgsl(shader_src.into()),
        });

        let camera = CameraUniform::default();
        let camera_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("camera_uniform"),
            contents: bytemuck::bytes_of(&camera),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("render_bind_group_layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("render_pipeline_layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("particle_render_pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader_module,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader_module,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::PointList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        // Placeholder bind group (will be recreated when particle buffer is available)
        let dummy_particle_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("dummy_particles"),
            size: 96,
            usage: wgpu::BufferUsages::STORAGE,
            mapped_at_creation: false,
        });

        let camera_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("render_bind_group"),
            layout: &bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: dummy_particle_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: camera_buffer.as_entire_binding(),
                },
            ],
        });

        Self {
            surface,
            surface_config,
            render_pipeline,
            camera_buffer,
            camera_bind_group,
            camera,
            particle_count: 0,
        }
    }

    /// Update camera uniform.
    pub fn update_camera(&mut self, queue: &wgpu::Queue, camera: CameraUniform) {
        self.camera = camera;
        queue.write_buffer(&self.camera_buffer, 0, bytemuck::bytes_of(&self.camera));
    }

    /// Recreate bind group with actual particle buffer (zero-copy from compute).
    pub fn bind_particle_buffer(
        &mut self,
        device: &wgpu::Device,
        particle_buffer: &wgpu::Buffer,
        count: u32,
    ) {
        let layout = self.render_pipeline.get_bind_group_layout(0);
        self.camera_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("render_bind_group"),
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: particle_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: self.camera_buffer.as_entire_binding(),
                },
            ],
        });
        self.particle_count = count;
    }

    /// Render one frame.
    pub fn render(&self, device: &wgpu::Device, queue: &wgpu::Queue) -> Result<(), wgpu::SurfaceError> {
        let output = self.surface.get_current_texture()?;
        let view = output.texture.create_view(&wgpu::TextureViewDescriptor::default());

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("render_encoder"),
        });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("particle_render_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.0,
                            g: 0.0,
                            b: 0.02,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            render_pass.set_pipeline(&self.render_pipeline);
            render_pass.set_bind_group(0, &self.camera_bind_group, &[]);

            if self.particle_count > 0 {
                render_pass.draw(0..self.particle_count, 0..1);
            }
        }

        queue.submit(std::iter::once(encoder.finish()));
        output.present();

        Ok(())
    }

    /// Handle resize.
    pub fn resize(&mut self, device: &wgpu::Device, width: u32, height: u32) {
        if width > 0 && height > 0 {
            self.surface_config.width = width;
            self.surface_config.height = height;
            self.surface.configure(device, &self.surface_config);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camera_uniform_layout() {
        assert_eq!(std::mem::size_of::<CameraUniform>(), 80);
    }

    #[test]
    fn orbit_camera_produces_valid_matrix() {
        let cam = CameraUniform::from_orbit(0.0, 0.3, 5.0, [0.0, 0.0, 0.0], 1.5);
        assert!(cam.eye_pos[2] > 0.0);
        let det_approx = cam.view_proj[0][0] * cam.view_proj[1][1];
        assert!(det_approx.abs() > 1e-6, "Matrix should be non-degenerate");
    }

    #[test]
    fn default_camera() {
        let cam = CameraUniform::default();
        assert_eq!(cam.eye_pos, [0.0, 0.0, 5.0]);
        assert_eq!(cam.view_proj[0][0], 1.0);
    }
}
