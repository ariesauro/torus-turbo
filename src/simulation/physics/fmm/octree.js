/**
 * Octree для FMM: одна и та же структура узлов с мультиполями и листовыми индексами.
 * Построение по источникам (particles) с полями x,y,z, gamma, vorticity, coreRadius.
 */

function getOctant(source, cx, cy, cz) {
  let octant = 0
  if (source.x >= cx) octant |= 1
  if (source.y >= cy) octant |= 2
  if (source.z >= cz) octant |= 4
  return octant
}

export function computeBounds(sources) {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  for (let i = 0; i < sources.length; i += 1) {
    const s = sources[i]
    if (s.x < minX) minX = s.x
    if (s.y < minY) minY = s.y
    if (s.z < minZ) minZ = s.z
    if (s.x > maxX) maxX = s.x
    if (s.y > maxY) maxY = s.y
    if (s.z > maxZ) maxZ = s.z
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

/**
 * Строит узел дерева. sources — массив { x,y,z, omegaGammaX,Y,Z, sigma, id }, indices — индексы в sources.
 * Возвращает узел с полями: leaf, indices, children, centerX,Y,Z, halfSize, count, multipole { comX, comY, comZ, omegaGammaX,Y,Z, sigmaMean }.
 */
export function buildNode(sources, indices, cx, cy, cz, halfSize, leafSize, depth, maxDepth) {
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
    const s = sources[indices[i]]
    const w = Math.abs(s.gamma ?? 1) + 1e-6
    totalWeight += w
    weightedX += s.x * w
    weightedY += s.y * w
    weightedZ += s.z * w
    sigmaWeighted += (s.sigma ?? 0.01) * w
    omegaGammaX += s.omegaGammaX ?? 0
    omegaGammaY += s.omegaGammaY ?? 0
    omegaGammaZ += s.omegaGammaZ ?? 0
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
    multipole: (() => {
      const comXv = weightedX / Math.max(totalWeight, 1e-6)
      const comYv = weightedY / Math.max(totalWeight, 1e-6)
      const comZv = weightedZ / Math.max(totalWeight, 1e-6)
      let qTrace = 0
      for (let qi = 0; qi < indices.length; qi += 1) {
        const qs = sources[indices[qi]]
        const dx = qs.x - comXv
        const dy = qs.y - comYv
        const dz = qs.z - comZv
        const strength = Math.hypot(qs.omegaGammaX ?? 0, qs.omegaGammaY ?? 0, qs.omegaGammaZ ?? 0)
        qTrace += strength * (dx * dx + dy * dy + dz * dz)
      }
      return {
        comX: comXv, comY: comYv, comZ: comZv,
        omegaGammaX, omegaGammaY, omegaGammaZ,
        sigmaMean: Math.max(1e-6, sigmaWeighted / Math.max(totalWeight, 1e-6)),
        qTrace,
      }
    })(),
  }

  if (node.leaf) {
    node.indices = indices
    return node
  }

  const childHalf = halfSize * 0.5
  const buckets = Array.from({ length: 8 }, () => [])
  for (let i = 0; i < indices.length; i += 1) {
    const idx = indices[i]
    const s = sources[idx]
    buckets[getOctant(s, cx, cy, cz)].push(idx)
  }

  node.children = new Array(8).fill(null)
  for (let octant = 0; octant < 8; octant += 1) {
    const childIndices = buckets[octant]
    if (childIndices.length === 0) continue

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

/**
 * Собирает все листовые узлы в массив (для построения interaction lists и обхода).
 */
export function collectLeaves(node, out = []) {
  if (!node) return out
  if (node.leaf) {
    out.push(node)
    return out
  }
  for (let i = 0; i < node.children.length; i += 1) {
    collectLeaves(node.children[i], out)
  }
  return out
}

/**
 * Проверка well-separated: (sizeA + sizeB) <= theta * distance(centerA, centerB).
 */
export function areWellSeparated(leafA, leafB, theta) {
  const sizeA = leafA.halfSize * 2
  const sizeB = leafB.halfSize * 2
  const dx = leafA.centerX - leafB.centerX
  const dy = leafA.centerY - leafB.centerY
  const dz = leafA.centerZ - leafB.centerZ
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-12
  return sizeA + sizeB <= theta * dist
}
