import { useSimulationStore } from '../state/simulationStore'
import { runVortexParticlePipeline } from '../simulation/physics/vpm/pipeline'
import { computeVelocityBiotSavart } from '../simulation/physics/vpm/biotSavart'

const BLOCKED_PARAM_KEYS = new Set([
  'gpuAvailable',
  'runtimeBackend',
  'runtimeBackendReason',
  'runtimeBackendError',
])

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function assertPatchObject(patch) {
  if (!isPlainObject(patch)) {
    throw new Error('setParams expects a plain object')
  }
}

function validatePatchKeys(patch, currentParams) {
  const patchKeys = Object.keys(patch)
  const disallowed = patchKeys.filter((key) => {
    if (!(key in currentParams)) {
      return true
    }
    if (key.startsWith('runtime')) {
      return true
    }
    if (BLOCKED_PARAM_KEYS.has(key)) {
      return true
    }
    return false
  })
  if (disallowed.length > 0) {
    throw new Error(`Disallowed param keys: ${disallowed.join(', ')}`)
  }
}

function normalizeRuntimeRef(runtimeRef) {
  if (runtimeRef && typeof runtimeRef === 'object' && 'current' in runtimeRef) {
    return runtimeRef
  }
  return { current: null }
}

function createRuntimeDiagnosticsSnapshot(params, runtimeRef) {
  const runtime = runtimeRef.current
  const simulationState = runtime?.simulationState
  const runtimeTubeCountFromState = Array.isArray(simulationState?.vortexTubes)
    ? simulationState.vortexTubes.length
    : 0
  const runtimeParticleCount = Array.isArray(simulationState?.particles) ? simulationState.particles.length : 0
  const configuredParticleCount = Math.max(0, Math.floor(params.particleCount ?? 0))
  const activeCount = Math.max(
    0,
    Math.floor(params.runtimeGpuDiagActiveCount ?? 0),
    runtimeParticleCount,
    configuredParticleCount,
  )
  return {
    stepMs: Number(params.runtimeGpuStepMs ?? 0) || 0,
    runtimeBackend: String(params.runtimeBackend ?? 'unavailable'),
    runtimeSimulationTime: Number(params.runtimeSimulationTime ?? 0) || 0,
    runtimeCpuSteps: Math.max(0, Math.floor(params.runtimeCpuSteps ?? 0)),
    runtimeGpuSteps: Math.max(0, Math.floor(params.runtimeGpuSteps ?? 0)),
    syncPolicy: String(params.runtimeGpuSyncPolicy ?? 'unavailable'),
    syncReason: String(params.runtimeGpuSyncReason ?? 'manager_unavailable'),
    syncViolations: Math.max(0, Math.floor(params.runtimeGpuSyncViolationCount ?? 0)),
    fullReadbackCount: Math.max(0, Math.floor(params.runtimeGpuFullReadbackCount ?? 0)),
    skippedReadbackCount: Math.max(0, Math.floor(params.runtimeGpuSkippedReadbackCount ?? 0)),
    overflowCount: Math.max(0, Math.floor(params.runtimeGpuDiagOverflowCount ?? 0)),
    collisionCount: Math.max(0, Math.floor(params.runtimeGpuDiagCollisionCount ?? 0)),
    collisionRatio: Number(params.runtimeGpuDiagCollisionRatio ?? 0) || 0,
    hashLoadFactor: Number(params.runtimeGpuDiagHashLoadFactor ?? 0) || 0,
    dispatchCount: Math.max(0, Math.floor(params.runtimeGpuDiagDispatchCount ?? 0)),
    gridBuildCount: Math.max(0, Math.floor(params.runtimeGpuDiagGridBuildCount ?? 0)),
    activeCount,
    sampleCount: Math.max(0, Math.floor(params.runtimeGpuDiagSampleCount ?? 0)),
    avgSpeed: Number(params.runtimeGpuDiagAvgSpeed ?? 0) || 0,
    maxSpeed: Number(params.runtimeGpuDiagMaxSpeed ?? 0) || 0,
    runtimeParticleCount,
    runtimeFilamentCount: Array.isArray(simulationState?.filaments)
      ? simulationState.filaments.length
      : 0,
    runtimeTubeCount: Math.max(
      runtimeTubeCountFromState,
      Math.max(0, Math.floor(params.runtimeTubeCount ?? 0)),
    ),
    runtimeTubeParticleCount: Math.max(0, Math.floor(params.runtimeTubeParticleCount ?? 0)),
    runtimeTubeProjectedCount: Math.max(0, Math.floor(params.runtimeTubeProjectedCount ?? 0)),
    runtimeTubeAverageRadius: Number(params.runtimeTubeAverageRadius ?? 0) || 0,
    runtimeTubeStepMs: Number(params.runtimeTubeStepMs ?? 0) || 0,
    runtimeTubeSpeedAvg: Number(params.runtimeTubeSpeedAvg ?? 0) || 0,
    runtimeTubeSpeedMax: Number(params.runtimeTubeSpeedMax ?? 0) || 0,
    runtimeTubeFilamentContributionAvg: Number(params.runtimeTubeFilamentContributionAvg ?? 0) || 0,
    runtimeTubeVpmContributionAvg: Number(params.runtimeTubeVpmContributionAvg ?? 0) || 0,
    runtimeTubeSelfContributionAvg: Number(params.runtimeTubeSelfContributionAvg ?? 0) || 0,
    tube: {
      count: Math.max(runtimeTubeCountFromState, Math.max(0, Math.floor(params.runtimeTubeCount ?? 0))),
      particleCount: Math.max(0, Math.floor(params.runtimeTubeParticleCount ?? 0)),
      projectedCount: Math.max(0, Math.floor(params.runtimeTubeProjectedCount ?? 0)),
      avgRadius: Number(params.runtimeTubeAverageRadius ?? 0) || 0,
      stepMs: Number(params.runtimeTubeStepMs ?? 0) || 0,
      speedAvg: Number(params.runtimeTubeSpeedAvg ?? 0) || 0,
      speedMax: Number(params.runtimeTubeSpeedMax ?? 0) || 0,
      sourceFilamentAvg: Number(params.runtimeTubeFilamentContributionAvg ?? 0) || 0,
      sourceVpmAvg: Number(params.runtimeTubeVpmContributionAvg ?? 0) || 0,
      sourceTubeAvg: Number(params.runtimeTubeSelfContributionAvg ?? 0) || 0,
    },
  }
}

