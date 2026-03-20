function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function clampFinite(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return clamp(n, min, max)
}

function classifyNewtoniumType(detections) {
  const ringCount = detections?.ringCount ?? 0
  const tubeCount = detections?.tubeCount ?? 0
  const filamentCount = detections?.filamentCount ?? 0
  const clusterCount = detections?.clusterCount ?? 0

  if (tubeCount > 0) {
    return 'vortex_tube'
  }
  if (ringCount > 0) {
    return 'vortex_ring'
  }
  if (filamentCount >= Math.max(2, Math.floor(clusterCount * 0.6))) {
    return 'vortex_jet'
  }
  if (clusterCount > 0) {
    return 'vortex_cluster'
  }
  return 'none'
}

function computeTypeConfidence(type, detections) {
  const confidenceBase = detections?.confidence ?? 0
  const ringCount = detections?.ringCount ?? 0
  const tubeCount = detections?.tubeCount ?? 0
  const filamentCount = detections?.filamentCount ?? 0
  const clusterCount = detections?.clusterCount ?? 0
  if (type === 'vortex_tube') {
    return clamp(confidenceBase * 0.65 + Math.min(1, tubeCount / 6) * 0.35, 0, 1)
  }
  if (type === 'vortex_ring') {
    return clamp(confidenceBase * 0.65 + Math.min(1, ringCount / 8) * 0.35, 0, 1)
  }
  if (type === 'vortex_jet') {
    return clamp(confidenceBase * 0.6 + Math.min(1, filamentCount / Math.max(clusterCount, 1)) * 0.4, 0, 1)
  }
  if (type === 'vortex_cluster') {
    return clamp(confidenceBase * 0.5 + Math.min(1, clusterCount / 12) * 0.5, 0, 1)
  }
  return 0
}

function computeTransitionInvariantDrifts(params = {}) {
  const gammaDriftPct = Math.abs(clampFinite(params.runtimeStabilityCirculationErrorPct, 0, 1e6, 0))
  const energyDriftPct = Math.abs(clampFinite(params.runtimeStabilityEnergyErrorPct, 0, 1e6, 0))
  const impulseDriftPct = Math.abs(clampFinite(params.runtimeStabilityVelocityDivergence, 0, 1e9, 0) * 100)
  return {
    gammaDriftPct,
    impulseDriftPct,
    energyDriftPct,
  }
}

function evaluateTransitionGates({
  nextType,
  confidence,
  pendingFrames,
  drifts,
  params,
}) {
  const enterFrames = Math.max(
    1,
    Math.floor(clampFinite(params?.newtoniumTransitionEnterFrames, 1, 120, 3)),
  )
  const confidenceEnterMin = clampFinite(params?.newtoniumTransitionConfidenceEnterMin, 0, 1, 0.56)
  const confidenceExitMin = clampFinite(params?.newtoniumTransitionConfidenceExitMin, 0, 1, 0.44)
  const gammaDriftMax = clampFinite(params?.newtoniumTransitionGammaDriftMaxPct, 0, 200, 8)
  const impulseDriftMax = clampFinite(params?.newtoniumTransitionImpulseDriftMaxPct, 0, 200, 12)
  const energyDriftMax = clampFinite(params?.newtoniumTransitionEnergyDriftMaxPct, 0, 200, 10)
  const confidenceGateOk =
    nextType === 'none'
      ? confidence >= confidenceExitMin
      : pendingFrames >= enterFrames
        ? confidence >= confidenceEnterMin
        : confidence >= confidenceExitMin
  const invariantGateOk =
    drifts.gammaDriftPct <= gammaDriftMax &&
    drifts.impulseDriftPct <= impulseDriftMax &&
    drifts.energyDriftPct <= energyDriftMax
  const hysteresisGateOk = pendingFrames >= enterFrames
  let reason = 'ok'
  if (!confidenceGateOk) reason = 'confidence_gate'
  else if (!invariantGateOk) reason = 'invariant_gate'
  else if (!hysteresisGateOk) reason = 'hysteresis_hold'
  return {
    enterFrames,
    confidenceEnterMin,
    confidenceExitMin,
    gammaDriftMax,
    impulseDriftMax,
    energyDriftMax,
    confidenceGateOk,
    invariantGateOk,
    hysteresisGateOk,
    reason,
  }
}

export function createNewtoniumTrackingState() {
  return {
    frameSerial: 0,
    currentType: 'none',
    stableStreak: 0,
    transitions: 0,
    lastConfidence: 0,
    confidenceEma: 0,
    history: [],
    maxHistory: 120,
    transitionState: 'idle',
    transitionCandidateType: 'none',
    transitionPendingFrames: 0,
    transitionCandidates: 0,
    transitionCommitted: 0,
    transitionRejected: 0,
    transitionGammaDriftPct: 0,
    transitionImpulseDriftPct: 0,
    transitionEnergyDriftPct: 0,
    transitionGateConfidenceOk: true,
    transitionGateInvariantOk: true,
    transitionGateHysteresisOk: false,
    transitionGateReason: 'none',
    transitionEnterFrames: 3,
    transitionConfidenceEnterMin: 0.56,
    transitionConfidenceExitMin: 0.44,
  }
}

