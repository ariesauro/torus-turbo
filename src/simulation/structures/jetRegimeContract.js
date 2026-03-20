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
      ringSignalRelax: 0,
      wakeRelax: 0,
      transitionRelax: 1,
    }
  }
  return {
    profile: 'natural_modulated',
    modifierStrength,
    confidenceRelax: 0.1 * modifierStrength,
    ringSignalRelax: 0.12 * modifierStrength,
    wakeRelax: 0.12 * modifierStrength,
    transitionRelax: 1 + 0.35 * modifierStrength,
  }
}

function classifyJetRegime({ reProxy, stProxy, ldProxy, ringDominance, wakeIndex }) {
  if (reProxy >= 0.62 && wakeIndex >= 0.58) return 'turbulent_wake'
  if (ringDominance >= 0.56 && stProxy >= 0.35 && stProxy <= 0.75) return 'ring_train'
  if (ldProxy <= 0.4 || stProxy >= 0.8) return 'shear_layer'
  return wakeIndex >= 0.42 ? 'interaction' : 'ring_train'
}

export function buildJetRegimeContract(params = {}) {
  const envelope = buildNaturalEnvelope(params)
  const ringCount = Math.max(0, Math.floor(toFinite(params.runtimeDetectedRingCount, 0)))
  const filamentCount = Math.max(0, Math.floor(toFinite(params.runtimeDetectedFilamentCount, 0)))
  const clusterCount = Math.max(0, Math.floor(toFinite(params.runtimeDetectedClusterCount, 0)))
  const tubeCount = Math.max(0, Math.floor(toFinite(params.runtimeDetectedTubeCount, 0)))
  const totalStructures = Math.max(1, ringCount + filamentCount + clusterCount + tubeCount)
  const detectionConfidence = clamp01(params.runtimeDetectionConfidence ?? 0)

  const jetSpeed = Math.max(0, toFinite(params.jetSpeed, 0))
  const pulseDuration = Math.max(1e-6, toFinite(params.pulseDuration, 1))
  const nozzleRadius = Math.max(1e-6, toFinite(params.coreRadiusSigma, 0.18))
  const viscosityNu = Math.max(1e-7, toFinite(params.physicalViscosityNu, 1e-4))
  const stProxy = clamp01((1 / pulseDuration) / 4.5)
  const reProxy = clamp01((jetSpeed * nozzleRadius) / (viscosityNu * 12000))
  const ldProxy = clamp01((toFinite(params.pulseInterval, 0.8) + pulseDuration) / Math.max(0.25, nozzleRadius * 4))

  const ringDominance = clamp01(ringCount / totalStructures)
  const filamentShare = clamp01(filamentCount / totalStructures)
  const clusterShare = clamp01(clusterCount / totalStructures)
  const wakeIndex = clamp01(clusterShare * 0.55 + filamentShare * 0.25 + reProxy * 0.2)
  const regime = classifyJetRegime({ reProxy, stProxy, ldProxy, ringDominance, wakeIndex })

  const gates = {
    confidence: {
      value: detectionConfidence,
      status: toVerdict(
        detectionConfidence >= 0.58 - envelope.confidenceRelax,
        detectionConfidence >= 0.45 - envelope.confidenceRelax,
      ),
      passMin: 0.58 - envelope.confidenceRelax,
      warnMin: 0.45 - envelope.confidenceRelax,
    },
    ringTrainSignal: {
      value: ringDominance,
      status: toVerdict(
        ringDominance >= 0.32 - envelope.ringSignalRelax,
        ringDominance >= 0.2 - envelope.ringSignalRelax,
      ),
      passMin: 0.32 - envelope.ringSignalRelax,
      warnMin: 0.2 - envelope.ringSignalRelax,
    },
    wakeBreakdownSignal: {
      value: wakeIndex,
      status: toVerdict(
        wakeIndex <= 0.8 + envelope.wakeRelax,
        wakeIndex <= 0.92 + envelope.wakeRelax,
      ),
      passMax: 0.8 + envelope.wakeRelax,
      warnMax: 0.92 + envelope.wakeRelax,
    },
    transitionHealth: {
      value: Math.max(
        Math.abs(toFinite(params.runtimeTransitionGammaDriftPct, 0)),
        Math.abs(toFinite(params.runtimeTransitionEnergyDriftPct, 0)),
      ),
      status: toVerdict(
        toFinite(params.runtimeTransitionGammaDriftPct, 0) <= 10 * envelope.transitionRelax &&
          toFinite(params.runtimeTransitionEnergyDriftPct, 0) <= 12 * envelope.transitionRelax,
        toFinite(params.runtimeTransitionGammaDriftPct, 0) <= 14 * envelope.transitionRelax &&
          toFinite(params.runtimeTransitionEnergyDriftPct, 0) <= 16 * envelope.transitionRelax,
      ),
      passMax: { gammaPct: 10 * envelope.transitionRelax, energyPct: 12 * envelope.transitionRelax },
      warnMax: { gammaPct: 14 * envelope.transitionRelax, energyPct: 16 * envelope.transitionRelax },
    },
  }

  const statuses = Object.values(gates).map((gate) => gate.status)
  const passCount = statuses.filter((status) => status === 'pass').length
  const warnCount = statuses.filter((status) => status === 'warn').length
  const failCount = statuses.filter((status) => status === 'fail').length
  const verdict = failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass'
  const valid = verdict !== 'fail'
  const acceptanceScore = clamp01(
    detectionConfidence * 0.35 +
      ringDominance * 0.2 +
      (1 - wakeIndex) * 0.2 +
      reProxy * 0.1 +
      stProxy * 0.05 +
      ldProxy * 0.1,
  )
  const externalValidationEligible = !(params.dynamicsMode === 'guidedPhysics' && envelope.modifierStrength > 1e-6)
  const externalValidationEligibilityReason = externalValidationEligible
    ? 'eligible'
    : 'natural_modifier_active'

  return {
    version: 'tt024b.jet_regime.v1',
    valid,
    verdict,
    profile: envelope.profile,
    modifierStrength: envelope.modifierStrength,
    externalValidationEligible,
    externalValidationEligibilityReason,
    acceptanceScore,
    regime,
    gatePassCount: passCount,
    gateTotal: statuses.length,
    proxies: {
      re: reProxy,
      st: stProxy,
      ld: ldProxy,
      ringDominance,
      wakeIndex,
    },
    gates,
  }
}
