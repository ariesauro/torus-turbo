import { emitParticles } from './emission/emitParticles'
import { getEffectiveSimulationParams } from './runtime/effectiveParams'
import { runVortexParticlePipeline } from './vpm/pipeline'
import { computeVelocityBiotSavart } from './vpm/biotSavart'
import { computeVelocityBiotSavartSpatial } from './spatialAcceleration/biotSavartSpatial'
import { computeVelocityBiotSavartFMM } from './fmm/biotSavartFmm'
import { conserveCirculation, computeStabilityStats } from './vpm/stability'
import { useSimulationStore } from '../../state/simulationStore'

function pushHistoryPoint(particle, maxLength) {
  if (!Array.isArray(particle.history)) {
    particle.history = []
  }

  particle.history.push({ x: particle.x, y: particle.y, z: particle.z })
  const safeMax = Math.max(2, Math.floor(maxLength))

  if (particle.history.length > safeMax) {
    particle.history.splice(0, particle.history.length - safeMax)
  }
}

function initializeParticleState(particle, params, dt) {
  particle.px = particle.x
  particle.py = particle.y
  particle.pz = particle.z

  particle.life += dt * (params.reverse ? -1 : 1)
  particle.age = (particle.age ?? 0) + dt
  particle.gamma = particle.gamma ?? params.gamma
  particle.coreRadius = Math.max(
    particle.coreRadius ?? params.coreRadiusSigma ?? 0.01,
    params.minCoreRadius ?? 0.01,
  )
  particle.vorticity = particle.vorticity ?? { x: 0, y: 0, z: 0 }
  particle.velocity = particle.velocity ?? {
    x: particle.vx ?? 0,
    y: particle.vy ?? 0,
    z: particle.vz ?? 0,
  }
  particle.injectVx = particle.injectVx ?? particle.velocity.x ?? particle.vx ?? 0
  particle.injectVy = particle.injectVy ?? particle.velocity.y ?? particle.vy ?? 0
  particle.injectVz = particle.injectVz ?? particle.velocity.z ?? particle.vz ?? 0
}

function applyScriptedMotion(particle, params, dt) {
  const jetDuration = Math.max(params.pulseDuration, 1e-4)

  if (particle.life < jetDuration) {
    const nozzleZ = params.nozzleZ ?? params.nozzleX ?? 0
    const dx = particle.x
    const dy = particle.y
    const r = Math.sqrt(dx * dx + dy * dy)
    const psi = Math.atan2(dy, dx)

    const eps = 1e-4
    const safeR = Math.max(r, eps)
    const rc = Math.max(params.twistCoreRadius, eps)
    const beta = Math.max(params.twistAxialDecay, 0)
    const zOffset = Math.max(particle.z - nozzleZ, 0)

    const profile = 1 - Math.exp(-((safeR / rc) ** 2))
    const vtBase = (params.jetTwist / (2 * Math.PI * safeR)) * profile
    const vt = vtBase * Math.exp(-beta * zOffset)

    const vxSwirl = -vt * Math.sin(psi)
    const vySwirl = vt * Math.cos(psi)

    particle.x += vxSwirl * dt
    particle.y += vySwirl * dt
    particle.z += params.jetSpeed * dt

    const angularRate = vt / safeR
    particle.jetPsi += angularRate * dt
    particle.vorticity.z = angularRate * 2
  } else {
    const spin = params.ringSpin ? 1 : -1
    const flip = params.ringFlip ? -1 : 1
    const alpha = (params.alpha * Math.PI) / 180
    const omega = params.thetaSpeed

    const vTheta = omega * Math.cos(alpha)
    const vPhi = omega * Math.sin(alpha)

    if (!particle.hasInjectedTwist) {
      particle.phi += params.twistToRingCoupling * particle.jetPsi
      particle.hasInjectedTwist = true
    }

    particle.theta += vTheta * spin
    particle.phi += vPhi * flip

    const rt = params.ringMajor + params.ringMinor * Math.cos(particle.phi)

    const tx = rt * Math.cos(particle.theta)
    const ty = rt * Math.sin(particle.theta)
    const tz = params.ringMinor * Math.sin(particle.phi)

    particle.x += (tx - particle.x) * (1 - params.viscosity)
    particle.y += (ty - particle.y) * (1 - params.viscosity)
    particle.z += (tz - particle.z) * (1 - params.viscosity)

    if (params.useBiotSavart) {
      const ringMajor = params.ringMajor
      const ringMinor = params.ringMinor
      const circulation = params.gamma

      if (ringMajor > 0 && ringMinor > 0) {
        const logArg = (8 * ringMajor) / ringMinor
        if (logArg > 0) {
          const velocity =
            (circulation / (4 * Math.PI * ringMajor)) * (Math.log(logArg) - 0.25)
          particle.z += velocity
        }
      }
    }
  }

  particle.vx = particle.x - particle.px
  particle.vy = particle.y - particle.py
  particle.vz = particle.z - particle.pz
  particle.velocity = { x: particle.vx, y: particle.vy, z: particle.vz }
}