function createRingParticles(count, ringRadius, coreRadius, gamma) {
  const particles = []
  for (let i = 0; i < count; i++) {
    const theta = (2 * Math.PI * i) / count
    const x = ringRadius * Math.cos(theta)
    const y = ringRadius * Math.sin(theta)
    const z = 0
    const wx = -Math.sin(theta)
    const wy = Math.cos(theta)
    const wz = 0
    particles.push({
      id: i + 1,
      x, y, z,
      px: x, py: y, pz: z,
      vx: 0, vy: 0, vz: 0,
      life: 1, age: 0.1,
      theta: 0, phi: 0, jetPsi: 0,
      hasInjectedTwist: false,
      gamma,
      coreRadius,
      flowVx: 0, flowVy: 0, flowVz: 0,
      velocity: { x: 0, y: 0, z: 0 },
      vorticity: { x: wx, y: wy, z: wz },
      injectVx: 0, injectVy: 0, injectVz: 0,
      history: [{ x, y, z }],
    })
  }
  return particles
}

function deepCloneParticles(particles) {
  return particles.map((p) => ({
    ...p,
    velocity: { ...p.velocity },
    vorticity: { ...p.vorticity },
    history: Array.isArray(p.history) ? p.history.map((h) => ({ ...h })) : [],
  }))
}

function buildParityPhysicsParams(coreRadius, gamma, ringRadius) {
  return {
    vpmEnabled: true,
    useBiotSavart: true,
    dynamicsMode: 'fullPhysics',
    viscosity: 0.001,
    stretchingStrength: 0.5,
    coreRadiusSigma: coreRadius,
    minCoreRadius: 0.01,
    maxVelocity: 100,
    maxVorticity: 200,
    vorticityConfinementStrength: 0,
    adaptiveCfl: false,
    particleIntegrator: 'euler',
    circulationConservationMode: 'off',
    reconnectionDistance: 0,
    diffusionMethod: 'pse',
    stretchingMethod: 'analytic',
    interactionRadius: 2.0,
    cellSizeMultiplier: 20,
    neighborCellRange: 1,
    gamma,
    remeshInterval: 99999,
    trackConservation: false,
    pulseDuration: 0,
    timeScale: 1,
    ringMajor: ringRadius,
    ringMinor: 0.1,
    nozzleZ: 0,
    alpha: 0,
    thetaSpeed: 0,
    twistCoreRadius: 0,
    twistAxialDecay: 0,
    twistToRingCoupling: 0,
    jetSpeed: 0,
    jetTwist: 0,
    ringSpin: false,
    ringFlip: false,
    reverse: false,
    reconnectionMinAge: 0,
    autoCoreRadius: false,
    sigmaRatio: 0.08,
    maxSigmaRatio: 0.25,
    guidedStrength: 0,
    gpuChunkSize: 96,
  }
}

