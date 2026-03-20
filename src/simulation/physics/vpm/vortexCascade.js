/**
 * Vortex cascade: local energy threshold, particle splitting, dissipation (remove too-small core).
 */

import { buildGrid } from '../spatialAcceleration/gridBuilder'

const EPS = 1e-12
const DEFAULT_GRID_RESOLUTION = 24
const DEFAULT_CELL_SIZE_MULTIPLIER = 6

function cloneParticleFields(source) {
  return {
    id: source.id,
    x: source.x,
    y: source.y,
    z: source.z,
    px: source.px ?? source.x,
    py: source.py ?? source.y,
    pz: source.pz ?? source.z,
    vx: source.vx ?? 0,
    vy: source.vy ?? 0,
    vz: source.vz ?? 0,
    velocity: source.velocity
      ? { x: source.velocity.x, y: source.velocity.y, z: source.velocity.z }
      : { x: source.vx ?? 0, y: source.vy ?? 0, z: source.vz ?? 0 },
    vorticity: source.vorticity
      ? {
          x: source.vorticity.x,
          y: source.vorticity.y,
          z: source.vorticity.z,
        }
      : { x: 0, y: 0, z: 0 },
    gamma: source.gamma ?? 0,
    coreRadius: source.coreRadius ?? 0.01,
    age: source.age ?? 0,
    life: source.life ?? 0,
    theta: source.theta ?? 0,
    phi: source.phi ?? 0,
    jetPsi: source.jetPsi ?? 0,
    hasInjectedTwist: source.hasInjectedTwist ?? false,
    injectVx: source.injectVx ?? source.vx ?? 0,
    injectVy: source.injectVy ?? source.vy ?? 0,
    injectVz: source.injectVz ?? source.vz ?? 0,
    flowVx: source.flowVx,
    flowVy: source.flowVy,
    flowVz: source.flowVz,
    history: Array.isArray(source.history) ? [...source.history] : undefined,
    cascadeLevel: source.cascadeLevel ?? 0,
  }
}

/**
 * Split one particle into N (2–4) new particles: newGamma = gamma/N, newCoreRadius = coreRadius/sqrt(N).
 * Positions offset by small random amount. Returns array of new particle objects (same shape as existing).
 */
export function splitParticle(particle, params, N, idRef, random = Math.random) {
  const gamma = particle.gamma ?? params?.gamma ?? 0
  const coreRadius = Math.max(particle.coreRadius ?? params?.coreRadiusSigma ?? 0.01, EPS)
  const newGamma = gamma / N
  const newCoreRadius = coreRadius / Math.sqrt(N)
  const minCore = Math.max(params?.minCoreRadius ?? 0.01, 1e-4)
  if (newCoreRadius < minCore) {
    return []
  }

  const sigma = Math.min(coreRadius * 0.4, newCoreRadius * 2)
  const level = (particle.cascadeLevel ?? 0) + 1
  const newParticles = []

  for (let k = 0; k < N; k += 1) {
    const id = idRef?.current != null ? (idRef.current += 1) : particle.id * 1000 + k
    const p = cloneParticleFields(particle)
    p.id = id
    p.gamma = newGamma
    p.coreRadius = newCoreRadius
    p.cascadeLevel = level
    p.x = particle.x + (random() - 0.5) * 2 * sigma
    p.y = particle.y + (random() - 0.5) * 2 * sigma
    p.z = particle.z + (random() - 0.5) * 2 * sigma
    p.px = p.x
    p.py = p.y
    p.pz = p.z
    p.vx = (particle.vx ?? 0) + (random() - 0.5) * sigma * 0.5
    p.vy = (particle.vy ?? 0) + (random() - 0.5) * sigma * 0.5
    p.vz = (particle.vz ?? 0) + (random() - 0.5) * sigma * 0.5
    p.velocity = { x: p.vx, y: p.vy, z: p.vz }
    newParticles.push(p)
  }

  return newParticles
}

/**
 * Remove particles with coreRadius < minCoreRadius (cascade dissipation).
 * Mutates particles array in place (splice).
 */
export function applyCascadeDissipation(particles, params) {
  const minCore = Math.max(params?.minCoreRadius ?? 0.01, 1e-4)
  let i = 0
  while (i < particles.length) {
    const p = particles[i]
    const r = p.coreRadius ?? params?.coreRadiusSigma ?? 0.01
    if (r < minCore) {
      particles.splice(i, 1)
    } else {
      i += 1
    }
  }
}

