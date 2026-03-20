import { buildSegmentGrid, querySegmentGrid } from './segmentGrid'

const FOUR_PI = 4 * Math.PI
const TOKEN_LIMIT = 0xfffffff0
const filamentQueryStats = {
  queryCount: 0,
  totalSegmentRefs: 0,
  maxSegmentRefs: 0,
  couplingQueryCount: 0,
  totalCouplingSamples: 0,
  maxCouplingSamples: 0,
  stepMs: 0,
  splitCount: 0,
  mergeCount: 0,
  nodesAddedThisStep: 0,
  splitMergeNet: 0,
  splitBudgetHitCount: 0,
  transportStepDistanceAvg: 0,
  transportStepDistanceMax: 0,
  transportVelocityAvg: 0,
  transportVelocityMax: 0,
  transportCenterStep: 0,
  radiusGuardActivations: 0,
  reconnectAttempts: 0,
  reconnectSuccess: 0,
  reconnectRejected: 0,
  reconnectRejectedCooldown: 0,
  reconnectRejectedNearEndpointA: 0,
  reconnectRejectedNearEndpointB: 0,
  reconnectRejectedNodeLimit: 0,
  reconnectRejectedDegenerateInsert: 0,
  reconnectRejectedDistance: 0,
  reconnectRejectedAngle: 0,
  reconnectMultipleApplied: 0,
  vortexAnnihilationCount: 0,
  topologyRejects: 0,
  repairedNodes: 0,
  degenerateSegmentsRemoved: 0,
  closedLoopViolations: 0,
  regularizationCorrections: 0,
  regularizedFilaments: 0,
  operatorSelfInducedMs: 0,
  operatorSmoothingMs: 0,
  operatorRegularizationMs: 0,
  operatorReconnectionMs: 0,
  adaptiveRefinementPressureAvg: 0,
  adaptiveRefinementPressureMax: 0,
  adaptiveSplitBudgetScale: 1,
  adaptiveMaxSegmentScale: 1,
  adaptiveMinSegmentScale: 1,
  liaVelocityAvg: 0,
  liaVelocityMax: 0,
  smoothingCurvatureAvg: 0,
  smoothingCurvatureMax: 0,
  circulationBefore: 0,
  circulationAfter: 0,
  circulationDriftAbs: 0,
  circulationDriftPercent: 0,
  circulationViolationCount: 0,
}

function length(vector) {
  return Math.hypot(vector.x, vector.y, vector.z)
}

function clampMagnitude(vector, maxValue) {
  if (!(maxValue > 0)) {
    return vector
  }

  const valueLength = length(vector)
  if (valueLength <= maxValue || valueLength <= 1e-8) {
    return vector
  }

  const scale = maxValue / valueLength
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  }
}

function addTo(target, source, scale = 1) {
  target.x += source.x * scale
  target.y += source.y * scale
  target.z += source.z * scale
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  }
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function parseCellKey(key) {
  const parts = key.split(':')
  if (parts.length !== 3) {
    return null
  }
  const ix = Number(parts[0])
  const iy = Number(parts[1])
  const iz = Number(parts[2])
  if (!Number.isFinite(ix) || !Number.isFinite(iy) || !Number.isFinite(iz)) {
    return null
  }
  return { ix, iy, iz }
}

function buildFarFieldAggregates(filaments, grid) {
  const farFieldCells = []
  if (!grid?.cells || !grid?.segments) {
    return farFieldCells
  }

  for (const [key, segmentIndices] of grid.cells.entries()) {
    if (!Array.isArray(segmentIndices) || segmentIndices.length === 0) {
      continue
    }
    const cellCoord = parseCellKey(key)
    if (!cellCoord) {
      continue
    }

    let totalLength = 0
    let centerX = 0
    let centerY = 0
    let centerZ = 0
    let vectorX = 0
    let vectorY = 0
    let vectorZ = 0
    let coreWeighted = 0

    for (let i = 0; i < segmentIndices.length; i += 1) {
      const segmentRef = grid.segments[segmentIndices[i]]
      if (!segmentRef) {
        continue
      }
      const filament = filaments[segmentRef.filamentIndex]
      if (!filament) {
        continue
      }
      const a = filament.nodes[segmentRef.aIndex]?.position
      const b = filament.nodes[segmentRef.bIndex]?.position
      if (!a || !b) {
        continue
      }

      const dx = b.x - a.x
      const dy = b.y - a.y
      const dz = b.z - a.z
      const lengthValue = Math.hypot(dx, dy, dz)
      if (lengthValue <= 1e-10) {
        continue
      }

      const midpointX = (a.x + b.x) * 0.5
      const midpointY = (a.y + b.y) * 0.5
      const midpointZ = (a.z + b.z) * 0.5
      const circulation = filament.circulation ?? 0
      const coreRadius = Math.max(filament.coreRadius ?? 0.08, 1e-6)

      totalLength += lengthValue
      centerX += midpointX * lengthValue
      centerY += midpointY * lengthValue
      centerZ += midpointZ * lengthValue
      vectorX += circulation * dx
      vectorY += circulation * dy
      vectorZ += circulation * dz
      coreWeighted += coreRadius * lengthValue
    }

    if (totalLength <= 1e-10) {
      continue
    }

    farFieldCells.push({
      ix: cellCoord.ix,
      iy: cellCoord.iy,
      iz: cellCoord.iz,
      center: {
        x: centerX / totalLength,
        y: centerY / totalLength,
        z: centerZ / totalLength,
      },
      circulationVector: {
        x: vectorX,
        y: vectorY,
        z: vectorZ,
      },
      coreRadius: coreWeighted / totalLength,
    })
  }

  return farFieldCells
}

