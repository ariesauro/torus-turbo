import { createParticle } from '../physics/spawnParticle'
import { buildGrid, computeCellIndex } from '../physics/spatialAcceleration/gridBuilder'
import { computeAggregatedCell, computeCellCenter } from '../physics/spatialAcceleration/aggregatedCells'
import {
  getNeighborCells,
  isCellInRange,
} from '../physics/spatialAcceleration/neighborSearch'
import {
  getFilamentVelocityLimit,
  sampleFilamentVelocityAtPointsBatch,
  sampleFilamentVelocityAtPoint,
} from './biotSavartFilament'

const FOUR_PI = 4 * Math.PI

function magnitude(vector) {
  return Math.hypot(vector.x, vector.y, vector.z)
}

function clampMagnitude(vector, maxMagnitude) {
  if (!(maxMagnitude > 0)) {
    return { ...vector }
  }

  const value = magnitude(vector)
  if (value <= maxMagnitude || value <= 1e-8) {
    return { ...vector }
  }

  const scale = maxMagnitude / value
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  }
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  }
}

function normalize(vector) {
  const len = magnitude(vector)
  if (len <= 1e-8) {
    return { x: 0, y: 0, z: 0 }
  }

  return {
    x: vector.x / len,
    y: vector.y / len,
    z: vector.z / len,
  }
}

function scale(vector, factor) {
  return {
    x: vector.x * factor,
    y: vector.y * factor,
    z: vector.z * factor,
  }
}

function add(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  }
}

function clampPositiveOutwardComponent(vector, outwardDirection, maxPositiveOutward) {
  if (!(maxPositiveOutward >= 0)) {
    return { vector: { ...vector }, outwardVelocity: 0, clamped: false }
  }

  const outwardVelocity = dot(vector, outwardDirection)
  if (outwardVelocity <= maxPositiveOutward) {
    return { vector: { ...vector }, outwardVelocity, clamped: false }
  }

  const excess = outwardVelocity - maxPositiveOutward
  return {
    vector: add(vector, scale(outwardDirection, -excess)),
    outwardVelocity: maxPositiveOutward,
    clamped: true,
  }
}

function clampPositiveAlongDirection(vector, direction, maxPositiveAlong) {
  if (!(maxPositiveAlong >= 0)) {
    return { vector: { ...vector }, alongVelocity: 0, clamped: false }
  }

  const alongVelocity = dot(vector, direction)
  if (alongVelocity <= maxPositiveAlong) {
    return { vector: { ...vector }, alongVelocity, clamped: false }
  }

  const excess = alongVelocity - maxPositiveAlong
  return {
    vector: add(vector, scale(direction, -excess)),
    alongVelocity: maxPositiveAlong,
    clamped: true,
  }
}

function computeFilamentCenter(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { x: 0, y: 0, z: 0 }
  }

  let x = 0
  let y = 0
  let z = 0
  for (let i = 0; i < nodes.length; i += 1) {
    x += nodes[i].position?.x ?? 0
    y += nodes[i].position?.y ?? 0
    z += nodes[i].position?.z ?? 0
  }

  const invCount = 1 / nodes.length
  return { x: x * invCount, y: y * invCount, z: z * invCount }
}

function computeParticleCenter(particles) {
  if (!Array.isArray(particles) || particles.length === 0) {
    return { x: 0, y: 0, z: 0 }
  }

  let x = 0
  let y = 0
  let z = 0
  for (let i = 0; i < particles.length; i += 1) {
    x += particles[i].x ?? 0
    y += particles[i].y ?? 0
    z += particles[i].z ?? 0
  }

  const invCount = 1 / particles.length
  return { x: x * invCount, y: y * invCount, z: z * invCount }
}

function computeMeanRadiusFromPoints(points, center, positionGetter) {
  if (!Array.isArray(points) || points.length === 0) {
    return 0
  }

  let totalRadius = 0
  for (let i = 0; i < points.length; i += 1) {
    const position = positionGetter(points[i])
    totalRadius += Math.hypot(
      (position.x ?? 0) - center.x,
      (position.y ?? 0) - center.y,
      (position.z ?? 0) - center.z,
    )
  }

  return totalRadius / points.length
}

