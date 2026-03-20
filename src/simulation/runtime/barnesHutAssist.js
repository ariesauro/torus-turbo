import { controlNaturalCirculationDirection } from '../physics/runtime/naturalBiotSavartModulation'

const FOUR_PI = 4 * Math.PI

function clampFinite(value, min, max, fallback) {
  const next = Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, next))
}

function computeBounds(sources) {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i]
    if (source.x < minX) minX = source.x
    if (source.y < minY) minY = source.y
    if (source.z < minZ) minZ = source.z
    if (source.x > maxX) maxX = source.x
    if (source.y > maxY) maxY = source.y
    if (source.z > maxZ) maxZ = source.z
  }

  const centerX = (minX + maxX) * 0.5
  const centerY = (minY + maxY) * 0.5
  const centerZ = (minZ + maxZ) * 0.5
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-4)
  return {
    centerX,
    centerY,
    centerZ,
    halfSize: extent * 0.5 + 1e-4,
  }
}

function getOctant(source, cx, cy, cz) {
  let octant = 0
  if (source.x >= cx) octant |= 1
  if (source.y >= cy) octant |= 2
  if (source.z >= cz) octant |= 4
  return octant
}

function buildNode(sources, indices, cx, cy, cz, halfSize, leafSize, depth, maxDepth) {
  if (indices.length === 0) {
    return null
  }

  let totalWeight = 0
  let weightedX = 0
  let weightedY = 0
  let weightedZ = 0
  let sigmaWeighted = 0
  let omegaGammaX = 0
  let omegaGammaY = 0
  let omegaGammaZ = 0

  for (let i = 0; i < indices.length; i += 1) {
    const source = sources[indices[i]]
    const weight = Math.abs(source.gamma) + 1e-6
    totalWeight += weight
    weightedX += source.x * weight
    weightedY += source.y * weight
    weightedZ += source.z * weight
    sigmaWeighted += source.sigma * weight
    omegaGammaX += source.omegaGammaX
    omegaGammaY += source.omegaGammaY
    omegaGammaZ += source.omegaGammaZ
  }

  const node = {
    leaf: indices.length <= leafSize || depth >= maxDepth,
    indices: null,
    children: null,
    centerX: cx,
    centerY: cy,
    centerZ: cz,
    halfSize,
    count: indices.length,
    comX: weightedX / Math.max(totalWeight, 1e-6),
    comY: weightedY / Math.max(totalWeight, 1e-6),
    comZ: weightedZ / Math.max(totalWeight, 1e-6),
    sigmaMean: sigmaWeighted / Math.max(totalWeight, 1e-6),
    omegaGammaX,
    omegaGammaY,
    omegaGammaZ,
  }

  if (node.leaf) {
    node.indices = indices
    return node
  }

  const childHalf = halfSize * 0.5
  const buckets = Array.from({ length: 8 }, () => [])
  for (let i = 0; i < indices.length; i += 1) {
    const index = indices[i]
    const source = sources[index]
    buckets[getOctant(source, cx, cy, cz)].push(index)
  }

  node.children = new Array(8).fill(null)
  for (let octant = 0; octant < 8; octant += 1) {
    const childIndices = buckets[octant]
    if (childIndices.length === 0) {
      continue
    }

    const childCx = cx + ((octant & 1) !== 0 ? childHalf : -childHalf)
    const childCy = cy + ((octant & 2) !== 0 ? childHalf : -childHalf)
    const childCz = cz + ((octant & 4) !== 0 ? childHalf : -childHalf)
    node.children[octant] = buildNode(
      sources,
      childIndices,
      childCx,
      childCy,
      childCz,
      childHalf,
      leafSize,
      depth + 1,
      maxDepth,
    )
  }

  return node
}

function evaluateLeafVelocity(query, node, sources, softening2) {
  let vx = 0
  let vy = 0
  let vz = 0

  for (let i = 0; i < node.indices.length; i += 1) {
    const source = sources[node.indices[i]]
    if (source.id === query.id) {
      continue
    }

    const rx = query.x - source.x
    const ry = query.y - source.y
    const rz = query.z - source.z
    const r2 = rx * rx + ry * ry + rz * rz
    const sigma2 = source.sigma * source.sigma + softening2
    const denom = Math.pow(r2 + sigma2, 1.5)
    if (denom <= 1e-10) {
      continue
    }

    const factor = 1 / (FOUR_PI * denom)
    const cx = ry * source.omegaGammaZ - rz * source.omegaGammaY
    const cy = rz * source.omegaGammaX - rx * source.omegaGammaZ
    const cz = rx * source.omegaGammaY - ry * source.omegaGammaX
    vx += cx * factor
    vy += cy * factor
    vz += cz * factor
  }

  return { x: vx, y: vy, z: vz }
}

