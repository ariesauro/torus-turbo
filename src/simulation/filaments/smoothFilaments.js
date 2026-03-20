function measureCurvature(prev, current, next) {
  const incoming = {
    x: current.x - prev.x,
    y: current.y - prev.y,
    z: current.z - prev.z,
  }
  const outgoing = {
    x: next.x - current.x,
    y: next.y - current.y,
    z: next.z - current.z,
  }
  const incomingLen = Math.hypot(incoming.x, incoming.y, incoming.z)
  const outgoingLen = Math.hypot(outgoing.x, outgoing.y, outgoing.z)
  if (incomingLen <= 1e-8 || outgoingLen <= 1e-8) {
    return 0
  }
  const turning = {
    x: outgoing.x - incoming.x,
    y: outgoing.y - incoming.y,
    z: outgoing.z - incoming.z,
  }
  return Math.hypot(turning.x, turning.y, turning.z) / Math.max((incomingLen + outgoingLen) * 0.5, 1e-6)
}

export function smoothFilaments(filaments, params, qualityStats = null) {
  const lambda = Math.max(0, Math.min(1, params.filamentSmoothing ?? 0))
  if (lambda <= 0) {
    return
  }
  const curvatureGain = Math.max(params.filamentCurvatureSmoothingGain ?? 0.8, 0)
  const curvatureClamp = Math.max(params.filamentCurvatureSmoothingClamp ?? 0.25, 0)
  let totalCurvature = 0
  let maxCurvature = 0
  let curvatureSamples = 0

  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const filament = filaments[filamentIndex]
    const nodeCount = filament.nodes.length
    if (nodeCount < 3) {
      continue
    }

    let centerBefore = { x: 0, y: 0, z: 0 }
    for (let i = 0; i < nodeCount; i += 1) {
      centerBefore.x += filament.nodes[i].position.x
      centerBefore.y += filament.nodes[i].position.y
      centerBefore.z += filament.nodes[i].position.z
    }
    centerBefore.x /= nodeCount
    centerBefore.y /= nodeCount
    centerBefore.z /= nodeCount

    let avgRadiusBefore = 0
    for (let i = 0; i < nodeCount; i += 1) {
      const p = filament.nodes[i].position
      avgRadiusBefore += Math.hypot(
        p.x - centerBefore.x,
        p.y - centerBefore.y,
        p.z - centerBefore.z,
      )
    }
    avgRadiusBefore /= nodeCount

    const nextPositions = new Array(nodeCount)
    for (let i = 0; i < nodeCount; i += 1) {
      const prevIndex = filament.closedLoop ? (i - 1 + nodeCount) % nodeCount : Math.max(0, i - 1)
      const nextIndex = filament.closedLoop ? (i + 1) % nodeCount : Math.min(nodeCount - 1, i + 1)
      const prev = filament.nodes[prevIndex].position
      const current = filament.nodes[i].position
      const next = filament.nodes[nextIndex].position

      if (!filament.closedLoop && (i === 0 || i === nodeCount - 1)) {
        nextPositions[i] = { ...current }
        continue
      }

      const curvature = measureCurvature(prev, current, next)
      const localLambda = Math.min(lambda + curvature * curvatureGain, Math.min(1, lambda + curvatureClamp))
      totalCurvature += curvature
      maxCurvature = Math.max(maxCurvature, curvature)
      curvatureSamples += 1

      nextPositions[i] = {
        x: current.x + localLambda * (prev.x + next.x - 2 * current.x),
        y: current.y + localLambda * (prev.y + next.y - 2 * current.y),
        z: current.z + localLambda * (prev.z + next.z - 2 * current.z),
      }
    }

    for (let i = 0; i < nodeCount; i += 1) {
      filament.nodes[i].position = nextPositions[i]
    }

    if (filament.closedLoop) {
      let centerAfter = { x: 0, y: 0, z: 0 }
      for (let i = 0; i < nodeCount; i += 1) {
        centerAfter.x += filament.nodes[i].position.x
        centerAfter.y += filament.nodes[i].position.y
        centerAfter.z += filament.nodes[i].position.z
      }
      centerAfter.x /= nodeCount
      centerAfter.y /= nodeCount
      centerAfter.z /= nodeCount

      const centerShift = {
        x: centerBefore.x - centerAfter.x,
        y: centerBefore.y - centerAfter.y,
        z: centerBefore.z - centerAfter.z,
      }
      for (let i = 0; i < nodeCount; i += 1) {
        filament.nodes[i].position = {
          x: filament.nodes[i].position.x + centerShift.x,
          y: filament.nodes[i].position.y + centerShift.y,
          z: filament.nodes[i].position.z + centerShift.z,
        }
      }

      let avgRadiusAfter = 0
      for (let i = 0; i < nodeCount; i += 1) {
        const p = filament.nodes[i].position
        avgRadiusAfter += Math.hypot(
          p.x - centerBefore.x,
          p.y - centerBefore.y,
          p.z - centerBefore.z,
        )
      }
      avgRadiusAfter /= nodeCount

      const radiusScale =
        avgRadiusAfter > 1e-8 ? avgRadiusBefore / avgRadiusAfter : 1

      for (let i = 0; i < nodeCount; i += 1) {
        const p = filament.nodes[i].position
        filament.nodes[i].position = {
          x: centerBefore.x + (p.x - centerBefore.x) * radiusScale,
          y: centerBefore.y + (p.y - centerBefore.y) * radiusScale,
          z: centerBefore.z + (p.z - centerBefore.z) * radiusScale,
        }
      }
    }
  }
  if (qualityStats && curvatureSamples > 0) {
    qualityStats.smoothingCurvatureAvg = totalCurvature / curvatureSamples
    qualityStats.smoothingCurvatureMax = maxCurvature
  }
}
