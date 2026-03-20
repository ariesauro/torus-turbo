import { createParticle } from '../physics/spawnParticle'
import { getNozzle, getNozzleBasis } from '../physics/emission/shared'

const FORMATION_NUMBER_LIMIT = 4

function clamp(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function normalize(vector, fallback = { x: 0, y: 0, z: 1 }) {
  const x = Number(vector?.x ?? fallback.x) || fallback.x
  const y = Number(vector?.y ?? fallback.y) || fallback.y
  const z = Number(vector?.z ?? fallback.z) || fallback.z
  const length = Math.hypot(x, y, z)
  if (length <= 1e-8) {
    return { ...fallback }
  }
  return { x: x / length, y: y / length, z: z / length }
}

function add(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  }
}

function scale(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  }
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function randomSigned(random) {
  return random() * 2 - 1
}

function randomUnitVector(random) {
  const x = randomSigned(random)
  const y = randomSigned(random)
  const z = randomSigned(random)
  return normalize({ x, y, z }, { x: 0, y: 0, z: 1 })
}

function resolvePulseGate(params, pulseState, dt) {
  const pulseDuration = Math.max(Number(params?.pulseDuration ?? 0.05) || 0.05, 1e-4)
  const pulseInterval = Math.max(Number(params?.jetRollupPulseInterval ?? 0.25) || 0, 0)
  const cycle = pulseDuration + pulseInterval

  pulseState.jetRollupClock = (Number(pulseState.jetRollupClock ?? 0) || 0) + Math.max(dt, 0)
  const phase = cycle > 1e-8 ? pulseState.jetRollupClock % cycle : 0
  const isOpen = cycle <= 1e-8 ? true : phase < pulseDuration

  return {
    pulseDuration,
    pulseInterval,
    cycle,
    phase,
    isOpen,
  }
}

function resolvePulseSignal(pulseState, upstreamSignal, gate, pulseStrength) {
  const mode = String(pulseState?.mode ?? 'off')
  if (mode === 'off') {
    return 0
  }
  if (mode === 'single') {
    // Single pulse duration is managed by shared pulse state.
    // Gate still applies but no train-frequency attenuation should be added.
    return gate.isOpen ? Math.max(upstreamSignal, 0) * pulseStrength : 0
  }
  if (mode === 'train') {
    // For roll-up train, duty is controlled by (pulseDuration + pulseInterval).
    // Ignore waveform/frequency attenuation from upstream signal.
    return gate.isOpen ? pulseStrength : 0
  }
  return gate.isOpen ? Math.max(upstreamSignal, 0) * pulseStrength : 0
}

function resolveEmissionBudget(params, signal, remainingCapacity, velocity, nozzleRadius) {
  const pulseDuration = Math.max(Number(params?.pulseDuration ?? 0.05) || 0.05, 1e-4)
  const slugLength = Math.max(velocity, 0) * pulseDuration
  const configuredStrokeLength = Math.max(Number(params?.jetRollupStrokeLength ?? 0) || 0, 0)
  const effectiveStrokeLength =
    configuredStrokeLength > 1e-8 ? Math.min(configuredStrokeLength, slugLength) : slugLength
  const diameter = Math.max(nozzleRadius * 2, 1e-4)
  const formationNumber = effectiveStrokeLength / diameter
  const formationScale =
    formationNumber > FORMATION_NUMBER_LIMIT
      ? Math.max(0.2, FORMATION_NUMBER_LIMIT / Math.max(formationNumber, 1e-6))
      : 1

  const requested = Math.max(0, Math.floor((Number(params?.spawnRate ?? 0) || 0) * signal))
  const spawnBudget = Math.min(remainingCapacity, Math.max(0, Math.floor(requested * formationScale)))

  return {
    spawnBudget,
    formationNumber,
    formationScale,
  }
}

