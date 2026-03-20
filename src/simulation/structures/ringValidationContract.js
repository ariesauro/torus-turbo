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
  if (!naturalMode) {
    return {
      profile: 'classic',
      modifierStrength: 0,
      confidenceRelax: 0,
      ringStdRelax: 0,
      transitionRelax: 0,
      driftRelax: 1,
    }
  }
  return {
    profile: 'natural_modulated',
    modifierStrength,
    confidenceRelax: 0.08 * modifierStrength,
    ringStdRelax: 0.08 * modifierStrength,
    transitionRelax: 0.12 * modifierStrength,
    driftRelax: 1 + 0.35 * modifierStrength,
  }
}

export function buildRingValidationContract(params = {}) {
  const envelope = buildNaturalEnvelope(params)
  const ringCount = Math.max(0, Math.floor(toFinite(params.runtimeDetectedRingCount, 0)))
  const detectionConfidence = clamp01(params.runtimeDetectionConfidence ?? 0)
  const ringStdRatioMax = Math.max(0, toFinite(params.runtimeDetectionEffectiveRingRadiusStdRatioMax, 0.28))
  const transitionCommitted = Math.max(0, Math.floor(toFinite(params.runtimeTransitionCommitted, 0)))
  const transitionRejected = Math.max(0, Math.floor(toFinite(params.runtimeTransitionRejected, 0)))
  const transitionTotal = transitionCommitted + transitionRejected
  const transitionCommitRatio = transitionTotal > 0 ? transitionCommitted / transitionTotal : 1
  const gammaDriftPct = Math.abs(toFinite(params.runtimeTransitionGammaDriftPct, 0))
  const energyDriftPct = Math.abs(toFinite(params.runtimeTransitionEnergyDriftPct, 0))
  const ringPresence = clamp01(ringCount / 6)

  const gates = {
    confidence: {
      value: detectionConfidence,
      status: toVerdict(
        detectionConfidence >= 0.62 - envelope.confidenceRelax,
        detectionConfidence >= 0.5 - envelope.confidenceRelax,
      ),
      passMin: 0.62 - envelope.confidenceRelax,
      warnMin: 0.5 - envelope.confidenceRelax,
    },
    ringStdRatio: {
      value: ringStdRatioMax,
      status: toVerdict(
        ringStdRatioMax <= 0.32 + envelope.ringStdRelax,
        ringStdRatioMax <= 0.4 + envelope.ringStdRelax,
      ),
      passMax: 0.32 + envelope.ringStdRelax,
      warnMax: 0.4 + envelope.ringStdRelax,
    },
    transitionCommitRatio: {
      value: transitionCommitRatio,
      status: toVerdict(
        transitionCommitRatio >= 0.7 - envelope.transitionRelax,
        transitionCommitRatio >= 0.5 - envelope.transitionRelax,
      ),
      passMin: 0.7 - envelope.transitionRelax,
      warnMin: 0.5 - envelope.transitionRelax,
    },
    invariantDrift: {
      value: Math.max(gammaDriftPct, energyDriftPct),
      status: toVerdict(
        gammaDriftPct <= 8 * envelope.driftRelax && energyDriftPct <= 10 * envelope.driftRelax,
        gammaDriftPct <= 12 * envelope.driftRelax && energyDriftPct <= 14 * envelope.driftRelax,
      ),
      passMax: { gammaPct: 8 * envelope.driftRelax, energyPct: 10 * envelope.driftRelax },
      warnMax: { gammaPct: 12 * envelope.driftRelax, energyPct: 14 * envelope.driftRelax },
    },
  }

  const statuses = Object.values(gates).map((gate) => gate.status)
  const passCount = statuses.filter((status) => status === 'pass').length
  const warnCount = statuses.filter((status) => status === 'warn').length
  const failCount = statuses.filter((status) => status === 'fail').length
  const verdict = failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass'
  const valid = verdict !== 'fail'
  const acceptanceScore = clamp01(
    ringPresence * 0.3 +
      detectionConfidence * 0.35 +
      transitionCommitRatio * 0.2 +
      (1 - clamp01((gammaDriftPct + energyDriftPct) / 40)) * 0.15,
  )
  const externalValidationEligible = !(params.dynamicsMode === 'guidedPhysics' && envelope.modifierStrength > 1e-6)
  const externalValidationEligibilityReason = externalValidationEligible
    ? 'eligible'
    : 'natural_modifier_active'

  return {
    version: 'tt023b.ring_validation.v1',
    valid,
    verdict,
    profile: envelope.profile,
    modifierStrength: envelope.modifierStrength,
    externalValidationEligible,
    externalValidationEligibilityReason,
    acceptanceScore,
    gatePassCount: passCount,
    gateTotal: statuses.length,
    ringCount,
    transitionCommitted,
    transitionRejected,
    transitionCommitRatio,
    gates,
  }
}
