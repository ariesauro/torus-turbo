import * as THREE from 'three'

const RADIAL_SEGMENTS = 8
const MIN_ARROW_LENGTH = 0.04
const MAX_ARROW_LENGTH = 1.4

function normalizeVector(x, y, z) {
  const len = Math.hypot(x, y, z)
  if (len <= 1e-8) {
    return { x: 0, y: 0, z: 1 }
  }
  return { x: x / len, y: y / len, z: z / len }
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function computeTangent(nodes, index, closedLoop) {
  const count = nodes.length
  if (closedLoop) {
    const prev = nodes[(index - 1 + count) % count].position
    const next = nodes[(index + 1) % count].position
    return normalizeVector(next.x - prev.x, next.y - prev.y, next.z - prev.z)
  }

  if (index === 0) {
    const current = nodes[0].position
    const next = nodes[1].position
    return normalizeVector(next.x - current.x, next.y - current.y, next.z - current.z)
  }
  if (index === count - 1) {
    const prev = nodes[count - 2].position
    const current = nodes[count - 1].position
    return normalizeVector(current.x - prev.x, current.y - prev.y, current.z - prev.z)
  }

  const prev = nodes[index - 1].position
  const next = nodes[index + 1].position
  return normalizeVector(next.x - prev.x, next.y - prev.y, next.z - prev.z)
}

function computeCurvature(nodes, index, closedLoop) {
  const count = nodes.length
  if (count < 3) {
    return 0
  }

  if (!closedLoop && (index === 0 || index === count - 1)) {
    return 0
  }

  const prevIndex = closedLoop ? (index - 1 + count) % count : Math.max(0, index - 1)
  const nextIndex = closedLoop ? (index + 1) % count : Math.min(count - 1, index + 1)
  const p0 = nodes[prevIndex].position
  const p1 = nodes[index].position
  const p2 = nodes[nextIndex].position

  const v1 = normalizeVector(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z)
  const v2 = normalizeVector(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z)
  if (!v1 || !v2) {
    return 0
  }

  return Math.hypot(v2.x - v1.x, v2.y - v1.y, v2.z - v1.z)
}

function buildTubeBuffers(filament, radius) {
  const nodes = filament.nodes
  const ringCount = nodes.length
  const closedLoop = filament.closedLoop !== false
  if (ringCount < 2) {
    return null
  }

  const segmentCount = closedLoop ? ringCount : ringCount - 1
  if (segmentCount <= 0) {
    return null
  }

  const vertexCount = ringCount * RADIAL_SEGMENTS
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const curvature = new Float32Array(vertexCount)
  const indexCount = segmentCount * RADIAL_SEGMENTS * 6
  const useUint32 = vertexCount > 65535
  const indices = useUint32 ? new Uint32Array(indexCount) : new Uint16Array(indexCount)

  const tangents = new Array(ringCount)
  for (let i = 0; i < ringCount; i += 1) {
    tangents[i] = computeTangent(nodes, i, closedLoop)
  }

  const firstTangent = tangents[0]
  const up = Math.abs(firstTangent.y) < 0.95 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  let normal = cross(up, firstTangent)
  normal = normalizeVector(normal.x, normal.y, normal.z)
  let binormal = cross(firstTangent, normal)
  binormal = normalizeVector(binormal.x, binormal.y, binormal.z)

  for (let i = 0; i < ringCount; i += 1) {
    const t = tangents[i]
    const nodeCurvature = computeCurvature(nodes, i, closedLoop)
    if (i > 0) {
      const projected = {
        x: normal.x - t.x * dot(normal, t),
        y: normal.y - t.y * dot(normal, t),
        z: normal.z - t.z * dot(normal, t),
      }
      normal = normalizeVector(projected.x, projected.y, projected.z)
      binormal = cross(t, normal)
      binormal = normalizeVector(binormal.x, binormal.y, binormal.z)
    }

    const center = nodes[i].position
    for (let s = 0; s < RADIAL_SEGMENTS; s += 1) {
      const angle = (s / RADIAL_SEGMENTS) * Math.PI * 2
      const cosA = Math.cos(angle)
      const sinA = Math.sin(angle)
      const radialX = normal.x * cosA + binormal.x * sinA
      const radialY = normal.y * cosA + binormal.y * sinA
      const radialZ = normal.z * cosA + binormal.z * sinA

      const vertexIndex = i * RADIAL_SEGMENTS + s
      const base = vertexIndex * 3
      positions[base] = center.x + radialX * radius
      positions[base + 1] = center.y + radialY * radius
      positions[base + 2] = center.z + radialZ * radius
      normals[base] = radialX
      normals[base + 1] = radialY
      normals[base + 2] = radialZ
      curvature[vertexIndex] = nodeCurvature
    }
  }

  let indexOffset = 0
  for (let i = 0; i < segmentCount; i += 1) {
    const nextRing = closedLoop ? (i + 1) % ringCount : i + 1
    for (let s = 0; s < RADIAL_SEGMENTS; s += 1) {
      const nextS = (s + 1) % RADIAL_SEGMENTS
      const a = i * RADIAL_SEGMENTS + s
      const b = nextRing * RADIAL_SEGMENTS + s
      const c = nextRing * RADIAL_SEGMENTS + nextS
      const d = i * RADIAL_SEGMENTS + nextS

      indices[indexOffset] = a
      indices[indexOffset + 1] = b
      indices[indexOffset + 2] = d
      indices[indexOffset + 3] = b
      indices[indexOffset + 4] = c
      indices[indexOffset + 5] = d
      indexOffset += 6
    }
  }

  return { positions, normals, curvature, indices }
}

function updateTubeGeometry(geometry, buffers) {
  if (!buffers) {
    geometry.setIndex([])
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(0), 3))
    geometry.setAttribute('curvature', new THREE.BufferAttribute(new Float32Array(0), 1))
    geometry.computeBoundingSphere()
    return
  }

  const { positions, normals, curvature, indices } = buffers
  const positionAttr = geometry.getAttribute('position')
  const normalAttr = geometry.getAttribute('normal')
  const curvatureAttr = geometry.getAttribute('curvature')
  const indexAttr = geometry.getIndex()

  const canReusePosition = positionAttr && positionAttr.array.length === positions.length
  const canReuseNormal = normalAttr && normalAttr.array.length === normals.length
  const canReuseCurvature = curvatureAttr && curvatureAttr.array.length === curvature.length
  const canReuseIndex = indexAttr && indexAttr.array.length === indices.length

  if (canReusePosition && canReuseNormal && canReuseCurvature && canReuseIndex) {
    positionAttr.array.set(positions)
    normalAttr.array.set(normals)
    curvatureAttr.array.set(curvature)
    indexAttr.array.set(indices)
    positionAttr.needsUpdate = true
    normalAttr.needsUpdate = true
    curvatureAttr.needsUpdate = true
    indexAttr.needsUpdate = true
  } else {
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geometry.setAttribute('curvature', new THREE.BufferAttribute(curvature, 1))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  }
  geometry.computeBoundingSphere()
}

