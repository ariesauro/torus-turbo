const RESOLUTION_LEVELS = ['L0', 'L1', 'L2', 'L3']

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

export function normalizeResolutionControllerPolicy(policy = {}) {
  const source = policy && typeof policy === 'object' ? policy : {}
  const weights = source.weights && typeof source.weights === 'object' ? source.weights : {}
  const thresholds = source.thresholds && typeof source.thresholds === 'object' ? source.thresholds : {}
  return {
    dwellMs: Math.max(0, Math.floor(toFinite(source.dwellMs, 1500))),
    cooldownMs: Math.max(0, Math.floor(toFinite(source.cooldownMs, 700))),
    hysteresisUp: clamp01(toFinite(source.hysteresisUp, 0.08)),
    hysteresisDown: clamp01(toFinite(source.hysteresisDown, 0.12)),
    maxLevelDeltaPerDecision: Math.max(1, Math.floor(toFinite(source.maxLevelDeltaPerDecision, 1))),
    weights: {
      vorticity: clamp01(toFinite(weights.vorticity, 0.38)),
      curvature: clamp01(toFinite(weights.curvature, 0.22)),
      reconnection: clamp01(toFinite(weights.reconnection, 0.2)),
      uncertainty: clamp01(toFinite(weights.uncertainty, 0.12)),
      stabilityWarnings: clamp01(toFinite(weights.stabilityWarnings, 0.08)),
    },
    thresholds: {
      l0: clamp01(toFinite(thresholds.l0, 0.2)),
      l1: clamp01(toFinite(thresholds.l1, 0.45)),
      l2: clamp01(toFinite(thresholds.l2, 0.7)),
    },
  }
}

export function createResolutionControllerState(initial = {}) {
  const source = initial && typeof initial === 'object' ? initial : {}
  const level = RESOLUTION_LEVELS.includes(source.level) ? source.level : 'L1'
  return {
    level,
    lastSwitchMs: Math.max(0, Math.floor(toFinite(source.lastSwitchMs, 0))),
    lastDecisionMs: Math.max(0, Math.floor(toFinite(source.lastDecisionMs, 0))),
    lastScore: clamp01(toFinite(source.lastScore, 0)),
    decisionSerial: Math.max(0, Math.floor(toFinite(source.decisionSerial, 0))),
  }
}

export function computeResolutionStressScore(signals = {}, policy = {}) {
  const normalizedPolicy = normalizeResolutionControllerPolicy(policy)
  const s = signals && typeof signals === 'object' ? signals : {}
  const score =
    clamp01(toFinite(s.vorticity, 0)) * normalizedPolicy.weights.vorticity +
    clamp01(toFinite(s.curvature, 0)) * normalizedPolicy.weights.curvature +
    clamp01(toFinite(s.reconnection, 0)) * normalizedPolicy.weights.reconnection +
    clamp01(toFinite(s.uncertainty, 0)) * normalizedPolicy.weights.uncertainty +
    clamp01(toFinite(s.stabilityWarnings, 0)) * normalizedPolicy.weights.stabilityWarnings
  return clamp01(score)
}

function levelIndex(level) {
  return Math.max(0, RESOLUTION_LEVELS.indexOf(level))
}

function targetLevelFromScore(score, thresholds) {
  if (score < thresholds.l0) return 'L0'
  if (score < thresholds.l1) return 'L1'
  if (score < thresholds.l2) return 'L2'
  return 'L3'
}

function levelPatch(level) {
  if (level === 'L0') {
    return { particleBudgetScale: 0.8, filamentRefineBias: -0.2, filamentCoarsenBias: 0.3 }
  }
  if (level === 'L1') {
    return { particleBudgetScale: 1.0, filamentRefineBias: 0.0, filamentCoarsenBias: 0.0 }
  }
  if (level === 'L2') {
    return { particleBudgetScale: 1.2, filamentRefineBias: 0.25, filamentCoarsenBias: -0.05 }
  }
  return { particleBudgetScale: 1.35, filamentRefineBias: 0.45, filamentCoarsenBias: -0.2 }
}