function applyNaturalGuidance(particles, params, dt) {
  if (params.dynamicsMode !== 'guidedPhysics') {
    return false
  }

  const strength = Math.max(params.guidedStrength ?? 0, 0)
  if (strength <= 0) {
    return false
  }

  const alpha = ((params.alpha ?? 0) * Math.PI) / 180
  const omega = Math.max(params.thetaSpeed ?? 0, 0)
  const spinSign = params.ringSpin ? 1 : -1
  const flipSign = params.ringFlip ? -1 : 1
  const thetaStep = omega * Math.cos(alpha) * dt * spinSign
  const phiStep = omega * Math.sin(alpha) * dt * flipSign
  const guideBlend = Math.min(strength * dt * 8, 1)
  const targetMajor = Math.max(params.ringMajor ?? 0, 1e-4)
  const targetMinor = Math.max(params.ringMinor ?? 0, 1e-4)

  for (let i = 0; i < particles.length; i += 1) {
    const particle = particles[i]
    const radial = Math.sqrt(particle.x * particle.x + particle.y * particle.y)
    const theta = Math.atan2(particle.y, particle.x) + thetaStep
    const phi = Math.atan2(particle.z, radial - targetMajor) + phiStep
    const targetRt = targetMajor + targetMinor * Math.cos(phi)
    const targetX = targetRt * Math.cos(theta)
    const targetY = targetRt * Math.sin(theta)
    const targetZ = targetMinor * Math.sin(phi)

    particle.x += (targetX - particle.x) * guideBlend
    particle.y += (targetY - particle.y) * guideBlend
    particle.z += (targetZ - particle.z) * guideBlend
    particle.vx = particle.x - particle.px
    particle.vy = particle.y - particle.py
    particle.vz = particle.z - particle.pz
    particle.velocity = { x: particle.vx, y: particle.vy, z: particle.vz }
  }

  return true
}

function shouldApplyNaturalPositionGuidance(params) {
  if (params.dynamicsMode !== 'guidedPhysics') {
    return false
  }

  // Priority rule: when Biot-Savart+VPM is active in Natural mode,
  // circulation-direction guidance is applied in the flow solver,
  // so positional attraction pass must stay disabled.
  return !(params.vpmEnabled && params.useBiotSavart)
}

function updateParticleState(particle, params, dt) {
  initializeParticleState(particle, params, dt)

  if (params.dynamicsMode === 'fullPhysics' || params.dynamicsMode === 'guidedPhysics') {
    return
  }

  applyScriptedMotion(particle, params, dt)
}

function resolveCpuVelocityMode(simulationParams, particleCount) {
  const requestedMode = String(simulationParams?.velocityComputationMode ?? 'exact')
  if (requestedMode !== 'auto') {
    return requestedMode
  }
  const exactMax = Math.max(
    1000,
    Math.floor(Number(simulationParams?.velocityAutoExactMaxParticles ?? 12000) || 12000),
  )
  const spatialMax = Math.max(
    exactMax + 1000,
    Math.floor(Number(simulationParams?.velocityAutoSpatialMaxParticles ?? 80000) || 80000),
  )
  if (particleCount <= exactMax) {
    return 'exact'
  }
  if (particleCount <= spatialMax) {
    return 'spatialGrid'
  }
  return 'fmm'
}

function classifyAutoBand(particleCount, exactMax, spatialMax) {
  if (particleCount <= exactMax) return 'exact'
  if (particleCount <= spatialMax) return 'spatialGrid'
  return 'fmm'
}

