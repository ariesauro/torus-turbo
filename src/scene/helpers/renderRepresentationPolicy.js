import { buildSheetPanelDiscretizationDiagnostics } from '../../simulation/sheets/sheetDiscretizationScaffold'
import { buildSheetCouplingContracts } from '../../simulation/sheets/sheetCouplingContracts'

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function normalizeLodTier(rawLod) {
  if (rawLod === 'far' || rawLod === 'mid') {
    return rawLod
  }
  return 'near'
}

function computeRepresentationScores(params, diagnostics, sheetDiscretization, sheetCouplingContracts) {
  const particleCount = Math.max(0, Math.floor(Number(params?.particleCount ?? 0) || 0))
  const detectedFilaments = Math.max(0, Math.floor(Number(params?.runtimeDetectedFilamentCount ?? 0) || 0))
  const detectedRings = Math.max(0, Math.floor(Number(params?.runtimeDetectedRingCount ?? 0) || 0))
  const detectedTubes = Math.max(0, Math.floor(Number(params?.runtimeDetectedTubeCount ?? 0) || 0))
  const detectedClusters = Math.max(0, Math.floor(Number(params?.runtimeDetectedClusterCount ?? 0) || 0))
  const structuresTotal = detectedFilaments + detectedRings + detectedTubes + detectedClusters
  const coherentShare = clamp01((detectedFilaments + detectedRings + detectedTubes) / Math.max(1, structuresTotal))
  const clusterShare = clamp01(detectedClusters / Math.max(1, structuresTotal))
  const detectorConfidence = clamp01(params?.runtimeDetectionConfidence ?? diagnostics.confidence)
  const gpuStepMs = Math.max(0, Number(params?.runtimeGpuStepMs ?? 0) || 0)
  const hashLoad = clamp01(params?.runtimeGpuDiagHashLoadFactor ?? 0)
  const gpuPressure = clamp01(gpuStepMs / 16)
  const particlePressure = clamp01(particleCount / 12000)
  const filamentNodeProxy = Math.max(1, detectedFilaments + detectedRings * 2 + detectedTubes * 2)
  const filamentPressure = clamp01(filamentNodeProxy / 900)
  const memoryPressure = clamp01(particlePressure * 0.7 + hashLoad * 0.3)
  const sheetBudget = clamp01(params?.performanceSheetWorkloadBudget ?? 0.35)
  const sheetPanels = Math.max(100, Math.floor(Number(params?.performanceMaxSheetPanels ?? 900) || 900))
  const sheetPanelPressure = clamp01(sheetPanels / 4000)
  const sheetReadiness = clamp01(sheetDiscretization?.readiness ?? 0)
  const sheetCoverage = clamp01(sheetDiscretization?.coverage ?? 0)
  const sheetPanelAspectP95 = Math.max(1, Number(sheetDiscretization?.panelAspectP95 ?? 1) || 1)
  const sheetAspectPenalty = clamp01((sheetPanelAspectP95 - 1) / 2.5)
  const sheetQualityPenalty = clamp01(sheetDiscretization?.qualityPenalty ?? sheetAspectPenalty)
  const sheetPatchImbalancePenalty = clamp01(
    Number(sheetDiscretization?.meshLayout?.patchPanelImbalance ?? 0) / 1.5,
  )
  const sheetMeshContractPenalty = clamp01(sheetDiscretization?.meshBuilderContract?.penalty ?? 0)
  const sheetCouplingPenalty = clamp01(sheetCouplingContracts?.penalty ?? 0)

  const morphology = {
    particles: clamp01((1 - detectorConfidence) * 0.45 + clusterShare * 0.35 + 0.2),
    filaments: clamp01(detectorConfidence * 0.55 + coherentShare * 0.45),
    sheets: clamp01(clusterShare * 0.25 + (1 - coherentShare) * 0.2 + sheetBudget * 0.2 + sheetReadiness * 0.35),
  }

  const errorEstimate = {
    particles: clamp01(diagnostics.uncertainty * 0.75 + 0.15),
    filaments: clamp01(diagnostics.uncertainty * 0.65 + 0.1),
    sheets: clamp01(diagnostics.uncertainty * 0.75 + 0.2 + (1 - sheetBudget) * 0.1 + (1 - sheetReadiness) * 0.2),
  }

  const computeCost = {
    particles: clamp01(particlePressure * 0.7 + gpuPressure * 0.3),
    filaments: clamp01(filamentPressure * 0.65 + gpuPressure * 0.35),
    sheets: clamp01(
      0.4 +
        (1 - sheetBudget) * 0.2 +
        sheetPanelPressure * 0.1 +
        gpuPressure * 0.1 +
        (1 - sheetCoverage) * 0.12 +
        sheetAspectPenalty * 0.04 +
        sheetQualityPenalty * 0.08 +
        sheetPatchImbalancePenalty * 0.04 +
        sheetMeshContractPenalty * 0.05 +
        sheetCouplingPenalty * 0.08,
    ),
  }

  const scoreByMode = {
    particles: clamp01(morphology.particles * 0.35 + (1 - errorEstimate.particles) * 0.25 + (1 - computeCost.particles) * 0.25 + (1 - memoryPressure) * 0.15),
    filaments: clamp01(morphology.filaments * 0.35 + (1 - errorEstimate.filaments) * 0.25 + (1 - computeCost.filaments) * 0.25 + (1 - memoryPressure) * 0.15),
    sheets: clamp01(morphology.sheets * 0.35 + (1 - errorEstimate.sheets) * 0.25 + (1 - computeCost.sheets) * 0.25 + (1 - memoryPressure) * 0.15),
  }

  const bestMode = Object.entries(scoreByMode).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'particles'
  return {
    scoreByMode,
    bestMode,
  }
}

