/**
 * Particle redistribution (remeshing) using the M'4 interpolation kernel.
 *
 * After several advection steps, particles drift from uniform spacing.
 * Remeshing projects vorticity onto a regular grid and creates new particles,
 * restoring uniform coverage and preventing clustering/voids.
 *
 * M'4 kernel (Monaghan 1985):
 *   W(q) = { 1 - 5q²/2 + 3|q|³/2,    0 ≤ |q| ≤ 1
 *          { (2-|q|)²(1-|q|)/2,         1 < |q| ≤ 2
 *          { 0,                          |q| > 2
 *
 * Properties: C², support = [-2, 2], satisfies moment conditions up to order 3,
 * ensuring O(h³) interpolation accuracy.
 *
 * [STATUS]: CORRECT — Cottet & Koumoutsakos (2000), Ch. 5; Monaghan (1985)
 */

function m4Kernel(q) {
  const absQ = Math.abs(q)
  if (absQ >= 2) return 0
  if (absQ <= 1) return 1 - 2.5 * absQ * absQ + 1.5 * absQ * absQ * absQ
  const t = 2 - absQ
  return 0.5 * t * t * (1 - absQ)
}

function m4Kernel3D(dx, dy, dz, h) {
  return m4Kernel(dx / h) * m4Kernel(dy / h) * m4Kernel(dz / h)
}

function computeBoundingBox(particles) {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i]
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.z < minZ) minZ = p.z
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
    if (p.z > maxZ) maxZ = p.z
  }

  return { minX, minY, minZ, maxX, maxY, maxZ }
}

/**
 * Remesh particles onto a regular grid using M'4 interpolation.
 *
 * @param {Array} particles - particle array (mutated in place)
 * @param {Object} params - simulation params
 * @param {Object} idRef - { current: number } for new particle IDs
 * @returns {{ remeshed: boolean, gridNodes: number, activeNodes: number, particlesBefore: number }}
 */
export function remeshParticles(particles, params, idRef = { current: 0 }) {
  const count = particles.length
  if (count < 4) return { remeshed: false, gridNodes: 0, activeNodes: 0, particlesBefore: count }

  const h = Math.max(params.remeshSpacing ?? params.coreRadiusSigma ?? params.minCoreRadius ?? 0.02, 1e-4)
  const support = 2
  const margin = support * h

  const bbox = computeBoundingBox(particles)
  const nx = Math.max(1, Math.ceil((bbox.maxX - bbox.minX + 2 * margin) / h))
  const ny = Math.max(1, Math.ceil((bbox.maxY - bbox.minY + 2 * margin) / h))
  const nz = Math.max(1, Math.ceil((bbox.maxZ - bbox.minZ + 2 * margin) / h))
  const originX = bbox.minX - margin
  const originY = bbox.minY - margin
  const originZ = bbox.minZ - margin

  const maxGridNodes = Math.max(1, Math.min(params.remeshMaxGridNodes ?? 500000, nx * ny * nz))
  if (nx * ny * nz > maxGridNodes) {
    return { remeshed: false, gridNodes: nx * ny * nz, activeNodes: 0, particlesBefore: count, reason: 'grid_too_large' }
  }

  const totalNodes = nx * ny * nz
  const omegaX = new Float64Array(totalNodes)
  const omegaY = new Float64Array(totalNodes)
  const omegaZ = new Float64Array(totalNodes)
  const gammaGrid = new Float64Array(totalNodes)

  for (let p = 0; p < count; p += 1) {
    const particle = particles[p]
    const px = particle.x
    const py = particle.y
    const pz = particle.z
    const ox = particle.vorticity?.x ?? 0
    const oy = particle.vorticity?.y ?? 0
    const oz = particle.vorticity?.z ?? 0
    const gamma = particle.gamma ?? params.gamma ?? 0

    const ci = Math.floor((px - originX) / h)
    const cj = Math.floor((py - originY) / h)
    const ck = Math.floor((pz - originZ) / h)

    for (let di = -support; di <= support; di += 1) {
      const gi = ci + di
      if (gi < 0 || gi >= nx) continue
      const gx = originX + gi * h
      const wx = m4Kernel((px - gx) / h)
      if (Math.abs(wx) < 1e-10) continue

      for (let dj = -support; dj <= support; dj += 1) {
        const gj = cj + dj
        if (gj < 0 || gj >= ny) continue
        const gy = originY + gj * h
        const wy = m4Kernel((py - gy) / h)
        if (Math.abs(wy) < 1e-10) continue

        for (let dk = -support; dk <= support; dk += 1) {
          const gk = ck + dk
          if (gk < 0 || gk >= nz) continue
          const gz = originZ + gk * h
          const wz = m4Kernel((pz - gz) / h)
          const w = wx * wy * wz
          if (Math.abs(w) < 1e-12) continue

          const idx = gi + nx * (gj + ny * gk)
          omegaX[idx] += ox * w
          omegaY[idx] += oy * w
          omegaZ[idx] += oz * w
          gammaGrid[idx] += gamma * w
        }
      }
    }
  }

  const threshold = Math.max(params.remeshThreshold ?? 1e-6, 1e-10)
  const coreRadius = Math.max(params.coreRadiusSigma ?? params.minCoreRadius ?? 0.01, 1e-4)
  const templateParticle = count > 0 ? particles[0] : null
  const newParticles = []
  let activeNodes = 0

  for (let gk = 0; gk < nz; gk += 1) {
    for (let gj = 0; gj < ny; gj += 1) {
      for (let gi = 0; gi < nx; gi += 1) {
        const idx = gi + nx * (gj + ny * gk)
        const mag = Math.sqrt(omegaX[idx] * omegaX[idx] + omegaY[idx] * omegaY[idx] + omegaZ[idx] * omegaZ[idx])
        if (mag < threshold && Math.abs(gammaGrid[idx]) < threshold) continue

        activeNodes += 1
        const newId = idRef.current
        idRef.current += 1

        newParticles.push({
          id: newId,
          x: originX + gi * h,
          y: originY + gj * h,
          z: originZ + gk * h,
          px: originX + gi * h,
          py: originY + gj * h,
          pz: originZ + gk * h,
          vx: 0,
          vy: 0,
          vz: 0,
          flowVx: 0,
          flowVy: 0,
          flowVz: 0,
          velocity: { x: 0, y: 0, z: 0 },
          vorticity: { x: omegaX[idx], y: omegaY[idx], z: omegaZ[idx] },
          gamma: gammaGrid[idx],
          coreRadius,
          age: templateParticle?.age ?? 0,
          life: templateParticle?.life ?? 0,
          theta: 0,
          phi: 0,
          jetPsi: 0,
          hasInjectedTwist: false,
          injectVx: 0,
          injectVy: 0,
          injectVz: 0,
          cascadeLevel: 0,
        })
      }
    }
  }

  const particlesBefore = count
  particles.length = 0
  particles.push(...newParticles)

  return { remeshed: true, gridNodes: totalNodes, activeNodes, particlesBefore }
}

let remeshStepCounter = 0

/**
 * Conditionally remesh particles based on step interval.
 * Call this from the pipeline at the end of each step.
 */
export function maybeRemesh(particles, params, idRef) {
  const interval = Math.max(1, Math.floor(params.remeshInterval ?? 0))
  if (interval <= 0) return null

  remeshStepCounter += 1
  if (remeshStepCounter < interval) return null

  remeshStepCounter = 0
  return remeshParticles(particles, params, idRef)
}

export function resetRemeshCounter() {
  remeshStepCounter = 0
}
