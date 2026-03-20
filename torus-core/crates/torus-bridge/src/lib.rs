//! Tauri FFI bridge: IPC commands between Rust core and JS UI.
//!
//! Provides Tauri commands that the frontend calls via `invoke()`.
//! The simulation runs in a background thread; commands communicate
//! via a shared `SimulationHandle` protected by a Mutex.

pub mod handle;
pub mod commands;