export function evaluateResolutionDecision({
  signals = {},
  controllerState = {},
  policy = {},
  nowMs = 0,
} = {}) {
  const normalizedPolicy = normalizeResolutionControllerPolicy(policy)
  const prev = createResolutionControllerState(controllerState)
  const now = Math.max(0, Math.floor(toFinite(nowMs, 0)))
  const score = computeResolutionStressScore(signals, normalizedPolicy)
  const targetLevel = targetLevelFromScore(score, normalizedPolicy.thresholds)

  let nextLevel = prev.level
  const prevIdx = levelIndex(prev.level)
  const targetIdx = levelIndex(targetLevel)
  const deltaIdx = targetIdx - prevIdx
  const absDelta = Math.abs(deltaIdx)
  const elapsedSinceSwitch = now - prev.lastSwitchMs
  const elapsedSinceDecision = now - prev.lastDecisionMs
  const reasons = []

  if (elapsedSinceSwitch < normalizedPolicy.dwellMs) {
    reasons.push('dwell_guard_active')
  } else if (elapsedSinceDecision < normalizedPolicy.cooldownMs) {
    reasons.push('cooldown_guard_active')
  } else if (deltaIdx > 0 && score < clamp01(prev.lastScore + normalizedPolicy.hysteresisUp)) {
    reasons.push('hysteresis_up_hold')
  } else if (deltaIdx < 0 && score > clamp01(prev.lastScore - normalizedPolicy.hysteresisDown)) {
    reasons.push('hysteresis_down_hold')
  } else if (absDelta > 0) {
    const boundedDelta = Math.min(absDelta, normalizedPolicy.maxLevelDeltaPerDecision)
    nextLevel = RESOLUTION_LEVELS[prevIdx + Math.sign(deltaIdx) * boundedDelta]
    reasons.push(deltaIdx > 0 ? 'stress_refine' : 'stress_coarsen')
  } else {
    reasons.push('level_steady')
  }

  const changed = nextLevel !== prev.level
  const next = {
    level: nextLevel,
    lastSwitchMs: changed ? now : prev.lastSwitchMs,
    lastDecisionMs: now,
    lastScore: score,
    decisionSerial: prev.decisionSerial + 1,
  }

  return {
    state: next,
    decision: {
      serial: next.decisionSerial,
      changed,
      previousLevel: prev.level,
      nextLevel,
      targetLevel,
      score,
      reasons,
      patch: levelPatch(nextLevel),
    },
  }
}

export function runResolutionControllerStressCases(policy = {}) {
  const checks = []

  // Case 1: sustained low stress should not refine aggressively.
  {
    let state = createResolutionControllerState({ level: 'L1', lastSwitchMs: 0, lastDecisionMs: 0 })
    let changedCount = 0
    for (let i = 1; i <= 10; i += 1) {
      const out = evaluateResolutionDecision({
        signals: { vorticity: 0.1, curvature: 0.1, reconnection: 0, uncertainty: 0.1, stabilityWarnings: 0 },
        controllerState: state,
        policy,
        nowMs: i * 300,
      })
      state = out.state
      if (out.decision.changed) changedCount += 1
    }
    checks.push({
      id: 'low_stress_stability',
      ok: changedCount <= 2,
      value: changedCount,
      threshold: '<=2',
    })
  }

  // Case 2: sustained high stress should eventually refine.
  {
    let state = createResolutionControllerState({ level: 'L0', lastSwitchMs: 0, lastDecisionMs: 0 })
    let maxLevel = 'L0'
    for (let i = 1; i <= 14; i += 1) {
      const out = evaluateResolutionDecision({
        signals: { vorticity: 1, curvature: 0.9, reconnection: 0.7, uncertainty: 0.6, stabilityWarnings: 0.9 },
        controllerState: state,
        policy,
        nowMs: i * 350,
      })
      state = out.state
      if (out.state.level > maxLevel) maxLevel = out.state.level
    }
    checks.push({
      id: 'high_stress_refine',
      ok: maxLevel >= 'L2',
      value: maxLevel,
      threshold: '>=L2',
    })
  }

  // Case 3: oscillating stress should not flip every step.
  {
    let state = createResolutionControllerState({ level: 'L1', lastSwitchMs: 0, lastDecisionMs: 0 })
    let flips = 0
    for (let i = 1; i <= 16; i += 1) {
      const high = i % 2 === 0
      const out = evaluateResolutionDecision({
        signals: high
          ? { vorticity: 0.9, curvature: 0.8, reconnection: 0.5, uncertainty: 0.5, stabilityWarnings: 0.8 }
          : { vorticity: 0.2, curvature: 0.15, reconnection: 0.1, uncertainty: 0.2, stabilityWarnings: 0.1 },
        controllerState: state,
        policy,
        nowMs: i * 250,
      })
      if (out.decision.changed) flips += 1
      state = out.state
    }
    checks.push({
      id: 'oscillation_guard',
      ok: flips <= 8,
      value: flips,
      threshold: '<=8',
    })
  }

  const failed = checks.filter((item) => item.ok !== true).map((item) => item.id)
  return {
    ok: failed.length === 0,
    checks,
    failedChecks: failed,
  }
}
