import { useSimulationStore } from '../../state/simulationStore'
import { runExperimentBatch } from './batchRunner'
import { normalizeExperimentContract, validateExperimentContract } from './experimentSchema'
import {
  buildDimensionalScalingPatch,
  buildRuntimeScalingPatch,
  computeNondimensionalGroups,
  evaluateScaleApplicability,
  getScalePresetById,
} from '../scaling/nondimensionalScaling'
import {
  createResolutionControllerState,
  evaluateResolutionDecision,
  normalizeResolutionControllerPolicy,
  runResolutionControllerStressCases,
} from '../adaptive/resolutionController'
import { buildResolutionDiagnosticsMap } from '../adaptive/resolutionDiagnosticsMap'

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) * 0.5 : sorted[mid]
}

function p95(values) {
  if (!Array.isArray(values) || values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))
  return sorted[idx]
}

function toPctDelta(start, end) {
  const startAbs = Math.max(1e-9, Math.abs(Number(start) || 0))
  return (((Number(end) || 0) - (Number(start) || 0)) / startAbs) * 100
}

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function normalizeAdaptiveRuntimeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: source.enabled === true,
    applyToRuntime: source.applyToRuntime === true,
    controllerProfile: typeof source.controllerProfile === 'string' ? source.controllerProfile : 'balanced',
    errorBudget: Math.max(0.01, Number(source.errorBudget ?? 0.12) || 0.12),
    maxActuationsPerMinute: Math.max(1, Math.floor(Number(source.maxActuationsPerMinute ?? 24) || 24)),
    maxParticleStepDeltaRatio: Math.min(0.2, Math.max(0.005, Number(source.maxParticleStepDeltaRatio ?? 0.04) || 0.04)),
    particleCountMin: Math.max(1000, Math.floor(Number(source.particleCountMin ?? 4000) || 4000)),
    particleCountMax: Math.max(5000, Math.floor(Number(source.particleCountMax ?? 120000) || 120000)),
    spawnRateMin: Math.max(30, Math.floor(Number(source.spawnRateMin ?? 120) || 120)),
    spawnRateMax: Math.max(200, Math.floor(Number(source.spawnRateMax ?? 1200) || 1200)),
    maxSpawnRateStepRatio: Math.min(0.2, Math.max(0.005, Number(source.maxSpawnRateStepRatio ?? 0.05) || 0.05)),
    maxRingResolutionStep: Math.max(1, Math.floor(Number(source.maxRingResolutionStep ?? 10) || 10)),
    maxTimeScaleStepRatio: Math.min(0.1, Math.max(0.002, Number(source.maxTimeScaleStepRatio ?? 0.02) || 0.02)),
    policy: normalizeResolutionControllerPolicy(source.policy ?? {}),
  }
}

function buildAdaptiveSignals(snapshot, previousSample = null, errorBudget = 0.12) {
  const p = snapshot?.params ?? {}
  const currentEnergy = Number(p.runtimeEnergyProxy ?? 0) || 0
  const currentEnstrophy = Number(p.runtimeEnstrophyProxy ?? 0) || 0
  const prevEnergy = Number(previousSample?.energyProxy ?? currentEnergy) || 0
  const prevEnstrophy = Number(previousSample?.enstrophyProxy ?? currentEnstrophy) || 0
  const energyStepDrift = Math.abs(toPctDelta(prevEnergy, currentEnergy))
  const enstrophyStepDrift = Math.abs(toPctDelta(prevEnstrophy, currentEnstrophy))
  const driftPressure = clamp01((energyStepDrift + enstrophyStepDrift) / Math.max(1, errorBudget * 100))

  const detectorConfidence = Number(p.runtimeDetectedConfidence ?? 0.75) || 0.75
  const uncertainty = clamp01(1 - detectorConfidence)
  const reconnection = clamp01(Number(p.runtimeDetectedReconnectCount ?? 0) / 5)
  const curvature = clamp01(Number(p.runtimeFilamentCurvatureProxy ?? 0))
  const vorticity = clamp01(Number(p.runtimeVorticityIntensityProxy ?? currentEnstrophy / 10))
  const autoCorrectionActive = String(p.runtimeStabilityAutoCorrectionLastAction ?? 'none') !== 'none'
  const stabilityWarnings = autoCorrectionActive ? 1 : driftPressure

  return {
    vorticity,
    curvature,
    reconnection,
    uncertainty,
    stabilityWarnings,
  }
}

function summarizeAdaptiveTrace(trace = [], sampleEveryMs = 300) {
  const timeByLevel = { L0: 0, L1: 0, L2: 0, L3: 0 }
  let refineCount = 0
  let coarsenCount = 0
  for (let i = 0; i < trace.length; i += 1) {
    const step = trace[i]
    const nextLevel = String(step?.nextLevel ?? 'L1')
    timeByLevel[nextLevel] = (timeByLevel[nextLevel] ?? 0) + sampleEveryMs
    const prevLevel = String(step?.previousLevel ?? nextLevel)
    if (nextLevel > prevLevel) refineCount += 1
    if (nextLevel < prevLevel) coarsenCount += 1
  }
  return {
    decisionCount: trace.length,
    refineCount,
    coarsenCount,
    actuationAppliedCount: trace.filter((item) => item?.actuation?.applied === true).length,
    actuationSkippedCount: trace.filter((item) => item?.actuation?.applied === false).length,
    timeInLevelsMs: timeByLevel,
  }
}

function createAdaptiveBudgetState() {
  return {
    windowStartMs: 0,
    usedInWindow: 0,
    lastActuationMs: -1,
  }
}

