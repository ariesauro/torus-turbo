/**
 * Filament dynamics: curvature, strain rate, instability detection and Kelvin-wave style perturbation.
 * Node fields used: position, velocity; written: curvature, strainRate, instabilityFlag.
 */

import { distance } from './filamentGeometry'

const EPS = 1e-10

function normalize(v) {
  const len = Math.hypot(v.x, v.y, v.z)
  if (len <= EPS) {
    return { x: 0, y: 0, z: 0 }
  }
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function length(v) {
  return Math.hypot(v.x, v.y, v.z)
}

/**
 * Curvature at node i: |T2 - T1| / segmentLength
 * T1 = normalize(Pi - P(i-1)), T2 = normalize(P(i+1) - Pi)
 */
export function computeFilamentCurvature(filament) {
  const nodes = filament?.nodes ?? []
  const n = nodes.length
  if (n < 3) {
    for (let i = 0; i < n; i += 1) {
      const node = nodes[i]
      if (node) node.curvature = 0
    }
    return
  }

  const closed = filament.closedLoop === true
  for (let i = 0; i < n; i += 1) {
    const node = nodes[i]
    const prevIdx = closed ? (i - 1 + n) % n : Math.max(0, i - 1)
    const nextIdx = closed ? (i + 1) % n : Math.min(n - 1, i + 1)
    if (!closed && (i === 0 || i === n - 1)) {
      node.curvature = 0
      continue
    }

    const prev = nodes[prevIdx].position
    const curr = node.position
    const next = nodes[nextIdx].position

    const e1 = subtract(curr, prev)
    const e2 = subtract(next, curr)
    const len1 = length(e1)
    const len2 = length(e2)
    if (len1 <= EPS || len2 <= EPS) {
      node.curvature = 0
      continue
    }

    const T1 = normalize(e1)
    const T2 = normalize(e2)
    const dT = subtract(T2, T1)
    const segmentLength = (len1 + len2) * 0.5
    const curvature = segmentLength > EPS ? length(dT) / segmentLength : 0
    node.curvature = curvature
  }
}

/**
 * Strain rate at node i: |V(i+1) - V(i-1)| / (2 * segmentLength)
 */
export function computeFilamentStrainRate(filament) {
  const nodes = filament?.nodes ?? []
  const n = nodes.length
  if (n < 3) {
    for (let i = 0; i < n; i += 1) {
      const node = nodes[i]
      if (node) node.strainRate = 0
    }
    return
  }

  const closed = filament.closedLoop === true
  for (let i = 0; i < n; i += 1) {
    const node = nodes[i]
    const prevIdx = closed ? (i - 1 + n) % n : Math.max(0, i - 1)
    const nextIdx = closed ? (i + 1) % n : Math.min(n - 1, i + 1)
    if (!closed && (i === 0 || i === n - 1)) {
      node.strainRate = 0
      continue
    }

    const vPrev = nodes[prevIdx].velocity ?? { x: 0, y: 0, z: 0 }
    const vNext = nodes[nextIdx].velocity ?? { x: 0, y: 0, z: 0 }
    const dV = subtract(vNext, vPrev)
    const segmentLength =
      distance(nodes[prevIdx].position, node.position) +
      distance(node.position, nodes[nextIdx].position)
    const segLen = Math.max(segmentLength * 0.5, EPS)
    const strainRate = length(dV) / (2 * segLen)
    node.strainRate = strainRate
  }
}

/**
 * Set node.instabilityFlag from curvature and strain thresholds.
 */
export function detectFilamentInstability(filaments, params) {
  const curvatureThreshold = Math.max(
    params?.filamentCurvatureThreshold ?? 2,
    1e-6,
  )
  const strainThreshold = Math.max(
    params?.filamentStrainThreshold ?? 1,
    1e-6,
  )

  for (let f = 0; f < filaments.length; f += 1) {
    const nodes = filaments[f].nodes ?? []
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]
      const curvature = node.curvature ?? 0
      const strainRate = node.strainRate ?? 0
      node.instabilityFlag =
        curvature > curvatureThreshold || strainRate > strainThreshold
    }
  }
}

/**
 * Apply instability operator: random perturbation velocity, slight curvature increase, shorten segment.
 * Models Kelvin wave growth.
 */
export function applyFilamentInstability(filaments, params) {
  const strength = Math.max(params?.filamentInstabilityStrength ?? 0, 0)
  if (strength <= 0) return

  const random = typeof Math.random === 'function' ? Math.random : () => 0.5
  const perturbScale = strength * 0.02
  const curvatureBump = strength * 0.01
  const shortenBlend = Math.min(strength * 0.03, 0.1)

  for (let f = 0; f < filaments.length; f += 1) {
    const filament = filaments[f]
    const nodes = filament.nodes ?? []
    const n = nodes.length
    if (n < 3) continue

    const closed = filament.closedLoop === true
    const coreRadius = Math.max(filament.coreRadius ?? 0.08, 1e-6)

    for (let i = 0; i < n; i += 1) {
      const node = nodes[i]
      if (!node.instabilityFlag) continue

      const prevIdx = closed ? (i - 1 + n) % n : Math.max(0, i - 1)
      const nextIdx = closed ? (i + 1) % n : Math.min(n - 1, i + 1)
      if (!closed && (i === 0 || i === n - 1)) continue

      const prev = nodes[prevIdx].position
      const curr = node.position
      const next = nodes[nextIdx].position

      const v = node.velocity ?? { x: 0, y: 0, z: 0 }
      const px = (random() - 0.5) * 2 * perturbScale * coreRadius
      const py = (random() - 0.5) * 2 * perturbScale * coreRadius
      const pz = (random() - 0.5) * 2 * perturbScale * coreRadius
      node.velocity = {
        x: v.x + px,
        y: v.y + py,
        z: v.z + pz,
      }

      const midX = (prev.x + next.x) * 0.5
      const midY = (prev.y + next.y) * 0.5
      const midZ = (prev.z + next.z) * 0.5
      const dx = curr.x - midX
      const dy = curr.y - midY
      const dz = curr.z - midZ
      const perpLen = Math.hypot(dx, dy, dz) || 1
      const outward = curvatureBump * coreRadius
      node.position = {
        x: curr.x + (dx / perpLen) * outward,
        y: curr.y + (dy / perpLen) * outward,
        z: curr.z + (dz / perpLen) * outward,
      }

      const towardMid = {
        x: midX - curr.x,
        y: midY - curr.y,
        z: midZ - curr.z,
      }
      node.position.x += towardMid.x * shortenBlend
      node.position.y += towardMid.y * shortenBlend
      node.position.z += towardMid.z * shortenBlend
    }
  }
}