function computeMeanParticleSelfSpeed(particles) {
  if (!Array.isArray(particles) || particles.length === 0) {
    return 0
  }
  let total = 0
  for (let i = 0; i < particles.length; i += 1) {
    const speed = Math.hypot(
      particles[i].selfFlowVx ?? particles[i].flowVx ?? 0,
      particles[i].selfFlowVy ?? particles[i].flowVy ?? 0,
      particles[i].selfFlowVz ?? particles[i].flowVz ?? 0,
    )
    total += speed
  }
  return total / particles.length
}

function computeMeanFilamentSelfSpeed(filaments) {
  if (!Array.isArray(filaments) || filaments.length === 0) {
    return 0
  }
  let total = 0
  let count = 0
  for (let fi = 0; fi < filaments.length; fi += 1) {
    const nodes = filaments[fi]?.nodes ?? []
    for (let ni = 0; ni < nodes.length; ni += 1) {
      const v = nodes[ni].selfVelocity ?? nodes[ni].velocity ?? { x: 0, y: 0, z: 0 }
      total += Math.hypot(v.x ?? 0, v.y ?? 0, v.z ?? 0)
      count += 1
    }
  }
  return count > 0 ? total / count : 0
}

function computeDriftClampFactor(
  particleCenter,
  filamentCenter,
  particleRadius,
  filamentRadius,
) {
  const centerOffset = Math.hypot(
    particleCenter.x - filamentCenter.x,
    particleCenter.y - filamentCenter.y,
    particleCenter.z - filamentCenter.z,
  )
  const radiusOffset = Math.abs(particleRadius - filamentRadius)
  const safeCenterOffset = Math.max(0.05, particleRadius * 0.2)
  const safeRadiusOffset = Math.max(0.03, particleRadius * 0.12)
  const centerScale = centerOffset > safeCenterOffset ? safeCenterOffset / centerOffset : 1
  const radiusScale = radiusOffset > safeRadiusOffset ? safeRadiusOffset / radiusOffset : 1
  const driftClampFactor = Math.max(0.1, Math.min(1, Math.min(centerScale, radiusScale)))
  const centerSeverity = Math.max(0, centerOffset / Math.max(safeCenterOffset, 1e-6) - 1)
  const radiusSeverity = Math.max(0, radiusOffset / Math.max(safeRadiusOffset, 1e-6) - 1)
  const driftSeverity = Math.min(2, Math.max(centerSeverity, radiusSeverity))

  return {
    driftClampFactor,
    centerOffset,
    radiusOffset,
    driftSeverity,
  }
}

export function seedParticlesFromFilament(filament, params, idRef, remainingCapacity) {
  if (!filament || remainingCapacity <= 0) {
    return []
  }

  const sampleCount = Math.min(
    remainingCapacity,
    Math.max(8, Math.min(filament.nodes.length, Math.floor(params.spawnRate ?? 24))),
  )
  const particles = []
  const gammaPerParticle = (filament.circulation ?? params.gamma ?? 1) / Math.max(sampleCount, 1)

  for (let i = 0; i < sampleCount; i += 1) {
    const index = Math.floor((i / sampleCount) * filament.nodes.length) % filament.nodes.length
    const node = filament.nodes[index]
    particles.push(
      createParticle(params, idRef.current, {
        x: node.position.x,
        y: node.position.y,
        z: node.position.z,
        vx: node.velocity.x,
        vy: node.velocity.y,
        vz: node.velocity.z,
        velocity: { ...node.velocity },
        gamma: gammaPerParticle,
        coreRadius: filament.coreRadius,
      }),
    )
    idRef.current += 1
  }

  return particles
}

function createStatsBucket() {
  return {
    queryCount: 0,
    totalSamples: 0,
    maxSamples: 0,
    totalVelocity: 0,
    maxVelocity: 0,
    totalSelfRatio: 0,
    maxSelfRatio: 0,
    totalOutwardVelocity: 0,
    maxOutwardVelocity: 0,
    clampHitCount: 0,
    totalDriftClampFactor: 0,
    minDriftClampFactor: 1,
    driftClampHitCount: 0,
    radiusGuardHitCount: 0,
    centerGuardHitCount: 0,
    totalAdaptiveMinSelfRatio: 0,
    maxAdaptiveMinSelfRatio: 0,
    totalAdaptiveCenterPullGain: 0,
    maxAdaptiveCenterPullGain: 0,
    totalDriftSeverity: 0,
    maxDriftSeverity: 0,
  }
}