function buildAdaptiveActuationPatch({
  decision,
  snapshotParams,
  adaptiveConfig,
  budgetState,
  nowMs,
} = {}) {
  if (!adaptiveConfig?.applyToRuntime) {
    return { applied: false, reason: 'runtime_apply_disabled', patch: null }
  }
  if (!decision?.changed) {
    return { applied: false, reason: 'no_level_change', patch: null }
  }
  const now = Math.max(0, Math.floor(Number(nowMs) || 0))
  const state = budgetState ?? createAdaptiveBudgetState()
  if (now - state.windowStartMs >= 60000) {
    state.windowStartMs = now
    state.usedInWindow = 0
  }
  if (state.usedInWindow >= adaptiveConfig.maxActuationsPerMinute) {
    return { applied: false, reason: 'actuation_budget_exhausted', patch: null }
  }
  if (state.lastActuationMs >= 0 && now - state.lastActuationMs < adaptiveConfig.policy.cooldownMs) {
    return { applied: false, reason: 'actuation_cooldown', patch: null }
  }

  const currentCount = Math.max(1000, Math.floor(Number(snapshotParams?.particleCount ?? 12000) || 12000))
  const scale = Number(decision?.patch?.particleBudgetScale ?? 1) || 1
  const unclampedTarget = Math.floor(currentCount * scale)
  const boundedStep = Math.max(1, Math.floor(currentCount * adaptiveConfig.maxParticleStepDeltaRatio))
  const limitedTarget = Math.max(currentCount - boundedStep, Math.min(currentCount + boundedStep, unclampedTarget))
  const targetCount = Math.max(adaptiveConfig.particleCountMin, Math.min(adaptiveConfig.particleCountMax, limitedTarget))

  if (targetCount === currentCount) {
    return { applied: false, reason: 'actuation_no_effect', patch: null }
  }

  state.usedInWindow += 1
  state.lastActuationMs = now
  return {
    applied: true,
    reason: 'ok',
    patch: { particleCount: targetCount },
  }
}

function withBoundedStep(currentValue, targetValue, ratioLimit) {
  const current = Number(currentValue)
  const target = Number(targetValue)
  if (!Number.isFinite(current) || !Number.isFinite(target)) {
    return currentValue
  }
  const step = Math.max(Math.abs(current) * ratioLimit, ratioLimit)
  return target > current ? Math.min(target, current + step) : Math.max(target, current - step)
}

function buildRuntimeMappedPatch({ basePatch, snapshotParams, decision, adaptiveConfig }) {
  const p = snapshotParams ?? {}
  const patch = { ...(basePatch ?? {}) }
  const refineBias = Number(decision?.patch?.filamentRefineBias ?? 0) || 0
  const coarsenBias = Number(decision?.patch?.filamentCoarsenBias ?? 0) || 0
  const stress = clamp01(Number(decision?.score ?? 0))

  const currentSpawnRate = Number(p.spawnRate ?? 360) || 360
  const spawnTargetRaw = currentSpawnRate * (1 + refineBias * 0.04 - coarsenBias * 0.04)
  const spawnTarget = Math.max(adaptiveConfig.spawnRateMin, Math.min(adaptiveConfig.spawnRateMax, spawnTargetRaw))
  patch.spawnRate = withBoundedStep(currentSpawnRate, spawnTarget, adaptiveConfig.maxSpawnRateStepRatio)

  const currentRingRes = Math.max(16, Math.floor(Number(p.ringResolution ?? 120) || 120))
  const ringDeltaRaw = Math.round(refineBias * adaptiveConfig.maxRingResolutionStep)
  const ringDelta = Math.max(
    -adaptiveConfig.maxRingResolutionStep,
    Math.min(adaptiveConfig.maxRingResolutionStep, ringDeltaRaw),
  )
  patch.ringResolution = Math.max(16, currentRingRes + ringDelta)

  const currentTimeScale = Number(p.timeScale ?? 1) || 1
  const timeScaleTargetRaw = currentTimeScale * (stress > 0.75 ? 0.985 : 1.005)
  patch.timeScale = withBoundedStep(currentTimeScale, timeScaleTargetRaw, adaptiveConfig.maxTimeScaleStepRatio)

  return patch
}

function evaluateAdaptiveAcceptance({
  trace = [],
  adaptiveConfig,
  durationSec,
  summary,
} = {}) {
  const applied = trace.filter((item) => item?.actuation?.applied === true)
  const appliedTimes = applied
    .map((item) => Number(item?.tMs ?? 0))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
  let minAppliedGapMs = Number.POSITIVE_INFINITY
  for (let i = 1; i < appliedTimes.length; i += 1) {
    minAppliedGapMs = Math.min(minAppliedGapMs, appliedTimes[i] - appliedTimes[i - 1])
  }
  const maxExpected =
    Math.ceil((Math.max(1, Number(durationSec) || 1) / 60) * Math.max(1, adaptiveConfig.maxActuationsPerMinute)) + 1
  const checks = [
    {
      id: 'actuation_budget_guard',
      ok: applied.length <= maxExpected,
      value: applied.length,
      threshold: maxExpected,
    },
    {
      id: 'actuation_cooldown_guard',
      ok: !Number.isFinite(minAppliedGapMs) || minAppliedGapMs >= adaptiveConfig.policy.cooldownMs,
      value: Number.isFinite(minAppliedGapMs) ? minAppliedGapMs : -1,
      threshold: adaptiveConfig.policy.cooldownMs,
    },
    {
      id: 'drift_guard_soft',
      ok:
        Math.abs(Number(summary?.energyDriftPct ?? 0)) <= Math.max(35, adaptiveConfig.errorBudget * 220) &&
        Math.abs(Number(summary?.circulationDriftPct ?? 0)) <= Math.max(20, adaptiveConfig.errorBudget * 160),
      value: `E=${Number(summary?.energyDriftPct ?? 0).toFixed(2)};C=${Number(summary?.circulationDriftPct ?? 0).toFixed(2)}`,
      threshold: `E<=${Math.max(35, adaptiveConfig.errorBudget * 220).toFixed(2)};C<=${Math.max(
        20,
        adaptiveConfig.errorBudget * 160,
      ).toFixed(2)}`,
      soft: true,
    },
  ]
  const failed = checks.filter((item) => item.ok !== true && item.soft !== true).map((item) => item.id)
  return {
    ok: failed.length === 0,
    checks,
    failedChecks: failed,
    minAppliedGapMs: Number.isFinite(minAppliedGapMs) ? minAppliedGapMs : -1,
    appliedCount: applied.length,
  }
}