function evaluateNodeVelocity(query, node, sources, theta, softening2) {
  if (!node || node.count === 0) {
    return { x: 0, y: 0, z: 0 }
  }

  const rx = query.x - node.comX
  const ry = query.y - node.comY
  const rz = query.z - node.comZ
  const r2 = rx * rx + ry * ry + rz * rz
  const distance = Math.sqrt(Math.max(r2, 1e-12))
  const size = node.halfSize * 2

  if (node.leaf || size / distance < theta) {
    if (node.leaf) {
      return evaluateLeafVelocity(query, node, sources, softening2)
    }
    const sigma2 = node.sigmaMean * node.sigmaMean + softening2
    const denom = Math.pow(r2 + sigma2, 1.5)
    if (denom <= 1e-10) {
      return { x: 0, y: 0, z: 0 }
    }
    const factor = 1 / (FOUR_PI * denom)
    return {
      x: (ry * node.omegaGammaZ - rz * node.omegaGammaY) * factor,
      y: (rz * node.omegaGammaX - rx * node.omegaGammaZ) * factor,
      z: (rx * node.omegaGammaY - ry * node.omegaGammaX) * factor,
    }
  }

  let vx = 0
  let vy = 0
  let vz = 0
  for (let i = 0; i < node.children.length; i += 1) {
    const child = node.children[i]
    if (!child) {
      continue
    }
    const contribution = evaluateNodeVelocity(query, child, sources, theta, softening2)
    vx += contribution.x
    vy += contribution.y
    vz += contribution.z
  }
  return { x: vx, y: vy, z: vz }
}

function buildSourceData(particles, params) {
  const sources = []
  for (let i = 0; i < particles.length; i += 1) {
    const particle = particles[i]
    if (!Number.isFinite(particle?.id)) {
      continue
    }
    const gamma = particle.gamma ?? params.gamma ?? 0
    const rawOmega = particle.vorticity ?? { x: 0, y: 0, z: 0 }
    const omega = controlNaturalCirculationDirection(particle, rawOmega, params)
    const sigma = Math.max(
      particle.coreRadius ?? params.coreRadiusSigma ?? params.minCoreRadius ?? 0.01,
      params.minCoreRadius ?? 0.01,
      1e-4,
    )
    sources.push({
      id: particle.id,
      x: particle.x ?? 0,
      y: particle.y ?? 0,
      z: particle.z ?? 0,
      gamma,
      sigma,
      omegaGammaX: (omega.x ?? 0) * gamma,
      omegaGammaY: (omega.y ?? 0) * gamma,
      omegaGammaZ: (omega.z ?? 0) * gamma,
    })
  }
  return sources
}

export function buildBarnesHutFarFieldDeltas(particles, params, dt) {
  const enabled = params?.hybridPlusBarnesHutEnabled === true
  if (!enabled || !Array.isArray(particles) || particles.length < 8) {
    return []
  }

  const farFieldMethod = params?.hybridPlusFarFieldMethod === 'fmm' ? 'fmm' : 'treecode'
  const baseTheta = clampFinite(params?.hybridPlusBarnesHutTheta, 0.2, 1.2, 0.65)
  // FMM-like mode uses a wider acceptance with denser sampling.
  const theta =
    farFieldMethod === 'fmm' ? clampFinite(baseTheta * 1.25, 0.25, 1.35, 0.82) : baseTheta
  const leafSize = Math.max(
    4,
    Math.floor(clampFinite(params?.hybridPlusBarnesHutLeafSize, 4, 64, 16)),
  )
  const strength = clampFinite(params?.hybridPlusBarnesHutStrength, 0, 1, 0.18)
  const maxDelta = clampFinite(params?.hybridPlusBarnesHutMaxDelta, 0.001, 3, 0.08)
  const maxDeltas = Math.max(
    8,
    Math.floor(clampFinite(params?.hybridPlusBarnesHutMaxDeltas, 8, 4096, 512)),
  )
  const minSpeed = clampFinite(params?.hybridPlusBarnesHutMinSpeed, 0, 2, 0.01)
  const softening = clampFinite(params?.hybridPlusBarnesHutSoftening, 1e-5, 2, 0.02)
  const softening2 = softening * softening
  const maxDepth = 14

  if (strength <= 0 || maxDelta <= 0) {
    return []
  }

  const sources = buildSourceData(particles, params)
  if (sources.length < 8) {
    return []
  }

  const bounds = computeBounds(sources)
  const indices = new Array(sources.length)
  for (let i = 0; i < indices.length; i += 1) {
    indices[i] = i
  }
  const root = buildNode(
    sources,
    indices,
    bounds.centerX,
    bounds.centerY,
    bounds.centerZ,
    bounds.halfSize,
    leafSize,
    0,
    maxDepth,
  )
  if (!root) {
    return []
  }

  const targetDeltas = farFieldMethod === 'fmm' ? Math.min(maxDeltas * 2, 4096) : maxDeltas
  const step = Math.max(1, Math.floor(sources.length / targetDeltas))
  const deltas = []
  for (let i = 0; i < sources.length && deltas.length < targetDeltas; i += step) {
    const query = sources[i]
    const velocity = evaluateNodeVelocity(query, root, sources, theta, softening2)
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z)
    if (speed < minSpeed) {
      continue
    }

    const displacementScale = (dt ?? 0.016) * strength
    let dx = velocity.x * displacementScale
    let dy = velocity.y * displacementScale
    let dz = velocity.z * displacementScale
    const displacement = Math.hypot(dx, dy, dz)
    if (displacement > maxDelta && displacement > 1e-10) {
      const clampRatio = maxDelta / displacement
      dx *= clampRatio
      dy *= clampRatio
      dz *= clampRatio
    }
    deltas.push({ id: query.id, dx, dy, dz })
  }

  return deltas
}