export function createFilamentView(group) {
  const lineGeometry = new THREE.BufferGeometry()
  const lineMaterial = new THREE.ShaderMaterial({
    uniforms: {
      baseColor: { value: new THREE.Color(0.85, 0.87, 0.9) },
      circulationColor: { value: new THREE.Color(0xff8844) },
      useCirculation: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 baseColor;
      uniform vec3 circulationColor;
      uniform float useCirculation;
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;

      void main() {
        float rim = pow(1.0 - max(dot(normalize(vWorldNormal), normalize(vViewDir)), 0.0), 2.0);
        vec3 smokeColor = baseColor + rim * 0.25;
        vec3 color = mix(smokeColor, circulationColor, step(0.5, useCirculation));
        gl_FragColor = vec4(color, 0.35);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  })
  const line = new THREE.Mesh(lineGeometry, lineMaterial)
  group.add(line)

  const nodeGroup = new THREE.Group()
  group.add(nodeGroup)
  const velocityVectorGroup = new THREE.Group()
  group.add(velocityVectorGroup)
  const tangentVectorGroup = new THREE.Group()
  group.add(tangentVectorGroup)

  return {
    line,
    nodeGroup,
    velocityVectorGroup,
    tangentVectorGroup,
  }
}

function ensureArrowCount(group, count, color) {
  while (group.children.length < count) {
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      MIN_ARROW_LENGTH,
      color,
      0.04,
      0.02,
    )
    group.add(arrow)
  }
  while (group.children.length > count) {
    const arrow = group.children[group.children.length - 1]
    group.remove(arrow)
    if (arrow.line?.material) {
      arrow.line.material.dispose()
    }
    if (arrow.cone?.material) {
      arrow.cone.material.dispose()
    }
  }
}

function updateDebugArrows(view, filament, params) {
  const nodes = filament.nodes ?? []
  const showVelocity = !!params.showFilamentVelocityVectors
  const showTangents = !!params.showFilamentTangents
  ensureArrowCount(view.velocityVectorGroup, nodes.length, 0x44ddff)
  ensureArrowCount(view.tangentVectorGroup, nodes.length, 0xffaa44)

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]
    const velocityArrow = view.velocityVectorGroup.children[i]
    const tangentArrow = view.tangentVectorGroup.children[i]
    const velocity = node.velocity ?? { x: 0, y: 0, z: 0 }
    const velocityLength = Math.hypot(velocity.x, velocity.y, velocity.z)
    const velocityDir =
      velocityLength > 1e-8
        ? new THREE.Vector3(
            velocity.x / velocityLength,
            velocity.y / velocityLength,
            velocity.z / velocityLength,
          )
        : new THREE.Vector3(0, 1, 0)

    velocityArrow.position.set(node.position.x, node.position.y, node.position.z)
    velocityArrow.setDirection(velocityDir)
    velocityArrow.setLength(
      Math.max(MIN_ARROW_LENGTH, Math.min(MAX_ARROW_LENGTH, velocityLength * 0.15)),
      0.05,
      0.025,
    )
    velocityArrow.visible = showVelocity

    const tangent = computeTangent(nodes, i, filament.closedLoop !== false)
    const tangentLength = Math.hypot(tangent.x, tangent.y, tangent.z)
    const tangentDir =
      tangentLength > 1e-8
        ? new THREE.Vector3(tangent.x, tangent.y, tangent.z)
        : new THREE.Vector3(0, 0, 1)
    tangentArrow.position.set(node.position.x, node.position.y, node.position.z)
    tangentArrow.setDirection(tangentDir)
    tangentArrow.setLength(0.22, 0.045, 0.02)
    tangentArrow.visible = showTangents
  }

  view.velocityVectorGroup.visible = showVelocity
  view.tangentVectorGroup.visible = showTangents
}

