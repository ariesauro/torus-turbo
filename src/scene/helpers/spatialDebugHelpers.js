import * as THREE from 'three'

function createCellBoxGeometry(cellSize) {
  return new THREE.BoxGeometry(cellSize * 0.99, cellSize * 0.99, cellSize * 0.99)
}

export function disposeGroupChildren(group) {
  if (!group) {
    return
  }

  group.children.forEach((child) => {
    child.geometry?.dispose?.()
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material?.dispose?.())
    } else {
      child.material?.dispose?.()
    }
  })
  group.clear()
}

export function getClosestParticleIndexToCameraCenter(camera, particles) {
  if (!camera || particles.length === 0) {
    return 0
  }

  let bestIndex = 0
  let bestScore = Infinity
  const projected = new THREE.Vector3()

  for (let i = 0; i < particles.length; i += 1) {
    projected.set(particles[i].x, particles[i].y, particles[i].z).project(camera)
    const score = projected.x * projected.x + projected.y * projected.y

    if (score < bestScore) {
      bestScore = score
      bestIndex = i
    }
  }

  return bestIndex
}

function getCellCentersData(particles, cellSize, gridResolution) {
  const gridSize = gridResolution * cellSize
  const offset = (gridSize - cellSize) / 2
  const cells = new Map()

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i]
    const cellX = Math.floor((p.x + offset) / cellSize)
    const cellY = Math.floor((p.y + offset) / cellSize)
    const cellZ = Math.floor((p.z + offset) / cellSize)
    const key = `${cellX},${cellY},${cellZ}`

    if (!cells.has(key)) {
      cells.set(key, { x: cellX, y: cellY, z: cellZ, count: 0 })
    }
    cells.get(key).count += 1
  }

  return {
    cells,
    offset,
  }
}

function ensureCellCentersMesh(oldGrid, group, cellSize, requiredCount) {
  if (!oldGrid.cellCenterGroup) {
    oldGrid.cellCenterGroup = new THREE.Group()
    group.add(oldGrid.cellCenterGroup)
  }

  const needsRebuild =
    !oldGrid.cellCenterMesh ||
    oldGrid.cellCenterCapacity !== requiredCount ||
    oldGrid.cellCenterCellSize !== cellSize

  if (!needsRebuild) {
    return oldGrid.cellCenterMesh
  }

  disposeGroupChildren(oldGrid.cellCenterGroup)

  const geometry = new THREE.SphereGeometry(cellSize * 0.15, 8, 8)
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.8,
    vertexColors: true,
  })
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(requiredCount, 1))
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  oldGrid.cellCenterGroup.add(mesh)

  oldGrid.cellCenterMesh = mesh
  oldGrid.cellCenterCapacity = requiredCount
  oldGrid.cellCenterCellSize = cellSize
  return mesh
}

