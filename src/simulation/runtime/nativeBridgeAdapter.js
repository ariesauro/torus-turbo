/**
 * Native bridge adapter — connects Rust native compute backend
 * to the existing Three.js rendering pipeline.
 *
 * In native-core mode:
 * - Simulation step runs in Rust via Tauri IPC (`native_step`)
 * - Particle state fetched via `native_get_state`
 * - Diagnostics via `native_get_diagnostics`
 * - Rendering stays in Three.js (WebView), receiving serialized positions
 *
 * This adapter converts the Rust response format to the JS particle format
 * expected by VortexScene/particleViewHelpers.
 */

let tauriInvoke = null

async function getInvoke() {
  if (tauriInvoke) return tauriInvoke
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    tauriInvoke = invoke
    return invoke
  } catch {
    return null
  }
}

/**
 * Initialize the native simulation with current params.
 * @param {object} params — SimParams-compatible object
 * @returns {Promise<boolean>} true if initialized
 */
export async function nativeInit(params) {
  const invoke = await getInvoke()
  if (!invoke) return false
  try {
    await invoke('native_init', { params: mapParamsToRust(params) })
    return true
  } catch {
    return false
  }
}

/**
 * Run one simulation step in the native backend.
 * @param {number} dt — time step
 * @returns {Promise<object|null>} diagnostics snapshot or null
 */
export async function nativeStep(dt) {
  const invoke = await getInvoke()
  if (!invoke) return null
  try {
    return await invoke('native_step', { dt })
  } catch {
    return null
  }
}

/**
 * Fetch current particle state for rendering.
 * Returns data in a format compatible with Three.js particle view.
 * @returns {Promise<object|null>} { count, positions, vorticities, gammas, coreRadii }
 */
export async function nativeGetState() {
  const invoke = await getInvoke()
  if (!invoke) return null
  try {
    return await invoke('native_get_state')
  } catch {
    return null
  }
}

/**
 * Update params without resetting simulation.
 * @param {object} params
 * @returns {Promise<boolean>}
 */
export async function nativeUpdateParams(params) {
  const invoke = await getInvoke()
  if (!invoke) return false
  try {
    await invoke('native_update_params', { params: mapParamsToRust(params) })
    return true
  } catch {
    return false
  }
}

/**
 * Get backend info.
 * @returns {Promise<object|null>}
 */
export async function nativeBackendInfo() {
  const invoke = await getInvoke()
  if (!invoke) return null
  try {
    return await invoke('native_backend_info')
  } catch {
    return null
  }
}

/**
 * Convert native particle snapshot to JS particles array for Three.js rendering.
 * @param {object} snapshot — { count, positions, vorticities, gammas, coreRadii }
 * @returns {Array} particles in JS format
 */
export function snapshotToParticles(snapshot) {
  if (!snapshot || !snapshot.positions) return []

  const { count, positions, vorticities, gammas, coreRadii } = snapshot
  const particles = new Array(count)

  for (let i = 0; i < count; i++) {
    const pos = positions[i]
    const vort = vorticities[i]
    particles[i] = {
      id: i,
      x: pos[0],
      y: pos[1],
      z: pos[2],
      vx: 0,
      vy: 0,
      vz: 0,
      flowVx: 0,
      flowVy: 0,
      flowVz: 0,
      vorticity: { x: vort[0], y: vort[1], z: vort[2] },
      gamma: gammas[i],
      coreRadius: coreRadii[i],
      age: 0,
      life: 1,
    }
  }

  return particles
}

/**
 * Map JS simulation params to Rust SimParams struct layout.
 * Only maps fields that exist in the Rust struct.
 */
function mapParamsToRust(params) {
  return {
    dt: params.dt ?? 0.016,
    particle_count: params.particleCount ?? 0,
    pulse_duration: params.pulseDuration ?? 0.05,
    time_scale: params.timeScale ?? 1,
    nozzle_x: params.nozzleX ?? params.nozzleZ ?? 0,
    alpha_deg: params.alpha ?? -45,
    theta_speed: params.thetaSpeed ?? 0.176,
    ring_major: params.ringMajor ?? 3.48,
    ring_minor: params.ringMinor ?? 1.45,
    viscosity: params.viscosity ?? 0,
    gamma: params.gamma ?? 5.01,
    use_biot_savart: params.useBiotSavart !== false,
    twist_core_radius: params.twistCoreRadius ?? 1.49,
    twist_axial_decay: params.twistAxialDecay ?? 0,
    twist_to_ring_coupling: params.twistToRingCoupling ?? 1,
    jet_speed: params.jetSpeed ?? 3,
    jet_twist: params.jetTwist ?? 0.3,
    spin_sign: params.ringSpin === false ? -1 : 1,
    flip_sign: params.ringFlip ? -1 : 1,
    reverse_factor: params.reverse ? -1 : 1,
    stretching_strength: params.stretchingStrength ?? 0.16,
    reconnection_distance: params.reconnectionDistance ?? 0.02,
    min_core_radius: params.minCoreRadius ?? 0.02,
    diffusion_viscosity: params.diffusionViscosity ?? 0,
    max_velocity: params.maxVelocity ?? 6,
    max_vorticity: params.maxVorticity ?? 0.2,
    grid_cell_size: params.gridCellSize ?? 0.12,
    neighbor_cell_radius: params.neighborCellRadius ?? 1,
    hash_table_size: params.hashTableSize ?? 4096,
    bucket_capacity: params.bucketCapacity ?? 48,
    interaction_radius: params.interactionRadius ?? 1,
    vpm_enabled: params.vpmEnabled !== false,
    scripted_dynamics: params.dynamicsMode === 'scripted',
    reconnection_min_age: params.reconnectionMinAge ?? params.pulseDuration ?? 0.05,
    auto_core_radius_sigma: params.autoCoreRadius ? (params.coreRadiusSigma ?? 0.2) : 0,
    max_sigma_ratio: params.maxSigmaRatio ?? 0.25,
    core_radius_sigma: params.coreRadiusSigma ?? 0.2,
    guided_dynamics: params.dynamicsMode === 'guidedPhysics',
    guided_strength: params.guidedStrength ?? 0.2,
    vorticity_confinement_strength: params.vorticityConfinementStrength ?? 0.08,
    les_enabled: params.lesEnabled === true,
    les_smagorinsky_cs: params.lesSmagorinskyCs ?? 0.15,
  }
}