export function emitJetRollupParticles({
  particles,
  params,
  idRef,
  pulseState,
  dt,
  emissionSignal,
  jetVelocity,
  random = Math.random,
}) {
  const remainingCapacity = Math.max(0, (params?.particleCount ?? 0) - particles.length)
  if (remainingCapacity <= 0 || emissionSignal <= 0) {
    return {
      spawnedParticles: [],
      effectiveSignal: 0,
      formationNumber: 0,
      slugFormationNumber: 0,
    }
  }

  const pulseGate = resolvePulseGate(params, pulseState, dt)
  const pulseStrength = clamp(Number(params?.jetRollupPulseStrength ?? 1) || 1, 0, 3)
  const effectiveSignal = resolvePulseSignal(pulseState, emissionSignal, pulseGate, pulseStrength)
  if (effectiveSignal <= 0) {
    return {
      spawnedParticles: [],
      effectiveSignal: 0,
      formationNumber: 0,
      slugFormationNumber: 0,
    }
  }

  const nozzle = getNozzle(params)
  const basis = getNozzleBasis(nozzle)
  const radius = Math.max(nozzle.radius, 1e-4)
  const velocity = Math.max(Number(jetVelocity ?? params?.jetSpeed ?? 0) || 0, 0)
  const edgeVorticityStrength = Math.max(Number(params?.jetRollupEdgeVorticity ?? 0.2) || 0, 0)
  const noiseAmplitude = Math.max(Number(params?.jetRollupNoiseAmplitude ?? 0) || 0, 0)
  const edgeThreshold = clamp(Number(params?.jetRollupEdgeThreshold ?? 0.7) || 0.7, 0.4, 0.98)

  const budget = resolveEmissionBudget(params, effectiveSignal, remainingCapacity, velocity, radius)
  if (budget.spawnBudget <= 0) {
    return {
      spawnedParticles: [],
      effectiveSignal: 0,
      formationNumber: budget.formationNumber,
      slugFormationNumber: budget.formationNumber,
    }
  }

  const particlesOut = []
  const vorticityMode = params?.jetVorticityMode ?? 'edge'
  const baseVorticity = scale(
    basis.direction,
    Math.max(0.001, Math.abs(Number(params?.jetTwist ?? 0) || 0) * 0.5),
  )

  for (let i = 0; i < budget.spawnBudget; i += 1) {
    const angle = random() * Math.PI * 2
    const radialNorm = Math.sqrt(random())
    const radialDistance = radialNorm * radius

    const radialDirection = add(
      scale(basis.tangent, Math.cos(angle)),
      scale(basis.bitangent, Math.sin(angle)),
    )
    const radialVector = scale(radialDirection, radialDistance)
    const position = add(nozzle.position, radialVector)

    const profileSpeed = velocity * Math.exp(-((radialDistance * radialDistance) / (radius * radius)))
    const noisyVelocity = add(
      scale(basis.direction, profileSpeed),
      scale(randomUnitVector(random), noiseAmplitude),
    )

    let vorticity

    if (vorticityMode === 'curl') {
      // Physical mode: ω = curl(u) from the Gaussian jet profile.
      // For u(r) = U₀·exp(−r²/R²)·ê_z, the azimuthal vorticity is:
      //   ω_θ = −∂u_z/∂r = (2U₀r/R²)·exp(−r²/R²)
      // Direction: ê_θ = ê_z × ê_r (circumferential).
      // [STATUS]: CORRECT — analytic curl of Gaussian profile
      const R2 = radius * radius
      const curlMagnitude = (2 * velocity * radialDistance / R2)
        * Math.exp(-(radialDistance * radialDistance) / R2)
      const radialUnit = normalize(radialDirection, basis.tangent)
      const circumferential = normalize(cross(basis.direction, radialUnit), basis.bitangent)
      vorticity = add(
        { ...baseVorticity },
        scale(circumferential, curlMagnitude),
      )
    } else {
      // Legacy mode: prescribed edge vorticity with hard threshold.
      // [STATUS]: PROXY — artificial, non-emergent
      vorticity = { ...baseVorticity }
      if (radialNorm > edgeThreshold && edgeVorticityStrength > 0) {
        const radialUnit = normalize(radialDirection, basis.tangent)
        const circumferential = normalize(cross(basis.direction, radialUnit), basis.bitangent)
        vorticity = add(vorticity, scale(circumferential, edgeVorticityStrength))
      }
    }

    particlesOut.push(
      createParticle(params, idRef.current, {
        x: position.x,
        y: position.y,
        z: position.z,
        vx: noisyVelocity.x,
        vy: noisyVelocity.y,
        vz: noisyVelocity.z,
        velocity: { ...noisyVelocity },
        injectionVelocity: { ...noisyVelocity },
        vorticity,
        coreRadius: Math.max(params?.coreRadiusSigma ?? 0.01, params?.minCoreRadius ?? 0.01),
      }),
    )
    idRef.current += 1
  }

  pulseState.trailingJetActive = budget.formationNumber > FORMATION_NUMBER_LIMIT

  return {
    spawnedParticles: particlesOut,
    effectiveSignal,
    formationNumber: budget.formationNumber,
    slugFormationNumber: budget.formationNumber,
  }
}