function getAdaptiveBaselineScenario(hardwareClass = 'unknown') {
  const key = String(hardwareClass ?? 'unknown').toLowerCase()
  if (key.includes('high')) {
    return {
      id: 'adaptive.high',
      stepP95MaxMs: 30,
      energyDriftAbsMaxPct: 35,
      circulationDriftAbsMaxPct: 20,
      maxPathComplexity: 0.9,
    }
  }
  if (key.includes('low')) {
    return {
      id: 'adaptive.low',
      stepP95MaxMs: 80,
      energyDriftAbsMaxPct: 55,
      circulationDriftAbsMaxPct: 30,
      maxPathComplexity: 1.25,
    }
  }
  return {
    id: 'adaptive.mid',
    stepP95MaxMs: 45,
    energyDriftAbsMaxPct: 45,
    circulationDriftAbsMaxPct: 25,
    maxPathComplexity: 1.0,
  }
}

function evaluateAdaptiveBaselineScenario({ summary = {}, hardwareClass = 'unknown' } = {}) {
  const scenario = getAdaptiveBaselineScenario(hardwareClass)
  const checks = [
    {
      id: 'step_p95_guard',
      ok: Number(summary.stepP95Ms ?? 0) <= scenario.stepP95MaxMs,
      value: Number(summary.stepP95Ms ?? 0),
      threshold: scenario.stepP95MaxMs,
    },
    {
      id: 'energy_drift_guard',
      ok: Math.abs(Number(summary.energyDriftPct ?? 0)) <= scenario.energyDriftAbsMaxPct,
      value: Math.abs(Number(summary.energyDriftPct ?? 0)),
      threshold: scenario.energyDriftAbsMaxPct,
    },
    {
      id: 'circulation_drift_guard',
      ok: Math.abs(Number(summary.circulationDriftPct ?? 0)) <= scenario.circulationDriftAbsMaxPct,
      value: Math.abs(Number(summary.circulationDriftPct ?? 0)),
      threshold: scenario.circulationDriftAbsMaxPct,
    },
    {
      id: 'path_complexity_guard',
      ok: Number(summary.adaptivePathComplexity ?? 0) <= scenario.maxPathComplexity,
      value: Number(summary.adaptivePathComplexity ?? 0),
      threshold: scenario.maxPathComplexity,
    },
  ]
  const failed = checks.filter((item) => item.ok !== true).map((item) => item.id)
  return {
    scenarioId: scenario.id,
    ok: failed.length === 0,
    checks,
    failedChecks: failed,
  }
}

export function createLabPresetVortexRingCollision() {
  return normalizeExperimentContract({
    schemaVersion: 1,
    id: 'lab.vortex_ring_collision.v1',
    title: 'Vortex Ring Collision',
    hypothesis: 'Pair interaction remains bounded under fixed circulation and controlled viscosity',
    initialConditions: {
      modePatch: {
        dynamicsMode: 'fullPhysics',
        executionMode: 'hybrid',
        vortexRepresentation: 'hybrid',
        hybridPlusEnabled: false,
      },
      paramsPatch: {
        particleCount: 12000,
        circulationStrength: 2.6,
        viscosity: 0.012,
        ringRadius: 3.2,
        pulseSpacing: 0.42,
      },
      warmupSec: 1.5,
      durationSec: 8,
      sampleEveryMs: 300,
      scale: {
        enabled: false,
        applyToRuntime: false,
        scalePresetId: 'ring_pair_lab',
        scaleClass: 'lab',
        targetReynolds: 4500,
        targetStrouhal: 0.22,
      },
      adaptive: {
        enabled: false,
        applyToRuntime: false,
        controllerProfile: 'balanced',
        errorBudget: 0.12,
      },
    },
    sweep: {
      strategy: 'linspace',
      dimensions: [
        {
          name: 'ringRadius',
          min: 2.4,
          max: 4.0,
          steps: 4,
        },
      ],
    },
    metrics: [
      'runtimeEnergyProxy',
      'runtimeEnstrophyProxy',
      'totalCirculation',
      'runtimeDetectedRingCount',
    ],
    acceptanceChecks: ['stability_monitor_not_critical', 'bounded_circulation_drift'],
    runBudget: {
      maxRuns: 4,
      maxWallClockSec: 180,
      maxRetries: 1,
    },
    artifacts: {
      includeRawSamples: true,
      includeSummary: true,
    },
  })
}

export function createLabPresetVortexLeapfrogging() {
  return normalizeExperimentContract({
    schemaVersion: 1,
    id: 'lab.vortex_leapfrogging.v1',
    title: 'Vortex Leapfrogging',
    hypothesis: 'Paired rings preserve bounded circulation while exchanging leading position',
    initialConditions: {
      modePatch: {
        dynamicsMode: 'fullPhysics',
        executionMode: 'hybrid',
        vortexRepresentation: 'hybrid',
        hybridPlusEnabled: false,
      },
      paramsPatch: {
        particleCount: 10000,
        circulationStrength: 2.3,
        viscosity: 0.01,
        ringRadius: 2.8,
        pulseSpacing: 0.32,
      },
      warmupSec: 1.2,
      durationSec: 7,
      sampleEveryMs: 300,
      scale: {
        enabled: false,
        applyToRuntime: false,
        scalePresetId: 'ring_pair_lab',
        scaleClass: 'lab',
        targetReynolds: 4200,
        targetStrouhal: 0.24,
      },
      adaptive: {
        enabled: false,
        applyToRuntime: false,
        controllerProfile: 'balanced',
        errorBudget: 0.12,
      },
    },
    sweep: {
      strategy: 'linspace',
      dimensions: [{ name: 'pulseSpacing', min: 0.24, max: 0.42, steps: 4 }],
    },
    metrics: ['runtimeEnergyProxy', 'runtimeEnstrophyProxy', 'totalCirculation', 'runtimeDetectedRingCount'],
    acceptanceChecks: ['stability_monitor_not_critical', 'bounded_circulation_drift'],
    runBudget: { maxRuns: 4, maxWallClockSec: 160, maxRetries: 1 },
    artifacts: { includeRawSamples: true, includeSummary: true },
  })
}