function resetStatsBucket(stats) {
  stats.queryCount = 0
  stats.totalSamples = 0
  stats.maxSamples = 0
  stats.totalVelocity = 0
  stats.maxVelocity = 0
  stats.totalSelfRatio = 0
  stats.maxSelfRatio = 0
  stats.totalOutwardVelocity = 0
  stats.maxOutwardVelocity = 0
  stats.clampHitCount = 0
  stats.totalDriftClampFactor = 0
  stats.minDriftClampFactor = 1
  stats.driftClampHitCount = 0
  stats.radiusGuardHitCount = 0
  stats.centerGuardHitCount = 0
  stats.totalAdaptiveMinSelfRatio = 0
  stats.maxAdaptiveMinSelfRatio = 0
  stats.totalAdaptiveCenterPullGain = 0
  stats.maxAdaptiveCenterPullGain = 0
  stats.totalDriftSeverity = 0
  stats.maxDriftSeverity = 0
}

function recordStatsBucket(
  stats,
  sampleCount,
  velocityMagnitude = 0,
  {
    selfRatio = 0,
    outwardVelocity = 0,
    clamped = false,
    driftClampFactor = 1,
    driftClamped = false,
    radiusGuardClamped = false,
    centerGuardClamped = false,
    adaptiveMinSelfRatio = 0,
    adaptiveCenterPullGain = 0,
    driftSeverity = 0,
  } = {},
) {
  stats.queryCount += 1
  stats.totalSamples += sampleCount
  if (sampleCount > stats.maxSamples) {
    stats.maxSamples = sampleCount
  }
  stats.totalVelocity += velocityMagnitude
  if (velocityMagnitude > stats.maxVelocity) {
    stats.maxVelocity = velocityMagnitude
  }
  stats.totalSelfRatio += selfRatio
  if (selfRatio > stats.maxSelfRatio) {
    stats.maxSelfRatio = selfRatio
  }
  stats.totalOutwardVelocity += outwardVelocity
  if (outwardVelocity > stats.maxOutwardVelocity) {
    stats.maxOutwardVelocity = outwardVelocity
  }
  if (clamped) {
    stats.clampHitCount += 1
  }
  const safeFactor = Math.max(0, Math.min(1, driftClampFactor))
  stats.totalDriftClampFactor += safeFactor
  if (safeFactor < stats.minDriftClampFactor) {
    stats.minDriftClampFactor = safeFactor
  }
  if (driftClamped) {
    stats.driftClampHitCount += 1
  }
  if (radiusGuardClamped) {
    stats.radiusGuardHitCount += 1
  }
  if (centerGuardClamped) {
    stats.centerGuardHitCount += 1
  }
  const safeAdaptiveMinSelfRatio = Math.max(0, adaptiveMinSelfRatio)
  stats.totalAdaptiveMinSelfRatio += safeAdaptiveMinSelfRatio
  if (safeAdaptiveMinSelfRatio > stats.maxAdaptiveMinSelfRatio) {
    stats.maxAdaptiveMinSelfRatio = safeAdaptiveMinSelfRatio
  }
  const safeAdaptiveCenterPullGain = Math.max(0, adaptiveCenterPullGain)
  stats.totalAdaptiveCenterPullGain += safeAdaptiveCenterPullGain
  if (safeAdaptiveCenterPullGain > stats.maxAdaptiveCenterPullGain) {
    stats.maxAdaptiveCenterPullGain = safeAdaptiveCenterPullGain
  }
  const safeDriftSeverity = Math.max(0, driftSeverity)
  stats.totalDriftSeverity += safeDriftSeverity
  if (safeDriftSeverity > stats.maxDriftSeverity) {
    stats.maxDriftSeverity = safeDriftSeverity
  }
}

function getCoreRadius(particle, params) {
  const minCore = Math.max(params.minCoreRadius ?? 0.01, 1e-4)
  const sigma = particle.coreRadius ?? params.coreRadiusSigma ?? minCore
  return Math.max(minCore, sigma)
}

function getParticleGridConfig(params) {
  const coreRadius = Math.max(params.coreRadiusSigma ?? params.minCoreRadius ?? 0.03, 1e-4)
  const cellSize = Math.max(coreRadius * Math.max(params.cellSizeMultiplier ?? 4, 1), 0.01)
  return {
    cellSize,
    gridResolution: 32,
    aggregationDistance: Math.max(1, Math.floor(params.aggregationDistance ?? 2)),
    neighborCellRange: Math.max(1, Math.floor(params.neighborCellRange ?? 1)),
  }
}

