import { computeFilamentStats } from '../filaments/filamentStats'
import {
  applyHybridCoupling,
  createHybridCouplingContext,
} from '../filaments/hybridCoupling'
import {
  createFilamentSolverContext,
  prepareFilamentSolverContext,
} from '../filaments/biotSavartFilament'
import { stepFilaments } from '../filaments/filamentSolver'
import { getFilamentQueryStats } from '../filaments/biotSavartFilament'
import {
  ensureVortexTubeSetForFilaments,
  stepVortexTubes,
} from '../tubes/stepVortexTubes'
import { updateParticles } from '../physics/updateParticles'
import { applyVortexCascade } from '../physics/vpm/vortexCascade'
import { computeHybridConsistencyStats } from '../physics/vpm/stability'
import { computeEnergySpectrumDiagnostics, computeWavenumberSpectrum } from '../physics/vpm/energySpectrumDiagnostics'
import { useSimulationStore } from '../../state/simulationStore'
import {
  createHybridPlusState,
  planHybridPlusStep,
  summarizeHybridPlusState,
} from './hybridPlusPlanner'
import {
  createHybridPlusOperatorRegistry,
  runHybridPlusAssistPass,
} from './hybridPlusOperators'
import {
  consumeSimulationStep,
  dropSchedulerOverflow,
  hasPendingSimulationStep,
} from './frameScheduler'
import {
  createStructureDetectionState,
  detectVortexStructures,
} from '../structures/detectVortexStructures'
import {
  createNewtoniumTrackingState,
  updateNewtoniumTrackingState,
} from '../structures/newtoniumTracker'
import { buildRingValidationContract } from '../structures/ringValidationContract'
import { createRingLifecycleState, updateRingLifecycle } from '../structures/ringLifecycleTracker'
import { buildJetRegimeContract } from '../structures/jetRegimeContract'
import { buildStructureDetectionFusionContract } from '../structures/structureDetectionFusionContract'
import {
  createTopologyTrackingState,
  updateTopologyTrackingState,
} from '../structures/topologyTracking'
import { evaluateStabilitySnapshot } from '../stability/stabilityMonitor'
import { buildRuntimeScalingPatch } from '../scaling/nondimensionalScaling'
import {
  createResolutionControllerState,
  evaluateResolutionDecision,
} from '../adaptive/resolutionController'

const GPU_OVERFLOW_CRITICAL_STREAK_MIN = 10
const GPU_OVERFLOW_ACTION_COOLDOWN_STEPS = 40
const GPU_OVERFLOW_COLLISION_RATIO_THRESHOLD = 0.22
const GPU_OVERFLOW_HASH_LOAD_FACTOR_THRESHOLD = 0.68
const GPU_OVERFLOW_MIN_SPAWN_RATE = 24
const GPU_OVERFLOW_SPAWN_RATE_REDUCTION_FACTOR = 0.88
const GPU_QUALITY_GUARD_STEP_MS_THRESHOLD = 9.5
const GPU_QUALITY_GUARD_ACTIVATE_STREAK = 10
const GPU_QUALITY_GUARD_RECOVER_STREAK = 36
const HYBRID_QUERY_DELTA_PROTO_STREAK_MIN = 10
const HYBRID_QUERY_DELTA_PROTO_INTERVAL_MIN = 8
const STABILITY_AUTOCORRECTION_COOLDOWN_STEPS = 24
const STABILITY_AUTOCORRECTION_MIN_TIME_SCALE = 0.15
const STABILITY_AUTOCORRECTION_TIMELINE_MAX = 12
const STABILITY_AUTOCORRECTION_WINDOW_STEPS = 240
const STABILITY_AUTOCORRECTION_SATURATION_PER_1K_STEPS = 35
const STABILITY_AUTOCORRECTION_SATURATION_COOLDOWN_STEPS = 96
const STABILITY_DRIFT_WARNING_ENERGY_PCT = 25
const STABILITY_DRIFT_WARNING_CIRCULATION_PCT = 10

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return 0
  }
  if (n <= 0) {
    return 0
  }
  if (n >= 1) {
    return 1
  }
  return n
}

function computeOverlayUncertaintyPatch(detections, newtonium, params) {
  const detectorConfidence = clamp01(detections?.confidence ?? 0)
  const newtoniumConfidence = clamp01(newtonium?.confidence ?? detectorConfidence)
  const transitions = Math.max(0, Number(newtonium?.transitions ?? 0) || 0)
  const detectorUncertainty = clamp01(1 - detectorConfidence)
  const topologyUncertainty = clamp01((1 - newtoniumConfidence) * 0.75 + clamp01(transitions / 24) * 0.25)
  const renderUncertainty = clamp01(params?.runtimeRenderDiagnosticsUncertainty ?? 1)
  const compositeUncertainty = clamp01(
    detectorUncertainty * 0.45 + topologyUncertainty * 0.35 + renderUncertainty * 0.2,
  )
  return {
    runtimeOverlayConfidenceComposite: clamp01(1 - compositeUncertainty),
    runtimeOverlayUncertaintyComposite: compositeUncertainty,
    runtimeOverlayUncertaintyDetector: detectorUncertainty,
    runtimeOverlayUncertaintyTopology: topologyUncertainty,
    runtimeOverlayUncertaintyRender: renderUncertainty,
  }
}

function normalizeRuntimeOverlayFeatures(features) {
  if (!Array.isArray(features)) {
    return []
  }
  return features.slice(0, 24).map((feature) => ({
    class: String(feature?.class ?? 'cluster'),
    confidence: clamp01(feature?.confidence ?? 0),
    center: {
      x: Number(feature?.center?.x ?? 0) || 0,
      y: Number(feature?.center?.y ?? 0) || 0,
      z: Number(feature?.center?.z ?? 0) || 0,
    },
    radius: Math.max(1e-4, Number(feature?.radius ?? 0) || 0),
    count: Math.max(0, Math.floor(Number(feature?.count ?? 0) || 0)),
    elongation: clamp01(feature?.elongation ?? 0),
    planarity: clamp01(feature?.planarity ?? 0),
  }))
}

function computeAdaptiveConservationDriftControl(runtimeParams, driftStreak) {
  const energyDriftAbs = Math.abs(Number(runtimeParams.runtimeStabilityEnergyErrorPct ?? 0) || 0)
  const circulationDriftAbs = Math.abs(Number(runtimeParams.runtimeStabilityCirculationErrorPct ?? 0) || 0)
  const energySeverity = clamp01(
    (energyDriftAbs - STABILITY_DRIFT_WARNING_ENERGY_PCT) / (STABILITY_DRIFT_WARNING_ENERGY_PCT * 3),
  )
  const circulationSeverity = clamp01(
    (circulationDriftAbs - STABILITY_DRIFT_WARNING_CIRCULATION_PCT) /
      (STABILITY_DRIFT_WARNING_CIRCULATION_PCT * 3),
  )
  const driftSeverity = Math.max(energySeverity, circulationSeverity)
  const streakSeverity = clamp01((Math.max(0, Number(driftStreak ?? 0) - 1) || 0) / 6)
  const adaptiveScale = clamp01(driftSeverity * 0.75 + streakSeverity * 0.25)
  return {
    driftSeverity,
    adaptiveScale,
  }
}

function pushStabilityAutoCorrectionHistory(state, actionLog, stepSerial) {
  const safeActions = Array.isArray(actionLog) ? actionLog.filter((item) => typeof item === 'string') : []
  if (safeActions.length === 0) {
    return
  }
  state.history = Array.isArray(state.history) ? state.history : []
  state.counters = state.counters ?? {
    total: 0,
    timeScale: 0,
    spawnRate: 0,
    remeshRefine: 0,
    remeshCoarsen: 0,
    saturationGuard: 0,
  }
  state.windowActionCount = Math.max(0, Math.floor(Number(state.windowActionCount ?? 0)))
  for (let i = 0; i < safeActions.length; i += 1) {
    const action = safeActions[i]
    state.windowActionCount += 1
    state.counters.total += 1
    if (action === 'reduce_time_scale') {
      state.counters.timeScale += 1
    } else if (
      action === 'reduce_spawn_rate_stability' ||
      action === 'increase_spawn_rate_stability'
    ) {
      state.counters.spawnRate += 1
    } else if (action === 'filament_remesh_refine') {
      state.counters.remeshRefine += 1
    } else if (action === 'filament_remesh_coarsen') {
      state.counters.remeshCoarsen += 1
    } else if (action === 'autocorrection_saturation_guard') {
      state.counters.saturationGuard += 1
    }
    const nextEntry = `${Math.max(0, Math.floor(stepSerial ?? 0))}:${action}`
    const lastEntry =
      state.history.length > 0 ? String(state.history[state.history.length - 1]) : null
    if (lastEntry !== nextEntry) {
      state.history.push(nextEntry)
    }
  }
  if (state.history.length > STABILITY_AUTOCORRECTION_TIMELINE_MAX) {
    state.history.splice(0, state.history.length - STABILITY_AUTOCORRECTION_TIMELINE_MAX)
  }
}

function computeAverageParticleSpeed(particles, fixedStep) {
  if (!Array.isArray(particles) || particles.length === 0) {
    return 0
  }

  const sampleCount = Math.min(160, particles.length)
  const stride = Math.max(1, Math.floor(particles.length / sampleCount))
  let totalSpeed = 0
  let count = 0

  for (let i = 0; i < particles.length; i += stride) {
    const particle = particles[i]
    const vx =
      Number.isFinite(particle.flowVx) && Math.abs(particle.flowVx) > 1e-8
        ? particle.flowVx
        : (particle.vx ?? 0) / Math.max(fixedStep, 1e-4)
    const vy =
      Number.isFinite(particle.flowVy) && Math.abs(particle.flowVy) > 1e-8
        ? particle.flowVy
        : (particle.vy ?? 0) / Math.max(fixedStep, 1e-4)
    const vz =
      Number.isFinite(particle.flowVz) && Math.abs(particle.flowVz) > 1e-8
        ? particle.flowVz
        : (particle.vz ?? 0) / Math.max(fixedStep, 1e-4)
    totalSpeed += Math.hypot(vx, vy, vz)
    count += 1
  }

  return count > 0 ? totalSpeed / count : 0
}

function computeAverageFilamentSpeed(filaments, transportVelocityAvg = 0) {
  if (transportVelocityAvg > 1e-8) {
    return transportVelocityAvg
  }

  if (!Array.isArray(filaments) || filaments.length === 0) {
    return 0
  }

  let totalSpeed = 0
  let count = 0
  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const nodes = filaments[filamentIndex].nodes ?? []
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      const velocity = nodes[nodeIndex].velocity ?? { x: 0, y: 0, z: 0 }
      totalSpeed += Math.hypot(velocity.x, velocity.y, velocity.z)
      count += 1
    }
  }

  return count > 0 ? totalSpeed / count : 0
}

function computeAverageParticleCrossSpeed(particles) {
  if (!Array.isArray(particles) || particles.length === 0) {
    return 0
  }

  let totalSpeed = 0
  for (let i = 0; i < particles.length; i += 1) {
    totalSpeed += Math.hypot(
      particles[i].crossFlowVx ?? 0,
      particles[i].crossFlowVy ?? 0,
      particles[i].crossFlowVz ?? 0,
    )
  }

  return totalSpeed / particles.length
}

function computeAverageFilamentCouplingSpeed(filaments) {
  if (!Array.isArray(filaments) || filaments.length === 0) {
    return 0
  }

  let totalSpeed = 0
  let count = 0
  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const nodes = filaments[filamentIndex].nodes ?? []
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      const couplingVelocity = nodes[nodeIndex].couplingVelocity ?? { x: 0, y: 0, z: 0 }
      totalSpeed += Math.hypot(couplingVelocity.x, couplingVelocity.y, couplingVelocity.z)
      count += 1
    }
  }

  return count > 0 ? totalSpeed / count : 0
}

function computeAverageFilamentLocalSelfSpeed(filaments) {
  if (!Array.isArray(filaments) || filaments.length === 0) {
    return 0
  }

  let totalSpeed = 0
  let count = 0
  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const nodes = filaments[filamentIndex].nodes ?? []
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      const localSelfVelocity = nodes[nodeIndex].localSelfVelocity ?? { x: 0, y: 0, z: 0 }
      totalSpeed += Math.hypot(localSelfVelocity.x, localSelfVelocity.y, localSelfVelocity.z)
      count += 1
    }
  }

  return count > 0 ? totalSpeed / count : 0
}

function computeMaxFilamentLocalSelfSpeed(filaments) {
  if (!Array.isArray(filaments) || filaments.length === 0) {
    return 0
  }

  let maxSpeed = 0
  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const nodes = filaments[filamentIndex].nodes ?? []
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      const localSelfVelocity = nodes[nodeIndex].localSelfVelocity ?? { x: 0, y: 0, z: 0 }
      const speed = Math.hypot(localSelfVelocity.x, localSelfVelocity.y, localSelfVelocity.z)
      if (speed > maxSpeed) {
        maxSpeed = speed
      }
    }
  }

  return maxSpeed
}

function snapFilamentCenterToParticles(filaments, particles) {
  if (
    !Array.isArray(filaments) || filaments.length === 0 ||
    !Array.isArray(particles) || particles.length === 0
  ) {
    return
  }
  let px = 0, py = 0, pz = 0
  for (let i = 0; i < particles.length; i += 1) {
    px += particles[i].x ?? 0
    py += particles[i].y ?? 0
    pz += particles[i].z ?? 0
  }
  const pInv = 1 / particles.length
  px *= pInv; py *= pInv; pz *= pInv

  let fx = 0, fy = 0, fz = 0, nodeCount = 0
  for (let fi = 0; fi < filaments.length; fi += 1) {
    const nodes = filaments[fi].nodes ?? []
    for (let ni = 0; ni < nodes.length; ni += 1) {
      fx += nodes[ni].position.x
      fy += nodes[ni].position.y
      fz += nodes[ni].position.z
      nodeCount += 1
    }
  }
  if (nodeCount === 0) return
  const fInv = 1 / nodeCount
  fx *= fInv; fy *= fInv; fz *= fInv

  const dx = px - fx
  const dy = py - fy
  const dz = pz - fz
  if (dx * dx + dy * dy + dz * dz < 1e-12) return

  for (let fi = 0; fi < filaments.length; fi += 1) {
    const nodes = filaments[fi].nodes ?? []
    for (let ni = 0; ni < nodes.length; ni += 1) {
      nodes[ni].position.x += dx
      nodes[ni].position.y += dy
      nodes[ni].position.z += dz
    }
  }
}

