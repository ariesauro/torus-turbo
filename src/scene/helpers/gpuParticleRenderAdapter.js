import * as THREE from 'three'

function resolveVectorDisplayMode(params) {
  if (params.vectorDisplayMode === 'vectors') {
    return 'vectors'
  }
  if (params.vectorDisplayMode === 'both') {
    return 'both'
  }
  if (params.vectorDisplayMode === 'particles') {
    return 'particles'
  }
  if (params.showBoth) {
    return 'both'
  }
  if (params.showVectors) {
    return 'vectors'
  }
  return 'particles'
}

function pushGpuHistoryPoint(history, x, y, z, maxLength) {
  history.push({ x, y, z })
  const safeMaxLength = Math.max(2, Math.floor(maxLength))
  if (history.length > safeMaxLength) {
    history.splice(0, history.length - safeMaxLength)
  }
}

function updateGpuCurveHistory({
  simulationState,
  snapshot,
  packed,
  activeCount,
  stride,
  idOffset,
  posOffset,
  curveHistoryLength,
}) {
  if (!simulationState.gpuCurveHistoryById) {
    simulationState.gpuCurveHistoryById = new Map()
  }
  if (simulationState.gpuCurveHistoryDispatchSerial === snapshot.dispatchSerial) {
    return
  }

  const activeIds = new Set()
  for (let i = 0; i < activeCount; i += 1) {
    const base = i * stride
    const particleId = packed[base + idOffset]
    if (!Number.isFinite(particleId)) {
      continue
    }
    const x = packed[base + posOffset] ?? 0
    const y = packed[base + posOffset + 1] ?? 0
    const z = packed[base + posOffset + 2] ?? 0
    activeIds.add(particleId)
    const history = simulationState.gpuCurveHistoryById.get(particleId) ?? []
    pushGpuHistoryPoint(history, x, y, z, curveHistoryLength)
    simulationState.gpuCurveHistoryById.set(particleId, history)
  }

  const staleIds = []
  simulationState.gpuCurveHistoryById.forEach((_history, particleId) => {
    if (!activeIds.has(particleId)) {
      staleIds.push(particleId)
    }
  })
  for (let i = 0; i < staleIds.length; i += 1) {
    simulationState.gpuCurveHistoryById.delete(staleIds[i])
  }

  simulationState.gpuCurveHistoryDispatchSerial = snapshot.dispatchSerial
}

