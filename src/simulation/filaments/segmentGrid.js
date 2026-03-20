function getSegmentBounds(a, b, padding) {
  return {
    minX: Math.min(a.x, b.x) - padding,
    minY: Math.min(a.y, b.y) - padding,
    minZ: Math.min(a.z, b.z) - padding,
    maxX: Math.max(a.x, b.x) + padding,
    maxY: Math.max(a.y, b.y) + padding,
    maxZ: Math.max(a.z, b.z) + padding,
  }
}

function cellKey(ix, iy, iz) {
  return `${ix}:${iy}:${iz}`
}

export function buildSegmentGrid(filaments, cellSize) {
  const safeCellSize = Math.max(cellSize, 1e-4)
  const cells = new Map()
  const segments = []

  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const filament = filaments[filamentIndex]
    const nodeCount = filament.nodes.length
    const segmentCount = filament.closedLoop ? nodeCount : Math.max(0, nodeCount - 1)

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const aIndex = segmentIndex
      const bIndex = (segmentIndex + 1) % nodeCount
      const a = filament.nodes[aIndex].position
      const b = filament.nodes[bIndex].position
      const bounds = getSegmentBounds(a, b, safeCellSize * 0.5)
      const segmentRecord = {
        filamentIndex,
        segmentIndex,
        aIndex,
        bIndex,
      }
      const recordIndex = segments.length
      segments.push(segmentRecord)

      const minCellX = Math.floor(bounds.minX / safeCellSize)
      const minCellY = Math.floor(bounds.minY / safeCellSize)
      const minCellZ = Math.floor(bounds.minZ / safeCellSize)
      const maxCellX = Math.floor(bounds.maxX / safeCellSize)
      const maxCellY = Math.floor(bounds.maxY / safeCellSize)
      const maxCellZ = Math.floor(bounds.maxZ / safeCellSize)

      for (let x = minCellX; x <= maxCellX; x += 1) {
        for (let y = minCellY; y <= maxCellY; y += 1) {
          for (let z = minCellZ; z <= maxCellZ; z += 1) {
            const key = cellKey(x, y, z)
            const list = cells.get(key)
            if (list) {
              list.push(recordIndex)
            } else {
              cells.set(key, [recordIndex])
            }
          }
        }
      }
    }
  }

  return {
    cellSize: safeCellSize,
    cells,
    segments,
  }
}

export function querySegmentGrid(
  grid,
  position,
  searchRadius,
  scratchSegments,
  marks,
  token,
) {
  if (!Array.isArray(scratchSegments) || !(marks instanceof Uint32Array)) {
    return 0
  }

  const safeRadius = Math.max(searchRadius, grid.cellSize)
  const cellRadius = Math.max(1, Math.ceil(safeRadius / grid.cellSize))
  const cellX = Math.floor(position.x / grid.cellSize)
  const cellY = Math.floor(position.y / grid.cellSize)
  const cellZ = Math.floor(position.z / grid.cellSize)
  let count = 0

  for (let x = cellX - cellRadius; x <= cellX + cellRadius; x += 1) {
    for (let y = cellY - cellRadius; y <= cellY + cellRadius; y += 1) {
      for (let z = cellZ - cellRadius; z <= cellZ + cellRadius; z += 1) {
        const bucket = grid.cells.get(cellKey(x, y, z))
        if (!bucket) {
          continue
        }
        for (let i = 0; i < bucket.length; i += 1) {
          const segmentIndex = bucket[i]
          if (marks[segmentIndex] === token) {
            continue
          }
          marks[segmentIndex] = token
          scratchSegments[count] = segmentIndex
          count += 1
        }
      }
    }
  }

  return count
}