export function updateFilamentView(view, filament, params) {
  const tubeRadius = Math.max(filament.coreRadius ?? 0.08, 1e-4)
  const buffers = buildTubeBuffers(filament, tubeRadius)
  updateTubeGeometry(view.line.geometry, buffers)

  if (params.filamentColorByCurvature === true || params.filamentColorByStrainRate === true) {
    const nodes = filament.nodes ?? []
    let maxVal = 0
    if (params.filamentColorByCurvature === true) {
      for (let i = 0; i < nodes.length; i += 1) {
        const c = nodes[i].curvature ?? 0
        if (c > maxVal) maxVal = c
      }
    } else {
      for (let i = 0; i < nodes.length; i += 1) {
        const s = nodes[i].strainRate ?? 0
        if (s > maxVal) maxVal = s
      }
    }
    const scale = params.filamentColorByCurvature === true ? 0.5 : 0.6
    const normalized = Math.min(maxVal * scale, 1)
    view.line.material.uniforms.circulationColor.value.setRGB(normalized, 0.3, 1 - normalized)
    view.line.material.uniforms.useCirculation.value = 1
  } else if (params.showCirculation) {
    const normalized = Math.min(Math.abs(filament.circulation ?? 0) / 5, 1)
    view.line.material.uniforms.circulationColor.value.setRGB(normalized, 0.4, 1 - normalized)
    view.line.material.uniforms.useCirculation.value = 1
  } else {
    view.line.material.uniforms.useCirculation.value = 0
  }

  while (view.nodeGroup.children.length < filament.nodes.length) {
    const geometry = new THREE.SphereGeometry(0.06, 8, 8)
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff })
    view.nodeGroup.add(new THREE.Mesh(geometry, material))
  }

  while (view.nodeGroup.children.length > filament.nodes.length) {
    const child = view.nodeGroup.children.pop()
    child.geometry.dispose()
    child.material.dispose()
  }

  for (let i = 0; i < filament.nodes.length; i += 1) {
    const node = filament.nodes[i]
    const mesh = view.nodeGroup.children[i]
    mesh.position.set(node.position.x, node.position.y, node.position.z)
    mesh.visible = !!params.showFilamentNodes
    if (params.showCirculation) {
      const normalized = Math.min(Math.abs(filament.circulation ?? 0) / 5, 1)
      mesh.material.color.setRGB(normalized, 0.4, 1 - normalized)
    } else {
      mesh.material.color.set(0xffffff)
    }
  }

  updateDebugArrows(view, filament, params)
  view.line.visible = !!params.showFilaments
  view.nodeGroup.visible = !!params.showFilamentNodes
}

export function removeFilamentViews(group, filamentViews) {
  filamentViews.forEach((view) => {
    group.remove(view.line)
    group.remove(view.nodeGroup)
    group.remove(view.velocityVectorGroup)
    group.remove(view.tangentVectorGroup)
    view.line.geometry.dispose()
    view.line.material.dispose()
    view.nodeGroup.children.forEach((child) => {
      child.geometry.dispose()
      child.material.dispose()
    })
    view.velocityVectorGroup.children.forEach((arrow) => {
      arrow.line?.material?.dispose()
      arrow.cone?.material?.dispose()
    })
    view.tangentVectorGroup.children.forEach((arrow) => {
      arrow.line?.material?.dispose()
      arrow.cone?.material?.dispose()
    })
    view.nodeGroup.clear()
    view.velocityVectorGroup.clear()
    view.tangentVectorGroup.clear()
  })
}

export function removeExtraFilamentViews(group, filamentViews, targetLength) {
  while (filamentViews.length > targetLength) {
    const view = filamentViews.pop()
    group.remove(view.line)
    group.remove(view.nodeGroup)
    group.remove(view.velocityVectorGroup)
    group.remove(view.tangentVectorGroup)
    view.line.geometry.dispose()
    view.line.material.dispose()
    view.nodeGroup.children.forEach((child) => {
      child.geometry.dispose()
      child.material.dispose()
    })
    view.velocityVectorGroup.children.forEach((arrow) => {
      arrow.line?.material?.dispose()
      arrow.cone?.material?.dispose()
    })
    view.tangentVectorGroup.children.forEach((arrow) => {
      arrow.line?.material?.dispose()
      arrow.cone?.material?.dispose()
    })
    view.nodeGroup.clear()
    view.velocityVectorGroup.clear()
    view.tangentVectorGroup.clear()
  }
}
