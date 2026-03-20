/**
 * LES Smagorinsky Subgrid-Scale Model for VPM
 *
 * Adds eddy viscosity ν_sgs = (C_s · Δ)² · |S| to the molecular viscosity,
 * where C_s is the Smagorinsky constant, Δ is the filter width (≈ core radius),
 * and |S| is the local strain rate magnitude estimated from velocity differences.
 *
 * The SGS viscosity is applied through the existing PSE diffusion operator,
 * effectively increasing diffusion in regions of high strain.
 *
 * Conservation: ν_sgs only modifies the viscosity input to PSE.
 * PSE antisymmetric form still conserves total vorticity.
 *
 * Reference: Smagorinsky (1963), Cottet & Koumoutsakos (2000) §6.5
 */

const DEFAULT_CS = 0.15
const DEFAULT_MAX_EDDY_RATIO = 50

/**
 * Estimate local strain rate |S| for each particle from velocity differences
 * with nearby particles (Gaussian-weighted).
 *
 * Returns Float64Array of |S| per particle.
 */
function estimateStrainRate(particles, params) {
  const count = particles.length
  const strainRate = new Float64Array(count)
  if (count < 2) return strainRate

  const sigma = Math.max(params.coreRadiusSigma ?? 0.1, 1e-4)
  const cutoff2 = (4 * sigma) * (4 * sigma)

  for (let i = 0; i < count; i++) {
    const pi = particles[i]
    let sumS2 = 0
    let weight = 0

    for (let j = 0; j < count; j++) {
      if (i === j) continue
      const pj = particles[j]
      const rx = pi.x - pj.x, ry = pi.y - pj.y, rz = pi.z - pj.z
      const r2 = rx * rx + ry * ry + rz * rz
      if (r2 > cutoff2 || r2 < 1e-14) continue

      const r = Math.sqrt(r2)
      const dvx = (pj.flowVx ?? 0) - (pi.flowVx ?? 0)
      const dvy = (pj.flowVy ?? 0) - (pi.flowVy ?? 0)
      const dvz = (pj.flowVz ?? 0) - (pi.flowVz ?? 0)

      const dvdr = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz) / r
      const w = Math.exp(-r2 / (2 * sigma * sigma))
      sumS2 += dvdr * dvdr * w
      weight += w
    }

    strainRate[i] = weight > 1e-12 ? Math.sqrt(sumS2 / weight) : 0
  }

  return strainRate
}

/**
 * Compute Smagorinsky eddy viscosity for each particle.
 *
 * ν_sgs_i = (C_s · Δ)² · |S|_i
 *
 * @param {Array} particles
 * @param {Object} params
 * @returns {{ eddyViscosity: Float64Array, meanNuSgs: number, maxNuSgs: number }}
 */
export function computeSmagorinskyViscosity(particles, params) {
  const count = particles.length
  const eddyViscosity = new Float64Array(count)

  if (count < 2) return { eddyViscosity, meanNuSgs: 0, maxNuSgs: 0 }

  const cs = Math.max(0, Number(params.lesSmagonriskyCs ?? params.lesSmagorinskyCs ?? DEFAULT_CS))
  const delta = Math.max(params.coreRadiusSigma ?? 0.1, 1e-4)
  const csDelta2 = (cs * delta) * (cs * delta)

  const strainRate = estimateStrainRate(particles, params)

  const nuMol = Math.max(params.viscosity ?? 0, 0)
  const maxRatio = params.lesMaxEddyRatio ?? DEFAULT_MAX_EDDY_RATIO

  let sumNuSgs = 0
  let maxNuSgs = 0

  for (let i = 0; i < count; i++) {
    let nuSgs = csDelta2 * strainRate[i]
    if (nuMol > 0 && nuSgs > nuMol * maxRatio) {
      nuSgs = nuMol * maxRatio
    }
    eddyViscosity[i] = nuSgs
    sumNuSgs += nuSgs
    if (nuSgs > maxNuSgs) maxNuSgs = nuSgs
  }

  return {
    eddyViscosity,
    meanNuSgs: sumNuSgs / count,
    maxNuSgs,
  }
}

/**
 * Apply LES SGS diffusion using PSE with per-particle eddy viscosity.
 *
 * This modifies vorticity in-place via PSE exchange with ν_eff = ν + ν_sgs.
 *
 * @param {Array} particles
 * @param {Object} params
 * @param {number} dt
 */
export function applyLesDiffusion(particles, params, dt) {
  const count = particles.length
  if (count < 2) return { applied: false }

  const nuMol = Math.max(params.viscosity ?? 0, 0)
  const { eddyViscosity, meanNuSgs, maxNuSgs } = computeSmagorinskyViscosity(particles, params)

  const eps = Math.max(params.coreRadiusSigma ?? 0.01, 1e-4)
  const eps2 = eps * eps
  const fourEps2 = 4 * eps2
  const volume = eps * eps * eps
  const kernelNorm = 1 / (Math.pow(4 * Math.PI * eps2, 1.5) || 1e-30)

  const dX = new Float64Array(count)
  const dY = new Float64Array(count)
  const dZ = new Float64Array(count)

  for (let i = 0; i < count; i++) {
    const pi = particles[i]
    const oix = pi.vorticity?.x ?? 0
    const oiy = pi.vorticity?.y ?? 0
    const oiz = pi.vorticity?.z ?? 0
    const nuI = nuMol + eddyViscosity[i]

    for (let j = i + 1; j < count; j++) {
      const pj = particles[j]
      const rx = pi.x - pj.x, ry = pi.y - pj.y, rz = pi.z - pj.z
      const r2 = rx * rx + ry * ry + rz * rz
      const expVal = Math.exp(-r2 / fourEps2)
      if (expVal < 1e-8) continue

      const nuJ = nuMol + eddyViscosity[j]
      const nuEff = (nuI + nuJ) * 0.5

      const prefactor = 2 * nuEff * volume * kernelNorm / eps2
      const factor = prefactor * expVal

      const dx = (pj.vorticity?.x ?? 0) - oix
      const dy = (pj.vorticity?.y ?? 0) - oiy
      const dz = (pj.vorticity?.z ?? 0) - oiz

      dX[i] += factor * dx; dY[i] += factor * dy; dZ[i] += factor * dz
      dX[j] -= factor * dx; dY[j] -= factor * dy; dZ[j] -= factor * dz
    }
  }

  for (let i = 0; i < count; i++) {
    const o = particles[i].vorticity
    if (o) {
      o.x += dt * dX[i]
      o.y += dt * dY[i]
      o.z += dt * dZ[i]
    }
  }

  return { applied: true, meanNuSgs, maxNuSgs, nuMol }
}