export function createLabPresetJetInstability() {
  return normalizeExperimentContract({
    schemaVersion: 1,
    id: 'lab.jet_instability.v1',
    title: 'Jet Instability Window',
    hypothesis: 'Jet onset regime appears in bounded enstrophy growth without catastrophic drift',
    initialConditions: {
      modePatch: {
        dynamicsMode: 'guidedPhysics',
        executionMode: 'gpu',
        vortexRepresentation: 'particles',
        hybridPlusEnabled: false,
      },
      paramsPatch: {
        particleCount: 14000,
        circulationStrength: 2.1,
        viscosity: 0.009,
        ringRadius: 3.4,
      },
      warmupSec: 1.5,
      durationSec: 9,
      sampleEveryMs: 300,
      scale: {
        enabled: false,
        applyToRuntime: false,
        scalePresetId: 'jet_window_lab',
        scaleClass: 'lab',
        targetReynolds: 6500,
        targetStrouhal: 0.28,
      },
      adaptive: {
        enabled: false,
        applyToRuntime: false,
        controllerProfile: 'balanced',
        errorBudget: 0.12,
      },
    },
    sweep: {
      strategy: 'linspace',
      dimensions: [{ name: 'circulationStrength', min: 1.6, max: 2.8, steps: 4 }],
    },
    metrics: ['runtimeEnergyProxy', 'runtimeEnstrophyProxy', 'runtimeDetectedClusterCount'],
    acceptanceChecks: ['stability_monitor_not_critical'],
    runBudget: { maxRuns: 4, maxWallClockSec: 180, maxRetries: 1 },
    artifacts: { includeRawSamples: true, includeSummary: true },
  })
}

export function createLabPresetTurbulenceCascade() {
  return normalizeExperimentContract({
    schemaVersion: 1,
    id: 'lab.turbulence_cascade.v1',
    title: 'Turbulence Cascade Window',
    hypothesis: 'Energy transfer remains bounded while detector identifies transient tube/ring structures',
    initialConditions: {
      modePatch: {
        dynamicsMode: 'fullPhysics',
        executionMode: 'hybrid',
        vortexRepresentation: 'hybrid',
        hybridPlusEnabled: true,
      },
      paramsPatch: {
        particleCount: 16000,
        circulationStrength: 2.5,
        viscosity: 0.012,
      },
      warmupSec: 1.8,
      durationSec: 10,
      sampleEveryMs: 350,
      scale: {
        enabled: false,
        applyToRuntime: false,
        scalePresetId: 'turbulence_lab',
        scaleClass: 'lab',
        targetReynolds: 7000,
        targetStrouhal: 0.2,
      },
      adaptive: {
        enabled: false,
        applyToRuntime: false,
        controllerProfile: 'balanced',
        errorBudget: 0.12,
      },
    },
    sweep: {
      strategy: 'linspace',
      dimensions: [{ name: 'viscosity', min: 0.008, max: 0.018, steps: 4 }],
    },
    metrics: ['runtimeEnergyProxy', 'runtimeEnstrophyProxy', 'runtimeDetectedTubeCount'],
    acceptanceChecks: ['stability_monitor_not_critical', 'bounded_circulation_drift'],
    runBudget: { maxRuns: 4, maxWallClockSec: 220, maxRetries: 1 },
    artifacts: { includeRawSamples: true, includeSummary: true },
  })
}

export function createLabPresetHelmholtzShear() {
  return normalizeExperimentContract({
    schemaVersion: 1,
    id: 'lab.helmholtz_shear.v1',
    title: 'Helmholtz Shear Growth',
    hypothesis: 'Shear-driven interface instability grows in a bounded envelope before breakdown',
    initialConditions: {
      modePatch: {
        dynamicsMode: 'guidedPhysics',
        executionMode: 'gpu',
        vortexRepresentation: 'particles',
        hybridPlusEnabled: false,
      },
      paramsPatch: {
        particleCount: 12000,
        circulationStrength: 1.9,
        viscosity: 0.008,
        ringRadius: 3.0,
        pulseSpacing: 0.36,
      },
      warmupSec: 1.4,
      durationSec: 8,
      sampleEveryMs: 300,
      scale: {
        enabled: false,
        applyToRuntime: false,
        scalePresetId: 'jet_window_lab',
        scaleClass: 'lab',
        targetReynolds: 5600,
        targetStrouhal: 0.26,
      },
      adaptive: {
        enabled: false,
        applyToRuntime: false,
        controllerProfile: 'balanced',
        errorBudget: 0.12,
      },
    },
    sweep: {
      strategy: 'linspace',
      dimensions: [{ name: 'pulseSpacing', min: 0.24, max: 0.52, steps: 4 }],
    },
    metrics: ['runtimeEnergyProxy', 'runtimeEnstrophyProxy', 'runtimeDetectedTubeCount'],
    acceptanceChecks: ['stability_monitor_not_critical', 'bounded_circulation_drift'],
    runBudget: { maxRuns: 4, maxWallClockSec: 180, maxRetries: 1 },
    artifacts: { includeRawSamples: true, includeSummary: true },
  })
}

export function createLabPresetKelvinWaveTrain() {
  return normalizeExperimentContract({
    schemaVersion: 1,
    id: 'lab.kelvin_wave_train.v1',
    title: 'Kelvin Wave Train',
    hypothesis: 'Wave train remains observable without catastrophic circulation drift',
    initialConditions: {
      modePatch: {
        dynamicsMode: 'fullPhysics',
        executionMode: 'hybrid',
        vortexRepresentation: 'hybrid',
        hybridPlusEnabled: false,
      },
      paramsPatch: {
        particleCount: 11000,
        circulationStrength: 2.0,
        viscosity: 0.01,
        ringRadius: 2.6,
        pulseSpacing: 0.3,
      },
      warmupSec: 1.2,
      durationSec: 8,
      sampleEveryMs: 280,
      scale: {
        enabled: false,
        applyToRuntime: false,
        scalePresetId: 'ring_pair_lab',
        scaleClass: 'lab',
        targetReynolds: 4800,
        targetStrouhal: 0.24,
      },
      adaptive: {
        enabled: false,
        applyToRuntime: false,
        controllerProfile: 'balanced',
        errorBudget: 0.12,
      },
    },
    sweep: {
      strategy: 'linspace',
      dimensions: [{ name: 'circulationStrength', min: 1.4, max: 2.6, steps: 4 }],
    },
    metrics: ['runtimeEnergyProxy', 'runtimeEnstrophyProxy', 'totalCirculation'],
    acceptanceChecks: ['stability_monitor_not_critical', 'bounded_circulation_drift'],
    runBudget: { maxRuns: 4, maxWallClockSec: 170, maxRetries: 1 },
    artifacts: { includeRawSamples: true, includeSummary: true },
  })
}