function evaluateAggregatedCellVelocity(point, aggregate) {
  const rx = point.x - aggregate.center.x
  const ry = point.y - aggregate.center.y
  const rz = point.z - aggregate.center.z
  const r2 = rx * rx + ry * ry + rz * rz
  const coreRadius = Math.max(aggregate.coreRadius ?? 0.08, 1e-6)
  const denom = (r2 + coreRadius * coreRadius) ** 1.5
  if (denom <= 1e-10) {
    return { x: 0, y: 0, z: 0 }
  }

  const v = aggregate.circulationVector
  const crossX = v.y * rz - v.z * ry
  const crossY = v.z * rx - v.x * rz
  const crossZ = v.x * ry - v.y * rx
  const factor = 1 / (FOUR_PI * denom)

  return {
    x: crossX * factor,
    y: crossY * factor,
    z: crossZ * factor,
  }
}

export function getFilamentVelocityLimit(params) {
  const particleVelocityLimit = Math.max(params?.maxVelocity ?? 0, 0)
  const baseLimit = particleVelocityLimit || 2.5
  const speedScale = Math.max(params?.filamentVelocityScale ?? 1, 0.01)
  return Math.max(baseLimit * speedScale, 0.02)
}

export function getEffectiveFilamentVelocityLimit(params, filamentCount) {
  const base = getFilamentVelocityLimit(params)
  if (filamentCount < 2) return base
  const factor = Math.max(0.2, Math.min(4, params?.filamentMultiFilamentVelocityFactor ?? 1))
  return base * factor
}

function createStatsBucket() {
  return {
    queryCount: 0,
    totalSegmentRefs: 0,
    maxSegmentRefs: 0,
  }
}

function resetStatsBucket(stats) {
  stats.queryCount = 0
  stats.totalSegmentRefs = 0
  stats.maxSegmentRefs = 0
}

function recordStatsBucket(stats, segmentRefCount) {
  stats.queryCount += 1
  stats.totalSegmentRefs += segmentRefCount
  if (segmentRefCount > stats.maxSegmentRefs) {
    stats.maxSegmentRefs = segmentRefCount
  }
}

function ensureQueryScratchCapacity(queryScratch, segmentCount) {
  const safeSegmentCount = Math.max(1, segmentCount)
  if (!(queryScratch.marks instanceof Uint32Array) || queryScratch.marks.length < safeSegmentCount) {
    queryScratch.marks = new Uint32Array(safeSegmentCount)
    queryScratch.token = 1
  }
  if (!Array.isArray(queryScratch.segmentRefs)) {
    queryScratch.segmentRefs = new Array(safeSegmentCount)
  } else if (queryScratch.segmentRefs.length < safeSegmentCount) {
    queryScratch.segmentRefs.length = safeSegmentCount
  }
}

function nextQueryToken(queryScratch) {
  const token = queryScratch.token
  queryScratch.token += 1
  if (queryScratch.token >= TOKEN_LIMIT) {
    queryScratch.marks.fill(0)
    queryScratch.token = 1
  }
  return token
}

export function resetFilamentQueryStats() {
  filamentQueryStats.queryCount = 0
  filamentQueryStats.totalSegmentRefs = 0
  filamentQueryStats.maxSegmentRefs = 0
  filamentQueryStats.couplingQueryCount = 0
  filamentQueryStats.totalCouplingSamples = 0
  filamentQueryStats.maxCouplingSamples = 0
  filamentQueryStats.stepMs = 0
  filamentQueryStats.splitCount = 0
  filamentQueryStats.mergeCount = 0
  filamentQueryStats.nodesAddedThisStep = 0
  filamentQueryStats.splitMergeNet = 0
  filamentQueryStats.splitBudgetHitCount = 0
  filamentQueryStats.transportStepDistanceAvg = 0
  filamentQueryStats.transportStepDistanceMax = 0
  filamentQueryStats.transportVelocityAvg = 0
  filamentQueryStats.transportVelocityMax = 0
  filamentQueryStats.transportCenterStep = 0
  filamentQueryStats.radiusGuardActivations = 0
  filamentQueryStats.reconnectAttempts = 0
  filamentQueryStats.reconnectSuccess = 0
  filamentQueryStats.reconnectRejected = 0
  filamentQueryStats.reconnectRejectedCooldown = 0
  filamentQueryStats.reconnectRejectedNearEndpointA = 0
  filamentQueryStats.reconnectRejectedNearEndpointB = 0
  filamentQueryStats.reconnectRejectedNodeLimit = 0
  filamentQueryStats.reconnectRejectedDegenerateInsert = 0
  filamentQueryStats.reconnectRejectedDistance = 0
  filamentQueryStats.reconnectRejectedAngle = 0
  filamentQueryStats.reconnectMultipleApplied = 0
  filamentQueryStats.vortexAnnihilationCount = 0
  filamentQueryStats.topologyRejects = 0
  filamentQueryStats.repairedNodes = 0
  filamentQueryStats.degenerateSegmentsRemoved = 0
  filamentQueryStats.closedLoopViolations = 0
  filamentQueryStats.regularizationCorrections = 0
  filamentQueryStats.regularizedFilaments = 0
  filamentQueryStats.operatorSelfInducedMs = 0
  filamentQueryStats.operatorSmoothingMs = 0
  filamentQueryStats.operatorRegularizationMs = 0
  filamentQueryStats.operatorReconnectionMs = 0
  filamentQueryStats.adaptiveRefinementPressureAvg = 0
  filamentQueryStats.adaptiveRefinementPressureMax = 0
  filamentQueryStats.adaptiveSplitBudgetScale = 1
  filamentQueryStats.adaptiveMaxSegmentScale = 1
  filamentQueryStats.adaptiveMinSegmentScale = 1
  filamentQueryStats.liaVelocityAvg = 0
  filamentQueryStats.liaVelocityMax = 0
  filamentQueryStats.smoothingCurvatureAvg = 0
  filamentQueryStats.smoothingCurvatureMax = 0
  filamentQueryStats.circulationBefore = 0
  filamentQueryStats.circulationAfter = 0
  filamentQueryStats.circulationDriftAbs = 0
  filamentQueryStats.circulationDriftPercent = 0
  filamentQueryStats.circulationViolationCount = 0
}

