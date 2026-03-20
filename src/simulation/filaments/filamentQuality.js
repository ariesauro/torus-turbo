import {
  distance,
  getSegmentCount,
  getSegmentPair,
  minNodeCountForFilament,
} from './filamentGeometry'

function createEmptyStats() {
  return {
    topologyRejects: 0,
    repairedNodes: 0,
    degenerateSegmentsRemoved: 0,
    closedLoopViolations: 0,
  }
}

function ensureFiniteVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: Number.isFinite(vector?.x) ? vector.x : fallback.x,
    y: Number.isFinite(vector?.y) ? vector.y : fallback.y,
    z: Number.isFinite(vector?.z) ? vector.z : fallback.z,
  }
}

function normalizeFilamentNode(node, stats) {
  const nextPosition = ensureFiniteVector(node?.position)
  const nextVelocity = ensureFiniteVector(node?.velocity)
  const positionChanged =
    nextPosition.x !== node?.position?.x ||
    nextPosition.y !== node?.position?.y ||
    nextPosition.z !== node?.position?.z
  const velocityChanged =
    nextVelocity.x !== node?.velocity?.x ||
    nextVelocity.y !== node?.velocity?.y ||
    nextVelocity.z !== node?.velocity?.z

  if (positionChanged || velocityChanged) {
    stats.repairedNodes += 1
  }

  return {
    ...node,
    position: nextPosition,
    velocity: nextVelocity,
  }
}

function removeDegenerateSegments(filament, params, stats) {
  const minAllowedNodes = minNodeCountForFilament(filament)
  const epsilon = Math.max((params.minSegmentLength ?? 0.01) * 0.1, 1e-5)
  let changed = true

  while (changed) {
    changed = false
    const segmentCount = getSegmentCount(filament)
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      if (filament.nodes.length <= minAllowedNodes) {
        return
      }

      const { aIndex, bIndex } = getSegmentPair(filament, segmentIndex)
      const a = filament.nodes[aIndex].position
      const b = filament.nodes[bIndex].position
      if (distance(a, b) > epsilon) {
        continue
      }

      filament.nodes.splice(bIndex, 1)
      stats.degenerateSegmentsRemoved += 1
      stats.closedLoopViolations += 1
      changed = true
      break
    }
  }
}

function repairAdjacentDuplicates(filament, params, stats) {
  const epsilon = Math.max((params.minSegmentLength ?? 0.01) * 0.05, 1e-6)
  const minAllowedNodes = minNodeCountForFilament(filament)
  let changed = true

  while (changed) {
    changed = false
    const segmentCount = getSegmentCount(filament)
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      if (filament.nodes.length <= minAllowedNodes) {
        return
      }

      const { aIndex, bIndex } = getSegmentPair(filament, segmentIndex)
      const a = filament.nodes[aIndex].position
      const b = filament.nodes[bIndex].position
      if (distance(a, b) > epsilon) {
        continue
      }

      filament.nodes.splice(bIndex, 1)
      stats.closedLoopViolations += 1
      stats.degenerateSegmentsRemoved += 1
      changed = true
      break
    }
  }
}

function isFilamentValid(filament) {
  return (
    filament &&
    Array.isArray(filament.nodes) &&
    Number.isFinite(filament.circulation ?? 0) &&
    Number.isFinite(filament.coreRadius ?? 0)
  )
}

export function ensureFilamentTopology(filaments, params, qualityStats = null) {
  const stats = qualityStats ?? createEmptyStats()

  for (let filamentIndex = filaments.length - 1; filamentIndex >= 0; filamentIndex -= 1) {
    const filament = filaments[filamentIndex]
    if (!isFilamentValid(filament)) {
      filaments.splice(filamentIndex, 1)
      stats.topologyRejects += 1
      continue
    }

    filament.closedLoop = filament.closedLoop !== false
    filament.circulation = Number.isFinite(filament.circulation) ? filament.circulation : 0
    filament.coreRadius = Math.max(
      Number.isFinite(filament.coreRadius) ? filament.coreRadius : params.filamentCoreRadius ?? 0.08,
      1e-6,
    )
    filament.nodes = filament.nodes.map((node) => normalizeFilamentNode(node, stats))

    if (filament.nodes.length < minNodeCountForFilament(filament)) {
      filaments.splice(filamentIndex, 1)
      stats.topologyRejects += 1
      stats.closedLoopViolations += 1
      continue
    }

    if (filament.closedLoop && filament.nodes.length < 3) {
      filaments.splice(filamentIndex, 1)
      stats.topologyRejects += 1
      stats.closedLoopViolations += 1
      continue
    }

    repairAdjacentDuplicates(filament, params, stats)
    removeDegenerateSegments(filament, params, stats)

    if (filament.nodes.length < minNodeCountForFilament(filament)) {
      filaments.splice(filamentIndex, 1)
      stats.topologyRejects += 1
      stats.closedLoopViolations += 1
    }
  }

  return stats
}

export function createFilamentQualityStats() {
  return {
    ...createEmptyStats(),
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
    regularizationCorrections: 0,
    regularizedFilaments: 0,
    reconnectRejectedCooldown: 0,
    reconnectRejectedNearEndpointA: 0,
    reconnectRejectedNearEndpointB: 0,
    reconnectRejectedNodeLimit: 0,
    reconnectRejectedDegenerateInsert: 0,
    reconnectRejectedDistance: 0,
    reconnectRejectedAngle: 0,
    reconnectMultipleApplied: 0,
    vortexAnnihilationCount: 0,
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
  }
}

export function resetFilamentQualityStats(stats) {
  stats.topologyRejects = 0
  stats.repairedNodes = 0
  stats.degenerateSegmentsRemoved = 0
  stats.closedLoopViolations = 0
  stats.splitCount = 0
  stats.mergeCount = 0
  stats.nodesAddedThisStep = 0
  stats.splitMergeNet = 0
  stats.splitBudgetHitCount = 0
  stats.transportStepDistanceAvg = 0
  stats.transportStepDistanceMax = 0
  stats.transportVelocityAvg = 0
  stats.transportVelocityMax = 0
  stats.transportCenterStep = 0
  stats.radiusGuardActivations = 0
  stats.reconnectAttempts = 0
  stats.reconnectSuccess = 0
  stats.reconnectRejected = 0
  stats.regularizationCorrections = 0
  stats.regularizedFilaments = 0
  stats.reconnectRejectedCooldown = 0
  stats.reconnectRejectedNearEndpointA = 0
  stats.reconnectRejectedNearEndpointB = 0
  stats.reconnectRejectedNodeLimit = 0
  stats.reconnectRejectedDegenerateInsert = 0
  stats.reconnectRejectedDistance = 0
  stats.reconnectRejectedAngle = 0
  stats.reconnectMultipleApplied = 0
  stats.vortexAnnihilationCount = 0
  stats.adaptiveRefinementPressureAvg = 0
  stats.adaptiveRefinementPressureMax = 0
  stats.adaptiveSplitBudgetScale = 1
  stats.adaptiveMaxSegmentScale = 1
  stats.adaptiveMinSegmentScale = 1
  stats.liaVelocityAvg = 0
  stats.liaVelocityMax = 0
  stats.liaNodeCount = 0
  stats.smoothingCurvatureAvg = 0
  stats.smoothingCurvatureMax = 0
  stats.circulationBefore = 0
  stats.circulationAfter = 0
  stats.circulationDriftAbs = 0
  stats.circulationDriftPercent = 0
  stats.circulationViolationCount = 0
}
