import { sampleFilamentVelocityAtPoint } from '../filaments/biotSavartFilament'
import {
  add,
  buildLocalBasis,
  computeSegmentLengths,
  dot,
  normalize,
  scale,
  subtract,
} from './vortexTubeMath'
import { createVortexTubeFromFilament } from './createVortexTube'

const FOUR_PI = 4 * Math.PI

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function sampleVelocityFromParticles(point, particles, sigma, stride = 1) {
  let vx = 0
  let vy = 0
  let vz = 0
  const safeStride = Math.max(1, Math.floor(stride))
  for (let i = 0; i < particles.length; i += safeStride) {
    const source = particles[i]
    const rx = point.x - source.x
    const ry = point.y - source.y
    const rz = point.z - source.z
    const r2 = rx * rx + ry * ry + rz * rz
    const denom = (r2 + sigma * sigma) ** 1.5
    if (denom <= 1e-10) {
      continue
    }
    const omega = source.vorticity ?? { x: 0, y: 0, z: 0 }
    const cx = ry * omega.z - rz * omega.y
    const cy = rz * omega.x - rx * omega.z
    const cz = rx * omega.y - ry * omega.x
    const gamma = source.gamma ?? 0
    const factor = gamma / (FOUR_PI * denom)
    vx += cx * factor
    vy += cy * factor
    vz += cz * factor
  }
  return { x: vx, y: vy, z: vz }
}

function collectAllTubeParticles(vortexTubes) {
  const all = []
  for (let i = 0; i < vortexTubes.length; i += 1) {
    const particles = vortexTubes[i].vorticityParticles ?? []
    for (let j = 0; j < particles.length; j += 1) {
      all.push(particles[j])
    }
  }
  return all
}

function applyStretching(tube, spineNodes, closedLoop = true) {
  const oldSegments = Array.isArray(tube.restSegmentLengths) ? tube.restSegmentLengths : []
  const nextSegments = computeSegmentLengths(spineNodes, closedLoop)
  if (oldSegments.length === 0 || nextSegments.length === 0) {
    tube.restSegmentLengths = nextSegments
    return
  }
  const oldTotal = oldSegments.reduce((sum, value) => sum + Math.max(value, 1e-8), 0)
  const nextTotal = nextSegments.reduce((sum, value) => sum + Math.max(value, 1e-8), 0)
  if (oldTotal <= 1e-8 || nextTotal <= 1e-8) {
    tube.restSegmentLengths = nextSegments
    return
  }
  tube.radius = Math.max(tube.radius * Math.sqrt(oldTotal / nextTotal), 0.001)
  tube.restSegmentLengths = nextSegments
}

function reprojectTubeParticles(tube, spineNodes, params, stepIndex) {
  const cadence = Math.max(1, Math.floor(params?.tubeReprojectCadenceSteps ?? 5))
  if (stepIndex % cadence !== 0) {
    return 0
  }
  const thresholdRatio = Math.max(params?.tubeReprojectThreshold ?? 0.35, 0)
  let projectedCount = 0
  for (let i = 0; i < tube.vorticityParticles.length; i += 1) {
    const particle = tube.vorticityParticles[i]
    const spineNodeIndex = Math.max(
      0,
      Math.min(spineNodes.length - 1, Math.floor(particle.spineNodeIndex ?? 0)),
    )
    const spinePos = spineNodes[spineNodeIndex].position
    const basis = buildLocalBasis(spineNodes, spineNodeIndex, true)
    if (!basis) {
      continue
    }
    const relative = subtract(particle, spinePos)
    const axial = dot(relative, basis.tangent)
    const axialOffset = scale(basis.tangent, axial)
    const radial = subtract(relative, axialOffset)
    const radialLen = Math.hypot(radial.x, radial.y, radial.z)
    const targetRadius = Math.max((particle.localRadius ?? tube.radius) * (tube.radius / Math.max(params?.tubeRadius ?? tube.radius, 1e-6)), 0.0005)
    const radialError = Math.abs(radialLen - targetRadius)
    if (radialError <= thresholdRatio * Math.max(tube.radius, 1e-6)) {
      continue
    }
    const angle = Math.atan2(dot(radial, basis.binormal), dot(radial, basis.normal))
    particle.localAngle = angle
    particle.localRadius = targetRadius
    particle.x = spinePos.x + basis.normal.x * targetRadius * Math.cos(angle) + basis.binormal.x * targetRadius * Math.sin(angle)
    particle.y = spinePos.y + basis.normal.y * targetRadius * Math.cos(angle) + basis.binormal.y * targetRadius * Math.sin(angle)
    particle.z = spinePos.z + basis.normal.z * targetRadius * Math.cos(angle) + basis.binormal.z * targetRadius * Math.sin(angle)
    projectedCount += 1
  }
  tube.lastProjectionStep = stepIndex
  return projectedCount
}

