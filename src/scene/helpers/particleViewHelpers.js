import * as THREE from 'three'

export function createParticleTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  )

  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  return new THREE.CanvasTexture(canvas)
}

export function createParticleView(group, material, particle, arrowHead) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([particle.x, particle.y, particle.z]), 3),
  )

  const mesh = new THREE.Points(geometry, material)
  group.add(mesh)

  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(particle.x, particle.y, particle.z),
    1,
    0xffffff,
    arrowHead,
    arrowHead * 0.5,
  )
  arrow.line.material.transparent = true
  arrow.line.material.depthWrite = false
  arrow.cone.material.transparent = true
  arrow.cone.material.depthWrite = false
  group.add(arrow)

  const curveGeometry = new THREE.BufferGeometry()
  const curveMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
  })
  const curveLine = new THREE.Line(curveGeometry, curveMaterial)
  group.add(curveLine)

  const curveConeGeometry = new THREE.ConeGeometry(1, 1, 10)
  const curveConeMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
  })
  const curveCone = new THREE.Mesh(curveConeGeometry, curveConeMaterial)
  curveCone.scale.set(arrowHead * 0.5, arrowHead, arrowHead * 0.5)
  group.add(curveCone)

  return { mesh, arrow, curveLine, curveCone }
}

export function removeAllViews(group, particleViews) {
  particleViews.forEach((view) => {
    group.remove(view.mesh)
    group.remove(view.arrow)
    group.remove(view.curveLine)
    group.remove(view.curveCone)
    view.mesh.geometry.dispose()
    view.arrow.line.geometry.dispose()
    view.arrow.line.material.dispose()
    view.arrow.cone.geometry.dispose()
    view.arrow.cone.material.dispose()
    view.curveLine.geometry.dispose()
    view.curveLine.material.dispose()
    view.curveCone.geometry.dispose()
    view.curveCone.material.dispose()
  })
}

export function removeExtraViews(group, particleViews, targetLength) {
  while (particleViews.length > targetLength) {
    const view = particleViews.pop()
    group.remove(view.mesh)
    group.remove(view.arrow)
    group.remove(view.curveLine)
    group.remove(view.curveCone)
    view.mesh.geometry.dispose()
    view.arrow.line.geometry.dispose()
    view.arrow.line.material.dispose()
    view.arrow.cone.geometry.dispose()
    view.arrow.cone.material.dispose()
    view.curveLine.geometry.dispose()
    view.curveLine.material.dispose()
    view.curveCone.geometry.dispose()
    view.curveCone.material.dispose()
  }
}
