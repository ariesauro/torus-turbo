export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function distanceSquared(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

export function midpoint(a, b) {
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
    z: (a.z + b.z) * 0.5,
  }
}

export function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  }
}

export function getSegmentCount(filament) {
  return filament.closedLoop ? filament.nodes.length : Math.max(0, filament.nodes.length - 1)
}

export function getSegmentPair(filament, segmentIndex) {
  const nodeCount = filament.nodes.length
  const aIndex = segmentIndex
  const bIndex = (segmentIndex + 1) % nodeCount
  return { aIndex, bIndex }
}

export function minNodeCountForFilament(filament) {
  return filament.closedLoop ? 3 : 2
}

export function averageNodeVelocity(a, b) {
  const velocityA = a.velocity ?? { x: 0, y: 0, z: 0 }
  const velocityB = b.velocity ?? { x: 0, y: 0, z: 0 }
  return {
    x: (velocityA.x + velocityB.x) * 0.5,
    y: (velocityA.y + velocityB.y) * 0.5,
    z: (velocityA.z + velocityB.z) * 0.5,
  }
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function segmentSegmentDistanceSquared(a, b, c, d) {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
  const v = { x: d.x - c.x, y: d.y - c.y, z: d.z - c.z }
  const w = { x: a.x - c.x, y: a.y - c.y, z: a.z - c.z }

  const aDot = dot(u, u)
  const bDot = dot(u, v)
  const cDot = dot(v, v)
  const dDot = dot(u, w)
  const eDot = dot(v, w)
  const denom = aDot * cDot - bDot * bDot
  const eps = 1e-10

  let sNumerator = 0
  let sDenominator = denom
  let tNumerator = 0
  let tDenominator = denom

  if (denom < eps) {
    sNumerator = 0
    sDenominator = 1
    tNumerator = eDot
    tDenominator = cDot
  } else {
    sNumerator = bDot * eDot - cDot * dDot
    tNumerator = aDot * eDot - bDot * dDot

    if (sNumerator < 0) {
      sNumerator = 0
      tNumerator = eDot
      tDenominator = cDot
    } else if (sNumerator > sDenominator) {
      sNumerator = sDenominator
      tNumerator = eDot + bDot
      tDenominator = cDot
    }
  }

  if (tNumerator < 0) {
    tNumerator = 0
    if (-dDot < 0) {
      sNumerator = 0
    } else if (-dDot > aDot) {
      sNumerator = sDenominator
    } else {
      sNumerator = -dDot
      sDenominator = aDot
    }
  } else if (tNumerator > tDenominator) {
    tNumerator = tDenominator
    if (-dDot + bDot < 0) {
      sNumerator = 0
    } else if (-dDot + bDot > aDot) {
      sNumerator = sDenominator
    } else {
      sNumerator = -dDot + bDot
      sDenominator = aDot
    }
  }

  const s = Math.abs(sNumerator) < eps ? 0 : sNumerator / sDenominator
  const t = Math.abs(tNumerator) < eps ? 0 : tNumerator / tDenominator
  const closestOnAB = lerpPoint(a, b, s)
  const closestOnCD = lerpPoint(c, d, t)

  return {
    distanceSquared: distanceSquared(closestOnAB, closestOnCD),
    s,
    t,
    closestOnAB,
    closestOnCD,
  }
}