function createSolverAutoState(initialMode = 'exact') {
  return {
    currentMode: String(initialMode ?? 'exact'),
    candidateMode: String(initialMode ?? 'exact'),
    pendingSteps: 0,
    cooldownSteps: 0,
    switchCount: 0,
    lastSwitchReason: 'init',
  }
}

function resolveCpuVelocityModeAdaptive(simulationParams, particleCount, autoStateInput) {
  const exactMax = Math.max(
    1000,
    Math.floor(Number(simulationParams?.velocityAutoExactMaxParticles ?? 12000) || 12000),
  )
  const spatialMax = Math.max(
    exactMax + 1000,
    Math.floor(Number(simulationParams?.velocityAutoSpatialMaxParticles ?? 80000) || 80000),
  )
  const hysteresis = Math.max(
    200,
    Math.floor(Number(simulationParams?.velocityAutoHysteresisParticles ?? 4000) || 4000),
  )
  const enterSteps = Math.max(
    1,
    Math.floor(Number(simulationParams?.velocityAutoSwitchEnterSteps ?? 3) || 3),
  )
  const cooldownSteps = Math.max(
    0,
    Math.floor(Number(simulationParams?.velocityAutoSwitchCooldownSteps ?? 18) || 18),
  )

  const autoState = autoStateInput ?? createSolverAutoState(classifyAutoBand(particleCount, exactMax, spatialMax))
  if (!autoState.currentMode || autoState.currentMode === 'inactive') {
    autoState.currentMode = classifyAutoBand(particleCount, exactMax, spatialMax)
  }
  if (autoState.cooldownSteps > 0) {
    autoState.cooldownSteps = Math.max(0, autoState.cooldownSteps - 1)
  }

  let desiredMode = autoState.currentMode
  if (autoState.currentMode === 'exact') {
    if (particleCount > exactMax + hysteresis) {
      desiredMode = 'spatialGrid'
    }
  } else if (autoState.currentMode === 'spatialGrid') {
    if (particleCount < exactMax - hysteresis) {
      desiredMode = 'exact'
    } else if (particleCount > spatialMax + hysteresis) {
      desiredMode = 'fmm'
    }
  } else if (autoState.currentMode === 'fmm') {
    if (particleCount < spatialMax - hysteresis) {
      desiredMode = 'spatialGrid'
    }
  } else {
    desiredMode = classifyAutoBand(particleCount, exactMax, spatialMax)
    autoState.currentMode = desiredMode
  }

  if (desiredMode === autoState.currentMode) {
    autoState.candidateMode = desiredMode
    autoState.pendingSteps = 0
    if (autoState.lastSwitchReason === 'init') {
      autoState.lastSwitchReason = `stable_n=${particleCount}`
    }
    return { mode: autoState.currentMode, autoState }
  }

  if (autoState.cooldownSteps > 0) {
    autoState.candidateMode = desiredMode
    autoState.pendingSteps = 0
    autoState.lastSwitchReason = `cooldown_hold_n=${particleCount}`
    return { mode: autoState.currentMode, autoState }
  }

  if (autoState.candidateMode !== desiredMode) {
    autoState.candidateMode = desiredMode
    autoState.pendingSteps = 1
  } else {
    autoState.pendingSteps = Math.max(1, autoState.pendingSteps + 1)
  }

  if (autoState.pendingSteps >= enterSteps) {
    const prev = autoState.currentMode
    autoState.currentMode = desiredMode
    autoState.pendingSteps = 0
    autoState.cooldownSteps = cooldownSteps
    autoState.switchCount = Math.max(0, Math.floor(Number(autoState.switchCount ?? 0) || 0) + 1)
    autoState.lastSwitchReason = `switch_${prev}_to_${desiredMode}_n=${particleCount}`
  } else {
    autoState.lastSwitchReason = `pending_${autoState.pendingSteps}/${enterSteps}_to_${desiredMode}_n=${particleCount}`
  }

  return { mode: autoState.currentMode, autoState }
}

