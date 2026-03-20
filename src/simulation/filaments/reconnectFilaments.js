import {
  averageNodeVelocity,
  distance,
  getSegmentCount,
  getSegmentPair,
  segmentSegmentDistanceSquared,
} from './filamentGeometry'
import { getOrCreateFilamentRuntimeId } from './biotSavartFilament'
import { createFilamentNode } from './filamentTypes'

function insertReconnectNode(filament, segmentIndex, position, velocity) {
  const insertIndex = segmentIndex + 1
  filament.nodes.splice(insertIndex, 0, createFilamentNode(position, velocity))
  return insertIndex
}

function canReconnect(filamentA, filamentB) {
  if (!filamentA || !filamentB) {
    return false
  }
  if (!filamentA.closedLoop || !filamentB.closedLoop) {
    return false
  }
  return filamentA.nodes.length >= 3 && filamentB.nodes.length >= 3
}

function normalize(vector) {
  const len = Math.hypot(vector.x, vector.y, vector.z)
  if (len <= 1e-10) {
    return null
  }
  return {
    x: vector.x / len,
    y: vector.y / len,
    z: vector.z / len,
  }
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  }
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function computeSegmentAngleDeg(a, b, c, d) {
  const tangentA = normalize(subtract(b, a))
  const tangentB = normalize(subtract(d, c))
  if (!tangentA || !tangentB) {
    return 0
  }
  const cosine = Math.max(-1, Math.min(1, dot(tangentA, tangentB)))
  return (Math.acos(cosine) * 180) / Math.PI
}

function validateReconnectCandidate(candidate, params, solverContext) {
  const {
    filament,
    otherFilament,
    segmentIndex,
    otherSegmentIndex,
    s,
    t,
    closestOnAB,
    closestOnCD,
    distanceSquared,
    angleDeg,
  } = candidate
  const distanceThreshold = Math.max(
    params.reconnectDistanceThreshold ?? params.reconnectionThreshold ?? 0,
    0,
  )
  const distanceThreshold2 = distanceThreshold * distanceThreshold
  if (distanceThreshold2 > 0 && distanceSquared > distanceThreshold2) {
    return { valid: false, reason: 'distance' }
  }
  const minAngleDeg = Math.max(params.reconnectAngleThresholdDeg ?? 0, 0)
  if (angleDeg < minAngleDeg) {
    return { valid: false, reason: 'angle' }
  }
  const cooldownSteps = Math.max(0, Math.floor(params.filamentReconnectCooldownSteps ?? 0))
  if (cooldownSteps > 0 && solverContext) {
    const filamentRuntimeId = getOrCreateFilamentRuntimeId(solverContext, filament)
    const otherFilamentRuntimeId = getOrCreateFilamentRuntimeId(solverContext, otherFilament)
    const currentStep = solverContext.reconnectStepIndex ?? 0
    const filamentCooldownStep = solverContext.reconnectCooldowns?.get(filamentRuntimeId) ?? -1
    const otherCooldownStep = solverContext.reconnectCooldowns?.get(otherFilamentRuntimeId) ?? -1
    if (filamentCooldownStep >= currentStep || otherCooldownStep >= currentStep) {
      return { valid: false, reason: 'cooldown' }
    }
  }

  const endpointMargin = 0.1
  if (s <= endpointMargin || s >= 1 - endpointMargin) {
    return { valid: false, reason: 'near_endpoint_a' }
  }
  if (t <= endpointMargin || t >= 1 - endpointMargin) {
    return { valid: false, reason: 'near_endpoint_b' }
  }

  const maxNodes = Math.max(32, Math.floor(params.maxFilamentNodes ?? 2000))
  if (filament.nodes.length + 1 > maxNodes || otherFilament.nodes.length + 1 > maxNodes) {
    return { valid: false, reason: 'node_limit' }
  }

  const { aIndex, bIndex } = getSegmentPair(filament, segmentIndex)
  const { aIndex: cIndex, bIndex: dIndex } = getSegmentPair(otherFilament, otherSegmentIndex)
  const epsilon = Math.max((params.minSegmentLength ?? 0.01) * 0.25, 1e-5)
  const sourceDistances = [
    distance(closestOnAB, filament.nodes[aIndex].position),
    distance(closestOnAB, filament.nodes[bIndex].position),
    distance(closestOnCD, otherFilament.nodes[cIndex].position),
    distance(closestOnCD, otherFilament.nodes[dIndex].position),
  ]
  if (sourceDistances.some((value) => value <= epsilon)) {
    return { valid: false, reason: 'degenerate_insert' }
  }

  return { valid: true, reason: 'ok' }
}

function recordRejectReason(stats, reason) {
  if (!stats) {
    return
  }

  stats.reconnectRejected += 1
  if (reason === 'cooldown') {
    stats.reconnectRejectedCooldown += 1
  } else if (reason === 'near_endpoint_a') {
    stats.reconnectRejectedNearEndpointA += 1
  } else if (reason === 'near_endpoint_b') {
    stats.reconnectRejectedNearEndpointB += 1
  } else if (reason === 'node_limit') {
    stats.reconnectRejectedNodeLimit += 1
  } else if (reason === 'degenerate_insert') {
    stats.reconnectRejectedDegenerateInsert += 1
  } else if (reason === 'distance') {
    stats.reconnectRejectedDistance += 1
  } else if (reason === 'angle') {
    stats.reconnectRejectedAngle += 1
  }
}

