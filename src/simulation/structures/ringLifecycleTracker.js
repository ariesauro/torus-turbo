const LIFECYCLE_STATES = ['absent', 'forming', 'stable', 'deforming', 'breakdown']

function clamp01(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function saffmanRingSpeed(gamma, R, sigma) {
  const G = Math.abs(gamma)
  const r = Math.max(1e-6, R)
  const s = Math.max(1e-6, sigma)
  const ratio = r / s
  if (ratio < 1.01) return 0
  return (G / (4 * Math.PI * r)) * (Math.log(8 * ratio) - 0.25)
}

export function createRingLifecycleState() {
  return {
    state: 'absent',
    stateFrames: 0,
    stateSerial: 0,
    history: [],
    saffmanSpeedRef: 0,
    measuredSpeed: 0,
    speedErrorPct: 0,
  }
}

export function updateRingLifecycle(lifecycle, detection, validation, ringParams = {}) {
  const prev = lifecycle ?? createRingLifecycleState()
  const ringCount = Math.max(0, detection?.ringCount ?? 0)
  const confidence = clamp01(detection?.confidence ?? 0)
  const circulationClosure = clamp01(detection?.classConfidenceRing ?? 0)
  const validationValid = validation?.valid !== false
  const acceptanceScore = clamp01(validation?.acceptanceScore ?? 0)
  const driftMax = Math.max(
    Math.abs(validation?.gates?.invariantDrift?.value ?? 0),
    Math.abs(validation?.gates?.confidence?.value ?? 0) < 0.4 ? 50 : 0,
  )

  const gamma = Number(ringParams.gamma ?? 5) || 5
  const ringRadius = Number(ringParams.nozzleRadius ?? 0.5) || 0.5
  const coreRadius = Number(ringParams.coreRadiusSigma ?? 0.2) || 0.2
  const saffmanSpeed = saffmanRingSpeed(gamma, ringRadius, coreRadius)

  let nextState = prev.state
  const transition = (to) => {
    if (to !== prev.state) {
      nextState = to
    }
  }

  if (prev.state === 'absent') {
    if (ringCount >= 1 && confidence >= 0.35) transition('forming')
  } else if (prev.state === 'forming') {
    if (ringCount === 0 && prev.stateFrames > 10) transition('absent')
    else if (confidence >= 0.55 && acceptanceScore >= 0.4 && prev.stateFrames >= 5) transition('stable')
  } else if (prev.state === 'stable') {
    if (ringCount === 0 && prev.stateFrames > 5) transition('breakdown')
    else if (!validationValid && driftMax > 20) transition('deforming')
    else if (confidence < 0.35 && prev.stateFrames > 8) transition('deforming')
  } else if (prev.state === 'deforming') {
    if (confidence >= 0.55 && validationValid) transition('stable')
    else if (ringCount === 0 && prev.stateFrames > 10) transition('breakdown')
    else if (driftMax > 50 && prev.stateFrames > 5) transition('breakdown')
  } else if (prev.state === 'breakdown') {
    if (ringCount >= 1 && confidence >= 0.4 && prev.stateFrames > 8) transition('forming')
    else if (ringCount === 0 && prev.stateFrames > 30) transition('absent')
  }

  const changed = nextState !== prev.state
  const stateSerial = changed ? prev.stateSerial + 1 : prev.stateSerial
  const history = changed
    ? [...prev.history.slice(-19), { from: prev.state, to: nextState, serial: stateSerial }]
    : prev.history

  return {
    state: nextState,
    stateFrames: changed ? 0 : prev.stateFrames + 1,
    stateSerial,
    history,
    saffmanSpeedRef: saffmanSpeed,
    measuredSpeed: Number(ringParams.measuredRingSpeed ?? 0),
    speedErrorPct: saffmanSpeed > 1e-6
      ? Math.abs((Number(ringParams.measuredRingSpeed ?? 0) - saffmanSpeed) / saffmanSpeed) * 100
      : 0,
  }
}
