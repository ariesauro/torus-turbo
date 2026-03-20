import {
  commitFilamentSolverStats,
  computeFilamentSelfVelocities,
  createFilamentSolverContext,
  getFilamentVelocityLimit,
  prepareFilamentSolverContext,
  resetFilamentSolverContextStats,
} from './biotSavartFilament'
import { advectFilaments } from './advectFilaments'
import { adaptFilaments } from './adaptFilaments'
import {
  createFilamentQualityStats,
  ensureFilamentTopology,
  resetFilamentQualityStats,
} from './filamentQuality'
import { regularizeFilaments } from './regularizeFilaments'
import { smoothFilaments } from './smoothFilaments'
import { reconnectFilaments } from './reconnectFilaments'
import {
  computeFilamentCurvature,
  computeFilamentStrainRate,
  detectFilamentInstability,
  applyFilamentInstability,
} from './filamentDynamics'

function cloneNodePositions(filaments) {
  return filaments.map((filament) => ({
    center: measureFilamentCenter(filament.nodes ?? []),
    meanRadius: measureMeanRadius(filament.nodes ?? [], measureFilamentCenter(filament.nodes ?? [])),
    positions: (filament.nodes ?? []).map((node) => ({
      x: node.position.x,
      y: node.position.y,
      z: node.position.z,
    })),
  }))
}

function measureFilamentCenter(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { x: 0, y: 0, z: 0 }
  }

  let x = 0
  let y = 0
  let z = 0
  for (let i = 0; i < nodes.length; i += 1) {
    x += nodes[i].position.x
    y += nodes[i].position.y
    z += nodes[i].position.z
  }

  const invCount = 1 / nodes.length
  return { x: x * invCount, y: y * invCount, z: z * invCount }
}

function measureMeanRadius(nodes, center) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return 0
  }

  let totalRadius = 0
  for (let i = 0; i < nodes.length; i += 1) {
    totalRadius += Math.hypot(
      nodes[i].position.x - center.x,
      nodes[i].position.y - center.y,
      nodes[i].position.z - center.z,
    )
  }

  return totalRadius / nodes.length
}

function measureTransportStats(beforeState, filaments, dt, qualityStats) {
  let totalDistance = 0
  let distanceSamples = 0
  let maxDistance = 0
  let totalCenterStep = 0
  let centerSamples = 0

  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const filament = filaments[filamentIndex]
    const nodes = filament.nodes ?? []
    const previous = beforeState[filamentIndex]
    if (!previous) {
      continue
    }

    const compareCount = Math.min(previous.positions.length, nodes.length)
    for (let nodeIndex = 0; nodeIndex < compareCount; nodeIndex += 1) {
      const current = nodes[nodeIndex].position
      const prev = previous.positions[nodeIndex]
      const distance = Math.hypot(current.x - prev.x, current.y - prev.y, current.z - prev.z)
      totalDistance += distance
      distanceSamples += 1
      if (distance > maxDistance) {
        maxDistance = distance
      }
    }

    const currentCenter = measureFilamentCenter(nodes)
    totalCenterStep += Math.hypot(
      currentCenter.x - previous.center.x,
      currentCenter.y - previous.center.y,
      currentCenter.z - previous.center.z,
    )
    centerSamples += 1
  }

  qualityStats.transportStepDistanceAvg = distanceSamples > 0 ? totalDistance / distanceSamples : 0
  qualityStats.transportStepDistanceMax = maxDistance
  qualityStats.transportVelocityAvg =
    dt > 1e-8 ? qualityStats.transportStepDistanceAvg / dt : 0
  qualityStats.transportVelocityMax =
    dt > 1e-8 ? qualityStats.transportStepDistanceMax / dt : 0
  qualityStats.transportCenterStep = centerSamples > 0 ? totalCenterStep / centerSamples : 0
}

