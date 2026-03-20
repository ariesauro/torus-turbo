function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function toFinite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toVerdict(pass, warn) {
  if (pass) return 'pass'
  if (warn) return 'warn'
  return 'fail'
}

function buildNaturalEnvelope(params = {}) {
  const guidedStrength = clamp01(params.guidedStrength ?? 0)
  const alphaNorm = clamp01(Math.abs(toFinite(params.alpha, 0)) / 90)
  const modifierStrength = clamp01(guidedStrength * 0.65 + alphaNorm * 0.35)
  const naturalMode = params.dynamicsMode === 'guidedPhysics'
  return {
    profile: naturalMode ? 'natural_modulated' : 'classic',
    modifierStrength: naturalMode ? modifierStrength : 0,
  }
}

export function buildStructureDetectionFusionContract(params = {}) {
  const envelope = buildNaturalEnvelope(params)
  const filamentCount = Math.max(0, Math.floor(toFinite(params.runtimeDetectedFilamentCount, 0)))
  const ringCount = Math.max(0, Math.floor(toFinite(params.runtimeDetectedRingCount, 0)))
  const tubeCount = Math.max(0, Math.floor(toFinite(params.runtimeDetectedTubeCount, 0)))
  const sheetCount = Math.max(0, Math.floor(toFinite(params.runtimeDetectedSheetCount, 0)))
  const clusterCount = Math.max(0, Math.floor(toFinite(params.runtimeDetectedClusterCount, 0)))
  const total = Math.max(1, filamentCount + ringCount + tubeCount + sheetCount + clusterCount)
  const confidence = clamp01(params.runtimeDetectionConfidence ?? 0)

  const classConfidences = {
    filament: clamp01(params.runtimeDetectionClassConfidenceFilament ?? 0),
    ring: clamp01(params.runtimeDetectionClassConfidenceRing ?? 0),
    tube: clamp01(params.runtimeDetectionClassConfidenceTube ?? 0),
    sheet: clamp01(params.runtimeDetectionClassConfidenceSheet ?? 0),
  }
  const sheetFeatures = {
    surfaceCoherence: clamp01(params.runtimeDetectionSheetSurfaceCoherence ?? 0),
    curvatureAnisotropy: clamp01(params.runtimeDetectionSheetCurvatureAnisotropy ?? 0),
  }
  const shares = {
    filament: clamp01(filamentCount / total),
    ring: clamp01(ringCount / total),
    tube: clamp01(tubeCount / total),
    sheet: clamp01(sheetCount / total),
  }
  const weightedFusionScore = clamp01(
    classConfidences.filament * shares.filament * 0.85 +
      classConfidences.ring * shares.ring +
      classConfidences.tube * shares.tube * 0.95 +
      classConfidences.sheet * shares.sheet * 1.05,
  )

  const gates = {
    globalConfidence: {
      value: confidence,
      status: toVerdict(confidence >= 0.58, confidence >= 0.45),
      passMin: 0.58,
      warnMin: 0.45,
    },
    classCoverage: {
      value: clamp01((filamentCount > 0) + (ringCount > 0) + (tubeCount > 0) + (sheetCount > 0)) / 4,
      status: toVerdict(
        (filamentCount > 0 && ringCount > 0 && (tubeCount > 0 || sheetCount > 0)) === true,
        (filamentCount > 0 || ringCount > 0 || tubeCount > 0 || sheetCount > 0) === true,
      ),
      pass: '>= 3 classes active incl. filament/ring',
      warn: '>= 1 class active',
    },
    sheetSurfaceCoherence: {
      value: sheetFeatures.surfaceCoherence,
      status: toVerdict(sheetFeatures.surfaceCoherence >= 0.5, sheetFeatures.surfaceCoherence >= 0.34),
      passMin: 0.5,
      warnMin: 0.34,
    },
    sheetCurvatureAnisotropy: {
      value: sheetFeatures.curvatureAnisotropy,
      status: toVerdict(sheetFeatures.curvatureAnisotropy <= 0.55, sheetFeatures.curvatureAnisotropy <= 0.72),
      passMax: 0.55,
      warnMax: 0.72,
    },
    fusionScore: {
      value: weightedFusionScore,
      status: toVerdict(weightedFusionScore >= 0.24, weightedFusionScore >= 0.14),
      passMin: 0.24,
      warnMin: 0.14,
    },
  }

  const statuses = Object.values(gates).map((gate) => gate.status)
  const passCount = statuses.filter((status) => status === 'pass').length
  const warnCount = statuses.filter((status) => status === 'warn').length
  const failCount = statuses.filter((status) => status === 'fail').length
  const verdict = failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass'
  const valid = verdict !== 'fail'
  const acceptanceScore = clamp01(
    confidence * 0.35 +
      weightedFusionScore * 0.35 +
      sheetFeatures.surfaceCoherence * 0.2 +
      (1 - sheetFeatures.curvatureAnisotropy) * 0.1,
  )
  const externalValidationEligible = !(params.dynamicsMode === 'guidedPhysics' && envelope.modifierStrength > 1e-6)
  const externalValidationEligibilityReason = externalValidationEligible
    ? 'eligible'
    : 'natural_modifier_active'

  return {
    version: 'tt025b.detector_fusion.v1',
    valid,
    verdict,
    profile: envelope.profile,
    modifierStrength: envelope.modifierStrength,
    externalValidationEligible,
    externalValidationEligibilityReason,
    acceptanceScore,
    gatePassCount: passCount,
    gateTotal: statuses.length,
    classConfidences,
    classShares: shares,
    sheetFeatures,
    weightedFusionScore,
    gates,
  }
}