export function getFilamentQueryStats() {
  const averageSegmentRefs =
    filamentQueryStats.queryCount > 0
      ? filamentQueryStats.totalSegmentRefs / filamentQueryStats.queryCount
      : 0
  const averageCouplingSamples =
    filamentQueryStats.couplingQueryCount > 0
      ? filamentQueryStats.totalCouplingSamples / filamentQueryStats.couplingQueryCount
      : 0

  return {
    queryCount: filamentQueryStats.queryCount,
    averageSegmentRefs,
    maxSegmentRefs: filamentQueryStats.maxSegmentRefs,
    couplingQueryCount: filamentQueryStats.couplingQueryCount,
    averageCouplingSamples,
    maxCouplingSamples: filamentQueryStats.maxCouplingSamples,
    stepMs: filamentQueryStats.stepMs,
    splitCount: filamentQueryStats.splitCount,
    mergeCount: filamentQueryStats.mergeCount,
    nodesAddedThisStep: filamentQueryStats.nodesAddedThisStep,
    splitMergeNet: filamentQueryStats.splitMergeNet,
    splitBudgetHitCount: filamentQueryStats.splitBudgetHitCount,
    transportStepDistanceAvg: filamentQueryStats.transportStepDistanceAvg,
    transportStepDistanceMax: filamentQueryStats.transportStepDistanceMax,
    transportVelocityAvg: filamentQueryStats.transportVelocityAvg,
    transportVelocityMax: filamentQueryStats.transportVelocityMax,
    transportCenterStep: filamentQueryStats.transportCenterStep,
    radiusGuardActivations: filamentQueryStats.radiusGuardActivations,
    reconnectAttempts: filamentQueryStats.reconnectAttempts,
    reconnectSuccess: filamentQueryStats.reconnectSuccess,
    reconnectRejected: filamentQueryStats.reconnectRejected,
    reconnectRejectedCooldown: filamentQueryStats.reconnectRejectedCooldown,
    reconnectRejectedNearEndpointA: filamentQueryStats.reconnectRejectedNearEndpointA,
    reconnectRejectedNearEndpointB: filamentQueryStats.reconnectRejectedNearEndpointB,
    reconnectRejectedNodeLimit: filamentQueryStats.reconnectRejectedNodeLimit,
    reconnectRejectedDegenerateInsert: filamentQueryStats.reconnectRejectedDegenerateInsert,
    reconnectRejectedDistance: filamentQueryStats.reconnectRejectedDistance,
    reconnectRejectedAngle: filamentQueryStats.reconnectRejectedAngle,
    reconnectMultipleApplied: filamentQueryStats.reconnectMultipleApplied,
    vortexAnnihilationCount: filamentQueryStats.vortexAnnihilationCount,
    topologyRejects: filamentQueryStats.topologyRejects,
    repairedNodes: filamentQueryStats.repairedNodes,
    degenerateSegmentsRemoved: filamentQueryStats.degenerateSegmentsRemoved,
    closedLoopViolations: filamentQueryStats.closedLoopViolations,
    regularizationCorrections: filamentQueryStats.regularizationCorrections,
    regularizedFilaments: filamentQueryStats.regularizedFilaments,
    operatorSelfInducedMs: filamentQueryStats.operatorSelfInducedMs,
    operatorSmoothingMs: filamentQueryStats.operatorSmoothingMs,
    operatorRegularizationMs: filamentQueryStats.operatorRegularizationMs,
    operatorReconnectionMs: filamentQueryStats.operatorReconnectionMs,
    adaptiveRefinementPressureAvg: filamentQueryStats.adaptiveRefinementPressureAvg,
    adaptiveRefinementPressureMax: filamentQueryStats.adaptiveRefinementPressureMax,
    adaptiveSplitBudgetScale: filamentQueryStats.adaptiveSplitBudgetScale,
    adaptiveMaxSegmentScale: filamentQueryStats.adaptiveMaxSegmentScale,
    adaptiveMinSegmentScale: filamentQueryStats.adaptiveMinSegmentScale,
    liaVelocityAvg: filamentQueryStats.liaVelocityAvg,
    liaVelocityMax: filamentQueryStats.liaVelocityMax,
    smoothingCurvatureAvg: filamentQueryStats.smoothingCurvatureAvg,
    smoothingCurvatureMax: filamentQueryStats.smoothingCurvatureMax,
    circulationBefore: filamentQueryStats.circulationBefore,
    circulationAfter: filamentQueryStats.circulationAfter,
    circulationDriftAbs: filamentQueryStats.circulationDriftAbs,
    circulationDriftPercent: filamentQueryStats.circulationDriftPercent,
    circulationViolationCount: filamentQueryStats.circulationViolationCount,
  }
}

