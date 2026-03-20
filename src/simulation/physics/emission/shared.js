const GAUSSIAN_SIGMA = 0.18
const FORMATION_NUMBER_LIMIT = 4

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

function length(vector) {
  return Math.hypot(vector.x, vector.y, vector.z)
}

function normalize(vector, fallback = { x: 0, y: 0, z: 1 }) {
  const vectorLength = length(vector)

  if (vectorLength <= 1e-8) {
    return { ...fallback }
  }

  return {
    x: vector.x / vectorLength,
    y: vector.y / vectorLength,
    z: vector.z / vectorLength,
  }
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export function getNozzle(params) {
  return {
    radius: Math.max(params?.nozzle?.radius ?? params?.nozzleRadius ?? 0.01, 0.01),
    position: {
      x: params?.nozzle?.position?.x ?? 0,
      y: params?.nozzle?.position?.y ?? 0,
      z: params?.nozzle?.position?.z ?? params?.nozzleZ ?? params?.nozzleX ?? 0,
    },
    direction: normalize(params?.nozzle?.direction ?? { x: 0, y: 0, z: 1 }),
  }
}

export function getNozzleBasis(nozzle) {
  const direction = normalize(nozzle.direction)
  const reference =
    Math.abs(direction.z) < 0.95 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 }
  const tangent = normalize(cross(direction, reference), { x: 1, y: 0, z: 0 })
  const bitangent = normalize(cross(direction, tangent), { x: 0, y: 1, z: 0 })

  return {
    tangent,
    bitangent,
    direction,
  }
}

export function getFormationNumber(params, jetVelocity = params?.jetSpeed ?? 0) {
  const nozzle = getNozzle(params)
  const diameter = Math.max(nozzle.radius * 2, 1e-4)
  const slugLength = Math.max(jetVelocity, 0) * Math.max(params?.pulseDuration ?? 0, 0)
  return slugLength / diameter
}

export function getPulseShapeSignal(pulseShape, phase) {
  const safePhase = clamp01(phase)

  if (pulseShape === 'sin') {
    return Math.max(0, Math.sin(safePhase * Math.PI))
  }

  if (pulseShape === 'gaussian') {
    const centered = (safePhase - 0.5) / GAUSSIAN_SIGMA
    return Math.exp(-0.5 * centered * centered)
  }

  return 1
}

function getActiveSignal(params, pulseState, dt) {
  const safeDuration = Math.max(params.pulseDuration ?? 0, 0)
  const safeFrequency = Math.max(params.frequency ?? 0, 0)
  const pulseShape = params.pulseShape ?? 'rectangular'

  if (pulseState.mode === 'single') {
    pulseState.singleElapsed += dt
    if (safeDuration <= 0 || pulseState.singleElapsed >= safeDuration) {
      pulseState.mode = 'off'
      return 0
    }

    return getPulseShapeSignal(pulseShape, pulseState.singleElapsed / safeDuration)
  }

  if (pulseState.mode === 'train') {
    if (safeFrequency <= 0 || safeDuration <= 0) {
      return 0
    }

    pulseState.time += dt
    const phase = (pulseState.time * safeFrequency) % 1
    const duty = clamp01(safeDuration * safeFrequency)

    if (duty <= 0 || phase >= duty) {
      return 0
    }

    return getPulseShapeSignal(pulseShape, phase / Math.max(duty, 1e-4))
  }

  return 0
}

export function advancePulse(params, pulseState, dt) {
  const signal = getActiveSignal(params, pulseState, dt)
  const jetVelocity = Math.max(params.jetSpeed ?? 0, 0) * signal
  const isActive = signal > 0

  if (isActive && !pulseState.pulseActive) {
    pulseState.pulseTimer = 0
    pulseState.emittedSlugLength = 0
    pulseState.trailingJetActive = false
  }

  pulseState.pulseActive = isActive

  if (!isActive) {
    pulseState.pulseTimer = 0
    pulseState.emittedSlugLength = 0
    pulseState.trailingJetActive = false
    return {
      signal: 0,
      jetVelocity: 0,
      formationNumber: getFormationNumber(params),
      slugFormationNumber: 0,
    }
  }

  pulseState.pulseTimer += dt
  pulseState.emittedSlugLength += jetVelocity * dt
  pulseState.trailingJetActive =
    pulseState.emittedSlugLength / Math.max(getNozzle(params).radius * 2, 1e-4) > FORMATION_NUMBER_LIMIT

  return {
    signal,
    jetVelocity,
    formationNumber: getFormationNumber(params),
    slugFormationNumber:
      pulseState.emittedSlugLength / Math.max(getNozzle(params).radius * 2, 1e-4),
  }
}

export function shouldEmitTrailingJet(pulseState) {
  return Boolean(pulseState.trailingJetActive)
}

export function getFormationNumberLimit() {
  return FORMATION_NUMBER_LIMIT
}
