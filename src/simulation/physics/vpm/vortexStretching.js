const FOUR_PI = 4 * Math.PI

/**
 * Analytic vortex stretching: (ω·∇)u derived from the regularized Biot-Savart kernel.
 *
 * For source j with strength γⱼ·ωⱼ, the velocity gradient at particle i contributes:
 *   (ωᵢ·∇)u = (γⱼ/4π) · [ (ωᵢ × ωⱼ)/(r²+σ²)^(3/2) − 3(ωᵢ·r)(r × ωⱼ)/(r²+σ²)^(5/2) ]
 *
 * where r = xᵢ − xⱼ.
 *
 * [STATUS]: CORRECT — analytic gradient of desingularized Biot-Savart kernel
 */
function analyticStretching(particles, params, dt, strength) {
  const count = particles.length
  const minCore = Math.max(params.minCoreRadius ?? 0.01, 1e-4)
  const interactionRadius = Math.max(params.interactionRadius ?? 0, 0)
  const interactionRadius2 = interactionRadius * interactionRadius

  const dX = new Float64Array(count)
  const dY = new Float64Array(count)
  const dZ = new Float64Array(count)

  for (let i = 0; i < count; i += 1) {
    const pi = particles[i]
    const oix = pi.vorticity?.x ?? 0
    const oiy = pi.vorticity?.y ?? 0
    const oiz = pi.vorticity?.z ?? 0
    const omegaMag = Math.sqrt(oix * oix + oiy * oiy + oiz * oiz)
    if (omegaMag <= 1e-8) continue

    for (let j = 0; j < count; j += 1) {
      if (i === j) continue

      const pj = particles[j]
      const rx = pi.x - pj.x
      const ry = pi.y - pj.y
      const rz = pi.z - pj.z
      const r2 = rx * rx + ry * ry + rz * rz

      if (interactionRadius > 0 && r2 > interactionRadius2) continue

      const sigma = Math.max(pj.coreRadius ?? params.coreRadiusSigma ?? minCore, minCore)
      const sigma2 = sigma * sigma
      const r2s2 = r2 + sigma2

      if (r2s2 <= 1e-16) continue

      const r2s2_15 = Math.pow(r2s2, 1.5)
      const r2s2_25 = r2s2_15 * r2s2

      const gammaJ = pj.gamma ?? params.gamma ?? 0
      if (Math.abs(gammaJ) <= 1e-12) continue

      const ojx = pj.vorticity?.x ?? 0
      const ojy = pj.vorticity?.y ?? 0
      const ojz = pj.vorticity?.z ?? 0

      // ωᵢ × ωⱼ
      const crossX = oiy * ojz - oiz * ojy
      const crossY = oiz * ojx - oix * ojz
      const crossZ = oix * ojy - oiy * ojx

      // ωᵢ · r
      const omegaDotR = oix * rx + oiy * ry + oiz * rz

      // r × ωⱼ
      const rCrossX = ry * ojz - rz * ojy
      const rCrossY = rz * ojx - rx * ojz
      const rCrossZ = rx * ojy - ry * ojx

      const f3 = gammaJ / (FOUR_PI * r2s2_15)
      const f5 = -3 * gammaJ * omegaDotR / (FOUR_PI * r2s2_25)

      dX[i] += f3 * crossX + f5 * rCrossX
      dY[i] += f3 * crossY + f5 * rCrossY
      dZ[i] += f3 * crossZ + f5 * rCrossZ
    }
  }

  for (let i = 0; i < count; i += 1) {
    const p = particles[i]
    const omega = p.vorticity ?? { x: 0, y: 0, z: 0 }
    p.vorticity = {
      x: omega.x + dt * strength * dX[i],
      y: omega.y + dt * strength * dY[i],
      z: omega.z + dt * strength * dZ[i],
    }
  }
}

/**
 * Legacy stretching: Gaussian-weighted velocity-difference approximation.
 * Uses pre-computed flowV* from Biot-Savart pass. Not the true (ω·∇)u term.
 * [STATUS]: PROXY — qualitatively similar but quantitatively incorrect
 */
function legacyStretching(particles, params, dt, strength) {
  const count = particles.length
  const interactionRadius = Math.max(params.interactionRadius ?? 0, 0)
  const interactionRadius2 = interactionRadius * interactionRadius
  const next = new Array(count)

  for (let i = 0; i < count; i += 1) {
    const particle = particles[i]
    const omega = particle.vorticity ?? { x: 0, y: 0, z: 0 }
    const omegaMag = Math.sqrt(omega.x * omega.x + omega.y * omega.y + omega.z * omega.z)

    if (omegaMag <= 1e-6) {
      next[i] = { ...omega }
      continue
    }

    const vix = particle.flowVx ?? 0
    const viy = particle.flowVy ?? 0
    const viz = particle.flowVz ?? 0
    let sx = 0, sy = 0, sz = 0

    for (let j = 0; j < count; j += 1) {
      if (i === j) continue

      const neighbor = particles[j]
      const rx = neighbor.x - particle.x
      const ry = neighbor.y - particle.y
      const rz = neighbor.z - particle.z
      const r2 = rx * rx + ry * ry + rz * rz + 1e-6
      if (interactionRadius > 0 && r2 > interactionRadius2) continue
      const rLen = Math.sqrt(r2)

      const sigma = Math.max(
        params.minCoreRadius ?? 0.01,
        neighbor.coreRadius ?? params.coreRadiusSigma ?? 0.01,
      )
      const influence = Math.exp(-r2 / (2 * sigma * sigma))
      if (influence < 1e-4) continue

      const dvx = (neighbor.flowVx ?? 0) - vix
      const dvy = (neighbor.flowVy ?? 0) - viy
      const dvz = (neighbor.flowVz ?? 0) - viz
      const dirX = rx / rLen
      const dirY = ry / rLen
      const dirZ = rz / rLen
      const omegaDotDir = omega.x * dirX + omega.y * dirY + omega.z * dirZ
      const scale = (omegaDotDir / rLen) * influence

      sx += dvx * scale
      sy += dvy * scale
      sz += dvz * scale
    }

    next[i] = {
      x: omega.x + dt * strength * sx,
      y: omega.y + dt * strength * sy,
      z: omega.z + dt * strength * sz,
    }
  }

  for (let i = 0; i < count; i += 1) {
    particles[i].vorticity = next[i]
  }
}

export function vortexStretching(particles, params, dt) {
  const count = particles.length
  const strength = Math.max(params.stretchingStrength ?? 0, 0)

  if (strength <= 0 || count <= 1) return

  const method = params.stretchingMethod ?? 'analytic'

  if (method === 'analytic') {
    analyticStretching(particles, params, dt, strength)
  } else {
    legacyStretching(particles, params, dt, strength)
  }
}