export function commitFilamentSolverStats(solverContext, stepMs = 0) {
  const selfStats = solverContext?.stats?.selfQueries ?? createStatsBucket()
  const couplingStats = solverContext?.stats?.couplingQueries ?? createStatsBucket()
  const qualityStats = solverContext?.stats?.quality ?? {
    splitCount: 0,
    mergeCount: 0,
    nodesAddedThisStep: 0,
    splitMergeNet: 0,
    splitBudgetHitCount: 0,
    transportStepDistanceAvg: 0,
    transportStepDistanceMax: 0,
    transportVelocityAvg: 0,
    transportVelocityMax: 0,
    transportCenterStep: 0,
    radiusGuardActivations: 0,
    reconnectAttempts: 0,
    reconnectSuccess: 0,
    reconnectRejected: 0,
    reconnectRejectedCooldown: 0,
    reconnectRejectedNearEndpointA: 0,
    reconnectRejectedNearEndpointB: 0,
    reconnectRejectedNodeLimit: 0,
    reconnectRejectedDegenerateInsert: 0,
    reconnectRejectedDistance: 0,
    reconnectRejectedAngle: 0,
    reconnectMultipleApplied: 0,
    vortexAnnihilationCount: 0,
    topologyRejects: 0,
    repairedNodes: 0,
    degenerateSegmentsRemoved: 0,
    closedLoopViolations: 0,
    regularizationCorrections: 0,
    regularizedFilaments: 0,
    operatorSelfInducedMs: 0,
    operatorSmoothingMs: 0,
    operatorRegularizationMs: 0,
    operatorReconnectionMs: 0,
    adaptiveRefinementPressureAvg: 0,
    adaptiveRefinementPressureMax: 0,
    adaptiveSplitBudgetScale: 1,
    adaptiveMaxSegmentScale: 1,
    adaptiveMinSegmentScale: 1,
    liaVelocityAvg: 0,
    liaVelocityMax: 0,
    smoothingCurvatureAvg: 0,
    smoothingCurvatureMax: 0,
    circulationBefore: 0,
    circulationAfter: 0,
    circulationDriftAbs: 0,
    circulationDriftPercent: 0,
    circulationViolationCount: 0,
  }

  filamentQueryStats.queryCount = selfStats.queryCount
  filamentQueryStats.totalSegmentRefs = selfStats.totalSegmentRefs
  filamentQueryStats.maxSegmentRefs = selfStats.maxSegmentRefs
  filamentQueryStats.couplingQueryCount = couplingStats.queryCount
  filamentQueryStats.totalCouplingSamples = couplingStats.totalSegmentRefs
  filamentQueryStats.maxCouplingSamples = couplingStats.maxSegmentRefs
  filamentQueryStats.stepMs = stepMs
  filamentQueryStats.splitCount = qualityStats.splitCount
  filamentQueryStats.mergeCount = qualityStats.mergeCount
  filamentQueryStats.nodesAddedThisStep = qualityStats.nodesAddedThisStep
  filamentQueryStats.splitMergeNet = qualityStats.splitMergeNet
  filamentQueryStats.splitBudgetHitCount = qualityStats.splitBudgetHitCount
  filamentQueryStats.transportStepDistanceAvg = qualityStats.transportStepDistanceAvg
  filamentQueryStats.transportStepDistanceMax = qualityStats.transportStepDistanceMax
  filamentQueryStats.transportVelocityAvg = qualityStats.transportVelocityAvg
  filamentQueryStats.transportVelocityMax = qualityStats.transportVelocityMax
  filamentQueryStats.transportCenterStep = qualityStats.transportCenterStep
  filamentQueryStats.radiusGuardActivations = qualityStats.radiusGuardActivations
  filamentQueryStats.reconnectAttempts = qualityStats.reconnectAttempts
  filamentQueryStats.reconnectSuccess = qualityStats.reconnectSuccess
  filamentQueryStats.reconnectRejected = qualityStats.reconnectRejected
  filamentQueryStats.reconnectRejectedCooldown = qualityStats.reconnectRejectedCooldown
  filamentQueryStats.reconnectRejectedNearEndpointA = qualityStats.reconnectRejectedNearEndpointA
  filamentQueryStats.reconnectRejectedNearEndpointB = qualityStats.reconnectRejectedNearEndpointB
  filamentQueryStats.reconnectRejectedNodeLimit = qualityStats.reconnectRejectedNodeLimit
  filamentQueryStats.reconnectRejectedDegenerateInsert =
    qualityStats.reconnectRejectedDegenerateInsert
  filamentQueryStats.reconnectRejectedDistance = qualityStats.reconnectRejectedDistance ?? 0
  filamentQueryStats.reconnectRejectedAngle = qualityStats.reconnectRejectedAngle ?? 0
  filamentQueryStats.reconnectMultipleApplied = qualityStats.reconnectMultipleApplied ?? 0
  filamentQueryStats.vortexAnnihilationCount = qualityStats.vortexAnnihilationCount ?? 0
  filamentQueryStats.topologyRejects = qualityStats.topologyRejects
  filamentQueryStats.repairedNodes = qualityStats.repairedNodes
  filamentQueryStats.degenerateSegmentsRemoved = qualityStats.degenerateSegmentsRemoved
  filamentQueryStats.closedLoopViolations = qualityStats.closedLoopViolations
  filamentQueryStats.regularizationCorrections = qualityStats.regularizationCorrections
  filamentQueryStats.regularizedFilaments = qualityStats.regularizedFilaments
  filamentQueryStats.operatorSelfInducedMs = qualityStats.operatorSelfInducedMs ?? 0
  filamentQueryStats.operatorSmoothingMs = qualityStats.operatorSmoothingMs ?? 0
  filamentQueryStats.operatorRegularizationMs = qualityStats.operatorRegularizationMs ?? 0
  filamentQueryStats.operatorReconnectionMs = qualityStats.operatorReconnectionMs ?? 0
  filamentQueryStats.adaptiveRefinementPressureAvg = qualityStats.adaptiveRefinementPressureAvg ?? 0
  filamentQueryStats.adaptiveRefinementPressureMax = qualityStats.adaptiveRefinementPressureMax ?? 0
  filamentQueryStats.adaptiveSplitBudgetScale = qualityStats.adaptiveSplitBudgetScale ?? 1
  filamentQueryStats.adaptiveMaxSegmentScale = qualityStats.adaptiveMaxSegmentScale ?? 1
  filamentQueryStats.adaptiveMinSegmentScale = qualityStats.adaptiveMinSegmentScale ?? 1
  filamentQueryStats.liaVelocityAvg = qualityStats.liaVelocityAvg ?? 0
  filamentQueryStats.liaVelocityMax = qualityStats.liaVelocityMax ?? 0
  filamentQueryStats.smoothingCurvatureAvg = qualityStats.smoothingCurvatureAvg ?? 0
  filamentQueryStats.smoothingCurvatureMax = qualityStats.smoothingCurvatureMax ?? 0
  filamentQueryStats.circulationBefore = qualityStats.circulationBefore ?? 0
  filamentQueryStats.circulationAfter = qualityStats.circulationAfter ?? 0
  filamentQueryStats.circulationDriftAbs = qualityStats.circulationDriftAbs ?? 0
  filamentQueryStats.circulationDriftPercent = qualityStats.circulationDriftPercent ?? 0
  filamentQueryStats.circulationViolationCount = qualityStats.circulationViolationCount ?? 0
}