function buildSolverRuntimeDiagnostics(simulationParams, particleCount, resolvedMode = 'exact', autoState = null) {
  const vpmActive = simulationParams?.vpmEnabled === true
  const biotSavartActive = simulationParams?.useBiotSavart === true
  const requestedMode = String(simulationParams?.velocityComputationMode ?? 'exact')
  const solverMode = !vpmActive || !biotSavartActive ? 'inactive' : String(resolvedMode ?? requestedMode)
  const theta = Number(simulationParams?.fmmTheta ?? simulationParams?.hybridPlusBarnesHutTheta ?? 0.65) || 0.65
  const leafSize = Math.max(4, Math.floor(Number(simulationParams?.fmmLeafSize ?? 16) || 16))
  return {
    runtimeSolverMode: solverMode,
    runtimeSolverModeRequested: requestedMode,
    runtimeSolverParticleCount: Math.max(0, Math.floor(Number(particleCount) || 0)),
    runtimeSolverFmmTheta: Math.max(0.2, Math.min(1.2, theta)),
    runtimeSolverFmmLeafSize: Math.max(4, Math.min(64, leafSize)),
    runtimeSolverUseBiotSavart: biotSavartActive,
    runtimeSolverVpmEnabled: vpmActive,
    runtimeSolverAutoCurrentMode: String(autoState?.currentMode ?? resolvedMode ?? requestedMode),
    runtimeSolverAutoCandidateMode: String(autoState?.candidateMode ?? resolvedMode ?? requestedMode),
    runtimeSolverAutoPendingSteps: Math.max(0, Math.floor(Number(autoState?.pendingSteps ?? 0) || 0)),
    runtimeSolverAutoCooldownSteps: Math.max(0, Math.floor(Number(autoState?.cooldownSteps ?? 0) || 0)),
    runtimeSolverAutoSwitchCount: Math.max(0, Math.floor(Number(autoState?.switchCount ?? 0) || 0)),
    runtimeSolverAutoLastSwitchReason: String(autoState?.lastSwitchReason ?? 'none'),
  }
}

function appendParticleHistory(particles, simulationParams) {
  for (let i = 0; i < particles.length; i += 1) {
    pushHistoryPoint(particles[i], simulationParams.curveHistoryLength)
  }
}

function publishStabilityStats(stats, circulationBaseline) {
  const circulationDriftPercent =
    circulationBaseline > 1e-8
      ? ((stats.totalCirculation - circulationBaseline) / circulationBaseline) * 100
      : 0

  useSimulationStore.getState().setStabilityStats({
    ...stats,
    circulationBaseline,
    circulationDriftPercent,
  })
}

function collectParticleDiagnostics(particles, simulationParams) {
  if (!particles || particles.length === 0) {
    return null
  }

  const stats = computeStabilityStats(particles, simulationParams)
  const circulationBaseline = circulationState?.initial || stats.totalCirculation || 0

  if (simulationParams.debugStability) {
    console.log('[Stability]', stats)
  }

  publishStabilityStats(stats, circulationBaseline)
  return stats
}

function applyParticleCommands(
  particles,
  simulationParams,
  idRef,
  pulseState,
  dt,
  gpuRequested,
  webgpuManager,
) {
  if (simulationParams.vortexRepresentation === 'filaments') {
    appendParticleHistory(particles, simulationParams)
    return { spawnedCount: 0 }
  }

  const emissionResult = emitParticles(particles, simulationParams, idRef, pulseState, dt)
  const spawnedParticles = emissionResult.spawnedParticles
  const spawnedCount = spawnedParticles.length

  if (spawnedCount > 0) {
    particles.push(...spawnedParticles)
    if (gpuRequested && webgpuManager) {
      webgpuManager.queueAppendParticles(spawnedParticles)
    }
  }

  if ((pulseState.burstEmissionRemaining ?? 0) > 0) {
    pulseState.burstEmissionRemaining = Math.max(
      0,
      Math.floor(pulseState.burstEmissionRemaining) - spawnedCount,
    )
  }

  appendParticleHistory(particles, simulationParams)
  return { spawnedCount }
}

export function prepareParticleStep(params, baseDt = 0.02) {
  const simulationParams = getEffectiveSimulationParams(params)
  return {
    simulationParams,
    dt: baseDt * simulationParams.timeScale,
    startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    gpuRequested: simulationParams.physicsBackend === 'webgpu',
    runtimeStatus: {
      backend: 'cpu',
      reason: 'cpu_selected',
      stepMs: 0,
      error: '',
      advanced: true,
      emittedThisStep: false,
      gpuDispatchPending: false,
    },
  }
}

