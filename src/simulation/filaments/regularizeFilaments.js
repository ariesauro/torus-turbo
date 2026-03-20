import { distance } from './filamentGeometry'

function createZeroVector() {
  return { x: 0, y: 0, z: 0 }
}

function subtractVectors(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  }
}

function addVectors(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  }
}

function scaleVector(vector, scale) {
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  }
}

function vectorLength(vector) {
  return Math.hypot(vector.x, vector.y, vector.z)
}

function measureLoopCenter(nodes) {
  const center = createZeroVector()
  for (let i = 0; i < nodes.length; i += 1) {
    center.x += nodes[i].position.x
    center.y += nodes[i].position.y
    center.z += nodes[i].position.z
  }

  const invCount = 1 / Math.max(nodes.length, 1)
  center.x *= invCount
  center.y *= invCount
  center.z *= invCount
  return center
}

function measureAverageRadius(nodes, center) {
  let total = 0
  for (let i = 0; i < nodes.length; i += 1) {
    total += Math.hypot(
      nodes[i].position.x - center.x,
      nodes[i].position.y - center.y,
      nodes[i].position.z - center.z,
    )
  }
  return total / Math.max(nodes.length, 1)
}

function measureSegmentAverage(nodes, closedLoop) {
  const segmentCount = closedLoop ? nodes.length : Math.max(0, nodes.length - 1)
  if (segmentCount === 0) {
    return 0
  }

  let total = 0
  for (let i = 0; i < segmentCount; i += 1) {
    const nextIndex = (i + 1) % nodes.length
    total += distance(nodes[i].position, nodes[nextIndex].position)
  }
  return total / segmentCount
}

function measureLocalCurvature(prev, current, next, localScale) {
  const incoming = subtractVectors(current, prev)
  const outgoing = subtractVectors(next, current)
  const turning = subtractVectors(outgoing, incoming)
  return vectorLength(turning) / Math.max(localScale, 1e-6)
}

export function regularizeFilaments(filaments, params, qualityStats = null) {
  const curvatureStrength = Math.max(params.filamentRegularizationCurvatureStrength ?? 0.7, 0)
  const curvatureClamp = Math.max(params.filamentRegularizationCurvatureClamp ?? 0.24, 0)
  const baseCorrectionStrength = 0.05
  const correctionThreshold = Math.max((params.minSegmentLength ?? 0.01) * 0.05, 1e-6)

  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const filament = filaments[filamentIndex]
    const nodes = filament.nodes ?? []
    const nodeCount = nodes.length
    if (nodeCount < 3) {
      continue
    }

    const centerBefore = measureLoopCenter(nodes)
    const avgRadiusBefore = filament.closedLoop ? measureAverageRadius(nodes, centerBefore) : 0
    const avgSegmentBefore = measureSegmentAverage(nodes, filament.closedLoop)
    const nextPositions = new Array(nodeCount)
    let filamentCorrected = false

    for (let i = 0; i < nodeCount; i += 1) {
      const prevIndex = filament.closedLoop ? (i - 1 + nodeCount) % nodeCount : Math.max(0, i - 1)
      const nextIndex = filament.closedLoop ? (i + 1) % nodeCount : Math.min(nodeCount - 1, i + 1)
      const current = nodes[i].position
      const prev = nodes[prevIndex].position
      const next = nodes[nextIndex].position

      if (!filament.closedLoop && (i === 0 || i === nodeCount - 1)) {
        nextPositions[i] = { ...current }
        continue
      }

      const midpoint = scaleVector(addVectors(prev, next), 0.5)
      const correctionVector = subtractVectors(midpoint, current)
      const localSegmentScale =
        (distance(prev, current) + distance(current, next) + Math.max(avgSegmentBefore, 1e-6)) / 3
      const curvature = measureLocalCurvature(prev, current, next, localSegmentScale)
      const correctionStrength = Math.min(
        baseCorrectionStrength + curvature * curvatureStrength,
        curvatureClamp,
      )

      nextPositions[i] = {
        x: current.x + correctionVector.x * correctionStrength,
        y: current.y + correctionVector.y * correctionStrength,
        z: current.z + correctionVector.z * correctionStrength,
      }
    }

    for (let i = 0; i < nodeCount; i += 1) {
      const current = nodes[i].position
      const next = nextPositions[i]
      const correction = Math.hypot(next.x - current.x, next.y - current.y, next.z - current.z)
      if (qualityStats && correction > correctionThreshold) {
        qualityStats.regularizationCorrections += 1
        filamentCorrected = true
      }
      nodes[i].position = next
    }

    if (qualityStats && filamentCorrected) {
      qualityStats.regularizedFilaments += 1
    }

    if (!filament.closedLoop) {
      continue
    }

    const centerAfter = measureLoopCenter(nodes)
    const centerShift = subtractVectors(centerBefore, centerAfter)
    for (let i = 0; i < nodeCount; i += 1) {
      nodes[i].position = addVectors(nodes[i].position, centerShift)
    }

    const avgRadiusAfter = measureAverageRadius(nodes, centerBefore)
    const avgSegmentAfter = measureSegmentAverage(nodes, true)
    const radiusScale = avgRadiusAfter > 1e-8 ? avgRadiusBefore / avgRadiusAfter : 1
    const segmentScale = avgSegmentAfter > 1e-8 ? avgSegmentBefore / avgSegmentAfter : 1
    const scale = Math.sqrt(Math.max(radiusScale, 1e-8) * Math.max(segmentScale, 1e-8))

    for (let i = 0; i < nodeCount; i += 1) {
      const p = nodes[i].position
      nodes[i].position = {
        x: centerBefore.x + (p.x - centerBefore.x) * scale,
        y: centerBefore.y + (p.y - centerBefore.y) * scale,
        z: centerBefore.z + (p.z - centerBefore.z) * scale,
      }
    }
  }
}
