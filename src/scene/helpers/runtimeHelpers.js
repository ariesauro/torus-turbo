export function createGridDebugState() {
  return {
    gridHelper: null,
    cellCenterGroup: null,
    cellCenterMesh: null,
    cellCenterCapacity: 0,
    cellCenterCellSize: 0,
    neighborCellGroup: null,
    interactionSphere: null,
    selectedParticleMarker: null,
    selectedParticleIndex: 0,
    lastUpdateFrame: 0,
    updateInterval: 10,
    gridCreated: false,
    cellCentersCreated: false,
    cellCentersSignature: '',
    gridKey: '',
  }
}

export function resetGridDebugState(gridDebug, disposeGroupChildren) {
  if (!gridDebug) {
    return
  }

  if (gridDebug.gridHelper) {
    disposeGroupChildren(gridDebug.gridHelper)
  }
  if (gridDebug.cellCenterGroup) {
    disposeGroupChildren(gridDebug.cellCenterGroup)
  }
  if (gridDebug.neighborCellGroup) {
    disposeGroupChildren(gridDebug.neighborCellGroup)
  }

  gridDebug.gridCreated = false
  gridDebug.cellCentersCreated = false
  gridDebug.cellCentersSignature = ''
  gridDebug.gridKey = ''
  gridDebug.selectedParticleIndex = 0
  gridDebug.cellCenterMesh = null
  gridDebug.cellCenterCapacity = 0
  gridDebug.cellCenterCellSize = 0
}

export function rebuildRuntimeParticles({
  runtime,
  params,
  idRef,
  resetParticles,
  createParticleView,
  removeAllViews,
}) {
  removeAllViews(runtime.group, runtime.particleViews)
  runtime.particleViews = []
  runtime.particles = resetParticles(params, idRef)
  runtime.webgpuManager?.replaceSnapshot(runtime.particles)

  for (let i = 0; i < runtime.particles.length; i += 1) {
    const view = createParticleView(
      runtime.group,
      runtime.particleMaterial,
      runtime.particles[i],
      params.arrowHead,
    )
    runtime.particleViews.push(view)
  }
}

export function rebuildRuntimeFilaments({
  runtime,
  params,
  removeFilamentViews,
}) {
  removeFilamentViews(runtime.group, runtime.filamentViews)
  runtime.filamentViews = []
  runtime.filaments = []

  if (
    params.vortexRepresentation === 'particles' ||
    params.dynamicsMode === 'scripted' ||
    params.emissionMode !== 'vortexRing'
  ) {
    return
  }
}

export function disposeGridDebug(gridDebug, disposeGroupChildren) {
  if (!gridDebug) {
    return
  }

  if (gridDebug.gridHelper) {
    disposeGroupChildren(gridDebug.gridHelper)
  }
  if (gridDebug.cellCenterGroup) {
    disposeGroupChildren(gridDebug.cellCenterGroup)
  }
  if (gridDebug.neighborCellGroup) {
    disposeGroupChildren(gridDebug.neighborCellGroup)
  }
  if (gridDebug.interactionSphere) {
    gridDebug.interactionSphere.geometry.dispose()
    gridDebug.interactionSphere.material.dispose()
  }
  if (gridDebug.selectedParticleMarker) {
    gridDebug.selectedParticleMarker.geometry.dispose()
    gridDebug.selectedParticleMarker.material.dispose()
  }
}