export function renderParticleViewsFromGpuSnapshot({
  runtime,
  currentParams,
  group,
  particleMaterial,
  createParticleView,
  removeExtraViews,
}) {
  const snapshot = runtime.webgpuManager?.getLatestRenderSnapshot?.()
  const descriptor = runtime.simulationState.particleRenderSource?.descriptor
  if (!snapshot?.packed || !descriptor) {
    return false
  }
  const minDispatchSerial = runtime.simulationState.minGpuRenderDispatchSerial ?? 0
  if (snapshot.dispatchSerial < minDispatchSerial) {
    return false
  }
  if (minDispatchSerial > 0) {
    runtime.simulationState.minGpuRenderDispatchSerial = 0
  }
  const isFirstFrameAfterPulseSync = minDispatchSerial > 0

  const stride = Math.max(1, descriptor.particleStrideFloats ?? 24)
  const posOffset = descriptor.positionOffsetFloats ?? 0
  const velOffset = descriptor.velocityOffsetFloats ?? 4
  const vortOffset = descriptor.vorticityOffsetFloats ?? 12
  const flowOffset = descriptor.flowOffsetFloats ?? 17
  const idOffset = descriptor.idOffsetFloats ?? 20
  const injectOffset = idOffset + 1
  const ageOffset = velOffset + 3
  const availableCount = Math.floor(snapshot.packed.length / stride)
  const activeCount = Math.min(snapshot.activeCount ?? 0, availableCount)
  const useCurved = Boolean(currentParams.curvedVectors)
  if (useCurved) {
    updateGpuCurveHistory({
      simulationState: runtime.simulationState,
      snapshot,
      packed: snapshot.packed,
      activeCount,
      stride,
      idOffset,
      posOffset,
      curveHistoryLength: currentParams.curveHistoryLength,
    })
  }

  while (runtime.particleViews.length < activeCount) {
    runtime.particleViews.push(
      createParticleView(group, particleMaterial, { x: 0, y: 0, z: 0 }, currentParams.arrowHead),
    )
  }
  removeExtraViews(group, runtime.particleViews, activeCount)

  const vectorDisplayMode = resolveVectorDisplayMode(currentParams)
  const showVector = vectorDisplayMode === 'vectors' || vectorDisplayMode === 'both'
  const suppressVectorsByGuard = (runtime.simulationState.vectorGuardFrames ?? 0) > 0
  const suppressVectorsByPulse = (runtime.simulationState.vectorPulseCooldownFrames ?? 0) > 0
  const arrowOpacity = Math.min(Math.max(currentParams.arrowOpacity ?? 1, 0), 1)
  const colorScale = currentParams.debugVorticity ? 0.2 : 20
  const particleRepresentationVisible = currentParams.vortexRepresentation !== 'filaments'
  const fallbackDir = new THREE.Vector3(0, 0, 1)
  const maxVelocityForRender = Math.max(currentParams.maxVelocity ?? 0, 1)
  const vectorSpeedRenderCap = maxVelocityForRender * 2
  const vectorHardSpikeThreshold = Math.max(vectorSpeedRenderCap * 2, 120)

  for (let i = 0; i < activeCount; i += 1) {
    const base = i * stride
    const x = snapshot.packed[base + posOffset] ?? 0
    const y = snapshot.packed[base + posOffset + 1] ?? 0
    const z = snapshot.packed[base + posOffset + 2] ?? 0

    const flowVx = Number.isFinite(snapshot.packed[base + flowOffset])
      ? snapshot.packed[base + flowOffset]
      : 0
    const flowVy = Number.isFinite(snapshot.packed[base + flowOffset + 1])
      ? snapshot.packed[base + flowOffset + 1]
      : 0
    const flowVz = Number.isFinite(snapshot.packed[base + flowOffset + 2])
      ? snapshot.packed[base + flowOffset + 2]
      : 0
    const velVx = Number.isFinite(snapshot.packed[base + velOffset])
      ? snapshot.packed[base + velOffset]
      : 0
    const velVy = Number.isFinite(snapshot.packed[base + velOffset + 1])
      ? snapshot.packed[base + velOffset + 1]
      : 0
    const velVz = Number.isFinite(snapshot.packed[base + velOffset + 2])
      ? snapshot.packed[base + velOffset + 2]
      : 0
    const injectVx = Number.isFinite(snapshot.packed[base + injectOffset])
      ? snapshot.packed[base + injectOffset]
      : velVx
    const injectVy = Number.isFinite(snapshot.packed[base + injectOffset + 1])
      ? snapshot.packed[base + injectOffset + 1]
      : velVy
    const injectVz = Number.isFinite(snapshot.packed[base + injectOffset + 2])
      ? snapshot.packed[base + injectOffset + 2]
      : velVz
    const age = Number.isFinite(snapshot.packed[base + ageOffset]) ? snapshot.packed[base + ageOffset] : 0
    const freshVectorWindow = Math.max(Math.max(runtime.fixedStep, 1e-4) * 3, (currentParams.pulseDuration ?? 0) * 0.5)
    const isFreshSpawn = age <= freshVectorWindow

    const renderVx = isFreshSpawn
      ? injectVx
      : Number.isFinite(flowVx) && Math.abs(flowVx) > 1e-8
        ? flowVx
        : 0
    const renderVy = isFreshSpawn
      ? injectVy
      : Number.isFinite(flowVy) && Math.abs(flowVy) > 1e-8
        ? flowVy
        : 0
    const renderVz = isFreshSpawn
      ? injectVz
      : Number.isFinite(flowVz) && Math.abs(flowVz) > 1e-8
        ? flowVz
        : 0

    runtime.speedVector.set(renderVx, renderVy, renderVz)
    const speed = runtime.speedVector.length()
    const hasVectorSpike = speed > vectorHardSpikeThreshold || !Number.isFinite(speed)
    const speedForRender = hasVectorSpike ? 0 : Math.min(speed, vectorSpeedRenderCap)
    const vortX = snapshot.packed[base + vortOffset] ?? 0
    const vortY = snapshot.packed[base + vortOffset + 1] ?? 0
    const vortZ = snapshot.packed[base + vortOffset + 2] ?? 0
    const vorticityMagnitude = Math.hypot(vortX, vortY, vortZ)
    const colorMetric = currentParams.debugVorticity ? vorticityMagnitude : speedForRender
    if (speed > 0) {
      runtime.speedVector.normalize()
    } else {
      runtime.speedVector.copy(fallbackDir)
    }

    let t = Math.min(Math.max(colorMetric * colorScale, 0), 1)
    if (currentParams.invertColors) {
      t = 1 - t
    }
    runtime.mixedColor.copy(runtime.slowColor).lerp(runtime.fastColor, t)

    const view = runtime.particleViews[i]
    const position = view.mesh.geometry.attributes.position.array
    position[0] = x
    position[1] = y
    position[2] = z
    view.mesh.geometry.attributes.position.needsUpdate = true

    view.arrow.position.set(x, y, z)
    view.arrow.setDirection(runtime.speedVector)
    const vectorLength = Math.min(Math.max(speedForRender * currentParams.arrowScale, 0.02), 360)
    view.arrow.setLength(vectorLength, currentParams.arrowHead, currentParams.arrowHead * 0.5)
    view.arrow.line.material.color.copy(runtime.mixedColor)
    view.arrow.cone.material.color.copy(runtime.mixedColor)
    view.arrow.line.material.opacity = arrowOpacity
    view.arrow.line.material.transparent = arrowOpacity < 1
    view.arrow.cone.material.opacity = arrowOpacity
    view.arrow.cone.material.transparent = arrowOpacity < 1

    let hasCurveGeometry = false
    if (useCurved) {
      const particleId = snapshot.packed[base + idOffset]
      const historyPoints = runtime.simulationState.gpuCurveHistoryById?.get(particleId) ?? []
      if (historyPoints.length >= 2) {
        const points = historyPoints.map((point) => new THREE.Vector3(point.x, point.y, point.z))
        const tension = Math.min(Math.max(currentParams.curveStrength, 0), 1)
        const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', tension)
        const samples = Math.max(4, Math.floor(currentParams.curveSamples))
        const sampledPoints = curve.getPoints(samples)
        view.curveLine.geometry.setFromPoints(sampledPoints)
        view.curveLine.material.color.copy(runtime.mixedColor)
        view.curveLine.material.opacity = arrowOpacity
        view.curveLine.material.transparent = arrowOpacity < 1

        const headLength = Math.max(0.01, currentParams.arrowHead)
        const endPoint = sampledPoints[sampledPoints.length - 1]
        runtime.tangentVector.copy(curve.getTangent(1))
        if (runtime.tangentVector.lengthSq() > 0) {
          runtime.tangentVector.normalize()
        } else {
          runtime.tangentVector.copy(runtime.speedVector)
        }
        if (runtime.tangentVector.lengthSq() <= 1e-10) {
          runtime.tangentVector.set(0, 0, 1)
        }

        view.curveCone.scale.set(headLength * 0.5, headLength, headLength * 0.5)
        view.curveCone.position.copy(endPoint).addScaledVector(runtime.tangentVector, -headLength * 0.5)
        view.curveCone.quaternion.setFromUnitVectors(runtime.upVector, runtime.tangentVector)
        view.curveCone.material.color.copy(runtime.mixedColor)
        view.curveCone.material.opacity = arrowOpacity
        view.curveCone.material.transparent = arrowOpacity < 1
        hasCurveGeometry = true
      }
    }

    const suppressVectorsThisFrame =
      suppressVectorsByGuard || suppressVectorsByPulse || isFirstFrameAfterPulseSync || hasVectorSpike
    view.arrow.visible = showVector && !suppressVectorsThisFrame && (!useCurved || !hasCurveGeometry)
    view.curveLine.visible = showVector && !suppressVectorsThisFrame && useCurved && hasCurveGeometry
    view.curveCone.visible = showVector && !suppressVectorsThisFrame && useCurved && hasCurveGeometry
    view.mesh.visible = particleRepresentationVisible && vectorDisplayMode !== 'vectors'
  }

  return true
}