export function runCpuParticleStep(particles, simulationParams, dt, startedAt) {
  for (let i = 0; i < particles.length; i += 1) {
    updateParticleState(particles[i], simulationParams, dt)
  }

  let resolvedVelocityMode = String(simulationParams.velocityComputationMode ?? 'exact')
  let nextSolverAutoState = solverAutoState
  if (simulationParams.vpmEnabled) {
    let velocityComputer
    if (simulationParams.useBiotSavart) {
      if (resolvedVelocityMode === 'auto') {
        const adaptive = resolveCpuVelocityModeAdaptive(simulationParams, particles.length, nextSolverAutoState)
        resolvedVelocityMode = adaptive.mode
        nextSolverAutoState = adaptive.autoState
      } else {
        resolvedVelocityMode = resolveCpuVelocityMode(simulationParams, particles.length)
        nextSolverAutoState = createSolverAutoState(resolvedVelocityMode)
      }
      if (resolvedVelocityMode === 'fmm') {
        velocityComputer = computeVelocityBiotSavartFMM
      } else if (resolvedVelocityMode === 'spatialGrid') {
        velocityComputer = computeVelocityBiotSavartSpatial
      } else {
        velocityComputer = computeVelocityBiotSavart
      }
    }
    runVortexParticlePipeline(particles, simulationParams, dt, velocityComputer)
  }
  solverAutoState = nextSolverAutoState

  const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const solverDiagnostics = buildSolverRuntimeDiagnostics(
    simulationParams,
    particles.length,
    resolvedVelocityMode,
    nextSolverAutoState,
  )
  return {
    backend: 'cpu',
    reason: 'cpu_selected',
    stepMs: finishedAt - startedAt,
    error: '',
    advanced: true,
    emittedThisStep: false,
    gpuDispatchPending: false,
    ...solverDiagnostics,
  }
}

export function runGpuParticleStep(
  particles,
  simulationParams,
  dt,
  webgpuManager,
  stepOptions = {},
) {
  if (!simulationParams.gpuAvailable) {
    return {
      backend: 'gpu_error',
      reason: 'webgpu_unavailable',
      stepMs: 0,
      error: 'GPU backend is unavailable',
      advanced: false,
      gpuDispatchPending: false,
    }
  }

  if (!webgpuManager) {
    return {
      backend: 'gpu_error',
      reason: 'webgpu_not_initialized',
      stepMs: 0,
      error: 'GPU device is not initialized yet',
      advanced: false,
      gpuDispatchPending: false,
    }
  }

  try {
    const pollResult = webgpuManager.pollCompletedStep(particles)
    if (webgpuManager.hasPendingStep()) {
      const solverDiagnostics = buildSolverRuntimeDiagnostics(
        simulationParams,
        particles.length,
        String(simulationParams?.velocityComputationMode ?? 'exact'),
        solverAutoState,
      )
      return {
        backend: 'gpu',
        reason: 'dispatch_pending',
        stepMs: pollResult.stepMs ?? webgpuManager.lastStepMs ?? 0,
        error: '',
        advanced: Boolean(pollResult.applied),
        emittedThisStep: false,
        cpuSynchronized: Boolean(pollResult.cpuSynchronized),
        activeCount: pollResult.activeCount ?? webgpuManager.lastCount ?? particles.length,
        gpuDispatchPending: true,
        ...solverDiagnostics,
      }
    }

    if (
      !pollResult.applied &&
      typeof webgpuManager.ensureSnapshotMatchesSeed === 'function'
    ) {
      webgpuManager.ensureSnapshotMatchesSeed(particles)
    }

    if (stepOptions.deferGpuSubmit) {
      const solverDiagnostics = buildSolverRuntimeDiagnostics(
        simulationParams,
        particles.length,
        String(simulationParams?.velocityComputationMode ?? 'exact'),
        solverAutoState,
      )
      return {
        backend: 'gpu',
        reason: pollResult.applied ? 'dispatch_completed' : 'ready_to_submit',
        stepMs: pollResult.stepMs ?? webgpuManager.lastStepMs ?? 0,
        error: '',
        advanced: Boolean(pollResult.applied),
        emittedThisStep: false,
        cpuSynchronized: Boolean(pollResult.cpuSynchronized),
        activeCount: pollResult.activeCount ?? webgpuManager.lastCount ?? particles.length,
        gpuDispatchPending: false,
        readyForSubmit: true,
        ...solverDiagnostics,
      }
    }

    const submitResult = webgpuManager.submitStep(simulationParams, dt, particles)
    const solverDiagnostics = buildSolverRuntimeDiagnostics(
      simulationParams,
      particles.length,
      String(simulationParams?.velocityComputationMode ?? 'exact'),
      solverAutoState,
    )
    return {
      backend: 'gpu',
      reason: submitResult.reason ?? 'dispatch_submitted',
      stepMs: pollResult.stepMs ?? submitResult.stepMs ?? 0,
      error: '',
      advanced: Boolean(pollResult.applied),
      emittedThisStep: false,
      cpuSynchronized: Boolean(pollResult.cpuSynchronized),
      activeCount: pollResult.activeCount ?? webgpuManager.lastCount ?? particles.length,
      gpuDispatchPending: Boolean(submitResult.gpuDispatchPending),
      readyForSubmit: false,
      ...solverDiagnostics,
    }
  } catch (error) {
    const solverDiagnostics = buildSolverRuntimeDiagnostics(
      simulationParams,
      particles.length,
      String(simulationParams?.velocityComputationMode ?? 'exact'),
      solverAutoState,
    )
    return {
      backend: 'gpu_error',
      reason: 'webgpu_dispatch_failed',
      stepMs: 0,
      error: error instanceof Error ? error.message : 'GPU dispatch failed',
      advanced: false,
      emittedThisStep: false,
      gpuDispatchPending: false,
      readyForSubmit: false,
      ...solverDiagnostics,
    }
  }
}

