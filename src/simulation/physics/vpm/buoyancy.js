/**
 * Boussinesq Buoyancy for VPM
 *
 * Adds baroclinic torque from density/temperature stratification:
 *   dω/dt += -(g/ρ₀) × ∇ρ' ≈ -αg × ∇T'
 *
 * In the Boussinesq approximation:
 *   - Density variations only affect buoyancy (not inertia)
 *   - Each particle carries temperature perturbation T'
 *   - Temperature diffuses via PSE (same kernel as vorticity)
 *   - Buoyancy adds vorticity in horizontal plane from vertical T' gradients
 *
 * Conservation: buoyancy creates vorticity (baroclinic production),
 * which is physically correct — not a conservation violation.
 *
 * Reference: Cottet & Koumoutsakos (2000) §7.2, Eldredge (2019)
 */

const DEFAULT_GRAVITY = -9.81
const DEFAULT_THERMAL_EXPANSION = 3.4e-3

/**
 * Estimate temperature gradient at each particle position via PSE-style kernel.
 *
 * @returns {{ gradTx: Float64Array, gradTy: Float64Array, gradTz: Float64Array }}
 */
function estimateTemperatureGradient(particles, params) {
  const count = particles.length
  const gradTx = new Float64Array(count)
  const gradTy = new Float64Array(count)
  const gradTz = new Float64Array(count)

  if (count < 2) return { gradTx, gradTy, gradTz }

  const sigma = Math.max(params.coreRadiusSigma ?? 0.1, 1e-4)
  const sigma2 = sigma * sigma
  const cutoff2 = (4 * sigma) * (4 * sigma)

  for (let i = 0; i < count; i++) {
    const pi = particles[i]
    const Ti = pi.temperature ?? 0

    for (let j = i + 1; j < count; j++) {
      const pj = particles[j]
      const Tj = pj.temperature ?? 0
      const dT = Tj - Ti

      if (Math.abs(dT) < 1e-14) continue

      const rx = pj.x - pi.x, ry = pj.y - pi.y, rz = pj.z - pi.z
      const r2 = rx * rx + ry * ry + rz * rz
      if (r2 > cutoff2 || r2 < 1e-14) continue

      const w = Math.exp(-r2 / (2 * sigma2)) / (r2 + sigma2)

      gradTx[i] += dT * rx * w; gradTy[i] += dT * ry * w; gradTz[i] += dT * rz * w
      gradTx[j] -= dT * rx * w; gradTy[j] -= dT * ry * w; gradTz[j] -= dT * rz * w
    }
  }

  return { gradTx, gradTy, gradTz }
}

/**
 * Apply baroclinic vorticity production from buoyancy.
 *
 * Adds dω/dt = α·g × ∇T' to each particle's vorticity.
 * With g = (0, g_y, 0), this produces vorticity in the x-z plane.
 *
 * @param {Array} particles - must have .temperature field
 * @param {Object} params
 * @param {number} dt
 */
export function applyBuoyancy(particles, params, dt) {
  const count = particles.length
  if (count < 2) return { applied: false }

  const alpha = Number(params.buoyancyThermalExpansion ?? DEFAULT_THERMAL_EXPANSION)
  const gx = Number(params.buoyancyGravityX ?? 0)
  const gy = Number(params.buoyancyGravityY ?? DEFAULT_GRAVITY)
  const gz = Number(params.buoyancyGravityZ ?? 0)

  const hasTemp = particles.some(p => (p.temperature ?? 0) !== 0)
  if (!hasTemp) return { applied: false, reason: 'no_temperature' }

  const { gradTx, gradTy, gradTz } = estimateTemperatureGradient(particles, params)

  let maxTorque = 0
  for (let i = 0; i < count; i++) {
    const p = particles[i]
    if (!p.vorticity) continue

    // dω/dt = α · (g × ∇T') = α · cross(g, gradT)
    const dwx = alpha * (gy * gradTz[i] - gz * gradTy[i])
    const dwy = alpha * (gz * gradTx[i] - gx * gradTz[i])
    const dwz = alpha * (gx * gradTy[i] - gy * gradTx[i])

    p.vorticity.x += dwx * dt
    p.vorticity.y += dwy * dt
    p.vorticity.z += dwz * dt

    const torque = Math.sqrt(dwx * dwx + dwy * dwy + dwz * dwz)
    if (torque > maxTorque) maxTorque = torque
  }

  return { applied: true, maxBaroclinicTorque: maxTorque }
}

/**
 * Diffuse temperature field via PSE (same antisymmetric form as vorticity PSE).
 *
 * @param {Array} particles - must have .temperature field
 * @param {Object} params - uses buoyancyThermalDiffusivity (κ)
 * @param {number} dt
 */
export function diffuseTemperature(particles, params, dt) {
  const count = particles.length
  if (count < 2) return

  const kappa = Math.max(Number(params.buoyancyThermalDiffusivity ?? 0), 0)
  if (kappa <= 0) return

  const eps = Math.max(params.coreRadiusSigma ?? 0.01, 1e-4)
  const eps2 = eps * eps
  const fourEps2 = 4 * eps2
  const volume = eps ** 3
  const kernelNorm = 1 / (Math.pow(4 * Math.PI * eps2, 1.5) || 1e-30)
  const prefactor = 2 * kappa * volume * kernelNorm / eps2

  const dTemp = new Float64Array(count)

  for (let i = 0; i < count; i++) {
    const Ti = particles[i].temperature ?? 0
    for (let j = i + 1; j < count; j++) {
      const pi = particles[i], pj = particles[j]
      const rx = pi.x - pj.x, ry = pi.y - pj.y, rz = pi.z - pj.z
      const r2 = rx * rx + ry * ry + rz * rz
      const expVal = Math.exp(-r2 / fourEps2)
      if (expVal < 1e-8) continue

      const factor = prefactor * expVal
      const dT = (pj.temperature ?? 0) - Ti
      dTemp[i] += factor * dT
      dTemp[j] -= factor * dT
    }
  }

  for (let i = 0; i < count; i++) {
    particles[i].temperature = (particles[i].temperature ?? 0) + dt * dTemp[i]
  }
}