export function getFilamentGridConfig(params) {
  const interactionRadius = Math.max(params.interactionRadius ?? 0, 0)
  const localRadius = Math.max(
    (params.maxSegmentLength ?? 0.25) * 4,
    (params.filamentCoreRadius ?? 0.08) * 6,
  )
  const searchRadius =
    interactionRadius > 0 ? Math.min(interactionRadius, localRadius) : localRadius
  const gridCellSize = Math.max(searchRadius * 0.75, 1e-4)

  return {
    searchRadius,
    gridCellSize,
  }
}

export function createFilamentSolverContext() {
  return {
    grid: null,
    farFieldCells: [],
    searchRadius: 0,
    gridCellSize: 0,
    queryScratch: {
      segmentRefs: new Array(1),
      marks: new Uint32Array(1),
      token: 1,
    },
    runtimeIds: new WeakMap(),
    nextRuntimeId: 1,
    reconnectStepIndex: 0,
    reconnectCooldowns: new Map(),
    stats: {
      selfQueries: createStatsBucket(),
      couplingQueries: createStatsBucket(),
      quality: {
        splitCount: 0,
        mergeCount: 0,
        nodesAddedThisStep: 0,
        splitMergeNet: 0,
        splitBudgetHitCount: 0,
        transportStepDistanceAvg: 0,
        transportStepDistanceMax: 0,
        transportVelocityAvg: 0,
        transportVelocityMax: 0,
        transportCenterStep: 0,
        radiusGuardActivations: 0,
        reconnectAttempts: 0,
        reconnectSuccess: 0,
        reconnectRejected: 0,
        reconnectRejectedCooldown: 0,
        reconnectRejectedNearEndpointA: 0,
        reconnectRejectedNearEndpointB: 0,
        reconnectRejectedNodeLimit: 0,
        reconnectRejectedDegenerateInsert: 0,
        reconnectRejectedDistance: 0,
        reconnectRejectedAngle: 0,
        reconnectMultipleApplied: 0,
        vortexAnnihilationCount: 0,
        topologyRejects: 0,
        repairedNodes: 0,
        degenerateSegmentsRemoved: 0,
        closedLoopViolations: 0,
        regularizationCorrections: 0,
        regularizedFilaments: 0,
        operatorSelfInducedMs: 0,
        operatorSmoothingMs: 0,
        operatorRegularizationMs: 0,
        operatorReconnectionMs: 0,
        adaptiveRefinementPressureAvg: 0,
        adaptiveRefinementPressureMax: 0,
        adaptiveSplitBudgetScale: 1,
        adaptiveMaxSegmentScale: 1,
        adaptiveMinSegmentScale: 1,
        liaVelocityAvg: 0,
        liaVelocityMax: 0,
        liaNodeCount: 0,
        smoothingCurvatureAvg: 0,
        smoothingCurvatureMax: 0,
        circulationBefore: 0,
        circulationAfter: 0,
        circulationDriftAbs: 0,
        circulationDriftPercent: 0,
        circulationViolationCount: 0,
      },
    },
  }
}

export function getOrCreateFilamentRuntimeId(solverContext, filament) {
  if (!solverContext?.runtimeIds || !filament || typeof filament !== 'object') {
    return -1
  }

  let runtimeId = solverContext.runtimeIds.get(filament)
  if (!Number.isFinite(runtimeId)) {
    runtimeId = solverContext.nextRuntimeId
    solverContext.nextRuntimeId += 1
    solverContext.runtimeIds.set(filament, runtimeId)
  }

  return runtimeId
}