export function createHybridCouplingContext() {
  return {
    particleSampleContext: {
      cellSize: 0,
      gridResolution: 32,
      gridOrigin: { x: 0, y: 0, z: 0 },
      cellStartBuffer: new Int32Array(1),
      cellCountBuffer: new Int32Array(1),
      particleIndexBuffer: new Int32Array(1),
      aggregatedCells: [],
    },
    stats: {
      particleToFilament: createStatsBucket(),
      filamentToParticle: createStatsBucket(),
      stepMs: 0,
    },
  }
}

export function prepareHybridCouplingContext(particles, params, hybridContext = null) {
  const context = hybridContext ?? createHybridCouplingContext()
  const particleSampleContext = context.particleSampleContext
  const config = getParticleGridConfig(params)
  const grid = buildGrid(particles, config.cellSize, config.gridResolution)
  const aggregatedCells = []
  const totalCells = config.gridResolution ** 3

  for (let cellIndex = 0; cellIndex < totalCells; cellIndex += 1) {
    if (grid.cellCountBuffer[cellIndex] <= 0) {
      continue
    }
    const aggregated = computeAggregatedCell(
      cellIndex,
      particles,
      grid.particleIndexBuffer,
      grid.cellStartBuffer,
      grid.cellCountBuffer,
    )
    if (!aggregated) {
      continue
    }
    aggregated.center = computeCellCenter(
      cellIndex,
      config.gridResolution,
      grid.gridOrigin,
      config.cellSize,
    )
    aggregated.cellIndex = cellIndex
    aggregatedCells.push(aggregated)
  }

  particleSampleContext.cellSize = config.cellSize
  particleSampleContext.gridResolution = config.gridResolution
  particleSampleContext.aggregationDistance = config.aggregationDistance
  particleSampleContext.neighborCellRange = config.neighborCellRange
  particleSampleContext.gridOrigin = grid.gridOrigin
  particleSampleContext.cellStartBuffer = grid.cellStartBuffer
  particleSampleContext.cellCountBuffer = grid.cellCountBuffer
  particleSampleContext.particleIndexBuffer = grid.particleIndexBuffer
  particleSampleContext.aggregatedCells = aggregatedCells
  resetStatsBucket(context.stats.particleToFilament)
  resetStatsBucket(context.stats.filamentToParticle)
  context.stats.stepMs = 0
  return context
}