export function createLabPresetReconnectionPair() {
  return normalizeExperimentContract({
    schemaVersion: 1,
    id: 'lab.reconnection_pair.v1',
    title: 'Reconnection Pair Stability',
    hypothesis: 'Reconnection events remain bounded and preserve circulation envelope',
    initialConditions: {
      modePatch: {
        dynamicsMode: 'fullPhysics',
        executionMode: 'hybrid_plus',
        vortexRepresentation: 'hybrid',
        hybridPlusEnabled: true,
      },
      paramsPatch: {
        particleCount: 13000,
        circulationStrength: 2.4,
        viscosity: 0.011,
        ringRadius: 2.9,
        pulseSpacing: 0.34,
      },
      warmupSec: 1.6,
      durationSec: 9,
      sampleEveryMs: 320,
      scale: {
        enabled: false,
        applyToRuntime: false,
        scalePresetId: 'turbulence_lab',
        scaleClass: 'lab',
        targetReynolds: 6200,
        targetStrouhal: 0.21,
      },
      adaptive: {
        enabled: false,
        applyToRuntime: false,
        controllerProfile: 'balanced',
        errorBudget: 0.12,
      },
    },
    sweep: {
      strategy: 'linspace',
      dimensions: [{ name: 'viscosity', min: 0.007, max: 0.016, steps: 4 }],
    },
    metrics: ['runtimeEnergyProxy', 'runtimeEnstrophyProxy', 'runtimeDetectedReconnectCount'],
    acceptanceChecks: ['stability_monitor_not_critical', 'bounded_circulation_drift'],
    runBudget: { maxRuns: 4, maxWallClockSec: 210, maxRetries: 1 },
    artifacts: { includeRawSamples: true, includeSummary: true },
  })
}

const LAB_PRESET_FACTORIES = {
  vortex_ring_collision: createLabPresetVortexRingCollision,
  vortex_leapfrogging: createLabPresetVortexLeapfrogging,
  jet_instability: createLabPresetJetInstability,
  turbulence_cascade: createLabPresetTurbulenceCascade,
  helmholtz_shear: createLabPresetHelmholtzShear,
  kelvin_wave_train: createLabPresetKelvinWaveTrain,
  reconnection_pair: createLabPresetReconnectionPair,
}

export function getLabPresetOptions() {
  return [
    { value: 'vortex_ring_collision', label: 'Vortex Ring Collision' },
    { value: 'vortex_leapfrogging', label: 'Vortex Leapfrogging' },
    { value: 'jet_instability', label: 'Jet Instability Window' },
    { value: 'turbulence_cascade', label: 'Turbulence Cascade Window' },
    { value: 'helmholtz_shear', label: 'Helmholtz Shear Growth' },
    { value: 'kelvin_wave_train', label: 'Kelvin Wave Train' },
    { value: 'reconnection_pair', label: 'Reconnection Pair Stability' },
  ]
}

export function getResearchPresetPackV1() {
  return [
    'vortex_ring_collision',
    'vortex_leapfrogging',
    'jet_instability',
    'turbulence_cascade',
    'helmholtz_shear',
    'kelvin_wave_train',
    'reconnection_pair',
  ].map((presetId) => ({
    presetId,
    experiment: createLabPresetById(presetId),
  }))
}

export function createLabPresetById(presetId) {
  const factory = LAB_PRESET_FACTORIES[presetId] ?? createLabPresetVortexRingCollision
  return factory()
}

export function applyLabExperimentOverrides(experiment, overrides = {}) {
  const source = normalizeExperimentContract(experiment)
  const runBudget = source.runBudget ?? {}
  const initial = source.initialConditions ?? {}
  const initialScale = initial.scale ?? {}
  const initialAdaptive = initial.adaptive ?? {}
  const sweep = source.sweep ?? {}
  const dimensions = Array.isArray(sweep.dimensions) ? [...sweep.dimensions] : []
  if (dimensions.length > 0) {
    dimensions[0] = {
      ...(dimensions[0] ?? {}),
      steps: Math.max(1, Math.floor(Number(overrides.maxRuns ?? runBudget.maxRuns ?? 1))),
      min:
        Number.isFinite(Number(overrides.sweepMin)) && overrides.sweepMin !== ''
          ? Number(overrides.sweepMin)
          : Number(dimensions[0]?.min ?? 0),
      max:
        Number.isFinite(Number(overrides.sweepMax)) && overrides.sweepMax !== ''
          ? Number(overrides.sweepMax)
          : Number(dimensions[0]?.max ?? dimensions[0]?.min ?? 0),
    }
  }
  return normalizeExperimentContract({
    ...source,
    runBudget: {
      ...runBudget,
      maxRuns: Math.max(1, Math.floor(Number(overrides.maxRuns ?? runBudget.maxRuns ?? 1))),
      maxWallClockSec: Math.max(
        1,
        Math.floor(Number(overrides.maxWallClockSec ?? runBudget.maxWallClockSec ?? 120)),
      ),
      maxRetries: Math.max(0, Math.floor(Number(overrides.maxRetries ?? runBudget.maxRetries ?? 1))),
    },
    initialConditions: {
      ...initial,
      warmupSec: Math.max(0.2, Number(overrides.warmupSec ?? initial.warmupSec ?? 1)),
      durationSec: Math.max(1, Number(overrides.durationSec ?? initial.durationSec ?? 8)),
      sampleEveryMs: Math.max(100, Math.floor(Number(overrides.sampleEveryMs ?? initial.sampleEveryMs ?? 300))),
      scale: {
        ...initialScale,
        enabled: overrides.scaleEnabled === true,
        applyToRuntime: overrides.scaleApplyToRuntime === true,
        scalePresetId:
          typeof overrides.scalePresetId === 'string'
            ? overrides.scalePresetId
            : initialScale.scalePresetId ?? 'custom',
        scaleClass: typeof overrides.scaleClass === 'string' ? overrides.scaleClass : initialScale.scaleClass ?? 'lab',
        targetReynolds: Number.isFinite(Number(overrides.scaleTargetReynolds))
          ? Number(overrides.scaleTargetReynolds)
          : Number(initialScale.targetReynolds ?? 4500),
        targetStrouhal: Number.isFinite(Number(overrides.scaleTargetStrouhal))
          ? Number(overrides.scaleTargetStrouhal)
          : Number(initialScale.targetStrouhal ?? 0.22),
      },
      adaptive: {
        ...initialAdaptive,
        enabled: overrides.adaptiveEnabled === true,
        applyToRuntime: overrides.adaptiveApplyToRuntime === true,
        controllerProfile:
          typeof overrides.adaptiveControllerProfile === 'string'
            ? overrides.adaptiveControllerProfile
            : initialAdaptive.controllerProfile ?? 'balanced',
        errorBudget: Number.isFinite(Number(overrides.adaptiveErrorBudget))
          ? Math.max(0.01, Number(overrides.adaptiveErrorBudget))
          : Math.max(0.01, Number(initialAdaptive.errorBudget ?? 0.12)),
      },
    },
    sweep: {
      ...sweep,
      dimensions,
    },
  })
}