function arraysEqual(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

const GPU_STEP_MS_SMOOTHING_SIZE = 8

function medianStepMs(samples) {
  if (samples.length === 0) return 0
  const sorted = samples.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function publishRuntimeStatus(simulationState, runtimeStatus) {
  let stepMsToPublish = runtimeStatus?.stepMs ?? 0
  if (
    runtimeStatus?.backend === 'gpu' &&
    Number.isFinite(runtimeStatus.stepMs) &&
    runtimeStatus.stepMs >= 0
  ) {
    const ring = simulationState.gpuStepMsSamples ?? []
    ring.push(runtimeStatus.stepMs)
    if (ring.length > GPU_STEP_MS_SMOOTHING_SIZE) ring.shift()
    simulationState.gpuStepMsSamples = ring
    stepMsToPublish = medianStepMs(ring)
  }

  if (
    runtimeStatus &&
    (runtimeStatus.backend !== simulationState.runtimeStatus.backend ||
      runtimeStatus.reason !== simulationState.runtimeStatus.reason ||
      runtimeStatus.error !== simulationState.runtimeStatus.error ||
      runtimeStatus.stepMs !== simulationState.runtimeStatus.stepMs ||
      runtimeStatus.gpuDispatchPending !== simulationState.runtimeStatus.gpuDispatchPending)
  ) {
    simulationState.runtimeStatus = runtimeStatus
    useSimulationStore.getState().setParams({
      runtimeBackend: runtimeStatus.backend,
      runtimeBackendReason: runtimeStatus.reason ?? 'unknown',
      runtimeBackendError: runtimeStatus.error ?? '',
      runtimeGpuStepMs: stepMsToPublish,
      runtimeGpuDispatchPending: Boolean(runtimeStatus.gpuDispatchPending),
      runtimeSolverMode: String(runtimeStatus.runtimeSolverMode ?? 'inactive'),
      runtimeSolverModeRequested: String(runtimeStatus.runtimeSolverModeRequested ?? 'exact'),
      runtimeSolverParticleCount: Math.max(
        0,
        Math.floor(Number(runtimeStatus.runtimeSolverParticleCount ?? 0) || 0),
      ),
      runtimeSolverFmmTheta: Math.max(
        0.2,
        Math.min(1.2, Number(runtimeStatus.runtimeSolverFmmTheta ?? 0.65) || 0.65),
      ),
      runtimeSolverFmmLeafSize: Math.max(
        4,
        Math.min(64, Math.floor(Number(runtimeStatus.runtimeSolverFmmLeafSize ?? 16) || 16)),
      ),
      runtimeSolverUseBiotSavart: runtimeStatus.runtimeSolverUseBiotSavart === true,
      runtimeSolverVpmEnabled: runtimeStatus.runtimeSolverVpmEnabled === true,
      runtimeSolverAutoCurrentMode: String(runtimeStatus.runtimeSolverAutoCurrentMode ?? 'exact'),
      runtimeSolverAutoCandidateMode: String(runtimeStatus.runtimeSolverAutoCandidateMode ?? 'exact'),
      runtimeSolverAutoPendingSteps: Math.max(
        0,
        Math.floor(Number(runtimeStatus.runtimeSolverAutoPendingSteps ?? 0) || 0),
      ),
      runtimeSolverAutoCooldownSteps: Math.max(
        0,
        Math.floor(Number(runtimeStatus.runtimeSolverAutoCooldownSteps ?? 0) || 0),
      ),
      runtimeSolverAutoSwitchCount: Math.max(
        0,
        Math.floor(Number(runtimeStatus.runtimeSolverAutoSwitchCount ?? 0) || 0),
      ),
      runtimeSolverAutoLastSwitchReason: String(runtimeStatus.runtimeSolverAutoLastSwitchReason ?? 'none'),
    })
  }
}

function publishRuntimeCounters(simulationState) {
  const nextSimulationTime = simulationState.simulationTime
  const nextCpuSteps = simulationState.cpuSteps
  const nextGpuSteps = simulationState.gpuSteps
  const nextGpuDispatchPending = Boolean(simulationState.runtimeStatus.gpuDispatchPending)

  if (
    Math.abs(nextSimulationTime - simulationState.publishedStats.simulationTime) > 1e-6 ||
    nextCpuSteps !== simulationState.publishedStats.cpuSteps ||
    nextGpuSteps !== simulationState.publishedStats.gpuSteps ||
    nextGpuDispatchPending !== simulationState.publishedStats.gpuDispatchPending
  ) {
    simulationState.publishedStats.simulationTime = nextSimulationTime
    simulationState.publishedStats.cpuSteps = nextCpuSteps
    simulationState.publishedStats.gpuSteps = nextGpuSteps
    simulationState.publishedStats.gpuDispatchPending = nextGpuDispatchPending
    useSimulationStore.getState().setParams({
      runtimeSimulationTime: nextSimulationTime,
      runtimeCpuSteps: nextCpuSteps,
      runtimeGpuSteps: nextGpuSteps,
      runtimeGpuDispatchPending: nextGpuDispatchPending,
    })
  }
}

function publishGpuDiagnostics(simulationState) {
  const manager = simulationState.webgpuManager
  if (!manager || typeof manager.getLatestGpuDiagnostics !== 'function') {
    return
  }
  const diagnostics = manager.getLatestGpuDiagnostics()
  if (!diagnostics) {
    return
  }

  const dispatchSerial = diagnostics.updatedDispatchSerial ?? -1
  if (dispatchSerial === simulationState.publishedStats.gpuDiagnosticsDispatchSerial) {
    return
  }

  simulationState.publishedStats.gpuDiagnosticsDispatchSerial = dispatchSerial
  useSimulationStore.getState().setParams({
    runtimeGpuDiagSampleCount: diagnostics.sampleCount ?? 0,
    runtimeGpuDiagActiveCount: diagnostics.activeCount ?? 0,
    runtimeGpuDiagAvgSpeed: diagnostics.avgSpeed ?? 0,
    runtimeGpuDiagMaxSpeed: diagnostics.maxSpeed ?? 0,
    runtimeGpuDiagAvgVorticity: diagnostics.avgVorticity ?? 0,
    runtimeGpuDiagMaxVorticity: diagnostics.maxVorticity ?? 0,
    runtimeGpuDiagAvgCoreRadius: diagnostics.avgCoreRadius ?? 0,
    runtimeGpuDiagOverflowCount: diagnostics.overflowCount ?? 0,
    runtimeGpuDiagCollisionCount: diagnostics.collisionCount ?? 0,
    runtimeGpuDiagCollisionRatio: diagnostics.collisionRatio ?? 0,
    runtimeGpuDiagHashLoadFactor: diagnostics.hashLoadFactor ?? 0,
    runtimeGpuDiagDispatchCount: diagnostics.dispatchCount ?? 0,
    runtimeGpuDiagGridBuildCount: diagnostics.gridBuildCount ?? 0,
    runtimeGpuDiagOccupiedBucketCount: diagnostics.occupiedBucketCount ?? 0,
    runtimeGpuDiagHashTableSize: diagnostics.hashTableSize ?? 0,
    runtimeGpuDiagAdaptiveHashTableSize: diagnostics.adaptiveHashTableSize ?? 0,
    runtimeGpuDiagBucketCapacity: diagnostics.bucketCapacity ?? 0,
    runtimeGpuDiagAdaptiveBucketCapacity: diagnostics.adaptiveBucketCapacity ?? 0,
    runtimeGpuDiagOverflowCooldown: diagnostics.overflowAdaptCooldown ?? 0,
    runtimeGpuDiagLowPressureStreak: diagnostics.lowPressureStreak ?? 0,
    runtimeGpuDiagAdaptiveEventType: diagnostics.adaptiveEventType ?? 'none',
    runtimeGpuDiagAdaptiveEventReason: diagnostics.adaptiveEventReason ?? 'none',
    runtimeGpuDiagAdaptiveEventDispatchSerial: diagnostics.adaptiveEventDispatchSerial ?? -1,
  })
  const couplingQueryDiagnostics =
    typeof manager.getLatestCouplingQueryDiagnostics === 'function'
      ? manager.getLatestCouplingQueryDiagnostics()
      : null
  if (couplingQueryDiagnostics) {
    useSimulationStore.getState().setParams({
      runtimeGpuCouplingQuerySerial: couplingQueryDiagnostics.querySerial ?? 0,
      runtimeGpuCouplingQueryPointCount: couplingQueryDiagnostics.pointCount ?? 0,
      runtimeGpuCouplingQueryBackend: couplingQueryDiagnostics.backend ?? 'none',
      runtimeGpuCouplingQueryReason: couplingQueryDiagnostics.reason ?? 'none',
      runtimeGpuCouplingQueryMs: couplingQueryDiagnostics.queryMs ?? 0,
    })
  }
}

function publishStructureDetection(simulationState, params) {
  simulationState.structureDetectionState =
    simulationState.structureDetectionState ?? createStructureDetectionState()
  simulationState.newtoniumTrackingState =
    simulationState.newtoniumTrackingState ?? createNewtoniumTrackingState()
  simulationState.topologyTrackingState =
    simulationState.topologyTrackingState ?? createTopologyTrackingState()
  const detections = detectVortexStructures(
    simulationState.particles,
    params,
    simulationState.structureDetectionState,
  )
  const newtonium = updateNewtoniumTrackingState(
    simulationState.newtoniumTrackingState,
    detections,
    params,
  )
  const ringValidation = buildRingValidationContract({
    ...params,
    runtimeDetectedRingCount: detections.ringCount ?? 0,
    runtimeDetectionConfidence: detections.confidence ?? 0,
    runtimeDetectionEffectiveRingRadiusStdRatioMax: detections.effectiveRingRadiusStdRatioMax ?? 0,
    runtimeTransitionCommitted: newtonium.transitionCommitted ?? 0,
    runtimeTransitionRejected: newtonium.transitionRejected ?? 0,
    runtimeTransitionGammaDriftPct: newtonium.transitionGammaDriftPct ?? 0,
    runtimeTransitionEnergyDriftPct: newtonium.transitionEnergyDriftPct ?? 0,
  })
  simulationState.ringLifecycleState = updateRingLifecycle(
    simulationState.ringLifecycleState ?? createRingLifecycleState(),
    detections,
    ringValidation,
    params,
  )
  const jetRegime = buildJetRegimeContract({
    ...params,
    runtimeDetectedRingCount: detections.ringCount ?? 0,
    runtimeDetectedFilamentCount: detections.filamentCount ?? 0,
    runtimeDetectedClusterCount: detections.clusterCount ?? 0,
    runtimeDetectedTubeCount: detections.tubeCount ?? 0,
    runtimeDetectionConfidence: detections.confidence ?? 0,
    runtimeTransitionGammaDriftPct: newtonium.transitionGammaDriftPct ?? 0,
    runtimeTransitionEnergyDriftPct: newtonium.transitionEnergyDriftPct ?? 0,
  })
  const detectorFusion = buildStructureDetectionFusionContract({
    ...params,
    runtimeDetectedFilamentCount: detections.filamentCount ?? 0,
    runtimeDetectedRingCount: detections.ringCount ?? 0,
    runtimeDetectedTubeCount: detections.tubeCount ?? 0,
    runtimeDetectedSheetCount: detections.sheetCount ?? 0,
    runtimeDetectedClusterCount: detections.clusterCount ?? 0,
    runtimeDetectionConfidence: detections.confidence ?? 0,
    runtimeDetectionClassConfidenceFilament: detections.classConfidenceFilament ?? 0,
    runtimeDetectionClassConfidenceRing: detections.classConfidenceRing ?? 0,
    runtimeDetectionClassConfidenceTube: detections.classConfidenceTube ?? 0,
    runtimeDetectionClassConfidenceSheet: detections.classConfidenceSheet ?? 0,
    runtimeDetectionSheetSurfaceCoherence: detections.sheetSurfaceCoherence ?? 0,
    runtimeDetectionSheetCurvatureAnisotropy: detections.sheetCurvatureAnisotropy ?? 0,
  })
  const topologyTracking = updateTopologyTrackingState(
    simulationState.topologyTrackingState,
    detections,
    newtonium,
    params,
  )
  const jetAutoTuneEligibilityOverride =
    params.emissionMode === 'jetRollup' && params.jetRollupAutoTuneEnabled === true
  const jetExternalValidationEligible =
    jetRegime.externalValidationEligible !== false && !jetAutoTuneEligibilityOverride
  const jetExternalValidationEligibilityReason = jetExternalValidationEligible
    ? 'eligible'
    : jetAutoTuneEligibilityOverride
      ? 'jet_rollup_autotune_active'
      : jetRegime.externalValidationEligibilityReason ?? 'natural_modifier_active'
  useSimulationStore.getState().setParams({
    runtimeDetectedFilamentCount: detections.filamentCount ?? 0,
    runtimeDetectedRingCount: detections.ringCount ?? 0,
    runtimeDetectedTubeCount: detections.tubeCount ?? 0,
    runtimeDetectedSheetCount: detections.sheetCount ?? 0,
    runtimeDetectedClusterCount: detections.clusterCount ?? 0,
    runtimeDetectionConfidence: detections.confidence ?? 0,
    runtimeDetectionConfidenceRaw: detections.confidenceRaw ?? 0,
    runtimeDetectionSheetSurfaceCoherence: detections.sheetSurfaceCoherence ?? 0,
    runtimeDetectionSheetCurvatureAnisotropy: detections.sheetCurvatureAnisotropy ?? 0,
    runtimeDetectionClassConfidenceFilament: detections.classConfidenceFilament ?? 0,
    runtimeDetectionClassConfidenceRing: detections.classConfidenceRing ?? 0,
    runtimeDetectionClassConfidenceTube: detections.classConfidenceTube ?? 0,
    runtimeDetectionClassConfidenceSheet: detections.classConfidenceSheet ?? 0,
    runtimeDetectionSampleCount: detections.sampleCount ?? 0,
    runtimeDetectionMs: detections.elapsedMs ?? 0,
    runtimeDetectionEffectiveMinClusterSize: detections.effectiveMinClusterSize ?? 0,
    runtimeDetectionEffectiveFilamentElongationMin:
      detections.effectiveFilamentElongationMin ?? 0,
    runtimeDetectionEffectiveRingRadiusStdRatioMax:
      detections.effectiveRingRadiusStdRatioMax ?? 0,
    runtimeDetectionEffectiveTubeRadiusStdRatioMax:
      detections.effectiveTubeRadiusStdRatioMax ?? 0,
    runtimeNewtoniumType: newtonium.type ?? 'none',
    runtimeNewtoniumConfidenceRaw: newtonium.confidenceRaw ?? 0,
    runtimeNewtoniumConfidence: newtonium.confidence ?? 0,
    runtimeNewtoniumStableStreak: newtonium.stableStreak ?? 0,
    runtimeNewtoniumTransitions: newtonium.transitions ?? 0,
    runtimeNewtoniumFrameSerial: newtonium.frameSerial ?? 0,
    runtimeTransitionState: newtonium.transitionState ?? 'idle',
    runtimeTransitionCandidateType: newtonium.transitionCandidateType ?? 'none',
    runtimeTransitionPendingFrames: newtonium.transitionPendingFrames ?? 0,
    runtimeTransitionCandidates: newtonium.transitionCandidates ?? 0,
    runtimeTransitionCommitted: newtonium.transitionCommitted ?? 0,
    runtimeTransitionRejected: newtonium.transitionRejected ?? 0,
    runtimeTransitionGammaDriftPct: newtonium.transitionGammaDriftPct ?? 0,
    runtimeTransitionImpulseDriftPct: newtonium.transitionImpulseDriftPct ?? 0,
    runtimeTransitionEnergyDriftPct: newtonium.transitionEnergyDriftPct ?? 0,
    runtimeTransitionGateConfidenceOk: newtonium.transitionGateConfidenceOk === true,
    runtimeTransitionGateInvariantOk: newtonium.transitionGateInvariantOk === true,
    runtimeTransitionGateHysteresisOk: newtonium.transitionGateHysteresisOk === true,
    runtimeTransitionGateReason: newtonium.transitionGateReason ?? 'none',
    runtimeTransitionEnterFrames: newtonium.transitionEnterFrames ?? 3,
    runtimeTransitionConfidenceEnterMin: newtonium.transitionConfidenceEnterMin ?? 0.56,
    runtimeTransitionConfidenceExitMin: newtonium.transitionConfidenceExitMin ?? 0.44,
    runtimeRingValidationVersion: ringValidation.version,
    runtimeRingValidationValid: ringValidation.valid === true,
    runtimeRingValidationVerdict: ringValidation.verdict ?? 'fail',
    runtimeRingValidationAcceptanceScore: ringValidation.acceptanceScore ?? 0,
    runtimeRingValidationGatePassCount: ringValidation.gatePassCount ?? 0,
    runtimeRingValidationGateTotal: ringValidation.gateTotal ?? 4,
    runtimeRingValidationTransitionCommitRatio: ringValidation.transitionCommitRatio ?? 0,
    runtimeRingValidationProfile: ringValidation.profile ?? 'classic',
    runtimeRingValidationModifierStrength: ringValidation.modifierStrength ?? 0,
    runtimeRingExternalValidationEligible: ringValidation.externalValidationEligible !== false,
    runtimeRingExternalValidationEligibilityReason:
      ringValidation.externalValidationEligibilityReason ?? 'eligible',
    runtimeRingLifecycleState: simulationState.ringLifecycleState?.state ?? 'absent',
    runtimeRingLifecycleStateFrames: simulationState.ringLifecycleState?.stateFrames ?? 0,
    runtimeRingLifecycleStateSerial: simulationState.ringLifecycleState?.stateSerial ?? 0,
    runtimeRingLifecycleSaffmanSpeed: simulationState.ringLifecycleState?.saffmanSpeedRef ?? 0,
    runtimeRingLifecycleSpeedErrorPct: simulationState.ringLifecycleState?.speedErrorPct ?? 0,
    runtimeJetRegimeVersion: jetRegime.version,
    runtimeJetRegimeValid: jetRegime.valid === true,
    runtimeJetRegimeVerdict: jetRegime.verdict ?? 'fail',
    runtimeJetRegimeType: jetRegime.regime ?? 'ring_train',
    runtimeJetRegimeAcceptanceScore: jetRegime.acceptanceScore ?? 0,
    runtimeJetRegimeGatePassCount: jetRegime.gatePassCount ?? 0,
    runtimeJetRegimeGateTotal: jetRegime.gateTotal ?? 4,
    runtimeJetRegimeProfile: jetRegime.profile ?? 'classic',
    runtimeJetRegimeModifierStrength: jetRegime.modifierStrength ?? 0,
    runtimeJetExternalValidationEligible: jetExternalValidationEligible,
    runtimeJetExternalValidationEligibilityReason: jetExternalValidationEligibilityReason,
    runtimeJetRegimeReProxy: jetRegime.proxies?.re ?? 0,
    runtimeJetRegimeStProxy: jetRegime.proxies?.st ?? 0,
    runtimeJetRegimeLdProxy: jetRegime.proxies?.ld ?? 0,
    runtimeJetRegimeRingDominance: jetRegime.proxies?.ringDominance ?? 0,
    runtimeJetRegimeWakeIndex: jetRegime.proxies?.wakeIndex ?? 0,
    runtimeDetectorFusionVersion: detectorFusion.version,
    runtimeDetectorFusionValid: detectorFusion.valid === true,
    runtimeDetectorFusionVerdict: detectorFusion.verdict ?? 'fail',
    runtimeDetectorFusionProfile: detectorFusion.profile ?? 'classic',
    runtimeDetectorFusionModifierStrength: detectorFusion.modifierStrength ?? 0,
    runtimeDetectorExternalValidationEligible: detectorFusion.externalValidationEligible !== false,
    runtimeDetectorExternalValidationEligibilityReason:
      detectorFusion.externalValidationEligibilityReason ?? 'eligible',
    runtimeDetectorFusionAcceptanceScore: detectorFusion.acceptanceScore ?? 0,
    runtimeDetectorFusionGatePassCount: detectorFusion.gatePassCount ?? 0,
    runtimeDetectorFusionGateTotal: detectorFusion.gateTotal ?? 5,
    runtimeDetectorFusionWeightedScore: detectorFusion.weightedFusionScore ?? 0,
    runtimeTopologyVersion: topologyTracking.version,
    runtimeTopologyValid: topologyTracking.valid === true,
    runtimeTopologyProfile: topologyTracking.profile ?? 'classic',
    runtimeTopologyModifierStrength: topologyTracking.modifierStrength ?? 0,
    runtimeTopologyExternalValidationEligible: topologyTracking.externalValidationEligible !== false,
    runtimeTopologyExternalValidationEligibilityReason:
      topologyTracking.externalValidationEligibilityReason ?? 'eligible',
    runtimeTopologyFrameSerial: topologyTracking.frameSerial ?? 0,
    runtimeTopologyEventCount: topologyTracking.eventCount ?? 0,
    runtimeTopologyNodeCount: topologyTracking.nodeCount ?? 0,
    runtimeTopologyEdgeCount: topologyTracking.edgeCount ?? 0,
    runtimeTopologyBirthCount: topologyTracking.counters?.birth ?? 0,
    runtimeTopologyDecayCount: topologyTracking.counters?.decay ?? 0,
    runtimeTopologyMergeCount: topologyTracking.counters?.merge ?? 0,
    runtimeTopologySplitCount: topologyTracking.counters?.split ?? 0,
    runtimeTopologyReconnectionCount: topologyTracking.counters?.reconnection ?? 0,
    runtimeTopologyLatestEventType: topologyTracking.latestEvent?.eventType ?? 'none',
    runtimeTopologyLatestEventConfidence: topologyTracking.latestEvent?.confidence ?? 0,
    runtimeTopologyLatestEventFrame: topologyTracking.latestEvent?.frame ?? topologyTracking.frameSerial ?? 0,
    runtimeTopologyEventLog: topologyTracking.eventLog ?? [],
    runtimeTopologyGraphNodes: topologyTracking.graph?.nodes ?? [],
    runtimeTopologyGraphEdges: topologyTracking.graph?.edges ?? [],
    runtimeOverlayStructures: normalizeRuntimeOverlayFeatures(detections.overlayFeatures),
    ...computeOverlayUncertaintyPatch(detections, newtonium, params),
  })
}

function publishEnergyDiagnostics(simulationState, params) {
  if (params?.energyDiagnosticsEnabled === false) {
    return
  }
  const diagnostics = computeEnergySpectrumDiagnostics(simulationState.particles, {
    maxSamples: params?.energyDiagnosticsMaxSamples ?? 8000,
    bins: params?.energyDiagnosticsBinCount ?? 8,
    maxSpeedForBins: params?.energyDiagnosticsMaxSpeedForBins ?? 8,
    maxVorticityForProxy: params?.energyDiagnosticsMaxVorticityForProxy ?? 12,
  })
  const bins = diagnostics.bins ?? new Float32Array(8)
  useSimulationStore.getState().setParams({
    runtimeEnergySampleCount: diagnostics.sampleCount ?? 0,
    runtimeEnergyProxy: diagnostics.energyProxy ?? 0,
    runtimeEnstrophyProxy: diagnostics.enstrophyProxy ?? 0,
    runtimeEnergyMaxSpeed: diagnostics.maxSpeed ?? 0,
    runtimeEnergyMaxVorticity: diagnostics.maxVorticity ?? 0,
    runtimeEnergyBin0: bins[0] ?? 0,
    runtimeEnergyBin1: bins[1] ?? 0,
    runtimeEnergyBin2: bins[2] ?? 0,
    runtimeEnergyBin3: bins[3] ?? 0,
    runtimeEnergyBin4: bins[4] ?? 0,
    runtimeEnergyBin5: bins[5] ?? 0,
    runtimeEnergyBin6: bins[6] ?? 0,
    runtimeEnergyBin7: bins[7] ?? 0,
  })

  const stepSerial = simulationState.stepSerial ?? 0
  if (stepSerial % 30 === 0 && simulationState.particles.length >= 16) {
    const spectrum = computeWavenumberSpectrum(simulationState.particles, { maxSamples: 500, bins: 12 })
    simulationState.lastEkSpectrum = spectrum
  }
}

function publishHybridPlusStatus(simulationState) {
  const state = simulationState.hybridPlusState ?? createHybridPlusState()
  const syncContract = simulationState.gpuSyncContract ?? {
    policy: 'unavailable',
    reason: 'manager_unavailable',
    violationCount: 0,
    lastReadbackReason: 'none',
  }
  const syncDiagnostics =
    typeof simulationState.webgpuManager?.getSyncDiagnostics === 'function'
      ? simulationState.webgpuManager.getSyncDiagnostics()
      : null
  simulationState.hybridPlusState = state
  useSimulationStore.getState().setParams({
    runtimeHybridPlusActive: state.active,
    runtimeHybridPlusReason: state.reason,
    runtimeHybridPlusBaseBackend: state.baseBackend,
    runtimeHybridPlusAssistBackend: state.assistBackend,
    runtimeHybridPlusSyncMode: state.syncMode,
    runtimeHybridPlusOperatorCount: state.selectedOperatorCount,
    runtimeHybridPlusAssistCostMs: state.assistCostMs ?? 0,
    runtimeHybridPlusProducedDeltaCount: state.producedDeltaCount ?? 0,
    runtimeHybridPlusAppliedDeltaCount: state.appliedDeltaCount ?? 0,
    runtimeHybridPlusRejectedDeltaCount: state.rejectedDeltaCount ?? 0,
    runtimeHybridPlusTopologyProducedCount: state.topologyProducedCount ?? 0,
    runtimeHybridPlusBarnesHutProducedCount: state.barnesHutProducedCount ?? 0,
    runtimeHybridPlusTopologyCostMs: state.topologyCostMs ?? 0,
    runtimeHybridPlusBarnesHutCostMs: state.barnesHutCostMs ?? 0,
    runtimeHybridPlusApplyCostMs: state.applyCostMs ?? 0,
    runtimeHybridPlusAssistCadenceBaseSteps: state.assistCadenceBaseSteps ?? 1,
    runtimeHybridPlusAssistCadenceRuntimeSteps: state.assistCadenceRuntimeSteps ?? 1,
    runtimeHybridPlusAssistCadenceAdaptive: state.assistCadenceAdaptive !== false,
    runtimeHybridPlusAssistCadenceMaxSteps: state.assistCadenceMaxSteps ?? 4,
    runtimeHybridPlusAssistOverBudgetStreak: state.assistOverBudgetStreak ?? 0,
    runtimeHybridPlusAssistIdleStreak: state.assistIdleStreak ?? 0,
    runtimeHybridPlusAssistOverBudget: state.assistOverBudget === true,
    runtimeHybridPlusAssistBudgetPressure: state.assistBudgetPressure ?? 0,
    runtimeHybridPlusAssistSkipCadenceCount: state.assistSkipCadenceCount ?? 0,
    runtimeHybridPlusAssistSkipBudgetCount: state.assistSkipBudgetCount ?? 0,
    runtimeHybridPlusAssistRunCount: state.assistRunCount ?? 0,
    runtimeSyncEpoch: syncDiagnostics?.epoch ?? 0,
    runtimeSyncStaleDrops: syncDiagnostics?.staleDropCount ?? 0,
    runtimeSyncResyncCount: syncDiagnostics?.resyncCount ?? 0,
    runtimeGpuFullReadbackCount: syncDiagnostics?.fullReadbackCount ?? 0,
    runtimeGpuSkippedReadbackCount: syncDiagnostics?.skippedFullReadbackCount ?? 0,
    runtimeGpuDiagOverflowCount: syncDiagnostics?.overflowCount ?? 0,
    runtimeGpuDiagCollisionCount: syncDiagnostics?.collisionCount ?? 0,
    runtimeGpuDiagCollisionRatio: syncDiagnostics?.collisionRatio ?? 0,
    runtimeGpuDiagHashLoadFactor: syncDiagnostics?.hashLoadFactor ?? 0,
    runtimeGpuDiagDispatchCount: syncDiagnostics?.dispatchCount ?? 0,
    runtimeGpuDiagGridBuildCount: syncDiagnostics?.gridBuildCount ?? 0,
    runtimeGpuDiagOccupiedBucketCount: syncDiagnostics?.occupiedBucketCount ?? 0,
    runtimeGpuDiagHashTableSize: syncDiagnostics?.hashTableSize ?? 0,
    runtimeGpuDiagAdaptiveHashTableSize: syncDiagnostics?.adaptiveHashTableSize ?? 0,
    runtimeGpuDiagBucketCapacity: syncDiagnostics?.bucketCapacity ?? 0,
    runtimeGpuDiagAdaptiveBucketCapacity: syncDiagnostics?.adaptiveBucketCapacity ?? 0,
    runtimeGpuDiagOverflowCooldown: syncDiagnostics?.overflowAdaptCooldown ?? 0,
    runtimeGpuDiagLowPressureStreak: syncDiagnostics?.lowPressureStreak ?? 0,
    runtimeGpuDiagAdaptiveEventType: syncDiagnostics?.adaptiveEventType ?? 'none',
    runtimeGpuDiagAdaptiveEventReason: syncDiagnostics?.adaptiveEventReason ?? 'none',
    runtimeGpuDiagAdaptiveEventDispatchSerial: syncDiagnostics?.adaptiveEventDispatchSerial ?? -1,
    runtimeGpuSyncPolicy: syncContract.policy,
    runtimeGpuSyncReason: syncContract.reason,
    runtimeGpuSyncViolationCount: syncContract.violationCount,
    runtimeGpuSyncLastReadbackReason:
      syncDiagnostics?.lastFullReadbackReason ?? syncContract.lastReadbackReason ?? 'none',
  })
}

function publishFilamentStats(simulationState, fixedStep) {
  const queryStats = getFilamentQueryStats()
  const particleCouplingStats = simulationState.hybridCouplingContext?.stats?.particleToFilament
  const couplingQueryCount = queryStats.couplingQueryCount ?? 0
  const couplingTotalSamples =
    (queryStats.averageCouplingSamples ?? 0) * couplingQueryCount +
    (particleCouplingStats?.totalSamples ?? 0)
  const totalCouplingQueryCount = couplingQueryCount + (particleCouplingStats?.queryCount ?? 0)
  const averageCouplingSamples =
    totalCouplingQueryCount > 0 ? couplingTotalSamples / totalCouplingQueryCount : 0
  const maxCouplingSamples = Math.max(
    queryStats.maxCouplingSamples ?? 0,
    particleCouplingStats?.maxSamples ?? 0,
  )
  const couplingStepMs = simulationState.hybridCouplingContext?.stats?.stepMs ?? 0
  const couplingBackend =
    simulationState.hybridCouplingContext?.stats?.filamentToParticleBackend ?? 'cpu_pointwise'
  const couplingBatchingEnabled = couplingBackend === 'cpu_batch'
  const hybridRuntimeStats = simulationState.hybridRuntimeStats ?? {}
  const particleSpeed = computeAverageParticleSpeed(simulationState.particles, fixedStep)
  const filamentTransportVelocity = queryStats.transportVelocityAvg ?? 0
  const filamentSpeed = computeAverageFilamentSpeed(
    simulationState.filaments,
    filamentTransportVelocity,
  )
  const particleCrossSpeed = computeAverageParticleCrossSpeed(simulationState.particles)
  const filamentCrossSpeed = computeAverageFilamentCouplingSpeed(simulationState.filaments)
  const filamentLocalSelfSpeed = computeAverageFilamentLocalSelfSpeed(simulationState.filaments)
  const filamentLocalSelfSpeedMax = computeMaxFilamentLocalSelfSpeed(simulationState.filaments)
  const speedRatio = filamentSpeed > 1e-6 ? particleSpeed / filamentSpeed : 0
  const particleToFilamentQueryCount = particleCouplingStats?.queryCount ?? 0
  const hybridFilamentCouplingSelfRatio =
    particleToFilamentQueryCount > 0
      ? (particleCouplingStats?.totalSelfRatio ?? 0) / particleToFilamentQueryCount
      : 0
  const hybridFilamentRadialOutward =
    particleToFilamentQueryCount > 0
      ? (particleCouplingStats?.totalOutwardVelocity ?? 0) / particleToFilamentQueryCount
      : 0
  const hybridDriftClampFactorAvg =
    particleToFilamentQueryCount > 0
      ? (particleCouplingStats?.totalDriftClampFactor ?? 0) / particleToFilamentQueryCount
      : 1
  const hybridAdaptiveMinSelfRatioAvg =
    particleToFilamentQueryCount > 0
      ? (particleCouplingStats?.totalAdaptiveMinSelfRatio ?? 0) / particleToFilamentQueryCount
      : 0
  const hybridAdaptiveCenterPullGainAvg =
    particleToFilamentQueryCount > 0
      ? (particleCouplingStats?.totalAdaptiveCenterPullGain ?? 0) / particleToFilamentQueryCount
      : 0
  const hybridDriftSeverityAvg =
    particleToFilamentQueryCount > 0
      ? (particleCouplingStats?.totalDriftSeverity ?? 0) / particleToFilamentQueryCount
      : 0

  useSimulationStore.getState().setFilamentStats(
    computeFilamentStats(simulationState.filaments, {
      ...queryStats,
      averageCouplingSamples,
      maxCouplingSamples,
      stepMs: (queryStats.stepMs ?? 0) + couplingStepMs,
      hybridParticleSpeed: particleSpeed,
      hybridFilamentSpeed: filamentSpeed,
      hybridParticleCrossSpeed: particleCrossSpeed,
      hybridFilamentCrossSpeed: filamentCrossSpeed,
      hybridFilamentLocalSelfSpeed: filamentLocalSelfSpeed,
      hybridFilamentLocalSelfSpeedMax: filamentLocalSelfSpeedMax,
      hybridSpeedRatio: speedRatio,
      hybridParticleDt: hybridRuntimeStats.particleDt ?? fixedStep,
      hybridFilamentDt: hybridRuntimeStats.filamentDt ?? fixedStep,
      hybridParticleToFilamentClampHits: particleCouplingStats?.clampHitCount ?? 0,
      hybridFilamentCouplingSelfRatio,
      hybridFilamentCouplingSelfRatioMax: particleCouplingStats?.maxSelfRatio ?? 0,
      hybridFilamentRadialOutward,
      hybridFilamentRadialOutwardMax: particleCouplingStats?.maxOutwardVelocity ?? 0,
      hybridDriftClampFactorAvg,
      hybridDriftClampFactorMin: particleCouplingStats?.minDriftClampFactor ?? 1,
      hybridDriftClampHitCount: particleCouplingStats?.driftClampHitCount ?? 0,
      hybridCenterGuardActivations: particleCouplingStats?.centerGuardHitCount ?? 0,
      hybridRadiusGuardActivations: particleCouplingStats?.radiusGuardHitCount ?? 0,
      hybridAdaptiveMinSelfRatioAvg,
      hybridAdaptiveMinSelfRatioMax: particleCouplingStats?.maxAdaptiveMinSelfRatio ?? 0,
      hybridAdaptiveCenterPullGainAvg,
      hybridAdaptiveCenterPullGainMax: particleCouplingStats?.maxAdaptiveCenterPullGain ?? 0,
      hybridDriftSeverityAvg,
      hybridDriftSeverityMax: particleCouplingStats?.maxDriftSeverity ?? 0,
    }),
  )
  useSimulationStore.getState().setParams({
    runtimeHybridFilamentToParticleBackend: couplingBackend,
    runtimeHybridFilamentToParticleBatchingEnabled: couplingBatchingEnabled,
  })
}

function publishHybridDiagnostics(simulationState) {
  const hybridStats = computeHybridConsistencyStats(
    simulationState.particles,
    simulationState.filaments,
    simulationState.hybridConsistencyState,
  )
  const currentStats = useSimulationStore.getState().stabilityStats
  useSimulationStore.getState().setStabilityStats({
    ...currentStats,
    ...hybridStats,
  })
}

function resetCrossCouplingState(simulationState) {
  for (let i = 0; i < simulationState.particles.length; i += 1) {
    const particle = simulationState.particles[i]
    particle.crossFlowVx = 0
    particle.crossFlowVy = 0
    particle.crossFlowVz = 0
    particle.selfFlowVx = particle.flowVx ?? 0
    particle.selfFlowVy = particle.flowVy ?? 0
    particle.selfFlowVz = particle.flowVz ?? 0
  }

  for (let filamentIndex = 0; filamentIndex < simulationState.filaments.length; filamentIndex += 1) {
    const nodes = simulationState.filaments[filamentIndex].nodes ?? []
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      nodes[nodeIndex].couplingVelocity = { x: 0, y: 0, z: 0 }
    }
  }

  const currentStats = useSimulationStore.getState().stabilityStats
  useSimulationStore.getState().setStabilityStats({
    ...currentStats,
    hybridParticleCirculation: 0,
    hybridFilamentCirculation: 0,
    hybridTotalCirculation: 0,
    hybridCirculationBaseline: 0,
    hybridCirculationDriftPercent: 0,
    hybridParticleCount: 0,
    hybridFilamentCount: 0,
    hybridCenterOffset: 0,
    hybridAxialOffset: 0,
    hybridParticleCenterStep: 0,
    hybridFilamentCenterStep: 0,
    hybridRadiusOffset: 0,
    hybridFilamentMeanRadius: 0,
    hybridFilamentRadiusDriftPercent: 0,
    hybridFilamentArcLength: 0,
    hybridFilamentArcLengthDriftPercent: 0,
  })
  simulationState.hybridRuntimeStats = {
    particleDt: 0,
    filamentDt: 0,
    particleSpeed: 0,
    filamentSpeed: 0,
  }
}

/** В hybrid полный readback каждые N диспатчей: 1 = каждый кадр для tight particle-filament sync. */
const HYBRID_FULL_READBACK_INTERVAL = 1
const HYBRID_QUERY_AWARE_FULL_READBACK_INTERVAL = 1

function configureGpuReadbackCadence(simulationState, params) {
  const manager = simulationState.webgpuManager
  if (!manager || typeof manager.setFullReadbackInterval !== 'function') {
    return { policy: 'unavailable', reason: 'manager_unavailable', interval: 0 }
  }

  const forceSyncRequested = simulationState.pulseGpuSyncRequested === true
  const isHybrid = params.vortexRepresentation === 'hybrid'
  const strictSyncRequired =
    isHybrid ||
    params.dynamicsMode === 'guidedPhysics' ||
    params.hybridPlusEnabled === true ||
    params.runtimeHybridPlusActive === true
  const hybridQueryBackendMode = params.hybridParticleToFilamentBackend ?? 'auto'
  const hybridQueryAwareEnabled =
    isHybrid &&
    hybridQueryBackendMode !== 'cpu' &&
    typeof manager.isCouplingQuerySupported === 'function' &&
    manager.isCouplingQuerySupported()
  simulationState.gpuCouplingQueryPolicyState = simulationState.gpuCouplingQueryPolicyState ?? {
    healthyStreak: 0,
  }
  const couplingQueryDiagnostics =
    typeof manager.getLatestCouplingQueryDiagnostics === 'function'
      ? manager.getLatestCouplingQueryDiagnostics()
      : null
  const couplingQueryHealthy =
    couplingQueryDiagnostics?.backend === 'gpu' &&
    couplingQueryDiagnostics?.reason === 'ok' &&
    (couplingQueryDiagnostics?.pointCount ?? 0) > 0
  if (hybridQueryAwareEnabled && couplingQueryHealthy) {
    simulationState.gpuCouplingQueryPolicyState.healthyStreak += 1
  } else {
    simulationState.gpuCouplingQueryPolicyState.healthyStreak = 0
  }
  const deltaProtoEligible =
    hybridQueryAwareEnabled &&
    simulationState.gpuCouplingQueryPolicyState.healthyStreak >=
      HYBRID_QUERY_DELTA_PROTO_STREAK_MIN

  const baseInterval = forceSyncRequested
    ? 1
    : strictSyncRequired
      ? (isHybrid
          ? hybridQueryAwareEnabled
            ? Math.max(
                1,
                Math.floor(
                  params.hybridQueryAwareReadbackInterval ??
                    HYBRID_QUERY_AWARE_FULL_READBACK_INTERVAL,
                ),
              )
            : HYBRID_FULL_READBACK_INTERVAL
          : 1)
      : 4
  const interval =
    strictSyncRequired && isHybrid && deltaProtoEligible
      ? Math.max(baseInterval, HYBRID_QUERY_DELTA_PROTO_INTERVAL_MIN)
      : baseInterval
  manager.setFullReadbackInterval(interval)
  if (forceSyncRequested) {
    return { policy: 'forced', reason: 'pulse_sync_requested', interval }
  }
  if (strictSyncRequired) {
    const reason = isHybrid
      ? deltaProtoEligible
        ? 'hybrid_representation_query_delta_proto'
        : hybridQueryAwareEnabled
        ? 'hybrid_representation_query_aware'
        : 'hybrid_representation'
      : params.dynamicsMode === 'guidedPhysics'
        ? 'guided_physics'
        : 'hybrid_plus_assist'
    return { policy: 'strict', reason, interval }
  }
  return { policy: 'relaxed', reason: 'particle_gpu_primary', interval }
}

function updateGpuSyncContractState(simulationState, configuredSyncPolicy) {
  simulationState.gpuSyncContract = simulationState.gpuSyncContract ?? {
    policy: 'unavailable',
    reason: 'manager_unavailable',
    violationCount: 0,
    lastReadbackReason: 'none',
    lastObservedDispatchSerial: -1,
  }
  const contract = simulationState.gpuSyncContract
  contract.policy = configuredSyncPolicy?.policy ?? 'unavailable'
  contract.reason = configuredSyncPolicy?.reason ?? 'manager_unavailable'

  const syncDiagnostics =
    typeof simulationState.webgpuManager?.getSyncDiagnostics === 'function'
      ? simulationState.webgpuManager.getSyncDiagnostics()
      : null
  if (!syncDiagnostics) {
    contract.lastReadbackReason = 'none'
    return
  }

  const dispatchSerial = Math.floor(syncDiagnostics.currentDispatchSerial ?? -1)
  if (dispatchSerial === contract.lastObservedDispatchSerial) {
    contract.lastReadbackReason = syncDiagnostics.lastFullReadbackReason ?? 'none'
    return
  }
  contract.lastObservedDispatchSerial = dispatchSerial
  contract.lastReadbackReason = syncDiagnostics.lastFullReadbackReason ?? 'none'

  const hadFullReadback = syncDiagnostics.lastDispatchHadFullReadback === true
  const readbackReason = syncDiagnostics.lastFullReadbackReason ?? 'none'
  const policy = contract.policy
  if (policy === 'forced' && !hadFullReadback) {
    contract.violationCount += 1
  } else if (
    policy === 'relaxed' &&
    hadFullReadback &&
    readbackReason !== 'bootstrap' &&
    readbackReason !== 'interval_tick'
  ) {
    contract.violationCount += 1
  }
}

function applyGpuOverflowProtection(simulationState, params) {
  simulationState.gpuOverflowProtection = simulationState.gpuOverflowProtection ?? {
    criticalStreak: 0,
    active: false,
    actionCooldownSteps: 0,
    lastAction: 'none',
    lastPublished: null,
  }
  const protection = simulationState.gpuOverflowProtection
  if (protection.actionCooldownSteps > 0) {
    protection.actionCooldownSteps -= 1
  }

  const syncDiagnostics =
    typeof simulationState.webgpuManager?.getSyncDiagnostics === 'function'
      ? simulationState.webgpuManager.getSyncDiagnostics()
      : null
  const activeCount = Math.max(0, Math.floor(syncDiagnostics?.activeCount ?? 0))
  const overflowCount = Math.max(0, Math.floor(syncDiagnostics?.overflowCount ?? 0))
  const collisionRatio = Number(syncDiagnostics?.collisionRatio ?? 0)
  const hashLoadFactor = Number(syncDiagnostics?.hashLoadFactor ?? 0)
  const overflowThreshold = Math.max(6, Math.ceil(activeCount * 0.0025))
  const criticalNow =
    activeCount > 0 &&
    (overflowCount > overflowThreshold ||
      (collisionRatio > GPU_OVERFLOW_COLLISION_RATIO_THRESHOLD &&
        hashLoadFactor > GPU_OVERFLOW_HASH_LOAD_FACTOR_THRESHOLD))

  protection.criticalStreak = criticalNow ? protection.criticalStreak + 1 : 0
  protection.active = protection.criticalStreak >= GPU_OVERFLOW_CRITICAL_STREAK_MIN

  if (protection.active && protection.actionCooldownSteps <= 0) {
    const currentSpawnRate = Math.max(1, Math.floor(params.spawnRate ?? 0))
    const nextSpawnRate = Math.max(
      GPU_OVERFLOW_MIN_SPAWN_RATE,
      Math.floor(currentSpawnRate * GPU_OVERFLOW_SPAWN_RATE_REDUCTION_FACTOR),
    )
    if (nextSpawnRate < currentSpawnRate) {
      useSimulationStore.getState().setParams({ spawnRate: nextSpawnRate })
      protection.lastAction = 'reduce_spawn_rate'
      protection.actionCooldownSteps = GPU_OVERFLOW_ACTION_COOLDOWN_STEPS
    }
  }

  const nextPublished = {
    runtimeGpuOverflowCriticalStreak: protection.criticalStreak,
    runtimeGpuOverflowCriticalActive: protection.active,
    runtimeGpuOverflowProtectionCooldown: protection.actionCooldownSteps,
    runtimeGpuOverflowProtectionLastAction: protection.lastAction,
  }
  const prevPublished = protection.lastPublished
  const changed =
    !prevPublished ||
    prevPublished.runtimeGpuOverflowCriticalStreak !== nextPublished.runtimeGpuOverflowCriticalStreak ||
    prevPublished.runtimeGpuOverflowCriticalActive !== nextPublished.runtimeGpuOverflowCriticalActive ||
    prevPublished.runtimeGpuOverflowProtectionCooldown !==
      nextPublished.runtimeGpuOverflowProtectionCooldown ||
    prevPublished.runtimeGpuOverflowProtectionLastAction !==
      nextPublished.runtimeGpuOverflowProtectionLastAction

  if (changed) {
    useSimulationStore.getState().setParams(nextPublished)
    protection.lastPublished = nextPublished
  }
}

function updateGpuQualityGuardState(simulationState, params) {
  simulationState.gpuQualityGuard = simulationState.gpuQualityGuard ?? {
    active: false,
    applyActive: false,
    level: 'off',
    compatibility: 'disabled_user_off',
    guidedScale: 1,
    stretchingScale: 1,
    highStepStreak: 0,
    lowStepStreak: 0,
    lastAction: 'none',
    lastPublished: null,
  }

  const guard = simulationState.gpuQualityGuard
  const isGpuRuntime =
    params.physicsBackend === 'webgpu' &&
    simulationState.runtimeStatus?.backend === 'gpu' &&
    Number.isFinite(simulationState.runtimeStatus?.stepMs)
  const enabled = params.gpuAutoQualityGuardEnabled === true
  const scope =
    params.gpuAutoQualityGuardScope === 'monitor_only' ? 'monitor_only' : 'apply_supported_only'
  const mode = params.gpuAutoQualityGuardMode === 'moderate' ? 'moderate' : 'minimal'
  const forcedNatural = params.dynamicsMode === 'guidedPhysics'
  const forcedHybridPlus = params.hybridPlusEnabled === true || params.runtimeHybridPlusActive === true

  let compatibility = 'apply_allowed'
  if (!enabled) {
    compatibility = 'disabled_user_off'
  } else if (!isGpuRuntime) {
    compatibility = 'disabled_backend_not_gpu'
  } else if (forcedNatural) {
    compatibility = 'monitor_only_forced_natural'
  } else if (forcedHybridPlus) {
    compatibility = 'monitor_only_forced_hybrid_plus'
  }
  const canTrack = enabled && isGpuRuntime
  const scopeMonitorOnly = scope === 'monitor_only'
  const applyPhysicsOverrides = compatibility === 'apply_allowed' && !scopeMonitorOnly
  const uiOnlyActive = canTrack && !applyPhysicsOverrides

  if (!canTrack) {
    const wasActive =
      guard.active ||
      guard.applyActive ||
      guard.level !== 'off' ||
      guard.compatibility !== 'disabled_user_off' ||
      guard.guidedScale !== 1 ||
      guard.stretchingScale !== 1 ||
      guard.highStepStreak !== 0 ||
      guard.lowStepStreak !== 0 ||
      guard.lastAction !== 'none'
    guard.active = false
    guard.applyActive = false
    guard.level = 'off'
    guard.compatibility = compatibility
    guard.guidedScale = 1
    guard.stretchingScale = 1
    guard.highStepStreak = 0
    guard.lowStepStreak = 0
    guard.lastAction = 'none'
    if (wasActive || !guard.lastPublished) {
      const nextPublished = {
        runtimeGpuQualityGuardActive: false,
        runtimeGpuQualityGuardApplyActive: false,
        runtimeGpuQualityGuardLevel: 'off',
        runtimeGpuQualityGuardCompatibility: compatibility,
        runtimeGpuQualityGuardGuidedScale: 1,
        runtimeGpuQualityGuardStretchingScale: 1,
        runtimeGpuQualityGuardHighStepStreak: 0,
        runtimeGpuQualityGuardLowStepStreak: 0,
        runtimeGpuQualityGuardLastAction: 'none',
      }
      useSimulationStore.getState().setParams(nextPublished)
      guard.lastPublished = nextPublished
    }
    return
  }

  const stepMs = Number(simulationState.runtimeStatus?.stepMs ?? 0)
  const highStep = stepMs > GPU_QUALITY_GUARD_STEP_MS_THRESHOLD
  if (highStep) {
    guard.highStepStreak += 1
    guard.lowStepStreak = 0
  } else {
    guard.lowStepStreak += 1
    guard.highStepStreak = 0
  }

  if (!guard.active && guard.highStepStreak >= GPU_QUALITY_GUARD_ACTIVATE_STREAK) {
    guard.active = true
    guard.lastAction = uiOnlyActive ? 'activate_ui_only' : 'activate'
  } else if (guard.active && guard.lowStepStreak >= GPU_QUALITY_GUARD_RECOVER_STREAK) {
    guard.active = false
    guard.lastAction = uiOnlyActive ? 'recover_ui_only' : 'recover'
  }

  guard.applyActive = guard.active && applyPhysicsOverrides
  guard.compatibility = compatibility
  if (!guard.active) {
    guard.level = 'off'
    guard.guidedScale = 1
    guard.stretchingScale = 1
  } else if (!applyPhysicsOverrides) {
    guard.level = 'ui_only'
    guard.guidedScale = 1
    guard.stretchingScale = 1
  } else if (mode === 'moderate') {
    guard.level = 'moderate'
    guard.guidedScale = 0.65
    guard.stretchingScale = 0.8
  } else {
    guard.level = 'minimal'
    guard.guidedScale = 0.82
    guard.stretchingScale = 1
  }

  const nextPublished = {
    runtimeGpuQualityGuardActive: guard.active,
    runtimeGpuQualityGuardApplyActive: guard.applyActive,
    runtimeGpuQualityGuardLevel: guard.level,
    runtimeGpuQualityGuardCompatibility: guard.compatibility,
    runtimeGpuQualityGuardGuidedScale: guard.guidedScale,
    runtimeGpuQualityGuardStretchingScale: guard.stretchingScale,
    runtimeGpuQualityGuardHighStepStreak: guard.highStepStreak,
    runtimeGpuQualityGuardLowStepStreak: guard.lowStepStreak,
    runtimeGpuQualityGuardLastAction: guard.lastAction,
  }
  const prevPublished = guard.lastPublished
  const changed =
    !prevPublished ||
    prevPublished.runtimeGpuQualityGuardActive !== nextPublished.runtimeGpuQualityGuardActive ||
    prevPublished.runtimeGpuQualityGuardApplyActive !==
      nextPublished.runtimeGpuQualityGuardApplyActive ||
    prevPublished.runtimeGpuQualityGuardLevel !== nextPublished.runtimeGpuQualityGuardLevel ||
    prevPublished.runtimeGpuQualityGuardCompatibility !==
      nextPublished.runtimeGpuQualityGuardCompatibility ||
    prevPublished.runtimeGpuQualityGuardGuidedScale !== nextPublished.runtimeGpuQualityGuardGuidedScale ||
    prevPublished.runtimeGpuQualityGuardStretchingScale !==
      nextPublished.runtimeGpuQualityGuardStretchingScale ||
    prevPublished.runtimeGpuQualityGuardHighStepStreak !==
      nextPublished.runtimeGpuQualityGuardHighStepStreak ||
    prevPublished.runtimeGpuQualityGuardLowStepStreak !==
      nextPublished.runtimeGpuQualityGuardLowStepStreak ||
    prevPublished.runtimeGpuQualityGuardLastAction !== nextPublished.runtimeGpuQualityGuardLastAction
  if (changed) {
    useSimulationStore.getState().setParams(nextPublished)
    guard.lastPublished = nextPublished
  }
}

function createGpuStepParams(params, simulationState) {
  const guard = simulationState.gpuQualityGuard
  if (!guard?.active || !guard?.applyActive) {
    return params
  }

  const effectiveGuidedStrength = Math.max(0, (params.guidedStrength ?? 0) * (guard.guidedScale ?? 1))
  const effectiveStretchingStrength = Math.max(
    0,
    (params.stretchingStrength ?? 0) * (guard.stretchingScale ?? 1),
  )

  return {
    ...params,
    guidedStrength: effectiveGuidedStrength,
    stretchingStrength: effectiveStretchingStrength,
  }
}

function publishPhysicalHooksStatus(simulationState, params) {
  const stepOrder = ['velocity_computation']
  const warnings = []
  const stretchingApplied = params.physicalStretchingEnabled === true
  const viscosityApplied = params.physicalViscosityEnabled === true || params.physicalPseEnabled === true
  const boundaryApplied = params.physicalBoundaryEnabled === true
  const wakeApplied = params.physicalWakeEnabled === true
  const enabledStages = {
    stretching: stretchingApplied,
    diffusion: viscosityApplied,
    boundary_interaction: boundaryApplied,
    wake_forcing: wakeApplied,
  }
  const integrationProfile = String(params.physicalIntegrationOrderProfile ?? 'canonical')
  let stageOrderProfile = ['stretching', 'diffusion', 'boundary_interaction', 'wake_forcing']
  if (integrationProfile === 'boundary_first') {
    stageOrderProfile = ['boundary_interaction', 'stretching', 'diffusion', 'wake_forcing']
  } else if (integrationProfile === 'diffusion_first') {
    stageOrderProfile = ['diffusion', 'stretching', 'boundary_interaction', 'wake_forcing']
  } else if (integrationProfile !== 'canonical') {
    warnings.push('unknown_integration_order_profile_fallback_canonical')
  }
  stageOrderProfile.forEach((stageId) => {
    if (enabledStages[stageId] === true) {
      stepOrder.push(stageId)
    }
  })
  if (params.physicalNoSlipEnabled === true && !boundaryApplied) {
    warnings.push('no_slip_requires_boundary_enabled')
  }
  if (params.physicalImageVorticesEnabled === true && params.physicalBoundaryMode === 'meshes') {
    warnings.push('image_vortices_mesh_mode_phase2_only')
  }
  if (params.physicalPseEnabled === true) {
    warnings.push('pse_uses_core_spreading_proxy')
  }
  if (boundaryApplied) {
    warnings.push('boundary_interaction_hook_noop_proxy')
  }
  if (wakeApplied) {
    warnings.push('wake_forcing_hook_noop_proxy')
  }

  const nextPublished = {
    runtimePhysicalStepOrder: stepOrder.join(' -> '),
    runtimePhysicalIntegrationOrderProfile: integrationProfile,
    runtimePhysicalWarnings: warnings,
    runtimePhysicalViscosityApplied: viscosityApplied,
    runtimePhysicalStretchingApplied: stretchingApplied,
    runtimePhysicalBoundaryApplied: boundaryApplied,
    runtimePhysicalWakeApplied: wakeApplied,
  }
  const prev = simulationState.physicalHooksStatus ?? null
  const changed =
    !prev ||
    prev.runtimePhysicalStepOrder !== nextPublished.runtimePhysicalStepOrder ||
    prev.runtimePhysicalIntegrationOrderProfile !== nextPublished.runtimePhysicalIntegrationOrderProfile ||
    prev.runtimePhysicalViscosityApplied !== nextPublished.runtimePhysicalViscosityApplied ||
    prev.runtimePhysicalStretchingApplied !== nextPublished.runtimePhysicalStretchingApplied ||
    prev.runtimePhysicalBoundaryApplied !== nextPublished.runtimePhysicalBoundaryApplied ||
    prev.runtimePhysicalWakeApplied !== nextPublished.runtimePhysicalWakeApplied ||
    !arraysEqual(prev.runtimePhysicalWarnings, nextPublished.runtimePhysicalWarnings)
  if (changed) {
    useSimulationStore.getState().setParams(nextPublished)
    simulationState.physicalHooksStatus = nextPublished
  }
}

function publishStabilityMonitor(simulationState, params) {
  const store = useSimulationStore.getState()
  const stabilityStats = store.stabilityStats ?? {}
  const filamentStats = store.filamentStats ?? {}
  const circulationNow =
    Number(
      params.vortexRepresentation === 'hybrid'
        ? stabilityStats.hybridTotalCirculation ?? stabilityStats.totalCirculation ?? 0
        : stabilityStats.totalCirculation ?? 0,
    ) || 0
  const energyNow = Number(params.runtimeEnergyProxy ?? 0) || 0
  simulationState.stabilityMonitorState = simulationState.stabilityMonitorState ?? {
    prevEnergy: energyNow,
    prevCirculation: circulationNow,
  }
  const prevEnergy = Number(simulationState.stabilityMonitorState.prevEnergy ?? energyNow) || energyNow
  const prevCirculation =
    Number(simulationState.stabilityMonitorState.prevCirculation ?? circulationNow) || circulationNow
  const avgSpeed = Number(params.runtimeGpuDiagAvgSpeed ?? 0) || 0
  const maxSpeed = Number(params.runtimeGpuDiagMaxSpeed ?? 0) || 0
  const velocityDivergence = avgSpeed > 1e-6 ? maxSpeed / avgSpeed : maxSpeed
  const spacingRatio = Number(stabilityStats.sigmaOverR ?? 1) || 1
  const curvaturePeak = Number(filamentStats.smoothingCurvatureMax ?? 0) || 0
  const snapshot = evaluateStabilitySnapshot({
    startEnergy: prevEnergy,
    endEnergy: energyNow,
    startCirculation: prevCirculation,
    endCirculation: circulationNow,
    velocityDivergence,
    spacingRatio,
    curvaturePeak,
  })
  useSimulationStore.getState().setParams(snapshot)
  simulationState.stabilityMonitorState.prevEnergy = energyNow
  simulationState.stabilityMonitorState.prevCirculation = circulationNow
}

function applyStabilityAutoCorrections(simulationState, params) {
  simulationState.stabilityAutoCorrectionState = simulationState.stabilityAutoCorrectionState ?? {
    cooldownSteps: 0,
    lastAction: 'none',
    conservationDriftStreak: 0,
    adaptiveDriftSeverity: 0,
    adaptiveDriftScale: 0,
    windowStartStep: 0,
    windowActionCount: 0,
    history: [],
    counters: {
      total: 0,
      timeScale: 0,
      spawnRate: 0,
      remeshRefine: 0,
      remeshCoarsen: 0,
      saturationGuard: 0,
    },
  }
  const state = simulationState.stabilityAutoCorrectionState
  const currentStepSerial = Math.max(0, Math.floor(Number(simulationState.stepSerial ?? 0)))
  if (!Number.isFinite(Number(state.windowStartStep))) {
    state.windowStartStep = currentStepSerial
  }
  if (currentStepSerial - Number(state.windowStartStep) > STABILITY_AUTOCORRECTION_WINDOW_STEPS) {
    state.windowStartStep = currentStepSerial
    state.windowActionCount = 0
  }
  const windowStepsSpan = Math.max(1, currentStepSerial - Number(state.windowStartStep) + 1)
  const correctionPressurePer1k =
    (Math.max(0, Math.floor(Number(state.windowActionCount ?? 0))) / windowStepsSpan) * 1000
  const saturationGuardActive =
    correctionPressurePer1k > STABILITY_AUTOCORRECTION_SATURATION_PER_1K_STEPS
  if (state.cooldownSteps > 0) {
    state.cooldownSteps -= 1
  }

  const runtimeParams = useSimulationStore.getState().params
  const warnings = Array.isArray(runtimeParams.runtimeStabilityWarnings)
    ? runtimeParams.runtimeStabilityWarnings
    : []
  const suggestedScale = Number(runtimeParams.runtimeStabilitySuggestedDtScale ?? 1) || 1
  const hasConservationDriftWarning = warnings.includes('conservation_drift')
  state.conservationDriftStreak = hasConservationDriftWarning
    ? Math.min(100000, Math.floor(Number(state.conservationDriftStreak ?? 0)) + 1)
    : 0
  const adaptiveDriftControl = computeAdaptiveConservationDriftControl(
    runtimeParams,
    state.conservationDriftStreak,
  )
  state.adaptiveDriftSeverity = adaptiveDriftControl.driftSeverity
  state.adaptiveDriftScale = adaptiveDriftControl.adaptiveScale

  const actionLog = []
  const paramPatch = {}
  const canApplyFilamentRemesh =
    params.vortexRepresentation === 'filaments' ||
    params.vortexRepresentation === 'hybrid' ||
    params.vortexRepresentation === 'tubes'
  if (state.cooldownSteps <= 0) {
    if (saturationGuardActive) {
      actionLog.push('autocorrection_saturation_guard')
      state.cooldownSteps = STABILITY_AUTOCORRECTION_SATURATION_COOLDOWN_STEPS
    } else {
    if (
      suggestedScale < 0.999 &&
      Number(params.timeScale ?? 1) > STABILITY_AUTOCORRECTION_MIN_TIME_SCALE
    ) {
      const safeScale = Math.max(0.6, suggestedScale)
      const nextTimeScale = Math.max(
        STABILITY_AUTOCORRECTION_MIN_TIME_SCALE,
        Number(params.timeScale ?? 1) * safeScale,
      )
      if (nextTimeScale < Number(params.timeScale ?? 1)) {
        paramPatch.timeScale = nextTimeScale
        actionLog.push('reduce_time_scale')
      }
    }

    if (
      warnings.includes('particle_overclustering') &&
      Math.floor(Number(params.spawnRate ?? 0)) > GPU_OVERFLOW_MIN_SPAWN_RATE
    ) {
      const nextSpawnRate = Math.max(
        GPU_OVERFLOW_MIN_SPAWN_RATE,
        Math.floor(Number(params.spawnRate ?? 0) * 0.9),
      )
      if (nextSpawnRate < Math.floor(Number(params.spawnRate ?? 0))) {
        paramPatch.spawnRate = nextSpawnRate
        actionLog.push('reduce_spawn_rate_stability')
      }
    } else if (warnings.includes('particle_oversparse')) {
      const currentSpawnRate = Math.max(1, Math.floor(Number(params.spawnRate ?? 0) || 0))
      const nextSpawnRate = Math.min(4000, Math.floor(currentSpawnRate * 1.08))
      if (nextSpawnRate > currentSpawnRate) {
        paramPatch.spawnRate = nextSpawnRate
        actionLog.push('increase_spawn_rate_stability')
      }
    }

    if (hasConservationDriftWarning) {
      const currentGuidedStrength = Math.max(0, Number(params.guidedStrength ?? 0))
      const currentStretchingStrength = Math.max(0, Number(params.stretchingStrength ?? 0))
      const currentVorticityConfinement = Number(params.vorticityConfinementStrength ?? 0)
      // Hybrid+ is more sensitive to over-damping; apply softer adaptive downscale there.
      const hybridPlusAdaptiveGain =
        params.executionMode === 'hybrid' && params.hybridPlusEnabled === true ? 0.55 : 1
      const effectiveAdaptiveScale = clamp01(adaptiveDriftControl.adaptiveScale * hybridPlusAdaptiveGain)
      const guidedFactor = 0.98 - 0.08 * effectiveAdaptiveScale
      const stretchingFactor = 0.97 - 0.11 * effectiveAdaptiveScale
      const vorticityFactor = 0.96 - 0.14 * effectiveAdaptiveScale
      const nextGuidedStrength = Math.max(0, currentGuidedStrength * guidedFactor)
      const nextStretchingStrength = Math.max(0, currentStretchingStrength * stretchingFactor)
      const nextVorticityConfinement = currentVorticityConfinement * vorticityFactor
      if (nextGuidedStrength + 1e-6 < currentGuidedStrength) {
        paramPatch.guidedStrength = nextGuidedStrength
        actionLog.push('reduce_guided_strength_stability')
      }
      if (nextStretchingStrength + 1e-6 < currentStretchingStrength) {
        paramPatch.stretchingStrength = nextStretchingStrength
        actionLog.push('reduce_stretching_strength_stability')
      }
      if (Math.abs(nextVorticityConfinement) + 1e-6 < Math.abs(currentVorticityConfinement)) {
        paramPatch.vorticityConfinementStrength = nextVorticityConfinement
        actionLog.push('reduce_vorticity_confinement_stability')
      }
    }

    if (canApplyFilamentRemesh) {
      if (warnings.includes('particle_overclustering')) {
        const nextMinSegmentLength = Math.min(1, Number(params.minSegmentLength ?? 0.01) * 1.12)
        const nextMaxSegmentLength = Math.min(10, Number(params.maxSegmentLength ?? 0.05) * 1.08)
        const maxFilamentNodes = Math.max(128, Math.floor(Number(params.maxFilamentNodes ?? 1200)))
        const nextMaxFilamentNodes = Math.max(128, Math.floor(maxFilamentNodes * 0.95))
        if (nextMinSegmentLength > Number(params.minSegmentLength ?? 0.01)) {
          paramPatch.minSegmentLength = nextMinSegmentLength
        }
        if (nextMaxSegmentLength > Number(params.maxSegmentLength ?? 0.05)) {
          paramPatch.maxSegmentLength = nextMaxSegmentLength
        }
        if (nextMaxFilamentNodes < maxFilamentNodes) {
          paramPatch.maxFilamentNodes = nextMaxFilamentNodes
        }
        if (
          paramPatch.minSegmentLength !== undefined ||
          paramPatch.maxSegmentLength !== undefined ||
          paramPatch.maxFilamentNodes !== undefined
        ) {
          actionLog.push('filament_remesh_coarsen')
        }
      } else if (
        warnings.includes('particle_oversparse') ||
        warnings.includes('high_velocity_or_curvature')
      ) {
        const nextMaxSegmentLength = Math.max(0.01, Number(params.maxSegmentLength ?? 0.05) * 0.92)
        const nextMinSegmentLength = Math.max(
          0.005,
          Math.min(Number(params.minSegmentLength ?? 0.01), nextMaxSegmentLength * 0.6) * 0.94,
        )
        const maxFilamentNodes = Math.max(128, Math.floor(Number(params.maxFilamentNodes ?? 1200)))
        const nextMaxFilamentNodes = Math.min(2000, Math.floor(maxFilamentNodes * 1.06))
        const nextCurvatureSmoothingGain = Math.min(
          2.5,
          Number(params.filamentCurvatureSmoothingGain ?? 0.8) * 1.08,
        )
        if (nextMaxSegmentLength < Number(params.maxSegmentLength ?? 0.05)) {
          paramPatch.maxSegmentLength = nextMaxSegmentLength
        }
        if (nextMinSegmentLength < Number(params.minSegmentLength ?? 0.01)) {
          paramPatch.minSegmentLength = nextMinSegmentLength
        }
        if (nextMaxFilamentNodes > maxFilamentNodes) {
          paramPatch.maxFilamentNodes = nextMaxFilamentNodes
        }
        if (
          nextCurvatureSmoothingGain >
          Number(params.filamentCurvatureSmoothingGain ?? 0.8) + 1e-6
        ) {
          paramPatch.filamentCurvatureSmoothingGain = nextCurvatureSmoothingGain
        }
        if (
          paramPatch.minSegmentLength !== undefined ||
          paramPatch.maxSegmentLength !== undefined ||
          paramPatch.maxFilamentNodes !== undefined ||
          paramPatch.filamentCurvatureSmoothingGain !== undefined
        ) {
          actionLog.push('filament_remesh_refine')
        }
      }
    }
    }

    if (actionLog.includes('autocorrection_saturation_guard')) {
      state.lastAction = 'autocorrection_saturation_guard'
      pushStabilityAutoCorrectionHistory(state, actionLog, currentStepSerial)
    } else if (Object.keys(paramPatch).length > 0) {
      useSimulationStore.getState().setParams(paramPatch)
      state.cooldownSteps = STABILITY_AUTOCORRECTION_COOLDOWN_STEPS
      state.lastAction = actionLog[0] ?? 'none'
      pushStabilityAutoCorrectionHistory(state, actionLog, currentStepSerial)
    }
  }

  const primaryAction = actionLog[0] ?? 'none'
  const timeline = Array.isArray(state.history) ? state.history.slice(-STABILITY_AUTOCORRECTION_TIMELINE_MAX) : []
  const counters = state.counters ?? {
    total: 0,
    timeScale: 0,
    spawnRate: 0,
    remeshRefine: 0,
    remeshCoarsen: 0,
    saturationGuard: 0,
  }
  if (
    primaryAction !== 'none' ||
    runtimeParams.runtimeStabilityAutoCorrectionLastAction !== state.lastAction ||
    runtimeParams.runtimeStabilityAutoCorrectionCooldown !== state.cooldownSteps ||
    !arraysEqual(runtimeParams.runtimeStabilityAutoCorrectionTimeline, timeline) ||
    Math.floor(runtimeParams.runtimeStabilityAutoCorrectionTotalCount ?? 0) !==
      Math.floor(counters.total ?? 0) ||
    Math.floor(runtimeParams.runtimeStabilityAutoCorrectionTimeScaleCount ?? 0) !==
      Math.floor(counters.timeScale ?? 0) ||
    Math.floor(runtimeParams.runtimeStabilityAutoCorrectionSpawnRateCount ?? 0) !==
      Math.floor(counters.spawnRate ?? 0) ||
    Math.floor(runtimeParams.runtimeStabilityAutoCorrectionRemeshRefineCount ?? 0) !==
      Math.floor(counters.remeshRefine ?? 0) ||
    Math.floor(runtimeParams.runtimeStabilityAutoCorrectionRemeshCoarsenCount ?? 0) !==
      Math.floor(counters.remeshCoarsen ?? 0) ||
    Math.floor(runtimeParams.runtimeStabilityAutoCorrectionSaturationCount ?? 0) !==
      Math.floor(counters.saturationGuard ?? 0) ||
    Math.abs(
      Number(runtimeParams.runtimeStabilityAutoCorrectionWindowPer1k ?? 0) -
        Number(correctionPressurePer1k),
    ) > 1e-6 ||
    Math.abs(
      Number(runtimeParams.runtimeStabilityAdaptiveDriftSeverity ?? 0) -
        Number(state.adaptiveDriftSeverity ?? 0),
    ) > 1e-6 ||
    Math.abs(
      Number(runtimeParams.runtimeStabilityAdaptiveDriftScale ?? 0) -
        Number(state.adaptiveDriftScale ?? 0),
    ) > 1e-6 ||
    Math.floor(Number(runtimeParams.runtimeStabilityAdaptiveDriftStreak ?? 0)) !==
      Math.floor(Number(state.conservationDriftStreak ?? 0))
  ) {
    useSimulationStore.getState().setParams({
      runtimeStabilityAutoCorrectionLastAction: state.lastAction,
      runtimeStabilityAutoCorrectionCooldown: state.cooldownSteps,
      runtimeStabilityAutoCorrectionTimeline: timeline,
      runtimeStabilityAutoCorrectionTotalCount: Math.max(0, Math.floor(counters.total ?? 0)),
      runtimeStabilityAutoCorrectionTimeScaleCount: Math.max(0, Math.floor(counters.timeScale ?? 0)),
      runtimeStabilityAutoCorrectionSpawnRateCount: Math.max(0, Math.floor(counters.spawnRate ?? 0)),
      runtimeStabilityAutoCorrectionRemeshRefineCount: Math.max(
        0,
        Math.floor(counters.remeshRefine ?? 0),
      ),
      runtimeStabilityAutoCorrectionRemeshCoarsenCount: Math.max(
        0,
        Math.floor(counters.remeshCoarsen ?? 0),
      ),
      runtimeStabilityAutoCorrectionSaturationCount: Math.max(
        0,
        Math.floor(counters.saturationGuard ?? 0),
      ),
      runtimeStabilityAutoCorrectionWindowPer1k: Math.max(0, correctionPressurePer1k),
      runtimeStabilityAdaptiveDriftSeverity: clamp01(state.adaptiveDriftSeverity),
      runtimeStabilityAdaptiveDriftScale: clamp01(state.adaptiveDriftScale),
      runtimeStabilityAdaptiveDriftStreak: Math.max(
        0,
        Math.floor(Number(state.conservationDriftStreak ?? 0)),
      ),
      runtimeStabilityCorrections:
        primaryAction !== 'none'
          ? [...warnings.slice(0, 8), ...actionLog]
          : runtimeParams.runtimeStabilityCorrections,
    })
  }
}

function computeJetRollupClosureSnapshot(runtimeParams) {
  const detectedRings = Math.max(0, Math.floor(Number(runtimeParams.runtimeDetectedRingCount ?? 0) || 0))
  const confidence = clamp01(Number(runtimeParams.runtimeDetectionConfidence ?? 0) || 0)
  const ringDominance = clamp01(Number(runtimeParams.runtimeJetRegimeRingDominance ?? 0) || 0)
  const wakeIndex = clamp01(Number(runtimeParams.runtimeJetRegimeWakeIndex ?? 0) || 0)
  const acceptance = clamp01(Number(runtimeParams.runtimeJetRegimeAcceptanceScore ?? 0) || 0)
  const hasRing = detectedRings > 0
  const ringPresence = hasRing ? 1 : 0
  const wakePenalty = 1 - wakeIndex
  const score = clamp01(
    ringPresence * 0.35 +
      confidence * 0.25 +
      ringDominance * 0.25 +
      wakePenalty * 0.1 +
      acceptance * 0.05,
  )

  let state = 'idle'
  if (hasRing && confidence >= 0.58 && ringDominance >= 0.52 && wakeIndex <= 0.62) {
    state = 'closed'
  } else if (hasRing || confidence >= 0.35 || ringDominance >= 0.35) {
    state = 'forming'
  } else {
    state = 'unstable'
  }

  return { score, state, detectedRings, confidence, ringDominance, wakeIndex }
}

function applyJetRollupToroidTuning(simulationState, params, stepSerial) {
  if (params.emissionMode !== 'jetRollup') {
    return
  }
  simulationState.jetRollupTuningState = simulationState.jetRollupTuningState ?? {
    lastTuneStep: -1,
    cooldownSteps: 24,
    lastAction: 'none',
    lastPublishedScore: -1,
    lastPublishedState: 'idle',
  }
  const tuningState = simulationState.jetRollupTuningState
  const runtimeParams = useSimulationStore.getState().params
  const snapshot = computeJetRollupClosureSnapshot(runtimeParams)
  const emissionCouplingMode = String(params.emissionCouplingMode ?? 'free')
  const allowPulseDurationAutoTune =
    emissionCouplingMode !== 'lockPulseDuration' && emissionCouplingMode !== 'lockFormation'
  let lastAction = tuningState.lastAction

  if (
    params.jetRollupAutoTuneEnabled === true &&
    stepSerial - Number(tuningState.lastTuneStep ?? -1) >= Number(tuningState.cooldownSteps ?? 24)
  ) {
    const patch = {}

    if (snapshot.wakeIndex > 0.74) {
      // Wake-dominant: shorten stroke and reduce forcing.
      if (allowPulseDurationAutoTune) {
        patch.pulseDuration = Math.max(0.05, Number(params.pulseDuration ?? 0.2) - 0.01)
      }
      patch.jetRollupPulseInterval = Math.min(
        1.2,
        Number(params.jetRollupPulseInterval ?? 0.3) + 0.01,
      )
      patch.jetRollupNoiseAmplitude = Math.max(
        0.01,
        Number(params.jetRollupNoiseAmplitude ?? 0.06) - 0.005,
      )
      lastAction = 'trim_wake'
    } else if (snapshot.score < 0.45) {
      // Weak ring closure: increase edge shear and pulse drive.
      if (allowPulseDurationAutoTune) {
        patch.pulseDuration = Math.min(0.6, Number(params.pulseDuration ?? 0.2) + 0.01)
      }
      patch.jetRollupPulseInterval = Math.max(
        0.08,
        Number(params.jetRollupPulseInterval ?? 0.3) - 0.01,
      )
      patch.jetRollupPulseStrength = Math.min(
        1.8,
        Number(params.jetRollupPulseStrength ?? 1) + 0.02,
      )
      patch.jetRollupEdgeVorticity = Math.min(
        1.2,
        Number(params.jetRollupEdgeVorticity ?? 0.2) + 0.015,
      )
      lastAction = 'boost_rollup'
    } else if (snapshot.state === 'closed') {
      // Closed toroid detected: stabilize and reduce unnecessary noise.
      patch.jetRollupNoiseAmplitude = Math.max(
        0.01,
        Number(params.jetRollupNoiseAmplitude ?? 0.06) - 0.003,
      )
      patch.jetRollupPulseStrength = Math.max(
        0.9,
        Number(params.jetRollupPulseStrength ?? 1) - 0.01,
      )
      lastAction = 'stabilize_closed_toroid'
    } else {
      lastAction = 'hold'
    }

    if (Object.keys(patch).length > 0) {
      useSimulationStore.getState().setParams(patch)
    }
    tuningState.lastTuneStep = stepSerial
    tuningState.lastAction = lastAction
  }

  const shouldPublish =
    Math.abs(snapshot.score - Number(tuningState.lastPublishedScore ?? -1)) > 1e-4 ||
    snapshot.state !== String(tuningState.lastPublishedState ?? 'idle') ||
    String(runtimeParams.runtimeJetRollupAutoTuneLastAction ?? 'none') !== String(lastAction) ||
    Number(runtimeParams.runtimeJetRollupAutoTuneStepInterval ?? -1) !==
      Math.max(0, stepSerial - Number(tuningState.lastTuneStep ?? stepSerial))

  if (shouldPublish) {
    useSimulationStore.getState().setParams({
      runtimeJetRollupClosureScore: snapshot.score,
      runtimeJetRollupClosureState: snapshot.state,
      runtimeJetRollupAutoTuneLastAction: lastAction,
      runtimeJetRollupAutoTuneStepInterval: Math.max(
        0,
        stepSerial - Number(tuningState.lastTuneStep ?? stepSerial),
      ),
    })
    tuningState.lastPublishedScore = snapshot.score
    tuningState.lastPublishedState = snapshot.state
  }
}

const ADAPTIVE_EVAL_INTERVAL_MS = 500
const ADAPTIVE_ACTUATION_COOLDOWN_MS = 2000
const ADAPTIVE_MAX_PARTICLE_STEP_RATIO = 0.04
const ADAPTIVE_PARTICLE_COUNT_MIN = 2000
const ADAPTIVE_PARTICLE_COUNT_MAX = 200000
const ADAPTIVE_SPAWN_RATE_MIN = 60
const ADAPTIVE_SPAWN_RATE_MAX = 1800

function collectAdaptiveSignals(params) {
  const energy = Number(params.runtimeEnergyProxy ?? 0) || 0
  const enstrophy = Number(params.runtimeEnstrophyProxy ?? 0) || 0
  const maxVort = Number(params.runtimeEnergyMaxVorticity ?? 0) || 0
  const detectorConf = Number(params.runtimeDetectionConfidence ?? 0.75) || 0.75
  const autoCorrAction = String(params.runtimeStabilityAutoCorrectionLastAction ?? 'none')
  const driftSeverity = Number(params.runtimeStabilityAdaptiveDriftSeverity ?? 0) || 0

  return {
    vorticity: clamp01(enstrophy > 0 ? enstrophy / 100 : maxVort / 10),
    curvature: clamp01(Number(params.runtimeFilamentCurvatureProxy ?? 0)),
    reconnection: clamp01(Number(params.runtimeTopologyReconnectionCount ?? 0) / 5),
    uncertainty: clamp01(1 - detectorConf),
    stabilityWarnings: autoCorrAction !== 'none' ? 1 : clamp01(driftSeverity),
  }
}

function applyAdaptiveResolution(simulationState, params) {
  if (params.adaptiveResolutionEnabled !== true) return

  simulationState.adaptiveState = simulationState.adaptiveState ?? createResolutionControllerState()
  simulationState.adaptiveLastEvalMs = simulationState.adaptiveLastEvalMs ?? 0
  simulationState.adaptiveLastActuationMs = simulationState.adaptiveLastActuationMs ?? 0
  simulationState.adaptiveActuationCount = simulationState.adaptiveActuationCount ?? 0

  const nowMs = Date.now()
  if (nowMs - simulationState.adaptiveLastEvalMs < ADAPTIVE_EVAL_INTERVAL_MS) return
  simulationState.adaptiveLastEvalMs = nowMs

  const signals = collectAdaptiveSignals(params)
  const evaluation = evaluateResolutionDecision({
    signals,
    controllerState: simulationState.adaptiveState,
    nowMs,
  })
  simulationState.adaptiveState = evaluation.state

  const store = useSimulationStore.getState()
  store.setParams({
    adaptiveResolutionLevel: evaluation.state.level,
    adaptiveResolutionScore: evaluation.decision.score,
    adaptiveResolutionDecisionSerial: evaluation.state.decisionSerial,
    adaptiveResolutionLastReason: evaluation.decision.reasons?.[0] ?? 'none',
    adaptiveResolutionParticleBudgetScale: evaluation.decision.patch?.particleBudgetScale ?? 1,
  })

  if (!evaluation.decision.changed) return
  if (nowMs - simulationState.adaptiveLastActuationMs < ADAPTIVE_ACTUATION_COOLDOWN_MS) return

  const patch = evaluation.decision.patch
  const currentCount = Math.max(1000, Math.floor(Number(params.particleCount ?? 12000)))
  const scale = Number(patch?.particleBudgetScale ?? 1) || 1
  const unclampedTarget = Math.floor(currentCount * scale)
  const boundedStep = Math.max(1, Math.floor(currentCount * ADAPTIVE_MAX_PARTICLE_STEP_RATIO))
  const limitedTarget = Math.max(currentCount - boundedStep, Math.min(currentCount + boundedStep, unclampedTarget))
  const targetCount = Math.max(ADAPTIVE_PARTICLE_COUNT_MIN, Math.min(ADAPTIVE_PARTICLE_COUNT_MAX, limitedTarget))

  const currentSpawnRate = Number(params.spawnRate ?? 360) || 360
  const refineBias = Number(patch?.filamentRefineBias ?? 0)
  const coarsenBias = Number(patch?.filamentCoarsenBias ?? 0)
  const spawnTarget = Math.max(
    ADAPTIVE_SPAWN_RATE_MIN,
    Math.min(ADAPTIVE_SPAWN_RATE_MAX, currentSpawnRate * (1 + refineBias * 0.04 - coarsenBias * 0.04)),
  )

  const actuationPatch = {}
  if (targetCount !== currentCount) actuationPatch.particleCount = targetCount
  if (Math.abs(spawnTarget - currentSpawnRate) > 1) actuationPatch.spawnRate = Math.round(spawnTarget)

  if (Object.keys(actuationPatch).length > 0) {
    store.setParams(actuationPatch)
    simulationState.adaptiveLastActuationMs = nowMs
    simulationState.adaptiveActuationCount += 1
    store.setParams({ adaptiveResolutionActuationCount: simulationState.adaptiveActuationCount })
  }
}

function applyRuntimeScaling(params) {
  if (params.scaleEnabled !== true) return params
  const result = buildRuntimeScalingPatch({
    scaleClass: params.scaleClass ?? 'lab',
    targetReynolds: params.scaleTargetReynolds ?? 4500,
    targetStrouhal: params.scaleTargetStrouhal ?? 0.22,
    currentParams: params,
  })
  const merged = { ...params, ...result.patch }
  merged.scaleAchievedReynolds = result.nondimensional.achievedReynolds
  merged.scaleAchievedStrouhal = result.nondimensional.achievedStrouhal
  merged.scalePhysicsScaleFactor = result.scaling.physicsScaleFactor
  merged.scaleViewScale = result.scaling.viewScale
  merged.scaleLengthRefM = result.scaling.lengthRefM
  merged.scaleVelocityRefMs = result.scaling.velocityRefMs
  merged.scaleApplicability = result.applicability.level
  merged.scaleApplicabilityReasons = result.applicability.reasons
  return merged
}

export function stepSimulationRuntime(runtime, params, idRef) {
  params = applyRuntimeScaling(params)
  const simulationState = runtime.simulationState
  const scheduler = simulationState.scheduler
  if ((simulationState.vectorGuardFrames ?? 0) > 0) {
    simulationState.vectorGuardFrames = Math.max(0, simulationState.vectorGuardFrames - 1)
  }
  const configuredSyncPolicy = configureGpuReadbackCadence(simulationState, params)
  updateGpuQualityGuardState(simulationState, params)
  if (
    simulationState.pulseGpuSyncRequested &&
    params.physicsBackend === 'webgpu' &&
    simulationState.webgpuManager &&
    typeof simulationState.webgpuManager.requestFullReadbackNextDispatch === 'function'
  ) {
    simulationState.webgpuManager.requestFullReadbackNextDispatch()
    if (typeof simulationState.webgpuManager.getCurrentDispatchSerial === 'function') {
      const currentDispatchSerial = simulationState.webgpuManager.getCurrentDispatchSerial()
      simulationState.minGpuRenderDispatchSerial = currentDispatchSerial + 1
    } else {
      simulationState.minGpuRenderDispatchSerial = 0
    }
    simulationState.pulseGpuSyncRequested = false
  }
  simulationState.hybridPlusOperatorRegistry =
    simulationState.hybridPlusOperatorRegistry ?? createHybridPlusOperatorRegistry()
  simulationState.hybridPlusState = simulationState.hybridPlusState ?? createHybridPlusState()
  simulationState.hybridSyncCounters = simulationState.hybridSyncCounters ?? {
    filamentBlockedUnsyncedCount: 0,
    filamentUnsafeUnsyncedCount: 0,
  }
  let latestRuntimeStatus = simulationState.runtimeStatus
  let consumedStepUnits = 0
  let stepSerial = simulationState.stepSerial ?? 0

  while (hasPendingSimulationStep(scheduler) && consumedStepUnits < scheduler.maxCatchUpSteps) {
    const switchingCpuToGpu =
      params.physicsBackend === 'webgpu' &&
      latestRuntimeStatus?.backend === 'cpu' &&
      simulationState.webgpuManager &&
      typeof simulationState.webgpuManager.forceResyncSnapshot === 'function' &&
      !simulationState.webgpuManager.hasPendingStep()
    if (switchingCpuToGpu) {
      simulationState.webgpuManager.forceResyncSnapshot(simulationState.particles)
    }

    const shouldStepFilaments =
      params.vortexRepresentation === 'filaments' ||
      params.vortexRepresentation === 'hybrid' ||
      params.vortexRepresentation === 'tubes'
    const hybridCouplingActive =
      params.vortexRepresentation === 'hybrid' && params.hybridCouplingEnabled !== false
    if (!hybridCouplingActive) {
      resetCrossCouplingState(simulationState)
    }
    // GPU can finish slower than fixed-step cadence. In that case accumulator grows, but
    // dispatch path still advances only one completed step at a time. To reduce CPU/GPU
    // pace divergence, scale GPU dt by queued step units with a conservative cap.
    const pendingStepUnits = Math.max(1, Math.floor(scheduler.accumulator / scheduler.fixedStep))
    const gpuAdaptiveStepUnits =
      params.physicsBackend === 'webgpu'
        ? Math.min(3, pendingStepUnits, scheduler.maxCatchUpSteps - consumedStepUnits)
        : 1
    const particleStepUnits = Math.max(1, gpuAdaptiveStepUnits)
    const particleBaseDt = scheduler.fixedStep * particleStepUnits
    const stepTimeScale = Math.max(params.timeScale ?? 1, 0)
    const particleEffectiveDt = particleBaseDt * stepTimeScale
    const filamentDt = particleEffectiveDt
    simulationState.hybridRuntimeStats = {
      particleDt: particleEffectiveDt,
      filamentDt,
    }
    const hybridPlusPlan = planHybridPlusStep({
      params,
      runtimeStatus: latestRuntimeStatus,
      operatorRegistry: simulationState.hybridPlusOperatorRegistry,
      previousState: simulationState.hybridPlusState,
    })
    const cadence = Math.max(
      1,
      hybridPlusPlan?.syncPolicy?.cadenceStepsRuntime ??
        hybridPlusPlan?.syncPolicy?.cadenceSteps ??
        1,
    )
    const shouldRunAssistThisStep = hybridPlusPlan.active && stepSerial % cadence === 0
    const shouldSkipAssistByBudget =
      hybridPlusPlan.active &&
      hybridPlusPlan.scheduler?.overBudget === true &&
      hybridPlusPlan.scheduler?.overBudgetStreak >= 4

    latestRuntimeStatus = updateParticles(
      simulationState.particles,
      params,
      idRef,
      simulationState.pulseState,
      particleBaseDt,
      simulationState.webgpuManager,
      {
        deferGpuSubmit: hybridCouplingActive && params.physicsBackend === 'webgpu',
        hybridPlusPlan,
      },
    )
    if (latestRuntimeStatus?.emittedThisStep) {
      simulationState.vectorGuardFrames = Math.max(simulationState.vectorGuardFrames ?? 0, 3)
    }
    const stepAdvanced = latestRuntimeStatus?.advanced !== false
    const readyForSubmit = Boolean(latestRuntimeStatus?.readyForSubmit)
    const cpuSnapshotSynchronized = latestRuntimeStatus?.cpuSynchronized !== false
    const hybridExecutionActive =
      params.executionMode === 'hybrid' || params.executionMode === 'hybrid_plus'
    const requiresCpuSyncForFilamentStep =
      shouldStepFilaments &&
      hybridExecutionActive &&
      latestRuntimeStatus?.backend === 'gpu'
    const allowFilamentStepOnCurrentParticleState =
      stepAdvanced &&
      (!requiresCpuSyncForFilamentStep || cpuSnapshotSynchronized)
    if (requiresCpuSyncForFilamentStep && !cpuSnapshotSynchronized) {
      simulationState.hybridSyncCounters.filamentBlockedUnsyncedCount += 1
    }
    if (
      requiresCpuSyncForFilamentStep &&
      !cpuSnapshotSynchronized &&
      allowFilamentStepOnCurrentParticleState &&
      shouldStepFilaments
    ) {
      simulationState.hybridSyncCounters.filamentUnsafeUnsyncedCount += 1
    }
    useSimulationStore.getState().setParams({
      runtimeHybridFilamentStepBlockedUnsyncedCount:
        simulationState.hybridSyncCounters.filamentBlockedUnsyncedCount,
      runtimeHybridFilamentStepUnsafeUnsyncedCount:
        simulationState.hybridSyncCounters.filamentUnsafeUnsyncedCount,
    })
    if (!stepAdvanced && !readyForSubmit) {
      break
    }

    if (
      stepAdvanced &&
      params.cascadeEnabled === true &&
      stepSerial % Math.max(1, params.cascadeInterval ?? 5) === 0
    ) {
      const hasCpuParticles =
        !latestRuntimeStatus?.gpuDispatchPending ||
        latestRuntimeStatus?.cpuSynchronized === true
      if (hasCpuParticles && Array.isArray(simulationState.particles)) {
        applyVortexCascade(simulationState.particles, params, idRef)
      }
    }

    if (allowFilamentStepOnCurrentParticleState && shouldStepFilaments) {
      const recoupleWithinSubsteps =
        hybridCouplingActive && params.filamentCouplingSubsteps !== false
      if (hybridCouplingActive) {
        if (!simulationState.filamentSolverContext) {
          simulationState.filamentSolverContext = createFilamentSolverContext()
        }
        prepareFilamentSolverContext(
          simulationState.filaments,
          params,
          simulationState.filamentSolverContext,
          { resetSelfStats: false, resetCouplingStats: true },
        )
        if (!simulationState.hybridCouplingContext) {
          simulationState.hybridCouplingContext = createHybridCouplingContext()
        }
        if (!recoupleWithinSubsteps) {
          simulationState.hybridCouplingContext = applyHybridCoupling({
            particles: simulationState.particles,
            filaments: simulationState.filaments,
            params,
            filamentSolverContext: simulationState.filamentSolverContext,
            hybridContext: simulationState.hybridCouplingContext,
            webgpuManager: simulationState.webgpuManager,
          })
        }
      }

      simulationState.filamentSolverContext = stepFilaments(
        simulationState.filaments,
        params,
        filamentDt,
        simulationState.filamentSolverContext,
        {
          particles: simulationState.particles,
          hybridCouplingContext: simulationState.hybridCouplingContext,
          onSubstepPrepared: recoupleWithinSubsteps
            ? ({ solverContext }) => {
                simulationState.hybridCouplingContext = applyHybridCoupling({
                  particles: simulationState.particles,
                  filaments: simulationState.filaments,
                  params,
                  filamentSolverContext: solverContext,
                  hybridContext: simulationState.hybridCouplingContext,
                  webgpuManager: simulationState.webgpuManager,
                })
              }
            : null,
        },
      )
      publishFilamentStats(simulationState, filamentDt)
      if (params.vortexRepresentation === 'tubes') {
        simulationState.vortexTubeIdRef = simulationState.vortexTubeIdRef ?? { current: 1 }
        simulationState.vortexTubes = Array.isArray(simulationState.vortexTubes)
          ? simulationState.vortexTubes
          : []
        ensureVortexTubeSetForFilaments(
          simulationState.vortexTubes,
          simulationState.filaments,
          params,
          simulationState.vortexTubeIdRef,
        )
        const tubeStats = stepVortexTubes({
          vortexTubes: simulationState.vortexTubes,
          filaments: simulationState.filaments,
          particles: simulationState.particles,
          params,
          dt: filamentDt,
          filamentSolverContext: simulationState.filamentSolverContext,
          stepIndex: stepSerial,
        })
        useSimulationStore.getState().setParams({
          runtimeTubeCount: tubeStats.tubeCount,
          runtimeTubeParticleCount: tubeStats.tubeParticleCount,
          runtimeTubeProjectedCount: tubeStats.projectedCount,
          runtimeTubeAverageRadius: tubeStats.avgRadius,
          runtimeTubeStepMs: tubeStats.stepMs,
          runtimeTubeSpeedAvg: tubeStats.avgSpeed,
          runtimeTubeSpeedMax: tubeStats.maxSpeed,
          runtimeTubeFilamentContributionAvg: tubeStats.avgFilamentContribution,
          runtimeTubeVpmContributionAvg: tubeStats.avgVpmContribution,
          runtimeTubeSelfContributionAvg: tubeStats.avgTubeContribution,
        })
      }
      if (hybridCouplingActive) {
        publishHybridDiagnostics(simulationState)
      }
    } else if (shouldStepFilaments) {
      publishFilamentStats(simulationState, filamentDt)
    }

    if (latestRuntimeStatus?.backend === 'gpu' && readyForSubmit && simulationState.webgpuManager) {
      if (
        hybridCouplingActive &&
        typeof simulationState.webgpuManager.forceResyncSnapshot === 'function'
      ) {
        // Hybrid coupling mutates particle flow on CPU before GPU submit.
        // Keep GPU seed snapshot aligned with the just-updated CPU particle state.
        simulationState.webgpuManager.forceResyncSnapshot(simulationState.particles)
      }
      const submitResult = simulationState.webgpuManager.submitStep(
        createGpuStepParams(params, simulationState),
        // Keep GPU particle step time consistent with filament/hybrid dt.
        particleEffectiveDt,
        simulationState.particles,
      )
      latestRuntimeStatus = {
        ...latestRuntimeStatus,
        reason: submitResult.reason ?? latestRuntimeStatus.reason,
        gpuDispatchPending: Boolean(submitResult.gpuDispatchPending),
      }
    }

    const hybridPlusAssistResult = runHybridPlusAssistPass({
      plan:
        shouldRunAssistThisStep && !shouldSkipAssistByBudget
          ? hybridPlusPlan
          : {
              ...hybridPlusPlan,
              active: false,
              reason: shouldSkipAssistByBudget ? 'assist_budget_skip' : 'assist_cadence_skip',
            },
      operatorRegistry: simulationState.hybridPlusOperatorRegistry,
      particles: simulationState.particles,
      params,
      dt: particleEffectiveDt,
      webgpuManager: simulationState.webgpuManager,
    })
    simulationState.hybridPlusState = summarizeHybridPlusState(
      hybridPlusPlan,
      hybridPlusAssistResult,
      simulationState.hybridPlusState,
    )

    if (stepAdvanced && latestRuntimeStatus?.backend === 'cpu') {
      simulationState.cpuSteps += particleStepUnits
    } else if (stepAdvanced && latestRuntimeStatus?.backend === 'gpu') {
      // GPU completed step may represent multiple scheduler units.
      simulationState.gpuSteps += particleStepUnits
    }

    if (stepAdvanced) {
      simulationState.simulationTime += particleEffectiveDt
      for (
        let unit = 0;
        unit < particleStepUnits && hasPendingSimulationStep(scheduler);
        unit += 1
      ) {
        consumeSimulationStep(scheduler)
      }
      consumedStepUnits += particleStepUnits
      stepSerial += particleStepUnits
      continue
    }

    break
  }

  dropSchedulerOverflow(scheduler)
  simulationState.stepSerial = stepSerial

  if (params.vortexRepresentation === 'hybrid') {
    snapFilamentCenterToParticles(simulationState.filaments, simulationState.particles)
  }

  const diagnosticsPublishThrottle = 30
  const stepSinceDiagnostics =
    stepSerial - (simulationState.lastDiagnosticsPublishStep ?? -diagnosticsPublishThrottle)
  const shouldPublishDiagnostics = stepSinceDiagnostics >= diagnosticsPublishThrottle
  if (shouldPublishDiagnostics) {
    simulationState.lastDiagnosticsPublishStep = stepSerial
    const runPublish = () => {
      publishGpuDiagnostics(simulationState)
      publishHybridPlusStatus(simulationState)
      publishStructureDetection(simulationState, params)
      publishEnergyDiagnostics(simulationState, params)
    }
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(runPublish, { timeout: 50 })
    } else {
      runPublish()
    }
  }

  applyAdaptiveResolution(simulationState, params)
  publishRuntimeStatus(simulationState, latestRuntimeStatus)
  publishRuntimeCounters(simulationState)
  if (params.scaleEnabled === true) {
    useSimulationStore.getState().setParams({
      scaleAchievedReynolds: params.scaleAchievedReynolds ?? 0,
      scaleAchievedStrouhal: params.scaleAchievedStrouhal ?? 0,
      scalePhysicsScaleFactor: params.scalePhysicsScaleFactor ?? 1,
      scaleViewScale: params.scaleViewScale ?? 1,
      scaleLengthRefM: params.scaleLengthRefM ?? 0,
      scaleVelocityRefMs: params.scaleVelocityRefMs ?? 0,
      scaleApplicability: params.scaleApplicability ?? 'valid',
      scaleApplicabilityReasons: params.scaleApplicabilityReasons ?? [],
    })
  }
  publishPhysicalHooksStatus(simulationState, params)
  publishStabilityMonitor(simulationState, params)
  applyStabilityAutoCorrections(simulationState, params)
  applyJetRollupToroidTuning(simulationState, params, stepSerial)
  updateGpuSyncContractState(simulationState, configuredSyncPolicy)
  applyGpuOverflowProtection(simulationState, params)

  return latestRuntimeStatus
}
