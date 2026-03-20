import * as THREE from 'three'
import { getNozzleBasis } from '../../simulation/physics/emission/shared'

export function createAxisLabelSprite(text, color, position) {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.font = '300 64px sans-serif'
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 64, 64)

  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.position.copy(position)
  sprite.scale.set(0.6, 0.6, 0.6)
  return sprite
}

export function createAxisMesh(color) {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 12)
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 1,
    depthWrite: false,
  })
  return new THREE.Mesh(geometry, material)
}

export function updateAxisMesh(mesh, axis, length, negative = false, thickness = 0.04) {
  const safeLength = Math.max(0.1, length)
  const safeThickness = Math.max(0.005, thickness)
  const direction = negative ? -1 : 1

  mesh.scale.set(safeThickness, safeLength, safeThickness)
  mesh.rotation.set(0, 0, 0)
  mesh.position.set(0, 0, 0)

  if (axis === 'x') {
    mesh.rotation.z = -Math.PI / 2
    mesh.position.x = direction * safeLength * 0.5
    return
  }

  if (axis === 'y') {
    mesh.position.y = direction * safeLength * 0.5
    return
  }

  mesh.rotation.x = Math.PI / 2
  mesh.position.z = direction * safeLength * 0.5
}

export function updateNegativeAxisLine(line, axis, length) {
  const from = new THREE.Vector3(0, 0, 0)
  const to = new THREE.Vector3()
  if (axis === 'x') {
    to.set(-length, 0, 0)
  } else if (axis === 'y') {
    to.set(0, -length, 0)
  } else {
    to.set(0, 0, -length)
  }
  line.geometry.setFromPoints([from, to])
}

export function updateCircleLine(line, nozzle, radius, axialOffset = 0, segments = 64) {
  const { tangent, bitangent, direction } = getNozzleBasis(nozzle)
  const center = new THREE.Vector3(
    nozzle.position.x + direction.x * axialOffset,
    nozzle.position.y + direction.y * axialOffset,
    nozzle.position.z + direction.z * axialOffset,
  )
  const points = []

  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    points.push(
      new THREE.Vector3(
        center.x + radius * (tangent.x * Math.cos(angle) + bitangent.x * Math.sin(angle)),
        center.y + radius * (tangent.y * Math.cos(angle) + bitangent.y * Math.sin(angle)),
        center.z + radius * (tangent.z * Math.cos(angle) + bitangent.z * Math.sin(angle)),
      ),
    )
  }

  line.geometry.setFromPoints(points)
}

export function updateAxisGuide(line, nozzle, length) {
  const direction = nozzle.direction
  const from = new THREE.Vector3(nozzle.position.x, nozzle.position.y, nozzle.position.z)
  const to = new THREE.Vector3(
    nozzle.position.x + direction.x * length,
    nozzle.position.y + direction.y * length,
    nozzle.position.z + direction.z * length,
  )
  line.geometry.setFromPoints([from, to])
}
