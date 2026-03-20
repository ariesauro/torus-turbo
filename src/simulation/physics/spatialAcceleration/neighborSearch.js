/**
 * Поиск соседних ячеек (3×3×3)
 */

export function getNeighborCells(
  cellIndex,
  gridResolution,
  neighborCellRange,
  cellCountBuffer,
) {
  const neighbors = []
  const resolution = gridResolution
  const z = Math.floor(cellIndex / (resolution * resolution))
  const rem = cellIndex % (resolution * resolution)
  const y = Math.floor(rem / resolution)
  const x = rem % resolution

  for (let dz = -neighborCellRange; dz <= neighborCellRange; dz++) {
    for (let dy = -neighborCellRange; dy <= neighborCellRange; dy++) {
      for (let dx = -neighborCellRange; dx <= neighborCellRange; dx++) {
        const nx = x + dx
        const ny = y + dy
        const nz = z + dz

        if (
          nx >= 0 &&
          nx < resolution &&
          ny >= 0 &&
          ny < resolution &&
          nz >= 0 &&
          nz < resolution
        ) {
          const neighborIdx = nx + ny * resolution + nz * resolution * resolution
          if (cellCountBuffer[neighborIdx] > 0) {
            neighbors.push(neighborIdx)
          }
        }
      }
    }
  }

  return neighbors
}

export function isCellInRange(
  cellIndex1,
  cellIndex2,
  gridResolution,
  range,
) {
  const resolution = gridResolution
  const z1 = Math.floor(cellIndex1 / (resolution * resolution))
  const rem1 = cellIndex1 % (resolution * resolution)
  const y1 = Math.floor(rem1 / resolution)
  const x1 = rem1 % resolution

  const z2 = Math.floor(cellIndex2 / (resolution * resolution))
  const rem2 = cellIndex2 % (resolution * resolution)
  const y2 = Math.floor(rem2 / resolution)
  const x2 = rem2 % resolution

  const dx = Math.abs(x1 - x2)
  const dy = Math.abs(y1 - y2)
  const dz = Math.abs(z1 - z2)

  return dx <= range && dy <= range && dz <= range
}