function buildScaleReport({ initial, runPatch }) {
  const scaleConfig = initial?.scale ?? {}
  if (scaleConfig.enabled !== true) {
    return {
      enabled: false,
      applied: false,
      scaleClass: String(scaleConfig.scaleClass ?? 'lab'),
    }
  }
  const preset = getScalePresetById(String(scaleConfig.scalePresetId ?? 'custom'))
  const usePresetTargets = preset.id !== 'custom'
  const effectiveScaleClass = usePresetTargets
    ? preset.scaleClass
    : String(scaleConfig.scaleClass ?? 'lab')
  const effectiveTargetRe = usePresetTargets
    ? Number(preset.targetReynolds ?? 4500)
    : Number(scaleConfig.targetReynolds ?? 4500)
  const effectiveTargetSt = usePresetTargets
    ? Number(preset.targetStrouhal ?? 0.22)
    : Number(scaleConfig.targetStrouhal ?? 0.22)
  const referenceLengthM = Math.max(1e-6, Number(runPatch.ringRadius ?? runPatch.coreRadius ?? 1) || 1)
  const scaling = buildDimensionalScalingPatch({
    scaleClass: effectiveScaleClass,
    targetReynolds: effectiveTargetRe,
    targetStrouhal: effectiveTargetSt,
    referenceLengthM,
  })
  const applyToRuntime = scaleConfig.applyToRuntime === true
  if (applyToRuntime) {
    const runtimeScaling = buildRuntimeScalingPatch({
      scaleClass: effectiveScaleClass,
      targetReynolds: effectiveTargetRe,
      targetStrouhal: effectiveTargetSt,
      currentParams: runPatch,
    })
    Object.assign(runPatch, runtimeScaling.patch)
  }
  const nondimensional = computeNondimensionalGroups({
    lengthScale: referenceLengthM,
    velocityScale: Math.max(1e-6, Number(runPatch.circulationStrength ?? 1)),
    kinematicViscosity: Math.max(1e-9, Number(runPatch.viscosity ?? 0.01)),
    forcingPeriodSec: Math.max(1e-6, Number(runPatch.pulseSpacing ?? runPatch.pulseDuration ?? 1)),
  })
  const measuredApplicability = evaluateScaleApplicability({
    scaleClass: scaling.scaleClass,
    reynolds: nondimensional.reynolds,
    strouhal: nondimensional.strouhal,
    rossby: nondimensional.rossby,
  })
  const mergedReasons = [...(scaling.applicabilityReasons ?? []), ...(measuredApplicability.reasons ?? [])]
  const reasonSet = Array.from(new Set(mergedReasons))
  const validationErrors = Array.isArray(scaling.validation?.errors) ? scaling.validation.errors : []
  const validationWarnings = Array.isArray(scaling.validation?.warnings) ? scaling.validation.warnings : []
  const consistencyErrorPct = Number(scaling.consistency?.errors?.maxErrorPct ?? 0) || 0
  const mergedApplicability =
    scaling.applicability === 'unsupported' || measuredApplicability.level === 'unsupported'
      ? 'unsupported'
      : scaling.applicability === 'approximate' || measuredApplicability.level === 'approximate'
        ? 'approximate'
        : 'valid'
  if (validationErrors.length > 0) {
    reasonSet.push('scaling_validation_failed')
  }
  if (consistencyErrorPct > 1.0) {
    reasonSet.push('scaling_consistency_error_gt_1pct')
  }
  return {
    enabled: true,
    applied: applyToRuntime,
    presetId: preset.id,
    presetTitle: preset.title,
    scaleClass: scaling.scaleClass,
    applicability: mergedApplicability,
    applicabilityReasons: reasonSet,
    validationErrors,
    validationWarnings,
    consistencyErrorPct,
    target: {
      reynolds: scaling.nondimensional?.reynolds ?? effectiveTargetRe,
      strouhal: scaling.nondimensional?.strouhal ?? effectiveTargetSt,
    },
    measured: {
      reynolds: nondimensional.reynolds,
      strouhal: nondimensional.strouhal,
      rossby: nondimensional.rossby,
    },
  }
}

