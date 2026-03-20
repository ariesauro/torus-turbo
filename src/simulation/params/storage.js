import { defaultParams, STORAGE_KEY } from './defaultParams'
import { cloneSimulationParams, normalizeSimulationParams } from './normalizeParams'

function cloneDefaults() {
  return cloneSimulationParams(defaultParams)
}

const SYNC_CRITICAL_PARAMS = {
  filamentVelocityScale: defaultParams.filamentVelocityScale,
  filamentNodeCount: defaultParams.filamentNodeCount,
  filamentCenterLockEnabled: defaultParams.filamentCenterLockEnabled,
  filamentCenterLockGain: defaultParams.filamentCenterLockGain,
  filamentCenterLockMaxShiftRatio: defaultParams.filamentCenterLockMaxShiftRatio,
  hybridCouplingEnabled: defaultParams.hybridCouplingEnabled,
  hybridParticleToFilamentStrength: defaultParams.hybridParticleToFilamentStrength,
  hybridFilamentToParticleStrength: defaultParams.hybridFilamentToParticleStrength,
  hybridParticleToFilamentClampRatio: defaultParams.hybridParticleToFilamentClampRatio,
  hybridFilamentToParticleClampRatio: defaultParams.hybridFilamentToParticleClampRatio,
  hybridQueryAwareReadbackInterval: defaultParams.hybridQueryAwareReadbackInterval,
  vortexRepresentation: defaultParams.vortexRepresentation,
  executionMode: defaultParams.executionMode,
}

export function normalizePhysicsBackend(params) {
  const normalized = { ...params }

  if (normalized?.physicsBackend === 'gpu') {
    normalized.physicsBackend = 'webgpu'
  }

  return normalizeSimulationParams(normalized)
}

export function loadParamsFromStorage() {
  const base = cloneDefaults()
  const raw = localStorage.getItem(STORAGE_KEY)

  if (!raw) {
    return base
  }

  try {
    const parsed = normalizePhysicsBackend(JSON.parse(raw))
    return normalizeSimulationParams({
      ...base,
      ...parsed,
      ...SYNC_CRITICAL_PARAMS,
      camera: {
        ...base.camera,
        ...(parsed?.camera ?? {}),
      },
      nozzle: {
        ...base.nozzle,
        ...(parsed?.nozzle ?? {}),
        position: {
          ...base.nozzle.position,
          ...(parsed?.nozzle?.position ?? {}),
        },
        direction: {
          ...base.nozzle.direction,
          ...(parsed?.nozzle?.direction ?? {}),
        },
      },
    })
  } catch {
    return base
  }
}

export function saveParamsToStorage(params, cameraState) {
  const normalized = normalizeSimulationParams(params)
  const payload = {
    ...normalized,
    camera: {
      ...normalized.camera,
      ...cameraState,
    },
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}
