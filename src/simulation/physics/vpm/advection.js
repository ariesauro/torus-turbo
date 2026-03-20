/**
 * Forward Euler advection: x_{n+1} = x_n + dt · v(x_n)
 * [STATUS]: CORRECT — O(h) first-order, simple and stable
 */
export function advectParticles(particles, dt) {
  for (let i = 0; i < particles.length; i += 1) {
    const particle = particles[i]
    const vx = particle.flowVx ?? 0
    const vy = particle.flowVy ?? 0
    const vz = particle.flowVz ?? 0

    particle.px = particle.x
    particle.py = particle.y
    particle.pz = particle.z
    particle.x += vx * dt
    particle.y += vy * dt
    particle.z += vz * dt
    particle.vx = vx * dt
    particle.vy = vy * dt
    particle.vz = vz * dt
  }
}

/**
 * Save current positions for RK2 restore.
 */
export function capturePositions(particles) {
  const count = particles.length
  const positions = new Float64Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = particles[i].x
    positions[i * 3 + 1] = particles[i].y
    positions[i * 3 + 2] = particles[i].z
  }
  return positions
}

/**
 * Restore positions from snapshot.
 */
export function restorePositions(particles, positions) {
  const count = Math.min(particles.length, Math.floor(positions.length / 3))
  for (let i = 0; i < count; i += 1) {
    particles[i].x = positions[i * 3]
    particles[i].y = positions[i * 3 + 1]
    particles[i].z = positions[i * 3 + 2]
  }
}

/**
 * Save current flow velocities (v1 for RK2).
 */
export function captureFlowVelocities(particles) {
  const count = particles.length
  const velocities = new Float64Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    velocities[i * 3] = particles[i].flowVx ?? 0
    velocities[i * 3 + 1] = particles[i].flowVy ?? 0
    velocities[i * 3 + 2] = particles[i].flowVz ?? 0
  }
  return velocities
}

/**
 * RK2 (midpoint) final advection: x_{n+1} = x_n + dt · v(x_mid)
 * Called after second velocity evaluation at midpoint positions.
 * [STATUS]: CORRECT — O(h²) second-order
 */
export function advectParticlesRK2Final(particles, dt, savedPositions) {
  const count = Math.min(particles.length, Math.floor(savedPositions.length / 3))
  for (let i = 0; i < count; i += 1) {
    const particle = particles[i]
    const vx = particle.flowVx ?? 0
    const vy = particle.flowVy ?? 0
    const vz = particle.flowVz ?? 0

    const x0 = savedPositions[i * 3]
    const y0 = savedPositions[i * 3 + 1]
    const z0 = savedPositions[i * 3 + 2]

    particle.px = x0
    particle.py = y0
    particle.pz = z0
    particle.x = x0 + vx * dt
    particle.y = y0 + vy * dt
    particle.z = z0 + vz * dt
    particle.vx = vx * dt
    particle.vy = vy * dt
    particle.vz = vz * dt
  }
}

/**
 * Compute CFL-limited time step.
 * dt_cfl = C · h / max|v|, where h ≈ σ (core radius as proxy for spacing).
 */
export function computeCflDt(particles, params) {
  const count = particles.length
  if (count === 0) return { cflDt: Infinity, maxSpeed: 0 }

  let maxSpeed = 0
  for (let i = 0; i < count; i += 1) {
    const vx = particles[i].flowVx ?? 0
    const vy = particles[i].flowVy ?? 0
    const vz = particles[i].flowVz ?? 0
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz)
    if (speed > maxSpeed) maxSpeed = speed
  }

  if (maxSpeed <= 1e-8) return { cflDt: Infinity, maxSpeed }

  const h = Math.max(params.coreRadiusSigma ?? params.minCoreRadius ?? 0.01, 1e-4)
  const cflSafety = Math.max(params.cflSafety ?? 0.4, 0.05)
  const cflDt = cflSafety * h / maxSpeed

  return { cflDt, maxSpeed }
}
