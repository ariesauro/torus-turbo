//! Tauri commands exposed to the JS frontend.
//!
//! Usage from JS:
//! ```js
//! import { invoke } from '@tauri-apps/api/core';
//! await invoke('native_init', { params: {...} });
//! const result = await invoke('native_step', { dt: 0.016 });
//! const snapshot = await invoke('native_get_state');
//! ```

use crate::handle::{DiagnosticsSnapshot, ParticleSnapshot, SIMULATION, ensure_initialized};
use torus_physics::params::SimParams;

/// Initialize or re-initialize the native simulation.
#[tauri::command]
pub fn native_init(params: Option<SimParams>) -> Result<String, String> {
    ensure_initialized();
    let mut lock = SIMULATION.lock().map_err(|e| e.to_string())?;
    let sim = lock.as_mut().ok_or("Not initialized")?;

    if let Some(p) = params {
        sim.params = p;
    }
    sim.particles.clear();
    sim.step_count = 0;
    sim.last_diagnostics = None;

    Ok("initialized".into())
}

/// Run one simulation step with the given dt.
#[tauri::command]
pub fn native_step(dt: f64) -> Result<DiagnosticsSnapshot, String> {
    let mut lock = SIMULATION.lock().map_err(|e| e.to_string())?;
    let sim = lock.as_mut().ok_or("Not initialized")?;

    let diag = sim.step(dt);
    Ok(DiagnosticsSnapshot::from_diag(diag))
}

/// Get current particle state for rendering.
#[tauri::command]
pub fn native_get_state() -> Result<ParticleSnapshot, String> {
    let lock = SIMULATION.lock().map_err(|e| e.to_string())?;
    let sim = lock.as_ref().ok_or("Not initialized")?;
    Ok(sim.snapshot())
}

/// Get latest diagnostics.
#[tauri::command]
pub fn native_get_diagnostics() -> Result<Option<DiagnosticsSnapshot>, String> {
    let lock = SIMULATION.lock().map_err(|e| e.to_string())?;
    let sim = lock.as_ref().ok_or("Not initialized")?;
    Ok(sim.diagnostics())
}

/// Update simulation parameters without resetting state.
#[tauri::command]
pub fn native_update_params(params: SimParams) -> Result<String, String> {
    let mut lock = SIMULATION.lock().map_err(|e| e.to_string())?;
    let sim = lock.as_mut().ok_or("Not initialized")?;
    sim.params = params;
    Ok("params_updated".into())
}

/// Update camera from JS orbit controls.
#[tauri::command]
pub fn native_update_camera(
    azimuth: f64,
    elevation: f64,
    distance: f64,
    target: [f64; 3],
    aspect: f64,
) -> Result<String, String> {
    let mut lock = SIMULATION.lock().map_err(|e| e.to_string())?;
    let sim = lock.as_mut().ok_or("Not initialized")?;

    sim.camera_azimuth = azimuth as f32;
    sim.camera_elevation = elevation as f32;
    sim.camera_distance = distance as f32;
    sim.camera_target = [target[0] as f32, target[1] as f32, target[2] as f32];
    sim.camera_aspect = aspect as f32;

    Ok("camera_updated".into())
}

/// Query which backend is active.
#[tauri::command]
pub fn native_backend_info() -> Result<serde_json::Value, String> {
    ensure_initialized();
    let lock = SIMULATION.lock().map_err(|e| e.to_string())?;
    let sim = lock.as_ref().ok_or("Not initialized")?;

    Ok(serde_json::json!({
        "backend": "native",
        "engine": "torus-physics (Rust)",
        "compute_backend": sim.backend_label(),
        "compute_type": format!("{:?}", sim.backend_type()),
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