function computeOverrideReason(params, health) {
  const stabilityLevel = String(params?.runtimeStabilityLevel ?? 'ok')
  const adaptiveDriftSeverity = clamp01(params?.runtimeStabilityAdaptiveDriftSeverity ?? 0)
  const adaptiveDriftStreak = Math.max(0, Math.floor(Number(params?.runtimeStabilityAdaptiveDriftStreak ?? 0) || 0))
  if (stabilityLevel === 'critical' || adaptiveDriftSeverity >= 0.85 || (health.driftSeverity >= 0.7 && adaptiveDriftStreak >= 4)) {
    return 'invariant_guard'
  }
  if (health.timeoutRate >= 0.25) {
    return 'timeout_burst'
  }
  if (health.fallbackRate >= 0.05) {
    return 'fallback_storm'
  }
  return 'none'
}

function toConfidenceAndUncertainty(params) {
  const detectorConfidence = clamp01(params?.runtimeDetectionConfidence ?? 0)
  const detectorRawConfidence = clamp01(params?.runtimeDetectionConfidenceRaw ?? detectorConfidence)
  const detectorGap = clamp01(Math.max(1 - detectorConfidence, Math.abs(detectorRawConfidence - detectorConfidence)))
  const renderFallback =
    params?.runtimeParticleRenderBackend === 'gpu' ||
    params?.runtimeParticleRenderFallbackReason === 'gpu_snapshot'
      ? 0
      : params?.runtimeParticleRenderPolicy === 'cpu_backend'
        ? 0.04
        : 0.08
  const newtoniumConfidence = clamp01(params?.runtimeNewtoniumConfidence ?? detectorConfidence)
  const transitions = Math.max(0, Number(params?.runtimeNewtoniumTransitions ?? 0) || 0)
  const transitionPressure = clamp01(transitions / 24)
  const topologyVolatility = clamp01((1 - newtoniumConfidence) * 0.7 + transitionPressure * 0.3)
  const uncertainty = clamp01(detectorGap * 0.65 + renderFallback * 0.15 + topologyVolatility * 0.2)
  return {
    confidence: detectorConfidence,
    uncertainty,
    components: {
      detectorGap,
      renderFallback,
      topologyVolatility,
    },
  }
}

