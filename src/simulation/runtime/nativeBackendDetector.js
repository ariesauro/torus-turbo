/**
 * Detects whether the native Rust compute backend is available.
 *
 * In native-core builds, Tauri exposes `native_backend_info` command.
 * In web-core builds, this command doesn't exist — we fall back to JS/WebGPU.
 */

let cachedResult = null

export async function detectNativeBackend() {
  if (cachedResult !== null) return cachedResult

  if (typeof window === 'undefined') {
    cachedResult = { available: false, reason: 'no_window' }
    return cachedResult
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const info = await invoke('native_backend_info')
    cachedResult = {
      available: true,
      backend: info.backend,
      engine: info.engine,
      version: info.version,
    }
  } catch {
    cachedResult = { available: false, reason: 'not_native_build' }
  }

  return cachedResult
}

export function isNativeBackend() {
  return cachedResult?.available === true
}

export function getBackendLabel() {
  return cachedResult?.available ? 'Native' : 'WebGPU'
}
