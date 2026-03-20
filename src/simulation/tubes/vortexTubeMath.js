export function normalize(vector) {
  const len = Math.hypot(vector.x, vector.y, vector.z)
  if (len <= 1e-10) {
    return null
  }
  return { x: vector.x / len, y: vector.y / len, z: vector.z / len }
}

export function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  }
}

export function add(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  }
}

export function scale(vector, factor) {
  return {
    x: vector.x * factor,
    y: vector.y * factor,
    z: vector.z * factor,
  }
}

export function buildLocalBasis(nodes, nodeIndex, closedLoop = true) {
  const count = nodes.length
  if (count < 2) {
    return null
  }
  const prevIndex = closedLoop
    ? (nodeIndex - 1 + count) % count
    : Math.max(0, nodeIndex - 1)
  const nextIndex = closedLoop
    ? (nodeIndex + 1) % count
    : Math.min(count - 1, nodeIndex + 1)
  const prev = nodes[prevIndex].position
  const next = nodes[nextIndex].position
  const tangent = normalize(subtract(next, prev))
  if (!tangent) {
    return null
  }
  const fallbackUp = Math.abs(tangent.y) < 0.95 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  let normal = normalize(cross(fallbackUp, tangent))
  if (!normal) {
    normal = { x: 1, y: 0, z: 0 }
  }
  let binormal = normalize(cross(tangent, normal))
  if (!binormal) {
    binormal = { x: 0, y: 0, z: 1 }
  }
  return { tangent, normal, binormal }
}

export function computeSegmentLengths(nodes, closedLoop = true) {
  if (!Array.isArray(nodes) || nodes.length < 2) {
    return []
  }
  const segmentCount = closedLoop ? nodes.length : Math.max(0, nodes.length - 1)
  const result = new Array(segmentCount)
  for (let i = 0; i < segmentCount; i += 1) {
    const a = nodes[i].position
    const b = nodes[(i + 1) % nodes.length].position
    result[i] = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  }
  return result
}