function canApplyVortexAnnihilation(candidate, params) {
  if (params.reconnectVortexAnnihilationEnabled === false) {
    return false
  }
  const circulationA = candidate.filament?.circulation ?? 0
  const circulationB = candidate.otherFilament?.circulation ?? 0
  if (Math.abs(circulationA) <= 1e-10 || Math.abs(circulationB) <= 1e-10) {
    return false
  }
  if (Math.sign(circulationA) === Math.sign(circulationB)) {
    return false
  }
  const residualThreshold = Math.max(params.reconnectAnnihilationCirculationThreshold ?? 0.02, 0)
  return Math.abs(circulationA + circulationB) <= residualThreshold
}

function applyVortexAnnihilation(candidate, filaments, stats, solverContext = null) {
  const filamentA = candidate.filament
  const filamentB = candidate.otherFilament
  const indexA = filaments.indexOf(filamentA)
  const indexB = filaments.indexOf(filamentB)
  if (indexA < 0 || indexB < 0) {
    return false
  }
  const maxIndex = Math.max(indexA, indexB)
  const minIndex = Math.min(indexA, indexB)
  filaments.splice(maxIndex, 1)
  filaments.splice(minIndex, 1)
  stats.vortexAnnihilationCount += 1
  if (solverContext?.reconnectCooldowns) {
    solverContext.reconnectCooldowns.delete(candidate.filamentRuntimeId)
    solverContext.reconnectCooldowns.delete(candidate.otherFilamentRuntimeId)
  }
  return true
}

function findBestReconnectCandidate(filaments, params, stats, solverContext = null) {
  const threshold = Math.max(params.reconnectDistanceThreshold ?? params.reconnectionThreshold ?? 0, 0)
  const threshold2 = threshold * threshold
  let bestCandidate = null

  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const filament = filaments[filamentIndex]
    const filamentRuntimeId = getOrCreateFilamentRuntimeId(solverContext, filament)
    const segmentCount = getSegmentCount(filament)

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const { aIndex, bIndex } = getSegmentPair(filament, segmentIndex)
      const a = filament.nodes[aIndex].position
      const b = filament.nodes[bIndex].position

      const allowInterFilament = params.reconnectInterFilamentEnabled !== false
      for (
        let otherFilamentIndex = filamentIndex;
        otherFilamentIndex < filaments.length;
        otherFilamentIndex += 1
      ) {
        if (!allowInterFilament && otherFilamentIndex !== filamentIndex) {
          continue
        }
        const otherFilament = filaments[otherFilamentIndex]
        if (!canReconnect(filament, otherFilament)) {
          continue
        }
        const otherFilamentRuntimeId = getOrCreateFilamentRuntimeId(solverContext, otherFilament)
        const otherSegmentCount = getSegmentCount(otherFilament)

        for (let otherSegmentIndex = 0; otherSegmentIndex < otherSegmentCount; otherSegmentIndex += 1) {
          if (filamentIndex === otherFilamentIndex && segmentIndex === otherSegmentIndex) {
            continue
          }
          const { aIndex: cIndex, bIndex: dIndex } = getSegmentPair(otherFilament, otherSegmentIndex)
          const c = otherFilament.nodes[cIndex].position
          const d = otherFilament.nodes[dIndex].position
          stats.reconnectAttempts += 1
          const candidate = segmentSegmentDistanceSquared(a, b, c, d)
          const angleDeg = computeSegmentAngleDeg(a, b, c, d)
          const candidateRecord = {
            ...candidate,
            angleDeg,
            filament,
            otherFilament,
            filamentRuntimeId,
            otherFilamentRuntimeId,
            segmentIndex,
            otherSegmentIndex,
          }
          const validation = validateReconnectCandidate(candidateRecord, params, solverContext)
          if (!validation.valid) {
            recordRejectReason(stats, validation.reason)
            continue
          }
          if (threshold2 > 0 && candidate.distanceSquared >= threshold2) {
            recordRejectReason(stats, 'distance')
            continue
          }
          if (!bestCandidate || candidate.distanceSquared < bestCandidate.distanceSquared) {
            bestCandidate = candidateRecord
          }
        }
      }
    }
  }
  return bestCandidate
}

/**
 * Apply viscous diffusion in the reconnection zone before topological swap.
 * This models the physical process where anti-parallel vorticity cancels
 * through enhanced diffusion at close approach, creating a "bridge" region.
 *
 * The circulation at the reconnection point is reduced by a factor proportional
 * to the overlap of the approaching segments.
 *
 * [STATUS]: CORRECT — models viscous cancellation (Kida & Takaoka 1994)
 */
