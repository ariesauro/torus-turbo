import { createFilamentNode } from './filamentTypes'
import {
  averageNodeVelocity,
  distance,
  getSegmentCount,
  getSegmentPair,
  lerpPoint,
  minNodeCountForFilament,
} from './filamentGeometry'

function hasOverlongSegments(filament, maxSegmentLength) {
  const segmentCount = getSegmentCount(filament)
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const { aIndex, bIndex } = getSegmentPair(filament, segmentIndex)
    const aNode = filament.nodes[aIndex]
    const bNode = filament.nodes[bIndex]
    if (distance(aNode.position, bNode.position) > maxSegmentLength) {
      return true
    }
  }
  return false
}

function createGrowthBudget(filament, maxFilamentNodes, splitBudgetScale = 1) {
  const initialNodeCount = filament.nodes.length
  const hardRemainingCapacity = Math.max(maxFilamentNodes - initialNodeCount, 0)
  const safeSplitScale = Math.max(0.25, splitBudgetScale)
  const splitBudget = Math.min(
    Math.max(4, Math.floor(initialNodeCount * 0.25 * safeSplitScale)),
    hardRemainingCapacity,
  )
  const maxNetGrowth = Math.min(
    Math.max(8, Math.floor(initialNodeCount * 0.35 * safeSplitScale)),
    hardRemainingCapacity,
  )

  return {
    initialNodeCount,
    remainingSplits: splitBudget,
    maxNetGrowth,
    budgetHitRecorded: false,
  }
}

function recordSplitBudgetHit(stats, budgetState, filament, maxSegmentLength) {
  if (budgetState.budgetHitRecorded || !hasOverlongSegments(filament, maxSegmentLength)) {
    return
  }

  budgetState.budgetHitRecorded = true
  stats.splitBudgetHitCount += 1
}

function splitLongSegments(filament, maxSegmentLength, maxFilamentNodes, stats, budgetState) {
  let changed = true
  while (changed && filament.nodes.length < maxFilamentNodes) {
    const netGrowth = filament.nodes.length - budgetState.initialNodeCount
    if (budgetState.remainingSplits <= 0 || netGrowth >= budgetState.maxNetGrowth) {
      recordSplitBudgetHit(stats, budgetState, filament, maxSegmentLength)
      return
    }

    changed = false
    const segmentCount = getSegmentCount(filament)
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const { aIndex, bIndex } = getSegmentPair(filament, segmentIndex)
      const aNode = filament.nodes[aIndex]
      const bNode = filament.nodes[bIndex]
      const segmentLength = distance(aNode.position, bNode.position)
      if (segmentLength <= maxSegmentLength) {
        continue
      }

      filament.nodes.splice(
        bIndex,
        0,
        createFilamentNode(
          lerpPoint(aNode.position, bNode.position, 0.5),
          averageNodeVelocity(aNode, bNode),
        ),
      )
      stats.splitCount += 1
      stats.nodesAddedThisStep += 1
      budgetState.remainingSplits -= 1
      changed = true
      break
    }
  }
}

function mergeShortSegments(filament, minSegmentLength, stats) {
  const minAllowedNodes = minNodeCountForFilament(filament)
  let changed = true

  while (changed && filament.nodes.length > minAllowedNodes) {
    changed = false
    const segmentCount = getSegmentCount(filament)
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      if (filament.nodes.length <= minAllowedNodes) {
        return
      }

      const { aIndex, bIndex } = getSegmentPair(filament, segmentIndex)
      const aNode = filament.nodes[aIndex]
      const bNode = filament.nodes[bIndex]
      const segmentLength = distance(aNode.position, bNode.position)
      if (segmentLength >= minSegmentLength) {
        continue
      }

      aNode.position = lerpPoint(aNode.position, bNode.position, 0.5)
      aNode.velocity = averageNodeVelocity(aNode, bNode)
      filament.nodes.splice(bIndex, 1)
      stats.mergeCount += 1
      changed = true
      break
    }
  }
}

function buildArcLengthData(filament) {
  const nodes = filament.nodes ?? []
  const nodeCount = nodes.length
  const segmentCount = getSegmentCount(filament)
  const cumulative = new Array(segmentCount + 1)
  cumulative[0] = 0
  let totalLength = 0

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const { aIndex, bIndex } = getSegmentPair(filament, segmentIndex)
    const a = nodes[aIndex].position
    const b = nodes[bIndex].position
    totalLength += distance(a, b)
    cumulative[segmentIndex + 1] = totalLength
  }

  return { nodeCount, segmentCount, cumulative, totalLength }
}