function applyHybridRadiusGuard(filaments, beforeState, qualityStats, params) {
  if (params.vortexRepresentation !== 'hybrid') {
    return
  }

  const maxGrowthRatio = 1.03
  const minShrinkRatio = 0.97
  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const filament = filaments[filamentIndex]
    const nodes = filament.nodes ?? []
    if (nodes.length < 3) {
      continue
    }

    const baseline = beforeState[filamentIndex]
    if (!baseline || !(baseline.meanRadius > 1e-8)) {
      continue
    }

    const currentCenter = measureFilamentCenter(nodes)
    const currentRadius = measureMeanRadius(nodes, currentCenter)
    const maxAllowedRadius = baseline.meanRadius * maxGrowthRatio
    const minAllowedRadius = baseline.meanRadius * minShrinkRatio
    if (
      (currentRadius <= maxAllowedRadius && currentRadius >= minAllowedRadius) ||
      currentRadius <= 1e-8
    ) {
      continue
    }

    const targetRadius = currentRadius > maxAllowedRadius ? maxAllowedRadius : minAllowedRadius
    const scale = targetRadius / currentRadius
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      const position = nodes[nodeIndex].position
      nodes[nodeIndex].position = {
        x: currentCenter.x + (position.x - currentCenter.x) * scale,
        y: currentCenter.y + (position.y - currentCenter.y) * scale,
        z: currentCenter.z + (position.z - currentCenter.z) * scale,
      }
    }
    qualityStats.radiusGuardActivations += 1
  }
}

function normalizeVector(x, y, z) {
  const len = Math.hypot(x, y, z)
  if (len <= 1e-8) {
    return null
  }
  return { x: x / len, y: y / len, z: z / len }
}

function clampVectorMagnitude(vector, maxMagnitude) {
  if (!(maxMagnitude > 0)) {
    return vector
  }
  const value = Math.hypot(vector.x, vector.y, vector.z)
  if (value <= maxMagnitude || value <= 1e-8) {
    return vector
  }
  const scale = maxMagnitude / value
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  }
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

function computeParticleRadius(particles, center) {
  if (!Array.isArray(particles) || particles.length === 0) {
    return 0
  }
  let totalRadius = 0
  for (let i = 0; i < particles.length; i += 1) {
    totalRadius += Math.hypot(
      (particles[i].x ?? 0) - center.x,
      (particles[i].y ?? 0) - center.y,
      (particles[i].z ?? 0) - center.z,
    )
  }
  return totalRadius / particles.length
}

function computeFilamentCenterForAll(filaments) {
  if (!Array.isArray(filaments) || filaments.length === 0) {
    return { x: 0, y: 0, z: 0, count: 0 }
  }
  let x = 0
  let y = 0
  let z = 0
  let count = 0
  for (let i = 0; i < filaments.length; i += 1) {
    const nodes = filaments[i].nodes ?? []
    for (let j = 0; j < nodes.length; j += 1) {
      x += nodes[j].position.x ?? 0
      y += nodes[j].position.y ?? 0
      z += nodes[j].position.z ?? 0
      count += 1
    }
  }
  if (count === 0) {
    return { x: 0, y: 0, z: 0, count: 0 }
  }
  const invCount = 1 / count
  return { x: x * invCount, y: y * invCount, z: z * invCount, count }
}

function applyHybridCenterLock(filaments, particles, dt, params) {
  if (
    params?.filamentCenterLockEnabled !== true ||
    params?.vortexRepresentation !== 'hybrid' ||
    !Array.isArray(particles) ||
    particles.length === 0
  ) {
    return
  }
  const particleCenter = computeParticleCenter(particles)
  const particleRadius = computeParticleRadius(particles, particleCenter)
  const filamentCenter = computeFilamentCenterForAll(filaments)
  if (filamentCenter.count <= 0) {
    return
  }
  const offset = {
    x: particleCenter.x - filamentCenter.x,
    y: particleCenter.y - filamentCenter.y,
    z: particleCenter.z - filamentCenter.z,
  }
  const offsetLength = Math.hypot(offset.x, offset.y, offset.z)
  const emergencyTriggerOffset = Math.max(
    0.12,
    particleRadius * 0.35,
    0.08 * Math.max(1, particles.length / 1000),
  )
  if (offsetLength <= emergencyTriggerOffset) {
    return
  }
  const centerLockGain = Math.max(params?.filamentCenterLockGain ?? 0.08, 0)
  const maxShiftRatio = Math.max(params?.filamentCenterLockMaxShiftRatio ?? 0.15, 0.01)
  const maxShiftPerStep = Math.max(
    0.0005,
    getFilamentVelocityLimit(params) * Math.max(dt, 1e-4) * maxShiftRatio,
  )
  const correction = clampVectorMagnitude(
    {
      x: offset.x * centerLockGain,
      y: offset.y * centerLockGain,
      z: offset.z * centerLockGain,
    },
    maxShiftPerStep,
  )
  for (let i = 0; i < filaments.length; i += 1) {
    const nodes = filaments[i].nodes ?? []
    for (let j = 0; j < nodes.length; j += 1) {
      nodes[j].position.x += correction.x
      nodes[j].position.y += correction.y
      nodes[j].position.z += correction.z
    }
  }
}

