import * as THREE from 'three'

function ensureGeometryAttribute(geometry, positions) {
  const positionAttr = geometry.getAttribute('position')
  if (!positionAttr || positionAttr.array.length !== positions.length) {
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  } else {
    positionAttr.array.set(positions)
    positionAttr.needsUpdate = true
  }
  geometry.computeBoundingSphere()
}

function buildSurfaceIndices(tube, ringCount) {
  const particlesPerRing = Math.max(3, tube.particlesPerRing ?? 24)
  const layers = Math.max(1, tube.layers ?? 1)
  if (ringCount < 2) {
    return new Uint16Array(0)
  }
  const segmentCount = ringCount
  const indexCount = segmentCount * particlesPerRing * 6
  const useUint32 = ringCount * particlesPerRing > 65535
  const indices = useUint32 ? new Uint32Array(indexCount) : new Uint16Array(indexCount)
  let offset = 0
  const outerLayer = layers - 1
  for (let ring = 0; ring < segmentCount; ring += 1) {
    const nextRing = (ring + 1) % ringCount
    const ringStart = (ring * layers + outerLayer) * particlesPerRing
    const nextRingStart = (nextRing * layers + outerLayer) * particlesPerRing
    for (let i = 0; i < particlesPerRing; i += 1) {
      const nextI = (i + 1) % particlesPerRing
      const a = ringStart + i
      const b = nextRingStart + i
      const c = nextRingStart + nextI
      const d = ringStart + nextI
      indices[offset] = a
      indices[offset + 1] = b
      indices[offset + 2] = d
      indices[offset + 3] = b
      indices[offset + 4] = c
      indices[offset + 5] = d
      offset += 6
    }
  }
  return indices
}

export function createTubeView(group) {
  const pointsGeometry = new THREE.BufferGeometry()
  const pointsMaterial = new THREE.PointsMaterial({
    size: 0.05,
    color: 0x66ccff,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  })
  const points = new THREE.Points(pointsGeometry, pointsMaterial)
  group.add(points)

  const surfaceGeometry = new THREE.BufferGeometry()
  const surfaceMaterial = new THREE.MeshBasicMaterial({
    color: 0x44ddff,
    wireframe: false,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial)
  group.add(surface)
  return { points, surface }
}

export function updateTubeView(view, tube, params, spineNodeCount) {
  const particles = tube?.vorticityParticles ?? []
  const positions = new Float32Array(particles.length * 3)
  for (let i = 0; i < particles.length; i += 1) {
    const base = i * 3
    positions[base] = particles[i].x
    positions[base + 1] = particles[i].y
    positions[base + 2] = particles[i].z
  }
  ensureGeometryAttribute(view.points.geometry, positions)
  ensureGeometryAttribute(view.surface.geometry, positions)

  const ringCount = Math.max(0, Math.floor(spineNodeCount ?? 0))
  const indices = buildSurfaceIndices(tube, ringCount)
  const currentIndex = view.surface.geometry.getIndex()
  if (!currentIndex || currentIndex.array.length !== indices.length) {
    view.surface.geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  } else {
    currentIndex.array.set(indices)
    currentIndex.needsUpdate = true
  }

  const viewMode = params.tubeViewMode ?? 'spine_particles'
  const showParticlesByMode = viewMode === 'particles' || viewMode === 'spine_particles'
  const showSurfaceByMode = viewMode === 'surface'
  view.points.visible = params.showTubeParticles !== false && showParticlesByMode
  view.surface.visible = params.showTubeSurface === true && showSurfaceByMode
}

export function removeTubeViews(group, tubeViews) {
  for (let i = 0; i < tubeViews.length; i += 1) {
    const view = tubeViews[i]
    group.remove(view.points)
    group.remove(view.surface)
    view.points.geometry.dispose()
    view.points.material.dispose()
    view.surface.geometry.dispose()
    view.surface.material.dispose()
  }
}

export function removeExtraTubeViews(group, tubeViews, targetLength) {
  while (tubeViews.length > targetLength) {
    const view = tubeViews.pop()
    group.remove(view.points)
    group.remove(view.surface)
    view.points.geometry.dispose()
    view.points.material.dispose()
    view.surface.geometry.dispose()
    view.surface.material.dispose()
  }
}