export function updateDebugGrid(group, particles, params, oldGrid, camera) {
  const { cellSizeMultiplier = 4, coreRadiusSigma = 0.01, interactionRadius: paramsInteractionRadius } = params
  const cellSize = Math.max(coreRadiusSigma * cellSizeMultiplier, 0.01)
  const gridResolution = 32
  const interactionRadius = paramsInteractionRadius || coreRadiusSigma * 3
  const gridKey = `${gridResolution}:${cellSize.toFixed(4)}`
  const { cells, offset } = getCellCentersData(particles, cellSize, gridResolution)

  if (
    oldGrid.selectedParticleIndex == null ||
    oldGrid.selectedParticleIndex < 0 ||
    oldGrid.selectedParticleIndex >= particles.length
  ) {
    oldGrid.selectedParticleIndex = getClosestParticleIndexToCameraCenter(camera, particles)
  }

  const selectedParticle =
    oldGrid.selectedParticleIndex !== undefined && oldGrid.selectedParticleIndex < particles.length
      ? particles[oldGrid.selectedParticleIndex]
      : null

  if (!oldGrid.gridHelper) {
    oldGrid.gridHelper = new THREE.Group()
    group.add(oldGrid.gridHelper)
  }

  if (oldGrid.gridKey !== gridKey) {
    disposeGroupChildren(oldGrid.gridHelper)
    oldGrid.gridCreated = false
    oldGrid.gridKey = gridKey
  }

  if (params.showGrid && !oldGrid.gridCreated) {
    const boxGeometry = createCellBoxGeometry(cellSize)
    const edges = new THREE.EdgesGeometry(boxGeometry)
    const material = new THREE.LineBasicMaterial({
      color: 0x888888,
      transparent: true,
      opacity: 0.4,
    })

    for (let x = 0; x < gridResolution; x += 1) {
      for (let y = 0; y < gridResolution; y += 1) {
        for (let z = 0; z < gridResolution; z += 1) {
          const mesh = new THREE.LineSegments(edges, material.clone())
          mesh.position.x = -offset + (x + 0.5) * cellSize
          mesh.position.y = -offset + (y + 0.5) * cellSize
          mesh.position.z = -offset + (z + 0.5) * cellSize
          oldGrid.gridHelper.add(mesh)
        }
      }
    }
    oldGrid.gridCreated = true
  }

  oldGrid.gridHelper.visible = !!params.showGrid

  if (!oldGrid.cellCenterGroup) {
    oldGrid.cellCenterGroup = new THREE.Group()
    group.add(oldGrid.cellCenterGroup)
  }

  if (params.showCellCenters && cells.size > 0) {
    const filledCells = Array.from(cells.values())
    const instancedMesh = ensureCellCentersMesh(oldGrid, group, cellSize, filledCells.length)
    const dummy = new THREE.Object3D()

    filledCells.forEach((cellData, index) => {
      const ratio = Math.min(cellData.count / 10, 1)
      const color = new THREE.Color(ratio, 0.3, 1 - ratio)
      const sphereSize = 1 + Math.sqrt(cellData.count) * 0.3
      dummy.position.set(
        -offset + (cellData.x + 0.5) * cellSize,
        -offset + (cellData.y + 0.5) * cellSize,
        -offset + (cellData.z + 0.5) * cellSize,
      )
      dummy.scale.set(sphereSize, sphereSize, sphereSize)
      dummy.updateMatrix()

      instancedMesh.setMatrixAt(index, dummy.matrix)
      instancedMesh.setColorAt(index, color)
    })

    instancedMesh.count = filledCells.length
    instancedMesh.instanceMatrix.needsUpdate = true
    if (instancedMesh.instanceColor) {
      instancedMesh.instanceColor.needsUpdate = true
    }
  }

  oldGrid.cellCenterGroup.visible = !!params.showCellCenters

  if (!oldGrid.neighborCellGroup) {
    oldGrid.neighborCellGroup = new THREE.Group()
    group.add(oldGrid.neighborCellGroup)
  }

  disposeGroupChildren(oldGrid.neighborCellGroup)
  oldGrid.neighborCellGroup.visible = !!params.showNeighborCells

  if (oldGrid.interactionSphere) {
    oldGrid.interactionSphere.visible = false
  }

  if (oldGrid.selectedParticleMarker) {
    oldGrid.selectedParticleMarker.visible = false
  }

  if (params.showNeighborCells && selectedParticle) {
    const cellX = Math.floor((selectedParticle.x + offset) / cellSize)
    const cellY = Math.floor((selectedParticle.y + offset) / cellSize)
    const cellZ = Math.floor((selectedParticle.z + offset) / cellSize)

    const currentCellMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      wireframe: true,
      transparent: true,
      opacity: 0.9,
    })
    const neighborMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    })
    const neighborBoxGeometry = createCellBoxGeometry(cellSize)

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const nx = cellX + dx
          const ny = cellY + dy
          const nz = cellZ + dz
          const isCurrent = dx === 0 && dy === 0 && dz === 0
          const mesh = new THREE.Mesh(
            neighborBoxGeometry,
            isCurrent ? currentCellMaterial : neighborMaterial,
          )
          mesh.position.set(
            -offset + (nx + 0.5) * cellSize,
            -offset + (ny + 0.5) * cellSize,
            -offset + (nz + 0.5) * cellSize,
          )
          oldGrid.neighborCellGroup.add(mesh)
        }
      }
    }

    if (!oldGrid.interactionSphere) {
      const sphereGeometry = new THREE.SphereGeometry(interactionRadius, 16, 16)
      const sphereMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        wireframe: true,
        transparent: true,
        opacity: 0.3,
      })
      oldGrid.interactionSphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
      group.add(oldGrid.interactionSphere)
    }
    oldGrid.interactionSphere.position.copy(selectedParticle)
    oldGrid.interactionSphere.visible = true

    if (!oldGrid.selectedParticleMarker) {
      const markerGeometry = new THREE.SphereGeometry(cellSize * 0.3, 8, 8)
      const markerMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
      })
      oldGrid.selectedParticleMarker = new THREE.Mesh(markerGeometry, markerMaterial)
      group.add(oldGrid.selectedParticleMarker)
    }
    oldGrid.selectedParticleMarker.position.copy(selectedParticle)
    oldGrid.selectedParticleMarker.visible = true
  }
}