export function resetFilamentSolverContextStats(
  solverContext,
  { resetSelfStats = true, resetCouplingStats = true, resetQualityStats = true } = {},
) {
  if (!solverContext?.stats) {
    return
  }

  if (resetSelfStats) {
    resetStatsBucket(solverContext.stats.selfQueries)
  }
  if (resetCouplingStats) {
    resetStatsBucket(solverContext.stats.couplingQueries)
  }
  if (resetQualityStats) {
    solverContext.stats.quality.splitCount = 0
    solverContext.stats.quality.mergeCount = 0
    solverContext.stats.quality.nodesAddedThisStep = 0
    solverContext.stats.quality.splitMergeNet = 0
    solverContext.stats.quality.splitBudgetHitCount = 0
    solverContext.stats.quality.transportStepDistanceAvg = 0
    solverContext.stats.quality.transportStepDistanceMax = 0
    solverContext.stats.quality.transportVelocityAvg = 0
    solverContext.stats.quality.transportVelocityMax = 0
    solverContext.stats.quality.transportCenterStep = 0
    solverContext.stats.quality.radiusGuardActivations = 0
    solverContext.stats.quality.reconnectAttempts = 0
    solverContext.stats.quality.reconnectSuccess = 0
    solverContext.stats.quality.reconnectRejected = 0
    solverContext.stats.quality.reconnectRejectedCooldown = 0
    solverContext.stats.quality.reconnectRejectedNearEndpointA = 0
    solverContext.stats.quality.reconnectRejectedNearEndpointB = 0
    solverContext.stats.quality.reconnectRejectedNodeLimit = 0
    solverContext.stats.quality.reconnectRejectedDegenerateInsert = 0
    solverContext.stats.quality.reconnectRejectedDistance = 0
    solverContext.stats.quality.reconnectRejectedAngle = 0
    solverContext.stats.quality.reconnectMultipleApplied = 0
    solverContext.stats.quality.vortexAnnihilationCount = 0
    solverContext.stats.quality.topologyRejects = 0
    solverContext.stats.quality.repairedNodes = 0
    solverContext.stats.quality.degenerateSegmentsRemoved = 0
    solverContext.stats.quality.closedLoopViolations = 0
    solverContext.stats.quality.regularizationCorrections = 0
    solverContext.stats.quality.regularizedFilaments = 0
    solverContext.stats.quality.operatorSelfInducedMs = 0
    solverContext.stats.quality.operatorSmoothingMs = 0
    solverContext.stats.quality.operatorRegularizationMs = 0
    solverContext.stats.quality.operatorReconnectionMs = 0
    solverContext.stats.quality.adaptiveRefinementPressureAvg = 0
    solverContext.stats.quality.adaptiveRefinementPressureMax = 0
    solverContext.stats.quality.adaptiveSplitBudgetScale = 1
    solverContext.stats.quality.adaptiveMaxSegmentScale = 1
    solverContext.stats.quality.adaptiveMinSegmentScale = 1
    solverContext.stats.quality.liaVelocityAvg = 0
    solverContext.stats.quality.liaVelocityMax = 0
    solverContext.stats.quality.liaNodeCount = 0
    solverContext.stats.quality.smoothingCurvatureAvg = 0
    solverContext.stats.quality.smoothingCurvatureMax = 0
    solverContext.stats.quality.circulationBefore = 0
    solverContext.stats.quality.circulationAfter = 0
    solverContext.stats.quality.circulationDriftAbs = 0
    solverContext.stats.quality.circulationDriftPercent = 0
    solverContext.stats.quality.circulationViolationCount = 0
  }
}

export function prepareFilamentSolverContext(
  filaments,
  params,
  solverContext = null,
  { resetSelfStats = false, resetCouplingStats = false } = {},
) {
  const context = solverContext ?? createFilamentSolverContext()
  const gridConfig = getFilamentGridConfig(params)
  context.gridCellSize = gridConfig.gridCellSize
  context.searchRadius = gridConfig.searchRadius
  context.grid = buildSegmentGrid(filaments, context.gridCellSize)
  context.farFieldCells = buildFarFieldAggregates(filaments, context.grid)
  ensureQueryScratchCapacity(context.queryScratch, context.grid.segments.length)
  resetFilamentSolverContextStats(context, { resetSelfStats, resetCouplingStats })
  return context
}

export function evaluateSegmentVelocity(point, a, b, circulation, coreRadius) {
  const r0x = b.x - a.x
  const r0y = b.y - a.y
  const r0z = b.z - a.z
  const r0LenSq = r0x * r0x + r0y * r0y + r0z * r0z
  if (r0LenSq <= 1e-16) {
    return { x: 0, y: 0, z: 0 }
  }
  const r1x = point.x - a.x
  const r1y = point.y - a.y
  const r1z = point.z - a.z
  const r2x = point.x - b.x
  const r2y = point.y - b.y
  const r2z = point.z - b.z

  const crossX = r1y * r2z - r1z * r2y
  const crossY = r1z * r2x - r1x * r2z
  const crossZ = r1x * r2y - r1y * r2x
  const crossLengthSq = crossX * crossX + crossY * crossY + crossZ * crossZ

  if (crossLengthSq <= 1e-12) {
    return { x: 0, y: 0, z: 0 }
  }

  const r1LenSq = r1x * r1x + r1y * r1y + r1z * r1z
  const r2LenSq = r2x * r2x + r2y * r2y + r2z * r2z
  if (r1LenSq <= 1e-16 || r2LenSq <= 1e-16) {
    return { x: 0, y: 0, z: 0 }
  }

  const r1InvLen = 1 / Math.sqrt(r1LenSq)
  const r2InvLen = 1 / Math.sqrt(r2LenSq)
  const safeCoreRadius = Math.max(coreRadius ?? 0, 1e-8)
  const crossRegularized = crossLengthSq + safeCoreRadius * safeCoreRadius * r0LenSq + 1e-18
  const dx = r1x * r1InvLen - r2x * r2InvLen
  const dy = r1y * r1InvLen - r2y * r2InvLen
  const dz = r1z * r1InvLen - r2z * r2InvLen
  const filamentFactor = r0x * dx + r0y * dy + r0z * dz

  if (Math.abs(filamentFactor) <= 1e-12 || crossRegularized <= 1e-12) {
    return { x: 0, y: 0, z: 0 }
  }

  const factor = circulation / FOUR_PI * filamentFactor / crossRegularized
  return {
    x: crossX * factor,
    y: crossY * factor,
    z: crossZ * factor,
  }
}

function shouldExcludeAdjacentSelfSegment(segmentRef, excludeFilamentIndex, excludeNodeIndex, nodeCount) {
  if (segmentRef.filamentIndex !== excludeFilamentIndex || excludeNodeIndex < 0) {
    return false
  }

  return (
    segmentRef.aIndex === excludeNodeIndex ||
    segmentRef.bIndex === excludeNodeIndex ||
    Math.abs(segmentRef.aIndex - excludeNodeIndex) <= 1 ||
    Math.abs(segmentRef.bIndex - excludeNodeIndex) <= 1 ||
    Math.abs(segmentRef.aIndex - excludeNodeIndex) >= nodeCount - 1 ||
    Math.abs(segmentRef.bIndex - excludeNodeIndex) >= nodeCount - 1
  )
}