let kelvinWaveTime = 0

function applyKelvinWavePerturbation(filaments, dt, params) {
  if (params?.vortexRepresentation === 'hybrid' || params?.filamentKelvinWaveEnabled !== true) {
    return
  }

  const waveSpeed = 1.5
  kelvinWaveTime += Math.max(dt, 0)
  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const filament = filaments[filamentIndex]
    const nodes = filament.nodes
    const nodeCount = nodes.length
    if (nodeCount < 3) {
      continue
    }

    const coreRadius = Math.max(filament.coreRadius ?? 0.08, 1e-6)
    const amplitude = coreRadius * 0.02

    for (let i = 0; i < nodeCount; i += 1) {
      const prev = (i - 1 + nodeCount) % nodeCount
      const next = (i + 1) % nodeCount
      const prevPos = nodes[prev].position
      const nextPos = nodes[next].position
      const tangent = normalizeVector(
        nextPos.x - prevPos.x,
        nextPos.y - prevPos.y,
        nextPos.z - prevPos.z,
      )
      if (!tangent) {
        continue
      }

      const reference =
        Math.abs(tangent.y) < 0.9
          ? { x: 0, y: 1, z: 0 }
          : { x: 1, y: 0, z: 0 }
      let nx = tangent.y * reference.z - tangent.z * reference.y
      let ny = tangent.z * reference.x - tangent.x * reference.z
      let nz = tangent.x * reference.y - tangent.y * reference.x
      let normal = normalizeVector(nx, ny, nz)
      if (!normal) {
        const fallback = { x: 0, y: 0, z: 1 }
        nx = tangent.y * fallback.z - tangent.z * fallback.y
        ny = tangent.z * fallback.x - tangent.x * fallback.z
        nz = tangent.x * fallback.y - tangent.y * fallback.x
        normal = normalizeVector(nx, ny, nz)
      }
      if (!normal) {
        continue
      }

      const phase = (i / Math.max(nodeCount, 1)) * Math.PI * 2
      const wave = Math.sin(phase + kelvinWaveTime * waveSpeed)
      nodes[i].position.x += normal.x * wave * amplitude
      nodes[i].position.y += normal.y * wave * amplitude
      nodes[i].position.z += normal.z * wave * amplitude
    }
  }
}

function computeAdaptiveSubstepCount(filaments, dt, params) {
  const cfl = Math.max(params?.filamentCflSafety ?? 0.35, 0.05)
  const maxSubsteps = Math.max(2, Math.floor(params?.filamentMaxSubsteps ?? 8))
  let maxSpeed = 0
  let minSegmentLength = Number.POSITIVE_INFINITY

  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const filament = filaments[filamentIndex]
    const nodes = filament.nodes ?? []
    const nodeCount = nodes.length
    if (nodeCount < 2) {
      continue
    }
    const segmentCount = filament.closedLoop ? nodeCount : Math.max(0, nodeCount - 1)

    for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
      const velocity = nodes[nodeIndex].velocity ?? { x: 0, y: 0, z: 0 }
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z)
      if (speed > maxSpeed) {
        maxSpeed = speed
      }
    }

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const a = nodes[segmentIndex].position
      const b = nodes[(segmentIndex + 1) % nodeCount].position
      const segmentLength = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
      if (segmentLength > 1e-10 && segmentLength < minSegmentLength) {
        minSegmentLength = segmentLength
      }
    }
  }

  if (!(minSegmentLength < Number.POSITIVE_INFINITY) || maxSpeed <= 1e-6 || dt <= 1e-10) {
    return 2
  }

  const dtLimit = (cfl * minSegmentLength) / Math.max(maxSpeed, 1e-6)
  if (!(dtLimit > 1e-10)) {
    return maxSubsteps
  }

  return Math.max(2, Math.min(maxSubsteps, Math.ceil(dt / dtLimit)))
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function countFilamentNodes(filaments) {
  let total = 0
  for (let i = 0; i < filaments.length; i += 1) {
    total += filaments[i].nodes?.length ?? 0
  }
  return total
}

