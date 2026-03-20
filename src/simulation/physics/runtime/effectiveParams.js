import { getEffectiveRingResolution } from './ringResolution'

function getRingArcSpacing(params) {
  const nozzleRadius = Math.max(params.nozzleRadius ?? 0, 0.01)
  const ringResolution = getEffectiveRingResolution(params)
  return (2 * Math.PI * nozzleRadius) / ringResolution
}

function getReconnectionMinAge(params) {
  const pulseDuration = Math.max(params.pulseDuration ?? 0, 0)
  const jetSpeed = Math.max(params.jetSpeed ?? 0, 1e-4)
  const nozzleRadius = Math.max(params.nozzleRadius ?? 0, 0.01)
  const convectionDelay = nozzleRadius / jetSpeed
  return Math.max(pulseDuration * 2, pulseDuration + convectionDelay)
}

export function getEffectiveSimulationParams(params) {
  const physicsBackend =
    params.physicsBackend === 'webgpu' && !params.gpuAvailable ? 'cpu' : params.physicsBackend
  const guidedMode = params.dynamicsMode === 'guidedPhysics'
  const velocityComputationMode =
    physicsBackend === 'webgpu' || guidedMode ? 'spatialGrid' : params.velocityComputationMode
  const isPhysicsMode =
    params.dynamicsMode === 'fullPhysics' || params.dynamicsMode === 'guidedPhysics'

  const structuredVortexEmission =
    (
      params.emissionMode === 'vortexRing' ||
      params.emissionMode === 'vortexKnot' ||
      params.emissionMode === 'jetRollup'
    ) && isPhysicsMode

  if (!structuredVortexEmission) {
    return {
      ...params,
      physicsBackend,
      velocityComputationMode,
      reconnectionMinAge: Math.max(params.pulseDuration ?? 0, 0),
    }
  }

  const arcSpacing = getRingArcSpacing(params)
  const safeReconnectionDistance = Math.min(
    Math.max(params.reconnectionDistance ?? 0, 0),
    arcSpacing * 0.45,
  )

  return {
    ...params,
    physicsBackend,
    velocityComputationMode,
    useBiotSavart: true,
    vpmEnabled: true,
    reconnectionDistance: safeReconnectionDistance,
    reconnectionMinAge: getReconnectionMinAge(params),
  }
}