/**
 * applyVortexCascade(particles, params, idRef):
 * Build spatial grid, compute localEnergy = sum(gamma^2/coreRadius^2) per cell.
 * If localEnergy > cascadeThreshold, split particles in that cell (create 2–4 new, remove originals).
 * Then apply dissipation (remove coreRadius < minCoreRadius).
 */
/**
 * Compute enstrophy production diagnostic (from stretching).
 * In physical cascade: enstrophy production = ∫ ω·S·ω dV
 * where S is the strain rate tensor. Here we approximate as
 * the change in enstrophy between steps, tracked in pipeline diagnostics.
 *
 * This function provides a per-particle enstrophy density for visualization.
 */
export function computeEnstrophyDensity(particles) {
  const result = new Float64Array(particles.length)
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i]
    const ox = p.vorticity?.x ?? 0
    const oy = p.vorticity?.y ?? 0
    const oz = p.vorticity?.z ?? 0
    result[i] = ox * ox + oy * oy + oz * oz
  }
  return result
}

/**
 * [STATUS]: PROXY — artificial particle splitting, not physical cascade.
 * With Phase 1 (PSE + analytic stretching), the physical cascade emerges from:
 *   - Stretching: (ω·∇)u → enstrophy production at small scales
 *   - PSE diffusion: ν∇²ω → dissipation at grid scale
 * Set `cascadeMode: 'physical'` to skip this artificial operator.
 */
export function applyVortexCascade(particles, params, idRef = { current: 0 }) {
  if (!Array.isArray(particles) || particles.length === 0) return

  const cascadeMode = params?.cascadeMode ?? 'artificial'
  if (cascadeMode === 'physical') return

  const threshold = Number.isFinite(params?.cascadeThreshold)
    ? Math.max(params.cascadeThreshold, 0)
    : 0
  const splitFactor = Math.max(2, Math.min(4, Math.floor(params?.cascadeSplitFactor ?? 2)))
  const gridResolution = Math.max(8, Math.min(64, params?.cascadeGridResolution ?? DEFAULT_GRID_RESOLUTION))
  const cellSizeMultiplier = Math.max(2, params?.cascadeCellSizeMultiplier ?? DEFAULT_CELL_SIZE_MULTIPLIER)
  const sigma = Math.max(params?.coreRadiusSigma ?? params?.minCoreRadius ?? 0.03, 1e-4)
  const cellSize = Math.max(sigma * cellSizeMultiplier, 0.01)

  applyCascadeDissipation(particles, params)

  if (threshold <= 0) return

  const grid = buildGrid(particles, cellSize, gridResolution)
  const { cellStartBuffer, cellCountBuffer, particleIndexBuffer } = grid
  const totalCells = gridResolution ** 3

  const toRemove = new Set()
  const toAdd = []

  for (let cellIndex = 0; cellIndex < totalCells; cellIndex += 1) {
    const start = cellStartBuffer[cellIndex]
    const count = cellCountBuffer[cellIndex]
    if (count <= 0) continue

    let localEnergy = 0
    const indices = []
    for (let s = 0; s < count; s += 1) {
      const idx = particleIndexBuffer[start + s]
      const p = particles[idx]
      const g = p.gamma ?? 0
      const r = Math.max(p.coreRadius ?? sigma, EPS)
      localEnergy += (g * g) / (r * r)
      indices.push(idx)
    }

    if (localEnergy <= threshold) continue

    const numToSplit = Math.min(
      Math.max(1, Math.floor(indices.length * 0.5)),
      indices.length,
    )
    for (let k = 0; k < numToSplit; k += 1) {
      const idx = indices[k]
      if (toRemove.has(idx)) continue
      const particle = particles[idx]
      const N = splitFactor
      const newOnes = splitParticle(particle, params, N, idRef)
      if (newOnes.length > 0) {
        toRemove.add(idx)
        toAdd.push(...newOnes)
      }
    }
  }

  if (toRemove.size === 0 && toAdd.length === 0) return

  const removed = Array.from(toRemove).sort((a, b) => b - a)
  for (let r = 0; r < removed.length; r += 1) {
    particles.splice(removed[r], 1)
  }
  for (let a = 0; a < toAdd.length; a += 1) {
    particles.push(toAdd[a])
  }
}
