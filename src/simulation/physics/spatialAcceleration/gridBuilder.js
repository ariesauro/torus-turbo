/**
 * Построение uniform grid для spatial hashing
 * Вычисляет индекс ячейки для каждой частицы
 */

export function computeCellIndex(particle, cellSize, gridOrigin, gridResolution) {
  const localX = particle.x - gridOrigin.x
  const localY = particle.y - gridOrigin.y
  const localZ = particle.z - gridOrigin.z

  const cellX = Math.floor(localX / cellSize)
  const cellY = Math.floor(localY / cellSize)
  const cellZ = Math.floor(localZ / cellSize)

  if (
    cellX < 0 ||
    cellX >= gridResolution ||
    cellY < 0 ||
    cellY >= gridResolution ||
    cellZ < 0 ||
    cellZ >= gridResolution
  ) {
    return -1
  }

  return cellX + cellY * gridResolution + cellZ * gridResolution * gridResolution
}

export function buildGrid(particles, cellSize, gridResolution) {
  const gridOrigin = getGridOrigin(particles, cellSize)
  const cellIndexBuffer = new Int32Array(particles.length)
  const cellStartBuffer = new Int32Array(gridResolution ** 3 + 1)
  const cellCountBuffer = new Int32Array(gridResolution ** 3)
  const particleIndexBuffer = new Int32Array(particles.length)

  for (let i = 0; i < particles.length; i++) {
    const idx = computeCellIndex(particles[i], cellSize, gridOrigin, gridResolution)
    cellIndexBuffer[i] = idx
  }

  for (let i = 0; i < cellCountBuffer.length; i++) {
    cellCountBuffer[i] = 0
  }

  for (let i = 0; i < cellIndexBuffer.length; i++) {
    const idx = cellIndexBuffer[i]
    if (idx >= 0) {
      cellCountBuffer[idx]++
    }
  }

  cellStartBuffer[0] = 0
  for (let i = 0; i < cellCountBuffer.length; i++) {
    cellStartBuffer[i + 1] = cellStartBuffer[i] + cellCountBuffer[i]
  }

  const tempCounts = new Int32Array(cellCountBuffer.length)
  for (let i = 0; i < particles.length; i++) {
    const idx = cellIndexBuffer[i]
    if (idx >= 0) {
      const pos = cellStartBuffer[idx] + tempCounts[idx]
      particleIndexBuffer[pos] = i
      tempCounts[idx]++
    }
  }

  return {
    cellIndexBuffer,
    cellStartBuffer,
    cellCountBuffer,
    particleIndexBuffer,
    gridOrigin,
  }
}

export function getGridOrigin(particles, cellSize) {
  if (particles.length === 0) {
    return { x: 0, y: 0, z: 0 }
  }

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.z < minZ) minZ = p.z
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
    if (p.z > maxZ) maxZ = p.z
  }

  const margin = cellSize * 2
  minX -= margin
  minY -= margin
  minZ -= margin
  maxX += margin
  maxY += margin
  maxZ += margin

  return {
    x: minX,
    y: minY,
    z: minZ,
    width: maxX - minX,
    height: maxY - minY,
    depth: maxZ - minZ,
  }
}