function computeParityMetrics(cpuParticles, gpuParticles, h) {
  cpuParticles.sort((a, b) => a.id - b.id)
  gpuParticles.sort((a, b) => a.id - b.id)

  let maxPosError = 0
  let maxVortError = 0
  let maxGammaError = 0
  let worstIdx = -1

  for (let i = 0; i < cpuParticles.length; i++) {
    const cp = cpuParticles[i]
    const gp = gpuParticles[i]
    if (cp.id !== gp.id) {
      return { error: `ID mismatch at index ${i}: CPU=${cp.id}, GPU=${gp.id}` }
    }

    const dx = cp.x - gp.x
    const dy = cp.y - gp.y
    const dz = cp.z - gp.z
    const posErr = Math.sqrt(dx * dx + dy * dy + dz * dz) / h
    if (posErr > maxPosError) {
      maxPosError = posErr
      worstIdx = i
    }

    const cwx = cp.vorticity?.x ?? 0
    const cwy = cp.vorticity?.y ?? 0
    const cwz = cp.vorticity?.z ?? 0
    const cpMag = Math.sqrt(cwx * cwx + cwy * cwy + cwz * cwz)
    const dwx = cwx - (gp.vorticity?.x ?? 0)
    const dwy = cwy - (gp.vorticity?.y ?? 0)
    const dwz = cwz - (gp.vorticity?.z ?? 0)
    const vortErr = cpMag > 1e-8 ? Math.sqrt(dwx * dwx + dwy * dwy + dwz * dwz) / cpMag : 0
    if (vortErr > maxVortError) maxVortError = vortErr

    const gammaErr = Math.abs(cp.gamma - gp.gamma) / Math.max(Math.abs(cp.gamma), 1e-8)
    if (gammaErr > maxGammaError) maxGammaError = gammaErr
  }

  return { maxPosError, maxVortError, maxGammaError, worstIdx }
}