function sampleParticleVelocityAtPoint(
  point,
  particles,
  params,
  hybridContext,
  interactionRadiusOverride = 0,
) {
  const context = hybridContext.particleSampleContext
  const pointRecord = { x: point.x, y: point.y, z: point.z }
  const cellIndex = computeCellIndex(
    pointRecord,
    context.cellSize,
    context.gridOrigin,
    context.gridResolution,
  )
  if (cellIndex < 0) {
    return { velocity: { x: 0, y: 0, z: 0 }, sampleCount: 0 }
  }

  const interactionRadius = Math.max(
    interactionRadiusOverride > 0 ? interactionRadiusOverride : params.interactionRadius ?? 0,
    0,
  )
  const interactionRadius2 = interactionRadius * interactionRadius
  const neighbors = getNeighborCells(
    cellIndex,
    context.gridResolution,
    context.neighborCellRange,
    context.cellCountBuffer,
  )

  let velocity = { x: 0, y: 0, z: 0 }
  let sampleCount = 0

  for (let i = 0; i < neighbors.length; i += 1) {
    const neighborIndex = neighbors[i]
    const start = context.cellStartBuffer[neighborIndex]
    const count = context.cellCountBuffer[neighborIndex]
    for (let slot = 0; slot < count; slot += 1) {
      const particleIndex = context.particleIndexBuffer[start + slot]
      const source = particles[particleIndex]
      const rx = point.x - source.x
      const ry = point.y - source.y
      const rz = point.z - source.z
      const r2 = rx * rx + ry * ry + rz * rz
      if (interactionRadius > 0 && r2 > interactionRadius2) {
        continue
      }

      const sigma = getCoreRadius(source, params)
      const denom = (r2 + sigma * sigma) ** 1.5
      if (denom <= 1e-8) {
        continue
      }

      const omega = source.vorticity ?? { x: 0, y: 0, z: 0 }
      const cx = ry * omega.z - rz * omega.y
      const cy = rz * omega.x - rx * omega.z
      const cz = rx * omega.y - ry * omega.x
      const gamma = source.gamma ?? params.gamma ?? 0
      const factor = gamma / (FOUR_PI * denom)
      velocity.x += cx * factor
      velocity.y += cy * factor
      velocity.z += cz * factor
      sampleCount += 1
    }
  }

  for (let i = 0; i < context.aggregatedCells.length; i += 1) {
    const aggregatedCell = context.aggregatedCells[i]
    if (
      isCellInRange(
        cellIndex,
        aggregatedCell.cellIndex,
        context.gridResolution,
        context.aggregationDistance,
      )
    ) {
      continue
    }

    const rx = point.x - aggregatedCell.center.x
    const ry = point.y - aggregatedCell.center.y
    const rz = point.z - aggregatedCell.center.z
    const r2 = rx * rx + ry * ry + rz * rz
    if (interactionRadius > 0 && r2 > interactionRadius2) {
      continue
    }

    const sigma = Math.max(params.coreRadiusSigma ?? params.minCoreRadius ?? 0.01, 1e-4)
    const denom = (r2 + sigma * sigma) ** 1.5
    if (denom <= 1e-8) {
      continue
    }

    const omega = aggregatedCell.avgVorticity ?? { x: 0, y: 0, z: 0 }
    const cx = ry * omega.z - rz * omega.y
    const cy = rz * omega.x - rx * omega.z
    const cz = rx * omega.y - ry * omega.x
    const factor = aggregatedCell.totalGamma / (FOUR_PI * denom)
    velocity.x += cx * factor
    velocity.y += cy * factor
    velocity.z += cz * factor
    sampleCount += aggregatedCell.particleCount
  }

  return { velocity, sampleCount }
}

function resolveHybridParticleToFilamentBackend(params) {
  const requested = params?.hybridParticleToFilamentBackend
  if (requested === 'cpu' || requested === 'gpu') {
    return requested
  }
  return 'auto'
}

function buildFilamentNodePointBuffer(filaments) {
  let totalNodeCount = 0
  for (let i = 0; i < filaments.length; i += 1) {
    totalNodeCount += filaments[i]?.nodes?.length ?? 0
  }
  const packed = new Float32Array(totalNodeCount * 4)
  let index = 0
  for (let i = 0; i < filaments.length; i += 1) {
    const nodes = filaments[i]?.nodes ?? []
    for (let j = 0; j < nodes.length; j += 1) {
      const base = index * 4
      packed[base + 0] = nodes[j]?.position?.x ?? 0
      packed[base + 1] = nodes[j]?.position?.y ?? 0
      packed[base + 2] = nodes[j]?.position?.z ?? 0
      packed[base + 3] = 0
      index += 1
    }
  }
  return { packed, totalNodeCount }
}

function getCachedGpuPointSample(result, pointIndex) {
  if (!result || !(pointIndex >= 0)) {
    return null
  }
  const stride = Math.max(4, Math.floor(result.pointStrideFloats ?? 4))
  const velocities = result.velocitiesPacked
  const counts = result.sampleCountsPacked
  const base = pointIndex * stride
  if (
    !(velocities instanceof Float32Array) ||
    !(counts instanceof Uint32Array) ||
    base + 2 >= velocities.length ||
    pointIndex >= counts.length
  ) {
    return null
  }
  return {
    velocity: {
      x: velocities[base + 0] ?? 0,
      y: velocities[base + 1] ?? 0,
      z: velocities[base + 2] ?? 0,
    },
    sampleCount: counts[pointIndex] ?? 0,
  }
}

function shouldUseFilamentToParticleBatching(params, filamentSolverContext) {
  if (params?.hybridFilamentToParticleBatchingEnabled === false) {
    return false
  }
  if (!filamentSolverContext?.grid) {
    return false
  }
  return true
}