export function ensureVortexTubeSetForFilaments(vortexTubes, filaments, params, tubeIdRef) {
  const bySpineId = new Map()
  for (let i = 0; i < vortexTubes.length; i += 1) {
    bySpineId.set(vortexTubes[i].spineFilamentId, vortexTubes[i])
  }
  for (let i = 0; i < filaments.length; i += 1) {
    const filament = filaments[i]
    if (bySpineId.has(filament.id)) {
      continue
    }
    const nextTube = createVortexTubeFromFilament(filament, params, tubeIdRef.current)
    if (nextTube) {
      vortexTubes.push(nextTube)
      tubeIdRef.current += 1
    }
  }
}

export function stepVortexTubes({
  vortexTubes,
  filaments,
  particles,
  params,
  dt,
  filamentSolverContext,
  stepIndex,
}) {
  const startedAtMs = nowMs()
  if (!Array.isArray(vortexTubes) || vortexTubes.length === 0) {
    return {
      tubeCount: 0,
      tubeParticleCount: 0,
      projectedCount: 0,
      avgRadius: 0,
      stepMs: 0,
      avgSpeed: 0,
      maxSpeed: 0,
      avgFilamentContribution: 0,
      avgVpmContribution: 0,
      avgTubeContribution: 0,
    }
  }
  const sigma = Math.max(params?.tubeCoreSigma ?? params?.coreRadiusSigma ?? 0.03, 1e-4)
  const allTubeParticles = collectAllTubeParticles(vortexTubes)
  const vpmStride = Math.max(1, Math.floor((particles?.length ?? 0) / 1200))
  const tubeStride = Math.max(1, Math.floor(allTubeParticles.length / 1600))
  let projectedCount = 0
  let totalRadius = 0
  let particleCount = 0
  let totalSpeed = 0
  let maxSpeed = 0
  let totalFilamentContribution = 0
  let totalVpmContribution = 0
  let totalTubeContribution = 0

  for (let tubeIndex = vortexTubes.length - 1; tubeIndex >= 0; tubeIndex -= 1) {
    const tube = vortexTubes[tubeIndex]
    const spine = filaments.find((item) => item.id === tube.spineFilamentId)
    if (!spine || !Array.isArray(spine.nodes) || spine.nodes.length < 3) {
      vortexTubes.splice(tubeIndex, 1)
      continue
    }
    if ((tube.vorticityParticles?.length ?? 0) === 0) {
      const rebuilt = createVortexTubeFromFilament(spine, params, tube.id)
      if (rebuilt) {
        tube.vorticityParticles = rebuilt.vorticityParticles
      }
    }
    applyStretching(tube, spine.nodes, spine.closedLoop !== false)

    for (let i = 0; i < tube.vorticityParticles.length; i += 1) {
      const point = tube.vorticityParticles[i]
      const filamentVelocity = sampleFilamentVelocityAtPoint(
        { x: point.x, y: point.y, z: point.z },
        filaments,
        filamentSolverContext,
      )
      const vpmVelocity = sampleVelocityFromParticles(point, particles ?? [], sigma, vpmStride)
      const tubeVelocity = sampleVelocityFromParticles(point, allTubeParticles, sigma, tubeStride)
      const velocity = add(add(filamentVelocity, vpmVelocity), tubeVelocity)
      const filamentContribution = Math.hypot(
        filamentVelocity.x,
        filamentVelocity.y,
        filamentVelocity.z,
      )
      const vpmContribution = Math.hypot(vpmVelocity.x, vpmVelocity.y, vpmVelocity.z)
      const tubeContribution = Math.hypot(tubeVelocity.x, tubeVelocity.y, tubeVelocity.z)
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z)
      point.vx = velocity.x
      point.vy = velocity.y
      point.vz = velocity.z
      point.x += velocity.x * dt
      point.y += velocity.y * dt
      point.z += velocity.z * dt
      const spineNodeIndex = Math.max(
        0,
        Math.min(spine.nodes.length - 1, Math.floor(point.spineNodeIndex ?? 0)),
      )
      const basis = buildLocalBasis(spine.nodes, spineNodeIndex, spine.closedLoop !== false)
      if (basis) {
        point.vorticity = normalize(basis.tangent) ?? point.vorticity
      }
      totalRadius += point.localRadius ?? 0
      particleCount += 1
      totalSpeed += speed
      maxSpeed = Math.max(maxSpeed, speed)
      totalFilamentContribution += filamentContribution
      totalVpmContribution += vpmContribution
      totalTubeContribution += tubeContribution
    }
    projectedCount += reprojectTubeParticles(tube, spine.nodes, params, stepIndex)
  }

  return {
    tubeCount: vortexTubes.length,
    tubeParticleCount: particleCount,
    projectedCount,
    avgRadius: particleCount > 0 ? totalRadius / particleCount : 0,
    stepMs: Math.max(0, nowMs() - startedAtMs),
    avgSpeed: particleCount > 0 ? totalSpeed / particleCount : 0,
    maxSpeed,
    avgFilamentContribution: particleCount > 0 ? totalFilamentContribution / particleCount : 0,
    avgVpmContribution: particleCount > 0 ? totalVpmContribution / particleCount : 0,
    avgTubeContribution: particleCount > 0 ? totalTubeContribution / particleCount : 0,
  }
}