function sampleAtArcDistance(filament, arcData, targetDistance, startSegment = 0) {
  const { segmentCount, cumulative, totalLength } = arcData
  const nodes = filament.nodes
  const clampedDistance = Math.max(0, Math.min(targetDistance, totalLength))
  let segmentIndex = Math.max(0, Math.min(startSegment, Math.max(segmentCount - 1, 0)))

  while (
    segmentIndex < segmentCount - 1 &&
    cumulative[segmentIndex + 1] < clampedDistance
  ) {
    segmentIndex += 1
  }

  const { aIndex, bIndex } = getSegmentPair(filament, segmentIndex)
  const aNode = nodes[aIndex]
  const bNode = nodes[bIndex]
  const segmentStart = cumulative[segmentIndex]
  const segmentEnd = cumulative[segmentIndex + 1]
  const segmentLength = Math.max(segmentEnd - segmentStart, 1e-10)
  const t = Math.max(0, Math.min(1, (clampedDistance - segmentStart) / segmentLength))

  return {
    node: createFilamentNode(
      lerpPoint(aNode.position, bNode.position, t),
      averageNodeVelocity(aNode, bNode),
    ),
    segmentIndex,
  }
}

function resampleFilamentArcLength(filament, minSegmentLength, maxSegmentLength, maxFilamentNodes) {
  const minNodes = minNodeCountForFilament(filament)
  if ((filament.nodes?.length ?? 0) < minNodes) {
    return
  }

  const desiredSegmentLength = Math.max((minSegmentLength + maxSegmentLength) * 0.5, 1e-6)
  const arcData = buildArcLengthData(filament)
  if (arcData.totalLength <= 1e-8 || arcData.segmentCount <= 0) {
    return
  }

  const minSegments = filament.closedLoop ? 3 : 1
  const maxSegments = Math.max(
    minSegments,
    filament.closedLoop ? maxFilamentNodes : Math.max(maxFilamentNodes - 1, minSegments),
  )
  const targetSegmentCount = Math.max(
    minSegments,
    Math.min(maxSegments, Math.round(arcData.totalLength / desiredSegmentLength)),
  )
  const targetNodeCount = filament.closedLoop
    ? targetSegmentCount
    : Math.max(2, Math.min(maxFilamentNodes, targetSegmentCount + 1))

  if (targetNodeCount === filament.nodes.length) {
    return
  }

  const nextNodes = new Array(targetNodeCount)
  let segmentCursor = 0
  for (let i = 0; i < targetNodeCount; i += 1) {
    const distanceTarget = filament.closedLoop
      ? (i * arcData.totalLength) / targetNodeCount
      : (i * arcData.totalLength) / Math.max(targetNodeCount - 1, 1)
    const sampled = sampleAtArcDistance(filament, arcData, distanceTarget, segmentCursor)
    segmentCursor = sampled.segmentIndex
    nextNodes[i] = sampled.node
  }

  filament.nodes = nextNodes
}

export function adaptFilaments(filaments, params, qualityStats = null, options = {}) {
  const maxSegmentScale = Math.max(options.maxSegmentScale ?? 1, 0.25)
  const minSegmentScale = Math.max(options.minSegmentScale ?? 1, 0.25)
  const splitBudgetScale = Math.max(options.splitBudgetScale ?? 1, 0.25)
  const maxSegmentLength = Math.max((params.maxSegmentLength ?? 0.25) * maxSegmentScale, 1e-4)
  const minSegmentLengthRaw = Math.max((params.minSegmentLength ?? 0.08) * minSegmentScale, 1e-4)
  const minSegmentLength = Math.min(minSegmentLengthRaw, maxSegmentLength * 0.95)
  const maxFilamentNodes = Math.max(32, Math.floor(params.maxFilamentNodes ?? 2000))
  const maxIterations = Math.max(4, Math.floor(params.filamentAdaptMaxIterations ?? 48))
  const stats = qualityStats ?? {
    splitCount: 0,
    mergeCount: 0,
    nodesAddedThisStep: 0,
    splitMergeNet: 0,
    splitBudgetHitCount: 0,
  }

  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const filament = filaments[filamentIndex]
    const budgetState = createGrowthBudget(filament, maxFilamentNodes, splitBudgetScale)

    let changed = true
    let iteration = 0
    while (changed && iteration < maxIterations) {
      changed = false
      iteration += 1
      const nodesBefore = filament.nodes.length
      splitLongSegments(filament, maxSegmentLength, maxFilamentNodes, stats, budgetState)
      mergeShortSegments(filament, minSegmentLength, stats)
      resampleFilamentArcLength(
        filament,
        minSegmentLength,
        maxSegmentLength,
        maxFilamentNodes,
      )
      changed = filament.nodes.length !== nodesBefore
    }

    stats.splitMergeNet += filament.nodes.length - budgetState.initialNodeCount
  }

  return stats
}
