/**
 * Агрегация дальних клеток
 * Вычисляет cellCenter, totalGamma, averageVorticity
 */

export function computeAggregatedCell(
  cellIndex,
  particles,
  particleIndexBuffer,
  cellStartBuffer,
  cellCountBuffer,
) {
  const start = cellStartBuffer[cellIndex]
  const count = cellCountBuffer[cellIndex]

  if (count === 0) {
    return null
  }

  let totalX = 0
  let totalY = 0
  let totalZ = 0
  let totalGamma = 0
  let totalVorticityX = 0
  let totalVorticityY = 0
  let totalVorticityZ = 0

  for (let i = 0; i < count; i++) {
    const particleIdx = particleIndexBuffer[start + i]
    const p = particles[particleIdx]
    const vorticity = p.vorticity ?? { x: 0, y: 0, z: 0 }

    totalX += p.x
    totalY += p.y
    totalZ += p.z
    totalGamma += p.gamma || 1
    totalVorticityX += vorticity.x
    totalVorticityY += vorticity.y
    totalVorticityZ += vorticity.z
  }

  const invCount = 1 / count
  return {
    center: {
      x: totalX * invCount,
      y: totalY * invCount,
      z: totalZ * invCount,
    },
    totalGamma,
    avgVorticity: {
      x: totalVorticityX * invCount,
      y: totalVorticityY * invCount,
      z: totalVorticityZ * invCount,
    },
    particleCount: count,
  }
}

export function computeCellCenter(
  cellIndex,
  gridResolution,
  gridOrigin,
  cellSize,
) {
  const resolution = gridResolution
  const z = Math.floor(cellIndex / (resolution * resolution))
  const rem = cellIndex % (resolution * resolution)
  const y = Math.floor(rem / resolution)
  const x = rem % resolution

  return {
    x: gridOrigin.x + (x + 0.5) * cellSize,
    y: gridOrigin.y + (y + 0.5) * cellSize,
    z: gridOrigin.z + (z + 0.5) * cellSize,
  }
}
