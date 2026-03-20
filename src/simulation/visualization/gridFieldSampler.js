const FOUR_PI = 4 * Math.PI

function sampleVorticityAtPoint(px, py, pz, particles, maxRadius2) {
  let wx = 0, wy = 0, wz = 0
  let totalWeight = 0
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    const dx = px - (p.x ?? 0)
    const dy = py - (p.y ?? 0)
    const dz = pz - (p.z ?? 0)
    const r2 = dx * dx + dy * dy + dz * dz
    if (r2 > maxRadius2) continue
    const sigma = Math.max(0.01, p.coreRadius ?? 0.2)
    const s2 = sigma * sigma
    const weight = Math.exp(-r2 / (2 * s2))
    wx += (p.vorticity?.x ?? 0) * weight
    wy += (p.vorticity?.y ?? 0) * weight
    wz += (p.vorticity?.z ?? 0) * weight
    totalWeight += weight
  }
  if (totalWeight < 1e-12) return { x: 0, y: 0, z: 0, mag: 0 }
  const inv = 1 / totalWeight
  const ox = wx * inv, oy = wy * inv, oz = wz * inv
  return { x: ox, y: oy, z: oz, mag: Math.hypot(ox, oy, oz) }
}

function sampleVelocityAtPoint(px, py, pz, particles, maxRadius2) {
  let vx = 0, vy = 0, vz = 0
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    const rx = px - (p.x ?? 0)
    const ry = py - (p.y ?? 0)
    const rz = pz - (p.z ?? 0)
    const r2 = rx * rx + ry * ry + rz * rz
    if (r2 > maxRadius2) continue
    const sigma2 = (p.coreRadius ?? 0.2) ** 2
    const denom = (r2 + sigma2) ** 1.5
    if (denom < 1e-10) continue
    const gamma = p.gamma ?? 1
    const ox = (p.vorticity?.x ?? 0) * gamma
    const oy = (p.vorticity?.y ?? 0) * gamma
    const oz = (p.vorticity?.z ?? 0) * gamma
    const factor = 1 / (FOUR_PI * denom)
    vx += (ry * oz - rz * oy) * factor
    vy += (rz * ox - rx * oz) * factor
    vz += (rx * oy - ry * ox) * factor
  }
  return { x: vx, y: vy, z: vz, mag: Math.hypot(vx, vy, vz) }
}

export function sampleGridField(particles, {
  resolution = 16,
  fieldType = 'vorticity',
  bounds = null,
  maxSampleRadius = 2,
} = {}) {
  if (!particles || particles.length === 0) return null

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  if (bounds) {
    minX = bounds.minX; minY = bounds.minY; minZ = bounds.minZ
    maxX = bounds.maxX; maxY = bounds.maxY; maxZ = bounds.maxZ
  } else {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      const x = p.x ?? 0, y = p.y ?? 0, z = p.z ?? 0
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }
    const pad = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 0.1 + 0.5
    minX -= pad; minY -= pad; minZ -= pad
    maxX += pad; maxY += pad; maxZ += pad
  }

  const N = Math.max(4, Math.min(64, resolution))
  const dx = (maxX - minX) / (N - 1)
  const dy = (maxY - minY) / (N - 1)
  const dz = (maxZ - minZ) / (N - 1)
  const maxR2 = maxSampleRadius * maxSampleRadius
  const sampler = fieldType === 'velocity' ? sampleVelocityAtPoint : sampleVorticityAtPoint

  const data = new Float32Array(N * N * N * 4)
  let maxMag = 0
  for (let iz = 0; iz < N; iz++) {
    const pz = minZ + iz * dz
    for (let iy = 0; iy < N; iy++) {
      const py = minY + iy * dy
      for (let ix = 0; ix < N; ix++) {
        const px = minX + ix * dx
        const val = sampler(px, py, pz, particles, maxR2)
        const idx = ((iz * N + iy) * N + ix) * 4
        data[idx] = val.x
        data[idx + 1] = val.y
        data[idx + 2] = val.z
        data[idx + 3] = val.mag
        if (val.mag > maxMag) maxMag = val.mag
      }
    }
  }

  return {
    data,
    resolution: N,
    bounds: { minX, minY, minZ, maxX, maxY, maxZ },
    spacing: { dx, dy, dz },
    maxMagnitude: maxMag,
    fieldType,
  }
}

export function computeQCriterionGrid(vorticityGrid) {
  if (!vorticityGrid) return null
  const N = vorticityGrid.resolution
  const src = vorticityGrid.data
  const qData = new Float32Array(N * N * N)
  let maxQ = 0
  for (let i = 0; i < N * N * N; i++) {
    const mag = src[i * 4 + 3]
    const q = 0.5 * mag * mag
    qData[i] = q
    if (q > maxQ) maxQ = q
  }
  return {
    data: qData,
    resolution: N,
    bounds: vorticityGrid.bounds,
    spacing: vorticityGrid.spacing,
    maxValue: maxQ,
  }
}