function resolveAdaptiveRefinementSettings({
  filaments,
  params,
  qualityStats,
  particleCouplingStats,
  previousPressure = 0,
}) {
  if (params?.vortexRepresentation !== 'hybrid') {
    return {
      pressure: 0,
      smoothedPressure: 0,
      maxSegmentScale: 1,
      minSegmentScale: 1,
      splitBudgetScale: 1,
    }
  }

  const nodeCount = Math.max(countFilamentNodes(filaments), 1)
  const driftSeverityAvg =
    (particleCouplingStats?.queryCount ?? 0) > 0
      ? (particleCouplingStats?.totalDriftSeverity ?? 0) / particleCouplingStats.queryCount
      : 0
  const curvatureLoad = clamp01((qualityStats.regularizationCorrections ?? 0) / nodeCount)
  const reconnectPressure = clamp01((qualityStats.reconnectAttempts ?? 0) / Math.max(1, filaments.length * 4))
  const transportPressure = clamp01((qualityStats.transportVelocityAvg ?? 0) / 8)
  const rawPressure =
    clamp01(driftSeverityAvg) * 0.5 +
    curvatureLoad * 0.25 +
    reconnectPressure * 0.15 +
    transportPressure * 0.1
  const alpha = 0.22
  const smoothedPressure = previousPressure + (rawPressure - previousPressure) * alpha
  const maxSegmentScale = 1 - smoothedPressure * 0.45
  const minSegmentScale = 1 + smoothedPressure * 0.25
  const splitBudgetScale = 1 + smoothedPressure * 1.4
  return {
    pressure: rawPressure,
    smoothedPressure,
    maxSegmentScale: Math.max(0.55, Math.min(1, maxSegmentScale)),
    minSegmentScale: Math.max(1, Math.min(1.35, minSegmentScale)),
    splitBudgetScale: Math.max(1, Math.min(2.6, splitBudgetScale)),
  }
}

function computeTotalCirculation(filaments) {
  let total = 0
  for (let i = 0; i < filaments.length; i += 1) {
    total += filaments[i].circulation ?? 0
  }
  return total
}

function captureNodeVelocities(filaments) {
  return filaments.map((filament) =>
    (filament.nodes ?? []).map((node) => ({
      x: node.velocity?.x ?? 0,
      y: node.velocity?.y ?? 0,
      z: node.velocity?.z ?? 0,
    })),
  )
}

function captureNodePositions(filaments) {
  return filaments.map((filament) =>
    (filament.nodes ?? []).map((node) => ({
      x: node.position.x,
      y: node.position.y,
      z: node.position.z,
    })),
  )
}

function applyNodePositions(filaments, positions) {
  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const nodes = filaments[filamentIndex].nodes ?? []
    const source = positions[filamentIndex] ?? []
    const count = Math.min(nodes.length, source.length)
    for (let nodeIndex = 0; nodeIndex < count; nodeIndex += 1) {
      nodes[nodeIndex].position = {
        x: source[nodeIndex].x,
        y: source[nodeIndex].y,
        z: source[nodeIndex].z,
      }
    }
  }
}

function stagePositionsFromVelocities(basePositions, k1, dt, stage = 'midpoint', k2 = null) {
  return basePositions.map((filamentPositions, filamentIndex) =>
    filamentPositions.map((position, nodeIndex) => {
      const velocityK1 = k1[filamentIndex]?.[nodeIndex] ?? { x: 0, y: 0, z: 0 }
      if (stage === 'midpoint') {
        return {
          x: position.x + velocityK1.x * dt * 0.5,
          y: position.y + velocityK1.y * dt * 0.5,
          z: position.z + velocityK1.z * dt * 0.5,
        }
      }
      if (stage === 'euler') {
        return {
          x: position.x + velocityK1.x * dt,
          y: position.y + velocityK1.y * dt,
          z: position.z + velocityK1.z * dt,
        }
      }
      const velocityK2 = k2?.[filamentIndex]?.[nodeIndex] ?? { x: 0, y: 0, z: 0 }
      return {
        x: position.x + dt * (-velocityK1.x + 2 * velocityK2.x),
        y: position.y + dt * (-velocityK1.y + 2 * velocityK2.y),
        z: position.z + dt * (-velocityK1.z + 2 * velocityK2.z),
      }
    }),
  )
}