function addCrossFlowToParticle(particle, crossVelocity, maxVelocity) {
  const selfFlow = {
    x: Number.isFinite(particle.selfFlowVx) ? particle.selfFlowVx : particle.flowVx ?? 0,
    y: Number.isFinite(particle.selfFlowVy) ? particle.selfFlowVy : particle.flowVy ?? 0,
    z: Number.isFinite(particle.selfFlowVz) ? particle.selfFlowVz : particle.flowVz ?? 0,
  }
  const mergedFlow = {
    x: selfFlow.x + crossVelocity.x,
    y: selfFlow.y + crossVelocity.y,
    z: selfFlow.z + crossVelocity.z,
  }
  const clampedFlow = clampMagnitude(mergedFlow, maxVelocity)
  const appliedCross = {
    x: clampedFlow.x - selfFlow.x,
    y: clampedFlow.y - selfFlow.y,
    z: clampedFlow.z - selfFlow.z,
  }
  particle.selfFlowVx = selfFlow.x
  particle.selfFlowVy = selfFlow.y
  particle.selfFlowVz = selfFlow.z
  particle.crossFlowVx = appliedCross.x
  particle.crossFlowVy = appliedCross.y
  particle.crossFlowVz = appliedCross.z
  particle.flowVx = clampedFlow.x
  particle.flowVy = clampedFlow.y
  particle.flowVz = clampedFlow.z
  particle.velocity = {
    x: particle.flowVx,
    y: particle.flowVy,
    z: particle.flowVz,
  }
  return appliedCross
}

export function resetHybridCouplingTerms(particles, filaments) {
  for (let i = 0; i < particles.length; i += 1) {
    const particle = particles[i]
    const previousCrossFlow = {
      x: Number.isFinite(particle.crossFlowVx) ? particle.crossFlowVx : 0,
      y: Number.isFinite(particle.crossFlowVy) ? particle.crossFlowVy : 0,
      z: Number.isFinite(particle.crossFlowVz) ? particle.crossFlowVz : 0,
    }
    particle.selfFlowVx = (particle.flowVx ?? 0) - previousCrossFlow.x
    particle.selfFlowVy = (particle.flowVy ?? 0) - previousCrossFlow.y
    particle.selfFlowVz = (particle.flowVz ?? 0) - previousCrossFlow.z
    particle.crossFlowVx = 0
    particle.crossFlowVy = 0
    particle.crossFlowVz = 0
  }

  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const nodes = filaments[filamentIndex].nodes ?? []
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      nodes[nodeIndex].couplingVelocity = { x: 0, y: 0, z: 0 }
    }
  }
}