export function installRuntimeTestApi(runtimeRef) {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return () => {}
  }

  const effectiveRuntimeRef = normalizeRuntimeRef(runtimeRef)
  const readStore = () => useSimulationStore.getState()

  const api = {
    version: '1.0.0',
    getParams() {
      return { ...readStore().params }
    },
    setParams(patch) {
      assertPatchObject(patch)
      const state = readStore()
      validatePatchKeys(patch, state.params)
      state.setParams(patch)
      return { ...readStore().params }
    },
    setMode(modePatch = {}) {
      assertPatchObject(modePatch)
      const patch = {}
      if (modePatch.dynamicsMode != null) {
        patch.dynamicsMode = modePatch.dynamicsMode
      }
      if (modePatch.executionMode != null) {
        patch.executionMode = modePatch.executionMode
      }
      if (modePatch.vortexRepresentation != null) {
        patch.vortexRepresentation = modePatch.vortexRepresentation
      }
      if (modePatch.hybridPlusEnabled != null) {
        patch.hybridPlusEnabled = modePatch.hybridPlusEnabled
      }
      if (modePatch.gpuAutoQualityGuardEnabled != null) {
        patch.gpuAutoQualityGuardEnabled = modePatch.gpuAutoQualityGuardEnabled
      }
      if (modePatch.gpuAutoQualityGuardScope != null) {
        patch.gpuAutoQualityGuardScope = modePatch.gpuAutoQualityGuardScope
      }
      return this.setParams(patch)
    },
    resetParticles() {
      const state = readStore()
      state.resetScene()
      return true
    },
    pulse(command = 'single') {
      const state = readStore()
      if (command === 'single') {
        state.singlePulse()
        return true
      }
      if (command === 'singleBurst') {
        state.singleBurstPulse()
        return true
      }
      if (command === 'startTrain') {
        state.startPulseTrain()
        return true
      }
      if (command === 'stop') {
        state.stopPulseTrain()
        return true
      }
      throw new Error(`Unknown pulse command: ${String(command)}`)
    },
    getRuntimeDiagnostics() {
      const params = readStore().params
      return createRuntimeDiagnosticsSnapshot(params, effectiveRuntimeRef)
    },
    getFilamentStats() {
      const stats = readStore().filamentStats
      return stats && typeof stats === 'object' ? { ...stats } : {}
    },
    getStabilityStats() {
      const stats = readStore().stabilityStats
      return stats && typeof stats === 'object' ? { ...stats } : {}
    },
    getHealth() {
      const params = readStore().params
      const diagnostics = createRuntimeDiagnosticsSnapshot(params, effectiveRuntimeRef)
      const activeCount = Math.max(0, Math.floor(diagnostics.activeCount ?? 0))
      const simulationTime = Number(diagnostics.runtimeSimulationTime ?? 0) || 0
      const resolvedRuntime = effectiveRuntimeRef.current ?? (typeof window !== 'undefined' ? window.__torusRuntime : null)
      return {
        hasRuntimeRef: Boolean(resolvedRuntime),
        simulationAdvancing: simulationTime > 0.05,
        hasParticles: activeCount > 0,
        simulationTime,
        activeCount,
        runtimeBackend: diagnostics.runtimeBackend,
      }
    },
    async waitForMs(ms = 0) {
      const timeout = Math.max(0, Math.floor(Number(ms) || 0))
      await new Promise((resolve) => {
        window.setTimeout(resolve, timeout)
      })
      return true
    },
    getParticleSnapshot() {
      const runtime = effectiveRuntimeRef.current ?? window.__torusRuntime
      if (!runtime) return []
      const particles = runtime.simulationState?.particles ?? []
      return particles.map((p) => ({
        id: p.id,
        x: p.x, y: p.y, z: p.z,
        wx: p.vorticity?.x ?? 0,
        wy: p.vorticity?.y ?? 0,
        wz: p.vorticity?.z ?? 0,
        gamma: p.gamma,
        coreRadius: p.coreRadius,
      }))
    },
    async runParityTest({ particleCount = 32, steps = 100, dt = 0.002 } = {}) {
      const runtime = effectiveRuntimeRef.current ?? window.__torusRuntime
      if (!runtime) return { pass: false, error: 'Runtime not available' }

      const manager = runtime.simulationState?.webgpuManager
      if (!manager) return { pass: false, error: 'WebGPU manager not available' }
      if (manager.hasPendingStep()) {
        return { pass: false, error: 'GPU has pending step — try again' }
      }

      const ringRadius = 0.5
      const coreRadius = 0.05
      const gamma = 1.0
      const h = coreRadius
      const physicsParams = buildParityPhysicsParams(coreRadius, gamma, ringRadius)

      const cpuParticles = deepCloneParticles(createRingParticles(particleCount, ringRadius, coreRadius, gamma))
      for (let i = 0; i < steps; i++) {
        runVortexParticlePipeline(cpuParticles, physicsParams, dt, computeVelocityBiotSavart)
      }

      const gpuParticles = deepCloneParticles(createRingParticles(particleCount, ringRadius, coreRadius, gamma))
      const savedInterval = manager.fullReadbackInterval
      manager.setFullReadbackInterval(1)
      manager.replaceSnapshot(gpuParticles)

      for (let i = 0; i < steps; i++) {
        manager.forceFullReadbackNextDispatch = true
        manager.submitStep(physicsParams, dt, gpuParticles)
        if (manager.pending) await manager.pending
        manager.pollCompletedStep(gpuParticles)
      }

      manager.setFullReadbackInterval(savedInterval)
      const live = runtime.simulationState?.particles
      if (Array.isArray(live) && live.length > 0) {
        manager.forceResyncSnapshot(live)
      }

      if (cpuParticles.length !== gpuParticles.length) {
        return {
          pass: false,
          error: `Count mismatch: CPU=${cpuParticles.length}, GPU=${gpuParticles.length}`,
        }
      }

      const metrics = computeParityMetrics(cpuParticles, gpuParticles, h)
      if (metrics.error) return { pass: false, error: metrics.error }

      return {
        pass: metrics.maxPosError < 0.01,
        particleCount: cpuParticles.length,
        steps,
        dt,
        maxPositionError: metrics.maxPosError,
        maxVorticityError: metrics.maxVortError,
        maxGammaError: metrics.maxGammaError,
        worstParticleIndex: metrics.worstIdx,
        threshold: 0.01,
      }
    },
  }

  Object.defineProperty(window, '__torusTestApi', {
    configurable: true,
    writable: false,
    value: api,
  })

  return () => {
    if (window.__torusTestApi === api) {
      delete window.__torusTestApi
    }
  }
}