function applyViscousReconnectionDiffusion(candidate, params) {
  if (params.reconnectViscousDiffusionEnabled === false) return

  const { filament, otherFilament, segmentIndex, otherSegmentIndex, distanceSquared } = candidate
  const { aIndex, bIndex } = getSegmentPair(filament, segmentIndex)
  const { aIndex: cIndex, bIndex: dIndex } = getSegmentPair(otherFilament, otherSegmentIndex)

  const coreA = Math.max(filament.coreRadius ?? 0.08, 1e-6)
  const coreB = Math.max(otherFilament.coreRadius ?? 0.08, 1e-6)
  const avgCore = (coreA + coreB) * 0.5
  const dist = Math.sqrt(Math.max(distanceSquared, 0))
  const overlap = Math.max(0, 1 - dist / (2 * avgCore))

  if (overlap <= 0.01) return

  const diffusionStrength = Math.min(overlap * (params.reconnectViscousDiffusionStrength ?? 0.3), 0.5)
  const nodesA = [filament.nodes[aIndex], filament.nodes[bIndex]]
  const nodesB = [otherFilament.nodes[cIndex], otherFilament.nodes[dIndex]]

  for (const node of [...nodesA, ...nodesB]) {
    if (!node.velocity) continue
    node.velocity.x *= (1 - diffusionStrength)
    node.velocity.y *= (1 - diffusionStrength)
    node.velocity.z *= (1 - diffusionStrength)
  }

  filament.circulation *= (1 - diffusionStrength * 0.1)
  otherFilament.circulation *= (1 - diffusionStrength * 0.1)
}

function performSafeReconnect(candidate, params) {
  applyViscousReconnectionDiffusion(candidate, params ?? {})

  const {
    filament,
    otherFilament,
    segmentIndex,
    otherSegmentIndex,
    closestOnAB,
    closestOnCD,
  } = candidate
  const { aIndex, bIndex } = getSegmentPair(filament, segmentIndex)
  const { aIndex: cIndex, bIndex: dIndex } = getSegmentPair(otherFilament, otherSegmentIndex)
  const reconnectVelocityA = averageNodeVelocity(filament.nodes[aIndex], filament.nodes[bIndex])
  const reconnectVelocityB = averageNodeVelocity(otherFilament.nodes[cIndex], otherFilament.nodes[dIndex])

  const insertedAIndex = insertReconnectNode(
    filament,
    segmentIndex,
    closestOnAB,
    reconnectVelocityA,
  )
  const insertedBIndex = insertReconnectNode(
    otherFilament,
    otherSegmentIndex,
    closestOnCD,
    reconnectVelocityB,
  )

  const insertedNodeA = filament.nodes[insertedAIndex]
  const insertedNodeB = otherFilament.nodes[insertedBIndex]
  filament.nodes[insertedAIndex] = insertedNodeB
  otherFilament.nodes[insertedBIndex] = insertedNodeA
}

export function reconnectFilaments(filaments, params, qualityStats = null, solverContext = null) {
  if (params.reconnectEnabled === false) {
    return qualityStats ?? { reconnectAttempts: 0, reconnectSuccess: 0 }
  }
  const threshold = Math.max(params.reconnectDistanceThreshold ?? params.reconnectionThreshold ?? 0, 0)
  if (threshold <= 0) {
    return qualityStats ?? { reconnectAttempts: 0, reconnectSuccess: 0 }
  }

  const reconnectMultipleEnabled = params.reconnectMultipleEnabled !== false
  const maxReconnectPerStep = reconnectMultipleEnabled
    ? Math.max(1, Math.floor(params.reconnectMaxPerStep ?? 4))
    : 1
  const stats = qualityStats ?? {
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
  }
  if (solverContext) {
    solverContext.reconnectStepIndex = (solverContext.reconnectStepIndex ?? 0) + 1
  }
  const allowInterFilament = params.reconnectInterFilamentEnabled !== false
  let reconnectApplied = 0
  for (let reconnectIndex = 0; reconnectIndex < maxReconnectPerStep; reconnectIndex += 1) {
    const bestCandidate = findBestReconnectCandidate(filaments, params, stats, solverContext)
    if (!bestCandidate) {
      break
    }
    if (!allowInterFilament && bestCandidate.filament !== bestCandidate.otherFilament) {
      break
    }

    if (canApplyVortexAnnihilation(bestCandidate, params)) {
      if (!applyVortexAnnihilation(bestCandidate, filaments, stats, solverContext)) {
        break
      }
      stats.reconnectSuccess += 1
      reconnectApplied += 1
      continue
    }

    performSafeReconnect(bestCandidate, params)
    stats.reconnectSuccess += 1
    reconnectApplied += 1
    const cooldownSteps = Math.max(0, Math.floor(params.filamentReconnectCooldownSteps ?? 0))
    if (solverContext && cooldownSteps > 0) {
      const nextAllowedStep = (solverContext.reconnectStepIndex ?? 0) + cooldownSteps
      solverContext.reconnectCooldowns.set(bestCandidate.filamentRuntimeId, nextAllowedStep)
      solverContext.reconnectCooldowns.set(bestCandidate.otherFilamentRuntimeId, nextAllowedStep)
    }
  }
  stats.reconnectMultipleApplied = reconnectApplied

  return stats
}
