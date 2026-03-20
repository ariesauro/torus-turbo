import { getNozzle, getNozzleBasis } from './emission/shared'

function randomSigned(random) {
  return random() * 2 - 1
}

function getCircleSection(params, random) {
  const angle = random() * Math.PI * 2
  const radius = Math.sqrt(random()) * params.nozzleRadius
  return { angle, radius }
}

function getFibonacciSection(params, id, random) {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  const points = Math.max(1, Math.floor(params.fibPointsPerPulse))
  const index = id % points
  const unitRadius = Math.sqrt((index + 0.5) / points)

  const baseRadius = unitRadius * params.nozzleRadius * Math.max(params.fibScale, 0)
  const radiusJitter = randomSigned(random) * params.fibJitter * params.nozzleRadius
  const radius = Math.max(0, baseRadius + radiusJitter)

  const angleJitter = randomSigned(random) * params.fibJitter
  const angle = index * goldenAngle * Math.max(params.fibTurns, 0) + angleJitter

  return { angle, radius: Math.min(radius, params.nozzleRadius) }
}

function getDiscreteSection(params, random) {
  const sectionCount = Math.max(1, Math.floor(params.discreteSectionCount))
  const sector = Math.floor(random() * sectionCount)
  const baseAngle = (sector / sectionCount) * Math.PI * 2
  const angle =
    baseAngle +
    randomSigned(random) * params.discreteAngularJitter * (Math.PI * 2 / sectionCount)

  const bandWidth = Math.min(1, Math.max(0.05, params.discreteBandWidth))
  const inner = (1 - bandWidth) * params.nozzleRadius
  const baseRadius = inner + Math.sqrt(random()) * (params.nozzleRadius - inner)
  const radiusJitter = randomSigned(random) * params.discreteRadialJitter * params.nozzleRadius
  const radius = Math.max(0, Math.min(baseRadius + radiusJitter, params.nozzleRadius))

  return { angle, radius }
}

function getHelicoidSection(params, id, random) {
  const bands = Math.max(1, Math.floor(params.helicoidBands))
  const bandIndex = id % bands
  const t = (id % 10000) / 10000
  const turns = Math.max(0.1, params.helicoidTurns)
  const pitch = Math.max(0.01, params.helicoidPitch)
  const phaseDrift = id * params.helicoidPhaseSpeed

  const baseAngle = bandIndex * ((Math.PI * 2) / bands)
  const helixAngle = t * turns * Math.PI * 2 + phaseDrift
  const angle = baseAngle + helixAngle + randomSigned(random) * params.helicoidJitter

  const spiralRadius =
    ((t * turns) % 1) * params.nozzleRadius * pitch + (1 - pitch) * params.nozzleRadius * 0.2
  const radiusJitter = randomSigned(random) * params.helicoidJitter * params.nozzleRadius
  const radius = Math.max(0, Math.min(spiralRadius + radiusJitter, params.nozzleRadius))

  return { angle, radius }
}

function getNozzleSection(params, id, random) {
  if (params.nozzleSectionMode === 'fibonacci') {
    return getFibonacciSection(params, id, random)
  }

  if (params.nozzleSectionMode === 'helicoid') {
    return getHelicoidSection(params, id, random)
  }

  if (params.nozzleSectionMode === 'discrete') {
    return getDiscreteSection(params, random)
  }

  return getCircleSection(params, random)
}

export function createParticle(params, id, overrides = {}) {
  const x = overrides.x ?? 0
  const y = overrides.y ?? 0
  const z = overrides.z ?? 0
  const velocity =
    overrides.velocity ??
    {
      x: overrides.vx ?? 0,
      y: overrides.vy ?? 0,
      z: overrides.vz ?? 0,
    }
  const vorticity =
    overrides.vorticity ??
    {
      x: 0,
      y: 0,
      z: Math.max(0.001, Math.abs(params.jetTwist) + Math.abs(params.gamma) * 0.1),
    }
  const injectionVelocity =
    overrides.injectionVelocity ??
    velocity

  return {
    id,
    x,
    y,
    z,
    px: x,
    py: y,
    pz: z,
    vx: velocity.x,
    vy: velocity.y,
    vz: velocity.z,
    injectVx: injectionVelocity.x,
    injectVy: injectionVelocity.y,
    injectVz: injectionVelocity.z,
    theta: overrides.theta ?? 0,
    phi: overrides.phi ?? 0,
    velocity,
    vorticity,
    gamma: overrides.gamma ?? params.gamma,
    coreRadius:
      overrides.coreRadius ?? Math.max(params.minCoreRadius ?? 0.01, params.coreRadiusSigma ?? 0.01),
    viscosity: overrides.viscosity ?? params.viscosity ?? 0,
    particleType: overrides.particleType ?? 'amer',
    visualSize: overrides.visualSize ?? params.visualSize ?? 1,
    visualOpacity: overrides.visualOpacity ?? params.visualOpacity ?? 1,
    trailEnabled: overrides.trailEnabled ?? (params.trailEnabled !== false),
    vectorArrowEnabled: overrides.vectorArrowEnabled ?? (params.vectorArrowEnabled !== false),
    age: overrides.age ?? 0,
    jetPsi: overrides.jetPsi ?? 0,
    hasInjectedTwist: overrides.hasInjectedTwist ?? false,
    history: overrides.history ?? [{ x, y, z }],
    life: overrides.life ?? 0,
  }
}

export function spawnParticle(params, id, life = 0, random = Math.random) {
  const nozzle = getNozzle(params)
  const basis = getNozzleBasis(nozzle)
  const sectionParams = {
    ...params,
    nozzleRadius: nozzle.radius,
  }
  const { angle, radius } = getNozzleSection(sectionParams, id, random)
  const radialVector = {
    x: basis.tangent.x * Math.cos(angle) + basis.bitangent.x * Math.sin(angle),
    y: basis.tangent.y * Math.cos(angle) + basis.bitangent.y * Math.sin(angle),
    z: basis.tangent.z * Math.cos(angle) + basis.bitangent.z * Math.sin(angle),
  }
  const velocity = {
    x: basis.direction.x * params.jetSpeed,
    y: basis.direction.y * params.jetSpeed,
    z: basis.direction.z * params.jetSpeed,
  }

  return createParticle(params, id, {
    x: nozzle.position.x + radialVector.x * radius,
    y: nozzle.position.y + radialVector.y * radius,
    z: nozzle.position.z + radialVector.z * radius,
    theta: random() * Math.PI * 2,
    phi: random() * Math.PI * 2,
    velocity,
    life,
  })
}