export function updateNewtoniumTrackingState(
  trackingState,
  detections,
  params = {},
) {
  const state = trackingState ?? createNewtoniumTrackingState()
  const nextType = classifyNewtoniumType(detections)
  const typeConfidence = computeTypeConfidence(nextType, detections)
  const alpha = clamp(params?.newtoniumTrackingEmaAlpha ?? 0.2, 0.05, 0.8)
  state.confidenceEma =
    state.frameSerial > 0
      ? state.confidenceEma + (typeConfidence - state.confidenceEma) * alpha
      : typeConfidence

  const drifts = computeTransitionInvariantDrifts(params)
  state.transitionGammaDriftPct = drifts.gammaDriftPct
  state.transitionImpulseDriftPct = drifts.impulseDriftPct
  state.transitionEnergyDriftPct = drifts.energyDriftPct

  if (nextType === state.currentType) {
    state.stableStreak += 1
    state.transitionState = 'idle'
    state.transitionCandidateType = 'none'
    state.transitionPendingFrames = 0
    state.transitionGateConfidenceOk = true
    state.transitionGateInvariantOk = true
    state.transitionGateHysteresisOk = false
    state.transitionGateReason = 'none'
  } else {
    if (state.transitionCandidateType !== nextType) {
      state.transitionCandidateType = nextType
      state.transitionPendingFrames = 1
      state.transitionCandidates += 1
      state.transitionState = 'candidate'
    } else {
      state.transitionPendingFrames += 1
      state.transitionState = 'pending_confirm'
    }
    const gates = evaluateTransitionGates({
      nextType,
      confidence: state.confidenceEma,
      pendingFrames: state.transitionPendingFrames,
      drifts,
      params,
    })
    state.transitionEnterFrames = gates.enterFrames
    state.transitionConfidenceEnterMin = gates.confidenceEnterMin
    state.transitionConfidenceExitMin = gates.confidenceExitMin
    state.transitionGateConfidenceOk = gates.confidenceGateOk
    state.transitionGateInvariantOk = gates.invariantGateOk
    state.transitionGateHysteresisOk = gates.hysteresisGateOk
    state.transitionGateReason = gates.reason
    if (gates.confidenceGateOk && gates.invariantGateOk && gates.hysteresisGateOk) {
      if (state.currentType !== 'none') {
        state.transitions += 1
      }
      state.currentType = nextType
      state.stableStreak = 1
      state.transitionCommitted += 1
      state.transitionState = 'committed'
      state.transitionCandidateType = 'none'
      state.transitionPendingFrames = 0
      state.transitionGateReason = 'ok'
    } else if (!gates.confidenceGateOk || !gates.invariantGateOk) {
      state.transitionRejected += 1
      state.transitionState = 'rejected'
      state.transitionCandidateType = 'none'
      state.transitionPendingFrames = 0
    }
  }
  state.lastConfidence = typeConfidence
  state.frameSerial += 1
  state.history.push({
    frame: state.frameSerial,
    type: state.currentType,
    confidence: state.lastConfidence,
    transitionState: state.transitionState,
    transitionCandidateType: state.transitionCandidateType,
    transitionPendingFrames: state.transitionPendingFrames,
    transitionGateReason: state.transitionGateReason,
  })
  if (state.history.length > state.maxHistory) {
    state.history.splice(0, state.history.length - state.maxHistory)
  }

  return {
    type: state.currentType,
    confidenceRaw: state.lastConfidence,
    confidence: state.confidenceEma,
    stableStreak: state.stableStreak,
    transitions: state.transitions,
    frameSerial: state.frameSerial,
    transitionState: state.transitionState,
    transitionCandidateType: state.transitionCandidateType,
    transitionPendingFrames: state.transitionPendingFrames,
    transitionCandidates: state.transitionCandidates,
    transitionCommitted: state.transitionCommitted,
    transitionRejected: state.transitionRejected,
    transitionGammaDriftPct: state.transitionGammaDriftPct,
    transitionImpulseDriftPct: state.transitionImpulseDriftPct,
    transitionEnergyDriftPct: state.transitionEnergyDriftPct,
    transitionGateConfidenceOk: state.transitionGateConfidenceOk,
    transitionGateInvariantOk: state.transitionGateInvariantOk,
    transitionGateHysteresisOk: state.transitionGateHysteresisOk,
    transitionGateReason: state.transitionGateReason,
    transitionEnterFrames: state.transitionEnterFrames,
    transitionConfidenceEnterMin: state.transitionConfidenceEnterMin,
    transitionConfidenceExitMin: state.transitionConfidenceExitMin,
  }
}