function finalizeRk3Positions(basePositions, k1, k2, k3, dt) {
  return basePositions.map((filamentPositions, filamentIndex) =>
    filamentPositions.map((position, nodeIndex) => {
      const velocityK1 = k1[filamentIndex]?.[nodeIndex] ?? { x: 0, y: 0, z: 0 }
      const velocityK2 = k2[filamentIndex]?.[nodeIndex] ?? { x: 0, y: 0, z: 0 }
      const velocityK3 = k3[filamentIndex]?.[nodeIndex] ?? { x: 0, y: 0, z: 0 }
      return {
        x: position.x + (dt * (velocityK1.x + 4 * velocityK2.x + velocityK3.x)) / 6,
        y: position.y + (dt * (velocityK1.y + 4 * velocityK2.y + velocityK3.y)) / 6,
        z: position.z + (dt * (velocityK1.z + 4 * velocityK2.z + velocityK3.z)) / 6,
      }
    }),
  )
}

function recomputeFilamentVelocities(filaments, params, solverContext) {
  prepareFilamentSolverContext(filaments, params, solverContext)
  computeFilamentSelfVelocities(filaments, params, solverContext)
}

function advectFilamentsWithIntegrator(filaments, params, dt, solverContext) {
  const integrator = params?.filamentIntegrator ?? 'rk2'
  if (integrator === 'euler') {
    advectFilaments(filaments, dt)
    return
  }
  const basePositions = captureNodePositions(filaments)
  const k1 = captureNodeVelocities(filaments)
  if (integrator === 'rk2') {
    const midpointPositions = stagePositionsFromVelocities(basePositions, k1, dt, 'midpoint')
    applyNodePositions(filaments, midpointPositions)
    recomputeFilamentVelocities(filaments, params, solverContext)
    const k2 = captureNodeVelocities(filaments)
    const finalPositions = stagePositionsFromVelocities(basePositions, k2, dt, 'euler')
    applyNodePositions(filaments, finalPositions)
    recomputeFilamentVelocities(filaments, params, solverContext)
    return
  }
  const midpointPositions = stagePositionsFromVelocities(basePositions, k1, dt, 'midpoint')
  applyNodePositions(filaments, midpointPositions)
  recomputeFilamentVelocities(filaments, params, solverContext)
  const k2 = captureNodeVelocities(filaments)
  const stageThreePositions = stagePositionsFromVelocities(basePositions, k1, dt, 'rk3_stage3', k2)
  applyNodePositions(filaments, stageThreePositions)
  recomputeFilamentVelocities(filaments, params, solverContext)
  const k3 = captureNodeVelocities(filaments)
  const finalPositions = finalizeRk3Positions(basePositions, k1, k2, k3, dt)
  applyNodePositions(filaments, finalPositions)
  recomputeFilamentVelocities(filaments, params, solverContext)
}