async function runSingleRuntimeExperiment({ experiment, runIndex }) {
  const store = useSimulationStore.getState()
  const baselineParams = { ...store.params }
  const initial = experiment.initialConditions ?? {}
  const modePatch = initial.modePatch ?? {}
  const paramsPatch = initial.paramsPatch ?? {}
  const warmupSec = Math.max(0.2, Number(initial.warmupSec ?? 1.5) || 1.5)
  const durationSec = Math.max(1, Number(initial.durationSec ?? 8) || 8)
  const sampleEveryMs = Math.max(100, Math.floor(Number(initial.sampleEveryMs ?? 300) || 300))

  const sweepDimensions = Array.isArray(experiment?.sweep?.dimensions) ? experiment.sweep.dimensions : []
  const activeSweep = sweepDimensions[0] ?? null
  const runPatch = { ...paramsPatch }
  if (activeSweep) {
    const min = Number(activeSweep.min ?? 0)
    const max = Number(activeSweep.max ?? min)
    const steps = Math.max(1, Math.floor(Number(activeSweep.steps ?? experiment.runBudget?.maxRuns ?? 1)))
    const ratio = steps <= 1 ? 0 : runIndex / (steps - 1)
    const value = min + (max - min) * ratio
    if (typeof activeSweep.name === 'string' && activeSweep.name.trim().length > 0) {
      runPatch[activeSweep.name.trim()] = value
    }
  }
  const scaleReport = buildScaleReport({ initial, runPatch })
  const adaptiveConfig = normalizeAdaptiveRuntimeConfig(initial.adaptive ?? {})
  let controllerState = createResolutionControllerState({
    level: 'L1',
    lastSwitchMs: 0,
    lastDecisionMs: 0,
    lastScore: 0,
    decisionSerial: 0,
  })
  const adaptiveTrace = []
  const adaptiveBudgetState = createAdaptiveBudgetState()

  store.setParams({
    ...baselineParams,
    ...modePatch,
    ...runPatch,
  })
  store.resetScene()
  store.startPulseTrain()
  await sleep(Math.floor(warmupSec * 1000))

  const start = useSimulationStore.getState()
  const startParams = start.params
  const startCirculation =
    start.stabilityStats?.hybridTotalCirculation ?? start.stabilityStats?.totalCirculation ?? 0
  const startEnergy = Number(startParams.runtimeEnergyProxy ?? 0) || 0
  const startEnstrophy = Number(startParams.runtimeEnstrophyProxy ?? 0) || 0

  const samples = []
  const iterations = Math.max(1, Math.floor((durationSec * 1000) / sampleEveryMs))
  for (let i = 0; i < iterations; i += 1) {
    await sleep(sampleEveryMs)
    const snapshot = useSimulationStore.getState()
    let adaptiveDecision = null
    let adaptiveActuation = null
    if (adaptiveConfig.enabled) {
      const signals = buildAdaptiveSignals(snapshot, samples[samples.length - 1], adaptiveConfig.errorBudget)
      const evaluation = evaluateResolutionDecision({
        signals,
        controllerState,
        policy: adaptiveConfig.policy,
        nowMs: (i + 1) * sampleEveryMs,
      })
      controllerState = evaluation.state
      adaptiveDecision = evaluation.decision
      adaptiveActuation = buildAdaptiveActuationPatch({
        decision: evaluation.decision,
        snapshotParams: snapshot?.params ?? {},
        adaptiveConfig,
        budgetState: adaptiveBudgetState,
        nowMs: (i + 1) * sampleEveryMs,
      })
      if (adaptiveActuation?.applied && adaptiveActuation.patch) {
        const mappedPatch = buildRuntimeMappedPatch({
          basePatch: adaptiveActuation.patch,
          snapshotParams: useSimulationStore.getState().params,
          decision: evaluation.decision,
          adaptiveConfig,
        })
        store.setParams({
          ...useSimulationStore.getState().params,
          ...mappedPatch,
        })
        adaptiveActuation = {
          ...adaptiveActuation,
          patch: mappedPatch,
        }
      }
      adaptiveTrace.push({
        ...evaluation.decision,
        actuation: adaptiveActuation,
        tMs: (i + 1) * sampleEveryMs,
      })
    }
    samples.push({
      tMs: (i + 1) * sampleEveryMs,
      stepMs: Number(snapshot.params.runtimeGpuStepMs ?? 0) || 0,
      activeCount: Math.max(
        Number(snapshot.params.runtimeGpuDiagActiveCount ?? 0) || 0,
        Number(snapshot.params.particleCount ?? 0) || 0,
      ),
      energyProxy: Number(snapshot.params.runtimeEnergyProxy ?? 0) || 0,
      enstrophyProxy: Number(snapshot.params.runtimeEnstrophyProxy ?? 0) || 0,
      totalCirculation:
        snapshot.stabilityStats?.hybridTotalCirculation ?? snapshot.stabilityStats?.totalCirculation ?? 0,
      detectedRings: Number(snapshot.params.runtimeDetectedRingCount ?? 0) || 0,
      adaptiveLevel: adaptiveDecision?.nextLevel ?? 'L1',
      adaptiveScore: Number(adaptiveDecision?.score ?? 0),
      adaptiveReasons: Array.isArray(adaptiveDecision?.reasons) ? adaptiveDecision.reasons.join('|') : '',
      adaptiveActuationApplied: adaptiveActuation?.applied === true,
      adaptiveActuationReason: String(adaptiveActuation?.reason ?? ''),
    })
  }
  store.stopPulseTrain()

  const end = useSimulationStore.getState()
  const endParams = end.params
  const endCirculation =
    end.stabilityStats?.hybridTotalCirculation ?? end.stabilityStats?.totalCirculation ?? 0
  const endEnergy = Number(endParams.runtimeEnergyProxy ?? 0) || 0
  const endEnstrophy = Number(endParams.runtimeEnstrophyProxy ?? 0) || 0

  const stepSamples = samples.map((item) => item.stepMs).filter((value) => value > 0)
  const throughputSamples = samples
    .map((item) => (item.stepMs > 1e-6 ? item.activeCount / (item.stepMs / 1000) : 0))
    .filter((value) => value > 0)
  const adaptiveSummary = summarizeAdaptiveTrace(adaptiveTrace, sampleEveryMs)
  const adaptiveDiagnosticsMap = buildResolutionDiagnosticsMap(adaptiveTrace, sampleEveryMs)
  const controllerStressVerification = runResolutionControllerStressCases(adaptiveConfig.policy)
  const provisionalSummary = {
    energyDriftPct: toPctDelta(startEnergy, endEnergy),
    circulationDriftPct: toPctDelta(startCirculation, endCirculation),
  }
  const adaptiveAcceptance = evaluateAdaptiveAcceptance({
    trace: adaptiveTrace,
    adaptiveConfig,
    durationSec,
    summary: provisionalSummary,
  })
  const summaryPayload = {
    stepMedianMs: median(stepSamples),
    stepP95Ms: p95(stepSamples),
    throughputMedianPps: median(throughputSamples),
    energyDriftPct: toPctDelta(startEnergy, endEnergy),
    enstrophyDriftPct: toPctDelta(startEnstrophy, endEnstrophy),
    circulationDriftPct: toPctDelta(startCirculation, endCirculation),
    scalePresetId: String(scaleReport.presetId ?? 'custom'),
    scaleClass: scaleReport.scaleClass ?? 'none',
    scaleApplicability: scaleReport.applicability ?? 'n/a',
    scaleApplicabilityLevel: scaleReport.applicability ?? 'n/a',
    scaleApplicabilityReasons: Array.isArray(scaleReport.applicabilityReasons)
      ? scaleReport.applicabilityReasons.join('|')
      : '',
    scaleValidationErrors: Array.isArray(scaleReport.validationErrors)
      ? scaleReport.validationErrors.join('|')
      : '',
    scaleValidationWarnings: Array.isArray(scaleReport.validationWarnings)
      ? scaleReport.validationWarnings.join('|')
      : '',
    scaleConsistencyMaxErrorPct: Number(scaleReport.consistencyErrorPct ?? 0),
    reynolds: Number(scaleReport.measured?.reynolds ?? 0),
    strouhal: Number(scaleReport.measured?.strouhal ?? 0),
    rossby: Number(scaleReport.measured?.rossby ?? 0),
    adaptiveEnabled: adaptiveConfig.enabled,
    adaptiveApplyToRuntime: adaptiveConfig.applyToRuntime,
    adaptiveDecisionCount: adaptiveSummary.decisionCount,
    adaptiveRefineCount: adaptiveSummary.refineCount,
    adaptiveCoarsenCount: adaptiveSummary.coarsenCount,
    adaptiveActuationAppliedCount: adaptiveSummary.actuationAppliedCount,
    adaptiveActuationSkippedCount: adaptiveSummary.actuationSkippedCount,
    adaptiveAcceptanceOk: adaptiveAcceptance.ok,
    adaptiveAcceptanceFailedChecks: adaptiveAcceptance.failedChecks.join('|'),
    adaptiveControllerVerificationOk: controllerStressVerification.ok,
    adaptiveControllerVerificationFailedChecks: controllerStressVerification.failedChecks.join('|'),
    adaptiveDominantLevel: adaptiveDiagnosticsMap.dominantLevel,
    adaptiveTransitionCount: adaptiveDiagnosticsMap.transitionCount,
    adaptivePathComplexity: Number(adaptiveDiagnosticsMap.pathComplexity ?? 0),
    adaptiveOccupancyL0Pct: Number(adaptiveDiagnosticsMap.occupancyPct?.L0 ?? 0),
    adaptiveOccupancyL1Pct: Number(adaptiveDiagnosticsMap.occupancyPct?.L1 ?? 0),
    adaptiveOccupancyL2Pct: Number(adaptiveDiagnosticsMap.occupancyPct?.L2 ?? 0),
    adaptiveOccupancyL3Pct: Number(adaptiveDiagnosticsMap.occupancyPct?.L3 ?? 0),
    adaptiveAverageLevelIndex: Number(adaptiveDiagnosticsMap.averageLevelIndex ?? 1),
    adaptiveTimeInL0Ms: Number(adaptiveSummary.timeInLevelsMs?.L0 ?? 0),
    adaptiveTimeInL1Ms: Number(adaptiveSummary.timeInLevelsMs?.L1 ?? 0),
    adaptiveTimeInL2Ms: Number(adaptiveSummary.timeInLevelsMs?.L2 ?? 0),
    adaptiveTimeInL3Ms: Number(adaptiveSummary.timeInLevelsMs?.L3 ?? 0),
  }
  const adaptiveBaselineScenario = evaluateAdaptiveBaselineScenario({
    summary: summaryPayload,
    hardwareClass: String(endParams.performanceHardwareClass ?? baselineParams.performanceHardwareClass ?? 'mid'),
  })
  summaryPayload.adaptiveBaselineScenarioId = adaptiveBaselineScenario.scenarioId
  summaryPayload.adaptiveBaselineOk = adaptiveBaselineScenario.ok
  summaryPayload.adaptiveBaselineFailedChecks = adaptiveBaselineScenario.failedChecks.join('|')
  return {
    runIndex,
    mode: String(endParams.executionMode ?? 'unknown'),
    scale: scaleReport,
    adaptive: {
      enabled: adaptiveConfig.enabled,
      applyToRuntime: adaptiveConfig.applyToRuntime,
      profile: adaptiveConfig.controllerProfile,
      errorBudget: adaptiveConfig.errorBudget,
      trace: adaptiveTrace,
      summary: adaptiveSummary,
      diagnosticsMap: adaptiveDiagnosticsMap,
      acceptance: adaptiveAcceptance,
      controllerStressVerification,
      baselineScenario: adaptiveBaselineScenario,
    },
    samples,
    summary: summaryPayload,
  }
}

export async function runLabExperimentInRuntime({
  experiment,
  budget = {},
  onProgress = () => {},
} = {}) {
  const validation = validateExperimentContract(experiment)
  if (!validation.valid) {
    return {
      ok: false,
      error: 'invalid_experiment_contract',
      validationErrors: validation.errors,
    }
  }
  return runExperimentBatch({
    experiment: validation.normalized,
    budget,
    onProgress,
    runSingle: async ({ experiment: validatedExperiment, runIndex }) =>
      runSingleRuntimeExperiment({
        experiment: validatedExperiment,
        runIndex,
      }),
  })
}