let circulationState = null
let solverAutoState = null

export function updateParticles(
  particles,
  params,
  idRef,
  pulseState,
  baseDt = 0.02,
  webgpuManager = null,
  stepOptions = {},
) {
  const { simulationParams, dt, startedAt, gpuRequested } = prepareParticleStep(params, baseDt)
  const particlesWereEmptyAtStepStart = particles.length === 0

  if (particles.length === 0) {
    circulationState = null
    solverAutoState = null
  } else if (String(simulationParams.velocityComputationMode ?? 'exact') !== 'auto') {
    solverAutoState = null
  }

  const runtimeStatus = gpuRequested
    ? runGpuParticleStep(particles, simulationParams, dt, webgpuManager, stepOptions)
    : runCpuParticleStep(particles, simulationParams, dt, startedAt)
  const shouldAdvanceSideEffects = !gpuRequested || runtimeStatus.advanced || particles.length === 0
  const hasFreshCpuSnapshot = !gpuRequested || (runtimeStatus.cpuSynchronized ?? true)

  if (shouldAdvanceSideEffects && hasFreshCpuSnapshot && particles.length > 0) {
    if (!circulationState) {
      circulationState = { initial: 0, current: 0, particleCount: 0 }
    }

    const circulationResult = conserveCirculation(particles, simulationParams, circulationState)
    if (gpuRequested && circulationResult.changed && webgpuManager) {
      webgpuManager.queueGammaScale(circulationResult.ratio)
    }

    collectParticleDiagnostics(particles, simulationParams)
  }

  if (
    !gpuRequested &&
    shouldAdvanceSideEffects &&
    shouldApplyNaturalPositionGuidance(simulationParams)
  ) {
    applyNaturalGuidance(particles, simulationParams, dt)
  }

  let emittedThisStep = false
  if (shouldAdvanceSideEffects && (hasFreshCpuSnapshot || particles.length === 0)) {
    const commandResult = applyParticleCommands(
      particles,
      simulationParams,
      idRef,
      pulseState,
      dt,
      gpuRequested,
      webgpuManager,
    )
    emittedThisStep = (commandResult?.spawnedCount ?? 0) > 0
    if (
      gpuRequested &&
      particlesWereEmptyAtStepStart &&
      (commandResult?.spawnedCount ?? 0) > 0 &&
      typeof webgpuManager?.requestFullReadbackNextDispatch === 'function'
    ) {
      webgpuManager.requestFullReadbackNextDispatch()
    }
  }

  return {
    ...runtimeStatus,
    emittedThisStep,
  }
}