export function stepFilaments(filaments, params, dt, solverContext = null, options = {}) {
  if (!Array.isArray(filaments) || filaments.length === 0) {
    return solverContext ?? createFilamentSolverContext()
  }

  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const substeps = computeAdaptiveSubstepCount(filaments, dt, params)
  const subDt = dt / substeps
  const nextSolverContext = solverContext ?? createFilamentSolverContext()
  const qualityStats = nextSolverContext.stats?.quality ?? createFilamentQualityStats()
  const circulationBefore = computeTotalCirculation(filaments)
  const filamentStateBefore = cloneNodePositions(filaments)
  resetFilamentSolverContextStats(nextSolverContext, {
    resetSelfStats: true,
    resetCouplingStats: false,
    resetQualityStats: true,
  })
  resetFilamentQualityStats(qualityStats)
  qualityStats.operatorSelfInducedMs = 0
  qualityStats.operatorSmoothingMs = 0
  qualityStats.operatorRegularizationMs = 0
  qualityStats.operatorReconnectionMs = 0
  qualityStats.adaptiveRefinementPressureAvg = 0
  qualityStats.adaptiveRefinementPressureMax = 0
  qualityStats.adaptiveSplitBudgetScale = 1
  qualityStats.adaptiveMaxSegmentScale = 1
  qualityStats.adaptiveMinSegmentScale = 1
  nextSolverContext.stats.quality = qualityStats
  nextSolverContext.adaptiveRefinementState = nextSolverContext.adaptiveRefinementState ?? {
    pressureEma: 0,
  }
  ensureFilamentTopology(filaments, params, qualityStats)

  for (let step = 0; step < substeps; step += 1) {
    prepareFilamentSolverContext(filaments, params, nextSolverContext)
    if (typeof options.onSubstepPrepared === 'function') {
      options.onSubstepPrepared({
        filaments,
        params,
        substepIndex: step,
        substepCount: substeps,
        dt: subDt,
        solverContext: nextSolverContext,
      })
    }
    const selfStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    computeFilamentSelfVelocities(filaments, params, nextSolverContext)
    const selfFinishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    qualityStats.operatorSelfInducedMs += selfFinishedAt - selfStartedAt
    advectFilamentsWithIntegrator(filaments, params, subDt, nextSolverContext)
    applyHybridCenterLock(filaments, options.particles, subDt, params)
    applyKelvinWavePerturbation(filaments, subDt, params)
    const smoothingStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    smoothFilaments(filaments, params, qualityStats)
    const smoothingFinishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    qualityStats.operatorSmoothingMs += smoothingFinishedAt - smoothingStartedAt
    const regularizationStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    regularizeFilaments(filaments, params, qualityStats)
    const regularizationFinishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    qualityStats.operatorRegularizationMs += regularizationFinishedAt - regularizationStartedAt
    for (let f = 0; f < filaments.length; f += 1) {
      computeFilamentCurvature(filaments[f])
      computeFilamentStrainRate(filaments[f])
    }
    detectFilamentInstability(filaments, params)
    applyFilamentInstability(filaments, params)
    ensureFilamentTopology(filaments, params, qualityStats)
  }

  measureTransportStats(filamentStateBefore, filaments, Math.max(dt, 1e-8), qualityStats)
  const particleCouplingStats = options.hybridCouplingContext?.stats?.particleToFilament
  const adaptiveRefinement = resolveAdaptiveRefinementSettings({
    filaments,
    params,
    qualityStats,
    particleCouplingStats,
    previousPressure: nextSolverContext.adaptiveRefinementState.pressureEma ?? 0,
  })
  nextSolverContext.adaptiveRefinementState.pressureEma = adaptiveRefinement.smoothedPressure
  qualityStats.adaptiveRefinementPressureAvg = adaptiveRefinement.smoothedPressure
  qualityStats.adaptiveRefinementPressureMax = adaptiveRefinement.pressure
  qualityStats.adaptiveSplitBudgetScale = adaptiveRefinement.splitBudgetScale
  qualityStats.adaptiveMaxSegmentScale = adaptiveRefinement.maxSegmentScale
  qualityStats.adaptiveMinSegmentScale = adaptiveRefinement.minSegmentScale
  adaptFilaments(filaments, params, qualityStats, {
    maxSegmentScale: adaptiveRefinement.maxSegmentScale,
    minSegmentScale: adaptiveRefinement.minSegmentScale,
    splitBudgetScale: adaptiveRefinement.splitBudgetScale,
  })
  applyHybridRadiusGuard(filaments, filamentStateBefore, qualityStats, params)
  ensureFilamentTopology(filaments, params, qualityStats)
  const reconnectStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  reconnectFilaments(filaments, params, qualityStats, nextSolverContext)
  const reconnectFinishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  qualityStats.operatorReconnectionMs += reconnectFinishedAt - reconnectStartedAt
  ensureFilamentTopology(filaments, params, qualityStats)
  const circulationAfter = computeTotalCirculation(filaments)
  const circulationDriftAbs = circulationAfter - circulationBefore
  const circulationDriftPercent =
    (circulationDriftAbs / Math.max(Math.abs(circulationBefore), 1e-8)) * 100
  qualityStats.circulationBefore = circulationBefore
  qualityStats.circulationAfter = circulationAfter
  qualityStats.circulationDriftAbs = circulationDriftAbs
  qualityStats.circulationDriftPercent = circulationDriftPercent
  qualityStats.circulationViolationCount =
    Math.abs(circulationDriftPercent) >
    Math.max(params.filamentCirculationDriftWarnPercent ?? 0.5, 0)
      ? 1
      : 0
  measureTransportStats(filamentStateBefore, filaments, Math.max(dt, 1e-8), qualityStats)
  const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  commitFilamentSolverStats(nextSolverContext, finishedAt - startedAt)
  return nextSolverContext
}