export function applyHybridCoupling({
  particles,
  filaments,
  params,
  filamentSolverContext,
  hybridContext,
  webgpuManager = null,
}) {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const nextHybridContext = prepareHybridCouplingContext(particles, params, hybridContext)
  let particleToFilamentStrength = Math.max(params.hybridParticleToFilamentStrength ?? 1, 0)
  let filamentToParticleStrength = Math.max(params.hybridFilamentToParticleStrength ?? 1, 0)
  if (params.hybridCouplingAutoBalance !== false) {
    const particleSelfSpeed = computeMeanParticleSelfSpeed(particles)
    const filamentSelfSpeed = computeMeanFilamentSelfSpeed(filaments)
    if (particleSelfSpeed > 1e-6 && filamentSelfSpeed > 1e-6) {
      const balanceGain = Math.max(0, params.hybridCouplingBalanceGain ?? 0.45)
      const ratio = particleSelfSpeed / filamentSelfSpeed
      const ratioLog = Math.log(Math.max(ratio, 1e-6))
      const scaled = Math.exp(Math.min(2, Math.max(-2, ratioLog * balanceGain)))
      const p2fScale = Math.max(0.35, Math.min(1.85, scaled))
      const f2pScale = Math.max(0.35, Math.min(1.85, 1 / scaled))
      particleToFilamentStrength *= p2fScale
      filamentToParticleStrength *= f2pScale
    }
  }
  const maxVelocity = Math.max(params.maxVelocity ?? 2.5, 0.05)
  const filamentVelocityLimit = getFilamentVelocityLimit(params)
  const particleToFilamentClamp =
    filamentVelocityLimit * Math.max(params.hybridParticleToFilamentClampRatio ?? 1, 0)
  const filamentToParticleClamp = maxVelocity * Math.max(params.hybridFilamentToParticleClampRatio ?? 1, 0)
  const radialOutwardClamp = particleToFilamentClamp * 0.5
  const sharedInteractionRadius =
    filamentSolverContext?.searchRadius && filamentSolverContext.searchRadius > 0
      ? filamentSolverContext.searchRadius
      : Math.max(params.interactionRadius ?? 0, 0)
  const p2fBackendMode = resolveHybridParticleToFilamentBackend(params)
  const gpuQueryAllowedByParams =
    p2fBackendMode !== 'cpu' && params.physicsBackend === 'webgpu'
  const gpuQueryManagerAvailable =
    webgpuManager &&
    typeof webgpuManager.sampleParticleVelocityAtPoints === 'function' &&
    typeof webgpuManager.getLatestCouplingQueryResult === 'function'
  const gpuQueryEnabled = gpuQueryAllowedByParams && gpuQueryManagerAvailable
  const pointBuffer = gpuQueryEnabled ? buildFilamentNodePointBuffer(filaments) : null
  const cachedGpuQueryResult = gpuQueryEnabled ? webgpuManager.getLatestCouplingQueryResult() : null
  const canUseCachedGpuSamples =
    cachedGpuQueryResult &&
    cachedGpuQueryResult.backend === 'gpu' &&
    cachedGpuQueryResult.reason === 'ok' &&
    cachedGpuQueryResult.pointCount === (pointBuffer?.totalNodeCount ?? 0)
  const filamentToParticleBatchingEnabled = shouldUseFilamentToParticleBatching(
    params,
    filamentSolverContext,
  )

  resetHybridCouplingTerms(particles, filaments)
  if (gpuQueryEnabled && (pointBuffer?.totalNodeCount ?? 0) > 0) {
    Promise.resolve(
      webgpuManager.sampleParticleVelocityAtPoints(pointBuffer.packed, {
        params,
        pointStrideFloats: 4,
      }),
    ).catch(() => null)
  }
  const particleCenter = computeParticleCenter(particles)
  const particleRadius = computeMeanRadiusFromPoints(
    particles,
    particleCenter,
    (particle) => ({ x: particle.x ?? 0, y: particle.y ?? 0, z: particle.z ?? 0 }),
  )

  let couplingPointIndex = 0
  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const nodes = filaments[filamentIndex].nodes ?? []
    const filamentCenter = computeFilamentCenter(nodes)
    const filamentRadius = computeMeanRadiusFromPoints(
      nodes,
      filamentCenter,
      (node) => node.position ?? { x: 0, y: 0, z: 0 },
    )
    const driftState = computeDriftClampFactor(
      particleCenter,
      filamentCenter,
      particleRadius,
      filamentRadius,
    )
    const driftDirection = normalize(subtract(filamentCenter, particleCenter))
    const centerOffset = driftState.centerOffset
    const driftSeverity = driftState.driftSeverity ?? 0
    const adaptiveMinSelfRatio = 0
    const adaptiveCenterPullGain = 0
    const radiusOutwardClamp = radialOutwardClamp
    const centerAwayClamp = particleToFilamentClamp * 0.25
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      const cachedGpuSample =
        canUseCachedGpuSamples && gpuQueryEnabled
          ? getCachedGpuPointSample(cachedGpuQueryResult, couplingPointIndex)
          : null
      const sample =
        cachedGpuSample ??
        sampleParticleVelocityAtPoint(
          nodes[nodeIndex].position,
          particles,
          params,
          nextHybridContext,
          sharedInteractionRadius,
        )
      const unclampedVelocity = {
        x: sample.velocity.x * particleToFilamentStrength,
        y: sample.velocity.y * particleToFilamentStrength,
        z: sample.velocity.z * particleToFilamentStrength,
      }
      const magnitudeClampedVelocity = clampMagnitude(unclampedVelocity, particleToFilamentClamp)
      const outwardDirection = normalize(
        subtract(nodes[nodeIndex].position ?? { x: 0, y: 0, z: 0 }, filamentCenter),
      )
      const outwardClamp = clampPositiveOutwardComponent(
        magnitudeClampedVelocity,
        outwardDirection,
        radiusOutwardClamp,
      )
      const centerClamp = clampPositiveAlongDirection(
        outwardClamp.vector,
        driftDirection,
        centerAwayClamp,
      )
      const selfVelocityMagnitude = magnitude(
        nodes[nodeIndex].selfVelocity ?? nodes[nodeIndex].velocity ?? { x: 0, y: 0, z: 0 },
      )
      let couplingVelocity = centerClamp.vector
      couplingVelocity = clampMagnitude(couplingVelocity, particleToFilamentClamp)
      const couplingMagnitude = magnitude(couplingVelocity)
      const selfRatio =
        selfVelocityMagnitude > 1e-6
          ? couplingMagnitude / selfVelocityMagnitude
          : couplingMagnitude > 0
            ? 1
            : 0
      const clampHit =
        magnitude(unclampedVelocity) - magnitude(magnitudeClampedVelocity) > 1e-6 ||
        outwardClamp.clamped ||
        centerClamp.clamped
      recordStatsBucket(
        nextHybridContext.stats.particleToFilament,
        sample.sampleCount,
        couplingMagnitude,
        {
          selfRatio,
          outwardVelocity: Math.max(0, outwardClamp.outwardVelocity),
          clamped: clampHit,
          driftClampFactor: driftState.driftClampFactor,
          driftClamped: driftState.driftClampFactor < 0.999,
          radiusGuardClamped: outwardClamp.clamped,
          centerGuardClamped: centerClamp.clamped,
          adaptiveMinSelfRatio,
          adaptiveCenterPullGain,
          driftSeverity,
        },
      )
      nodes[nodeIndex].couplingVelocity = {
        x: couplingVelocity.x,
        y: couplingVelocity.y,
        z: couplingVelocity.z,
      }
      couplingPointIndex += 1
    }
  }

  if (filamentToParticleBatchingEnabled) {
    const packedPoints = new Float32Array(particles.length * 4)
    for (let i = 0; i < particles.length; i += 1) {
      const base = i * 4
      packedPoints[base + 0] = particles[i].x ?? 0
      packedPoints[base + 1] = particles[i].y ?? 0
      packedPoints[base + 2] = particles[i].z ?? 0
      packedPoints[base + 3] = 0
    }
    const batchSample = sampleFilamentVelocityAtPointsBatch(
      packedPoints,
      filaments,
      filamentSolverContext,
      { statsBucket: 'couplingQueries', pointStrideFloats: 4 },
    )
    for (let particleIndex = 0; particleIndex < particles.length; particleIndex += 1) {
      const particle = particles[particleIndex]
      const base = particleIndex * 4
      const couplingVelocity = clampMagnitude(
        {
          x: (batchSample.velocitiesPacked[base + 0] ?? 0) * filamentToParticleStrength,
          y: (batchSample.velocitiesPacked[base + 1] ?? 0) * filamentToParticleStrength,
          z: (batchSample.velocitiesPacked[base + 2] ?? 0) * filamentToParticleStrength,
        },
        filamentToParticleClamp,
      )
      const appliedCrossVelocity = addCrossFlowToParticle(
        particle,
        couplingVelocity,
        maxVelocity,
      )
      recordStatsBucket(
        nextHybridContext.stats.filamentToParticle,
        1,
        magnitude(appliedCrossVelocity),
      )
    }
  } else {
    for (let particleIndex = 0; particleIndex < particles.length; particleIndex += 1) {
      const particle = particles[particleIndex]
      const sample = sampleFilamentVelocityAtPoint(
        particle,
        filaments,
        filamentSolverContext,
        { statsBucket: 'couplingQueries' },
      )
      const couplingVelocity = clampMagnitude(
        {
          x: sample.x * filamentToParticleStrength,
          y: sample.y * filamentToParticleStrength,
          z: sample.z * filamentToParticleStrength,
        },
        filamentToParticleClamp,
      )
      const appliedCrossVelocity = addCrossFlowToParticle(
        particle,
        couplingVelocity,
        maxVelocity,
      )
      recordStatsBucket(
        nextHybridContext.stats.filamentToParticle,
        1,
        magnitude(appliedCrossVelocity),
      )
    }
  }

  const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  nextHybridContext.stats.particleToFilamentBackend = canUseCachedGpuSamples ? 'gpu_cached' : 'cpu'
  nextHybridContext.stats.particleToFilamentGpuQueryEnabled = gpuQueryEnabled
  nextHybridContext.stats.particleToFilamentGpuPointCount = pointBuffer?.totalNodeCount ?? 0
  nextHybridContext.stats.filamentToParticleBackend = filamentToParticleBatchingEnabled
    ? 'cpu_batch'
    : 'cpu_pointwise'
  nextHybridContext.stats.stepMs = finishedAt - startedAt
  return nextHybridContext
}
