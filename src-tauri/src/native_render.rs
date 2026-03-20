//! Native wgpu render integration with Tauri window.
//!
//! Creates a wgpu surface from the Tauri main window, initializes the
//! particle renderer, and runs a 60fps render loop in a background thread.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::Manager;
use torus_bridge::handle::SIMULATION;
use torus_gpu::renderer::{CameraUniform, ParticleRenderer};
use torus_physics::particle::pack_particles;

struct RenderState {
    renderer: ParticleRenderer,
    particle_buffer: Option<wgpu::Buffer>,
}

/// Initialize the native wgpu renderer on the main window.
///
/// Call this from Tauri `setup()` after the window is created.
pub fn init_native_render(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let main_window = app
        .get_webview_window("main")
        .ok_or("No main window")?;

    let window = main_window.as_ref().window();
    let size = window.inner_size()?;

    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        ..Default::default()
    });

    let surface = instance.create_surface(window)?;

    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: Some(&surface),
        force_fallback_adapter: false,
    }))
    .ok_or("No GPU adapter found")?;

    let (device, queue) = pollster::block_on(adapter.request_device(
        &wgpu::DeviceDescriptor {
            label: Some("torus-render"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            memory_hints: wgpu::MemoryHints::Performance,
        },
        None,
    ))?;

    let device = Arc::new(device);
    let queue = Arc::new(queue);

    let renderer = ParticleRenderer::new(
        &device,
        surface,
        size.width.max(1),
        size.height.max(1),
        &adapter,
    );

    let state = Arc::new(Mutex::new(RenderState {
        renderer,
        particle_buffer: None,
    }));

    // Render loop — 60fps in background thread
    let render_state = state.clone();
    let dev = device.clone();
    let q = queue.clone();

    std::thread::spawn(move || {
        let frame_duration = Duration::from_micros(16_667); // ~60fps

        loop {
            let frame_start = Instant::now();

            // Update particle buffer from simulation state
            if let Ok(sim_lock) = SIMULATION.lock() {
                if let Some(ref sim) = *sim_lock {
                    if let Ok(mut rs) = render_state.lock() {
                        // Update camera
                        let camera = CameraUniform::from_orbit(
                            sim.camera_azimuth,
                            sim.camera_elevation,
                            sim.camera_distance,
                            sim.camera_target,
                            sim.camera_aspect,
                        );
                        rs.renderer.update_camera(&q, camera);

                        // Upload particles to GPU buffer (or reuse compute buffer when wired)
                        if !sim.particles.is_empty() {
                            let gpu_particles = pack_particles(&sim.particles);
                            let buf_size = (gpu_particles.len() * 96) as u64;

                            let needs_recreate = rs.particle_buffer.as_ref()
                                .map(|b| b.size() < buf_size)
                                .unwrap_or(true);

                            if needs_recreate {
                                let buf = dev.create_buffer(&wgpu::BufferDescriptor {
                                    label: Some("render_particles"),
                                    size: buf_size,
                                    usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
                                    mapped_at_creation: false,
                                });
                                rs.renderer.bind_particle_buffer(&dev, &buf, gpu_particles.len() as u32);
                                rs.particle_buffer = Some(buf);
                            }

                            if let Some(ref buf) = rs.particle_buffer {
                                q.write_buffer(buf, 0, bytemuck::cast_slice(&gpu_particles));
                                rs.renderer.particle_count = gpu_particles.len() as u32;
                            }
                        }

                        // Render frame
                        match rs.renderer.render(&dev, &q) {
                            Ok(()) => {}
                            Err(wgpu::SurfaceError::Lost) => {
                                let w = rs.renderer.surface_config.width;
                                let h = rs.renderer.surface_config.height;
                                rs.renderer.resize(&dev, w, h);
                            }
                            Err(wgpu::SurfaceError::OutOfMemory) => {
                                log::error!("wgpu: out of memory");
                                return;
                            }
                            Err(e) => {
                                log::warn!("wgpu render error: {:?}", e);
                            }
                        }
                    }
                }
            }

            let elapsed = frame_start.elapsed();
            if elapsed < frame_duration {
                std::thread::sleep(frame_duration - elapsed);
            }
        }
    });

    log::info!("Native wgpu renderer initialized ({}x{})", size.width, size.height);
    Ok(())
}