export function buildRenderRepresentationPolicy(params = {}) {
  const representation =
    params?.vortexRepresentation === 'filaments' ||
    params?.vortexRepresentation === 'hybrid' ||
    params?.vortexRepresentation === 'tubes'
      ? params.vortexRepresentation
      : 'particles'
  const lodTier = normalizeLodTier(params?.runtimeAdaptiveLodTier)
  const diagnostics = toConfidenceAndUncertainty(params)
  const sheetDiscretization = buildSheetPanelDiscretizationDiagnostics(params)
  const sheetCouplingContracts = buildSheetCouplingContracts(params, sheetDiscretization)
  const { scoreByMode, bestMode } = computeRepresentationScores(
    params,
    diagnostics,
    sheetDiscretization,
    sheetCouplingContracts,
  )
  const showParticles = representation !== 'filaments'
  const showFilaments = representation === 'filaments' || representation === 'hybrid' || representation === 'tubes'
  const showTubes = representation === 'tubes'
  const detectedFilaments = Math.max(0, Math.floor(Number(params?.runtimeDetectedFilamentCount ?? 0) || 0))
  const detectedRings = Math.max(0, Math.floor(Number(params?.runtimeDetectedRingCount ?? 0) || 0))
  const detectedTubes = Math.max(0, Math.floor(Number(params?.runtimeDetectedTubeCount ?? 0) || 0))
  const detectedClusters = Math.max(0, Math.floor(Number(params?.runtimeDetectedClusterCount ?? 0) || 0))
  const detectedSheets = Math.max(0, Math.floor(Number(params?.runtimeDetectedSheetCount ?? 0) || 0))
  const structuresTotal = detectedFilaments + detectedRings + detectedTubes + detectedClusters + detectedSheets
  const sheetConfidence = clamp01(params?.runtimeDetectionClassConfidenceSheet ?? 0)
  const sheetSignal = clamp01(detectedSheets / Math.max(1, structuresTotal) * 0.6 + sheetConfidence * 0.4)
  const currentScore =
    representation === 'filaments' || representation === 'tubes'
      ? scoreByMode.filaments
      : representation === 'hybrid'
        ? Math.max(scoreByMode.particles, scoreByMode.filaments)
        : scoreByMode.particles
  const bestScore = scoreByMode[bestMode] ?? scoreByMode.particles
  const margin = Math.max(0, bestScore - currentScore)
  const holdStepsMin = Math.max(4, Math.floor(Number(params?.performanceRepresentationSwitchCooldown ?? 12) || 12))
  const stableStreak = Math.max(0, Math.floor(Number(params?.runtimeNewtoniumStableStreak ?? 0) || 0))
  const hysteresisRemaining = Math.max(0, holdStepsMin - (stableStreak % holdStepsMin))
  const circulationDriftPercent = Math.abs(Number(params?.runtimeStabilityCirculationErrorPct ?? 0) || 0)
  const energyDriftPercent = Math.abs(Number(params?.runtimeStabilityEnergyErrorPct ?? 0) || 0)
  const adaptiveDriftSeverity = clamp01(params?.runtimeStabilityAdaptiveDriftSeverity ?? 0)
  const adaptiveDriftStreak = Math.max(0, Math.floor(Number(params?.runtimeStabilityAdaptiveDriftStreak ?? 0) || 0))
  const driftSeverity = clamp01(
    adaptiveDriftSeverity * 0.6 + clamp01(circulationDriftPercent / 20) * 0.25 + clamp01(energyDriftPercent / 25) * 0.15,
  )
  const health = {
    fallbackRate: diagnostics.components.renderFallback,
    timeoutRate: clamp01((Number(params?.runtimeGpuSyncViolationCount ?? 0) || 0) / 16),
    driftSeverity: clamp01(driftSeverity + clamp01(adaptiveDriftStreak / 20) * 0.15),
  }
  const overrideReason = computeOverrideReason(params, health)
  const sheetPlaceholder =
    sheetDiscretization.readiness < 0.85 ||
    sheetDiscretization.qualityVerdict !== 'pass' ||
    sheetDiscretization.meshBuilderContract?.valid !== true ||
    sheetCouplingContracts?.valid !== true
  const showSheets = !sheetPlaceholder && (sheetSignal >= 0.18 || representation === 'hybrid')
  return {
    mode: representation,
    lodTier,
    layers: {
      particles: {
        visible: showParticles,
      },
      filaments: {
        visible: showFilaments,
      },
      sheets: {
        visible: showSheets,
        placeholder: sheetPlaceholder,
      },
      tubes: {
        visible: showTubes,
      },
    },
    diagnostics: {
      ...diagnostics,
      sheetDiscretization: {
        ...sheetDiscretization,
        couplingContracts: sheetCouplingContracts,
      },
    },
    scores: {
      particles: scoreByMode.particles,
      filaments: scoreByMode.filaments,
      sheets: scoreByMode.sheets,
      current: currentScore,
      bestMode,
      margin,
    },
    hysteresis: {
      holdStepsMin,
      remaining: hysteresisRemaining,
    },
    health,
    overrideReason,
  }
}
