const FOUR_PI_CUBED_SQRT = Math.pow(4 * Math.PI, 1.5)

/**
 * PSE (Particle Strength Exchange) diffusion.
 * Approximates ν∇²ω via inter-particle exchange:
 *   dω_i/dt = (2ν/ε²) · Σⱼ (ωⱼ − ωᵢ) · η_ε(r_ij) · V
 *
 * Kernel: η_ε(r) = exp(−r²/(4ε²)) / (4πε²)^(3/2)
 * The antisymmetric form (ωⱼ − ωᵢ) guarantees Σ dω = 0 (total vorticity conserved).
 *
 * [STATUS]: CORRECT — Cottet & Koumoutsakos (2000), Ch. 6
 */
function pseDiffusion(particles, params, dt, viscosity) {
  const count = particles.length
  if (count <= 1) return

  const minCore = Math.max(params.minCoreRadius ?? 0.01, 1e-4)
  const eps = Math.max(params.coreRadiusSigma ?? minCore, minCore)
  const eps2 = eps * eps
  const fourEps2 = 4 * eps2
  const volume = eps * eps * eps
  const kernelNorm = 1 / (FOUR_PI_CUBED_SQRT * eps2 * eps)
  const prefactor = 2 * viscosity * volume * kernelNorm / eps2

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

    for (let j = i + 1; j < count; j += 1) {
      const pj = particles[j]
      const rx = pi.x - pj.x
      const ry = pi.y - pj.y
      const rz = pi.z - pj.z
      const r2 = rx * rx + ry * ry + rz * rz

      if (interactionRadius > 0 && r2 > interactionRadius2) continue

      const expVal = Math.exp(-r2 / fourEps2)
      if (expVal < 1e-8) continue

      const factor = prefactor * expVal

      const ojx = pj.vorticity?.x ?? 0
      const ojy = pj.vorticity?.y ?? 0
      const ojz = pj.vorticity?.z ?? 0
      const diffX = ojx - oix
      const diffY = ojy - oiy
      const diffZ = ojz - oiz

      dX[i] += factor * diffX
      dY[i] += factor * diffY
      dZ[i] += factor * diffZ
      dX[j] -= factor * diffX
      dY[j] -= factor * diffY
      dZ[j] -= factor * diffZ
    }
  }

  for (let i = 0; i < count; i += 1) {
    const p = particles[i]
    const omega = p.vorticity ?? { x: 0, y: 0, z: 0 }
    p.vorticity = {
      x: omega.x + dt * dX[i],
      y: omega.y + dt * dY[i],
      z: omega.z + dt * dZ[i],
    }
  }
}

/**
 * Lamb-Oseen core spreading: σ² += 4νdt.
 * Correct for single isolated blob, but does NOT exchange vorticity between particles.
 * [STATUS]: PROXY — valid only as supplementary self-diffusion
 */
function coreSpreadDiffusion(particles, params, dt, viscosity) {
  const minCore = Math.max(params.minCoreRadius ?? 0.01, 1e-4)

  for (let i = 0; i < particles.length; i += 1) {
    const particle = particles[i]
    const sigma = Math.max(particle.coreRadius ?? params.coreRadiusSigma ?? minCore, minCore)
    particle.coreRadius = Math.sqrt(sigma * sigma + 4 * viscosity * dt)
  }
}

export function viscousDiffusion(particles, params, dt) {
  const viscosity = Math.max(params.viscosity ?? 0, 0)
  if (viscosity <= 0 || particles.length <= 1) return

  const method = params.diffusionMethod ?? 'pse'

  if (method === 'pse') {
    pseDiffusion(particles, params, dt, viscosity)
  } else {
    coreSpreadDiffusion(particles, params, dt, viscosity)
  }
}