function getLocalNeighborIndex(nodeIndex, nodeCount, offset, closedLoop) {
  const nextIndex = nodeIndex + offset
  if (closedLoop) {
    return (nextIndex + nodeCount) % nodeCount
  }
  if (nextIndex < 0 || nextIndex >= nodeCount) {
    return -1
  }
  return nextIndex
}

function computeLocalSelfInducedVelocity(filament, nodeIndex) {
  const nodes = filament?.nodes ?? []
  const nodeCount = nodes.length
  if (nodeCount < 3) {
    return { x: 0, y: 0, z: 0 }
  }

  const prevIndex = getLocalNeighborIndex(nodeIndex, nodeCount, -1, filament.closedLoop !== false)
  const nextIndex = getLocalNeighborIndex(nodeIndex, nodeCount, 1, filament.closedLoop !== false)
  if (prevIndex < 0 || nextIndex < 0 || prevIndex === nextIndex) {
    return { x: 0, y: 0, z: 0 }
  }

  const prevPosition = nodes[prevIndex].position
  const currentPosition = nodes[nodeIndex].position
  const nextPosition = nodes[nextIndex].position
  const prevEdge = subtract(currentPosition, prevPosition)
  const nextEdge = subtract(nextPosition, currentPosition)
  const prevLength = length(prevEdge)
  const nextLength = length(nextEdge)
  if (prevLength <= 1e-8 || nextLength <= 1e-8) {
    return { x: 0, y: 0, z: 0 }
  }

  const edgeSum = {
    x: prevEdge.x + nextEdge.x,
    y: prevEdge.y + nextEdge.y,
    z: prevEdge.z + nextEdge.z,
  }
  const edgeSumLength = length(edgeSum)
  if (edgeSumLength <= 1e-8) {
    return { x: 0, y: 0, z: 0 }
  }

  const binormal = cross(prevEdge, nextEdge)
  const binormalLength = length(binormal)
  if (binormalLength <= 1e-10) {
    return { x: 0, y: 0, z: 0 }
  }

  const curvatureBinormalScale = 2 / Math.max(prevLength * nextLength * edgeSumLength, 1e-8)
  const coreRadius = Math.max(filament.coreRadius ?? 0.08, 1e-6)
  const averageSegmentLength = (prevLength + nextLength) * 0.5
  const logFactor = Math.max(Math.log(1 + averageSegmentLength / coreRadius), 0)
  const localInductionScale = ((filament.circulation ?? 0) / FOUR_PI) * logFactor * curvatureBinormalScale

  return {
    x: binormal.x * localInductionScale,
    y: binormal.y * localInductionScale,
    z: binormal.z * localInductionScale,
  }
}

export function sampleFilamentVelocityAtPoint(
  point,
  filaments,
  solverContext,
  {
    excludeFilamentIndex = -1,
    excludeNodeIndex = -1,
    statsBucket = 'selfQueries',
  } = {},
) {
  if (!solverContext?.grid || !Array.isArray(filaments) || filaments.length === 0) {
    return { x: 0, y: 0, z: 0 }
  }

  const queryScratch = solverContext.queryScratch
  ensureQueryScratchCapacity(queryScratch, solverContext.grid.segments.length)
  const token = nextQueryToken(queryScratch)
  const segmentRefCount = querySegmentGrid(
    solverContext.grid,
    point,
    solverContext.searchRadius,
    queryScratch.segmentRefs,
    queryScratch.marks,
    token,
  )
  recordStatsBucket(solverContext.stats[statsBucket], segmentRefCount)

  const velocity = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < segmentRefCount; i += 1) {
    const segmentRef = solverContext.grid.segments[queryScratch.segmentRefs[i]]
    const sourceFilament = filaments[segmentRef.filamentIndex]
    const nodeCount = sourceFilament.nodes.length
    if (
      shouldExcludeAdjacentSelfSegment(
        segmentRef,
        excludeFilamentIndex,
        excludeNodeIndex,
        nodeCount,
      )
    ) {
      continue
    }

    const a = sourceFilament.nodes[segmentRef.aIndex].position
    const b = sourceFilament.nodes[segmentRef.bIndex].position
    const contribution = evaluateSegmentVelocity(
      point,
      a,
      b,
      sourceFilament.circulation,
      sourceFilament.coreRadius,
    )
    addTo(velocity, contribution)
  }

  const cellSize = Math.max(solverContext.grid?.cellSize ?? solverContext.gridCellSize ?? 0, 1e-6)
  const cellX = Math.floor(point.x / cellSize)
  const cellY = Math.floor(point.y / cellSize)
  const cellZ = Math.floor(point.z / cellSize)
  const nearCellRadius = Math.max(1, Math.ceil(solverContext.searchRadius / cellSize))
  const farFieldCells = solverContext.farFieldCells ?? []
  for (let i = 0; i < farFieldCells.length; i += 1) {
    const aggregate = farFieldCells[i]
    if (
      Math.abs(aggregate.ix - cellX) <= nearCellRadius &&
      Math.abs(aggregate.iy - cellY) <= nearCellRadius &&
      Math.abs(aggregate.iz - cellZ) <= nearCellRadius
    ) {
      continue
    }
    addTo(velocity, evaluateAggregatedCellVelocity(point, aggregate))
  }

  return velocity
}

