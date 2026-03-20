const FOUR_PI = 4 * Math.PI

function evaluateVelocity(px, py, pz, particles, maxR2) {
  let vx = 0, vy = 0, vz = 0
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    const rx = px - (p.x ?? 0)
    const ry = py - (p.y ?? 0)
    const rz = pz - (p.z ?? 0)
    const r2 = rx * rx + ry * ry + rz * rz
    if (r2 > maxR2) continue
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
  return { x: vx, y: vy, z: vz }
}

export function traceStreamlineRK4(seedX, seedY, seedZ, particles, {
  stepSize = 0.05,
  maxSteps = 200,
  maxRadius = 3,
} = {}) {
  const maxR2 = maxRadius * maxRadius
  const points = [{ x: seedX, y: seedY, z: seedZ }]
  let x = seedX, y = seedY, z = seedZ

  for (let step = 0; step < maxSteps; step++) {
    const k1 = evaluateVelocity(x, y, z, particles, maxR2)
    const k1mag = Math.hypot(k1.x, k1.y, k1.z)
    if (k1mag < 1e-10) break

    const h = stepSize / k1mag
    const k2 = evaluateVelocity(x + k1.x * h * 0.5, y + k1.y * h * 0.5, z + k1.z * h * 0.5, particles, maxR2)
    const k3 = evaluateVelocity(x + k2.x * h * 0.5, y + k2.y * h * 0.5, z + k2.z * h * 0.5, particles, maxR2)
    const k4 = evaluateVelocity(x + k3.x * h, y + k3.y * h, z + k3.z * h, particles, maxR2)

    x += (k1.x + 2 * k2.x + 2 * k3.x + k4.x) * h / 6
    y += (k1.y + 2 * k2.y + 2 * k3.y + k4.y) * h / 6
    z += (k1.z + 2 * k2.z + 2 * k3.z + k4.z) * h / 6

    points.push({ x, y, z })

    const dist2 = (x - seedX) ** 2 + (y - seedY) ** 2 + (z - seedZ) ** 2
    if (dist2 > maxRadius * maxRadius * 4) break
  }

  return points
}

export function traceMultipleStreamlines(particles, seeds, options = {}) {
  return seeds.map((seed) => traceStreamlineRK4(seed.x, seed.y, seed.z, particles, options))
}

export function generateStreamlineSeeds(particles, count = 8) {
  if (!particles || particles.length === 0) return []
  const seeds = []
  const stride = Math.max(1, Math.floor(particles.length / count))
  for (let i = 0; i < particles.length && seeds.length < count; i += stride) {
    const p = particles[i]
    const speed = Math.hypot(p.flowVx ?? 0, p.flowVy ?? 0, p.flowVz ?? 0)
    if (speed > 0.1) {
      seeds.push({ x: p.x ?? 0, y: p.y ?? 0, z: p.z ?? 0 })
    }
  }
  return seeds
}