export function sampleFilamentVelocityAtPointsBatch(
  pointsPacked,
  filaments,
  solverContext,
  { statsBucket = 'couplingQueries', pointStrideFloats = 4 } = {},
) {
  const stride = Math.max(4, Math.floor(pointStrideFloats))
  const pointCount =
    pointsPacked instanceof Float32Array ? Math.floor(pointsPacked.length / stride) : 0
  const velocitiesPacked = new Float32Array(pointCount * stride)
  const segmentRefCounts = new Uint32Array(pointCount)

  if (!solverContext?.grid || !Array.isArray(filaments) || filaments.length === 0 || pointCount <= 0) {
    return { velocitiesPacked, segmentRefCounts, pointCount, pointStrideFloats: stride }
  }

  const queryScratch = solverContext.queryScratch
  ensureQueryScratchCapacity(queryScratch, solverContext.grid.segments.length)
  const cellSize = Math.max(solverContext.grid?.cellSize ?? solverContext.gridCellSize ?? 0, 1e-6)
  const nearCellRadius = Math.max(1, Math.ceil(solverContext.searchRadius / cellSize))
  const farFieldCells = solverContext.farFieldCells ?? []

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const base = pointIndex * stride
    const point = {
      x: pointsPacked[base + 0] ?? 0,
      y: pointsPacked[base + 1] ?? 0,
      z: pointsPacked[base + 2] ?? 0,
    }

    const token = nextQueryToken(queryScratch)
    const segmentRefCount = querySegmentGrid(
      solverContext.grid,
      point,
      solverContext.searchRadius,
      queryScratch.segmentRefs,
      queryScratch.marks,
      token,
    )
    segmentRefCounts[pointIndex] = segmentRefCount
    recordStatsBucket(solverContext.stats[statsBucket], segmentRefCount)

    const velocity = { x: 0, y: 0, z: 0 }
    for (let i = 0; i < segmentRefCount; i += 1) {
      const segmentRef = solverContext.grid.segments[queryScratch.segmentRefs[i]]
      const sourceFilament = filaments[segmentRef.filamentIndex]
      const a = sourceFilament.nodes[segmentRef.aIndex].position
      const b = sourceFilament.nodes[segmentRef.bIndex].position
      const contribution = evaluateSegmentVelocity(
        point,
        a,
        b,
        sourceFilament.circulation,
        sourceFilament.coreRadius,
      )
      addTo(velocity, contribution)
    }

    const cellX = Math.floor(point.x / cellSize)
    const cellY = Math.floor(point.y / cellSize)
    const cellZ = Math.floor(point.z / cellSize)
    for (let i = 0; i < farFieldCells.length; i += 1) {
      const aggregate = farFieldCells[i]
      if (
        Math.abs(aggregate.ix - cellX) <= nearCellRadius &&
        Math.abs(aggregate.iy - cellY) <= nearCellRadius &&
        Math.abs(aggregate.iz - cellZ) <= nearCellRadius
      ) {
        continue
      }
      addTo(velocity, evaluateAggregatedCellVelocity(point, aggregate))
    }

    velocitiesPacked[base + 0] = velocity.x
    velocitiesPacked[base + 1] = velocity.y
    velocitiesPacked[base + 2] = velocity.z
    if (stride > 3) {
      velocitiesPacked[base + 3] = segmentRefCount
    }
  }

  return { velocitiesPacked, segmentRefCounts, pointCount, pointStrideFloats: stride }
}

export function computeFilamentSelfVelocities(filaments, params, solverContext) {
  const filamentMaxVelocity = getEffectiveFilamentVelocityLimit(params, filaments.length)
  const liaStrength = Math.max(params?.filamentLiaStrength ?? 1, 0)
  const liaClampRatio = Math.max(params?.filamentLiaClampRatio ?? 0.65, 0)
  const liaVelocityClamp = getFilamentVelocityLimit(params) * liaClampRatio
  const qualityStats = solverContext?.stats?.quality ?? null

  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const filament = filaments[filamentIndex]
    for (let nodeIndex = 0; nodeIndex < filament.nodes.length; nodeIndex += 1) {
      const node = filament.nodes[nodeIndex]
      const remoteSelfVelocity = sampleFilamentVelocityAtPoint(node.position, filaments, solverContext, {
        excludeFilamentIndex: filamentIndex,
        excludeNodeIndex: nodeIndex,
        statsBucket: 'selfQueries',
      })
      const localSelfVelocityRaw = computeLocalSelfInducedVelocity(filament, nodeIndex)
      const localSelfVelocityScaled =
        liaStrength === 1
          ? localSelfVelocityRaw
          : {
              x: localSelfVelocityRaw.x * liaStrength,
              y: localSelfVelocityRaw.y * liaStrength,
              z: localSelfVelocityRaw.z * liaStrength,
            }
      const localSelfVelocity =
        liaVelocityClamp > 0
          ? clampMagnitude(localSelfVelocityScaled, liaVelocityClamp)
          : { x: 0, y: 0, z: 0 }
      if (qualityStats) {
        const localMagnitude = length(localSelfVelocity)
        qualityStats.liaNodeCount = (qualityStats.liaNodeCount ?? 0) + 1
        const nextNodeCount = Math.max(qualityStats.liaNodeCount, 1)
        const prevTotal = (qualityStats.liaVelocityAvg ?? 0) * Math.max(nextNodeCount - 1, 0)
        qualityStats.liaVelocityAvg = (prevTotal + localMagnitude) / nextNodeCount
        qualityStats.liaVelocityMax = Math.max(qualityStats.liaVelocityMax ?? 0, localMagnitude)
      }
      node.localSelfVelocity = localSelfVelocity
      node.selfVelocity = {
        x: remoteSelfVelocity.x + localSelfVelocity.x,
        y: remoteSelfVelocity.y + localSelfVelocity.y,
        z: remoteSelfVelocity.z + localSelfVelocity.z,
      }
      node.couplingVelocity = node.couplingVelocity ?? { x: 0, y: 0, z: 0 }
      node.velocity = clampMagnitude(
        {
          x: node.selfVelocity.x + node.couplingVelocity.x,
          y: node.selfVelocity.y + node.couplingVelocity.y,
          z: node.selfVelocity.z + node.couplingVelocity.z,
        },
        filamentMaxVelocity,
      )
    }
  }
}
