import { computeVelocityBiotSavart } from './biotSavart'
import {
  advectParticles,
  capturePositions,
  restorePositions,
  advectParticlesRK2Final,
  computeCflDt,
} from './advection'
import { vortexStretching } from './vortexStretching'
import { viscousDiffusion } from './vortexDiffusion'
import { vortexReconnection } from './vortexReconnection'
import { applyStabilityConstraints, resetStabilityClampStats, getStabilityClampStats } from './stability'
import { applyVorticityConfinement } from './vorticityConfinement'
import { maybeRemesh } from './remesh'
import { applyLesDiffusion } from './lesSubgrid'
import { applyBuoyancy, diffuseTemperature } from './buoyancy'

let lastPipelineDiagnostics = null

function computeConservationMetrics(particles) {
  let energy = 0
  let enstrophy = 0
  let circulation = 0

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i]
    const vx = p.flowVx ?? 0
    const vy = p.flowVy ?? 0
    const vz = p.flowVz ?? 0
    energy += 0.5 * (vx * vx + vy * vy + vz * vz)

    const ox = p.vorticity?.x ?? 0
    const oy = p.vorticity?.y ?? 0
    const oz = p.vorticity?.z ?? 0
    enstrophy += ox * ox + oy * oy + oz * oz
    circulation += p.gamma ?? 0
  }

  return { energy, enstrophy, circulation, count: particles.length }
}

export function getLastPipelineDiagnostics() {
  return lastPipelineDiagnostics
}

function findMaxParticleId(particles) {
  let maxId = 0
  for (let i = 0; i < particles.length; i += 1) {
    const id = particles[i].id ?? 0
    if (id > maxId) maxId = id
  }
  return maxId
}

function resolvePhysicalStageOrder(params) {
  const profile = String(params?.physicalIntegrationOrderProfile ?? 'canonical')
  const base = profile === 'boundary_first'
    ? ['boundary_interaction', 'stretching', 'diffusion', 'wake_forcing']
    : profile === 'diffusion_first'
      ? ['diffusion', 'stretching', 'boundary_interaction', 'wake_forcing']
      : ['stretching', 'diffusion', 'boundary_interaction', 'wake_forcing']
  if (params?.buoyancyEnabled === true) base.push('buoyancy')
  return base
}

function applyBoundaryInteractionHook(particles, params, dt) {
  if (!particles || particles.length === 0) return

  const noSlip = params.physicalNoSlipEnabled === true
  const imageVortices = params.physicalImageVorticesEnabled !== false
  const boundaryY = Number(params.physicalBoundaryPlaneY ?? 0)
  const damping = Math.max(0, Math.min(1, Number(params.physicalBoundaryDamping ?? 0.8)))
  const wallLayerThickness = Math.max(0.01, Number(params.coreRadiusSigma ?? 0.2) * 3)

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    const py = p.y ?? 0
    const distToWall = py - boundaryY

    if (distToWall < 0) {
      p.y = boundaryY + Math.abs(distToWall) * 0.1
      const vy = p.flowVy ?? 0
      if (vy < 0) p.flowVy = -vy * damping

      if (noSlip) {
        p.flowVx = (p.flowVx ?? 0) * damping
        p.flowVz = (p.flowVz ?? 0) * damping
      }
    }

    if (imageVortices && distToWall > 0 && distToWall < wallLayerThickness) {
      const proximity = 1 - distToWall / wallLayerThickness
      const imageFactor = proximity * proximity
      const vy = p.flowVy ?? 0
      p.flowVy = vy * (1 - imageFactor) + (-vy) * imageFactor

      if (noSlip) {
        const tangentialDamping = 1 - imageFactor * (1 - damping)
        p.flowVx = (p.flowVx ?? 0) * tangentialDamping
        p.flowVz = (p.flowVz ?? 0) * tangentialDamping
      }

      const ox = p.vorticity?.x ?? 0
      const oy = p.vorticity?.y ?? 0
      const oz = p.vorticity?.z ?? 0
      if (p.vorticity) {
        p.vorticity.x = ox * (1 - imageFactor) + (-ox) * imageFactor
        p.vorticity.z = oz * (1 - imageFactor) + (-oz) * imageFactor
      }
    }
  }
}

function applyWakeForcingHook(particles, params, _dt) {
  if (!particles || particles.length === 0) return

  const ux = Number(params.physicalWakeUniformVx ?? 0)
  const uy = Number(params.physicalWakeUniformVy ?? 0)
  const uz = Number(params.physicalWakeUniformVz ?? 0)

  if (Math.abs(ux) < 1e-12 && Math.abs(uy) < 1e-12 && Math.abs(uz) < 1e-12) return

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    p.flowVx = (p.flowVx ?? 0) + ux
    p.flowVy = (p.flowVy ?? 0) + uy
    p.flowVz = (p.flowVz ?? 0) + uz
  }
}

function buildStageExecutors(particles, params, dt) {
  const effectiveStretchingStrength =
    params.physicalStretchingEnabled === true
      ? Math.max(0, Number(params.stretchingStrength ?? 0)) * Math.max(0, Number(params.physicalStretchingStrength ?? 1))
      : Math.max(0, Number(params.stretchingStrength ?? 0))
  const stretchingParams = {
    ...params,
    stretchingStrength: effectiveStretchingStrength,
  }
  const effectiveViscosity =
    params.physicalViscosityEnabled === true
      ? Math.max(0, Number(params.physicalViscosityNu ?? params.viscosity ?? 0))
      : Math.max(0, Number(params.viscosity ?? 0))
  const diffusionParams = {
    ...params,
    viscosity: effectiveViscosity,
  }

  const useLes = params.lesEnabled === true

  return {
    stretching: () => {
      if (effectiveStretchingStrength > 0) {
        vortexStretching(particles, stretchingParams, dt)
      }
    },
    diffusion: () => {
      if (useLes) {
        applyLesDiffusion(particles, diffusionParams, dt)
      } else if (effectiveViscosity > 0 || params.physicalPseEnabled === true) {
        viscousDiffusion(particles, diffusionParams, dt)
      }
    },
    boundary_interaction: () => {
      if (params.physicalBoundaryEnabled === true) {
        applyBoundaryInteractionHook(particles, params, dt)
      }
    },
    wake_forcing: () => {
      if (params.physicalWakeEnabled === true) {
        applyWakeForcingHook(particles, params, dt)
      }
    },
    buoyancy: () => {
      if (params.buoyancyEnabled === true) {
        applyBuoyancy(particles, params, dt)
        diffuseTemperature(particles, params, dt)
      }
    },
  }
}

/**
 * Single sub-step of the VPM pipeline (Euler advection).
 */
function runSubstepEuler(particles, params, subDt, velocityComputer) {
  velocityComputer(particles, params)
  applyVorticityConfinement(particles, params)
  applyStabilityConstraints(particles, params)
  advectParticles(particles, subDt)

  const stageOrder = resolvePhysicalStageOrder(params)
  const stageExecutors = buildStageExecutors(particles, params, subDt)
  for (let i = 0; i < stageOrder.length; i += 1) {
    const exec = stageExecutors[stageOrder[i]]
    if (typeof exec === 'function') exec()
  }
}

/**
 * Single sub-step of the VPM pipeline (RK2 midpoint advection).
 * Two velocity evaluations per step for O(h²) accuracy.
 */
function runSubstepRK2(particles, params, subDt, velocityComputer) {
  // Stage 1: compute v1 at current positions
  velocityComputer(particles, params)
  applyVorticityConfinement(particles, params)
  applyStabilityConstraints(particles, params)

  const savedPositions = capturePositions(particles)

  // Half-step to midpoint
  advectParticles(particles, subDt * 0.5)

  // Stage 2: compute v2 at midpoint positions
  velocityComputer(particles, params)
  applyVorticityConfinement(particles, params)
  applyStabilityConstraints(particles, params)

  // Final step from original positions using midpoint velocity
  advectParticlesRK2Final(particles, subDt, savedPositions)

  // Physics operators use full subDt
  const stageOrder = resolvePhysicalStageOrder(params)
  const stageExecutors = buildStageExecutors(particles, params, subDt)
  for (let i = 0; i < stageOrder.length; i += 1) {
    const exec = stageExecutors[stageOrder[i]]
    if (typeof exec === 'function') exec()
  }
}

export function runVortexParticlePipeline(
  particles,
  params,
  dt,
  velocityComputer = computeVelocityBiotSavart,
) {
  const trackConservation = params.trackConservation !== false
  const useAdaptiveDt = params.adaptiveCfl !== false
  const integrator = params.particleIntegrator ?? 'euler'
  const maxSubsteps = Math.max(1, Math.min(16, Math.floor(params.maxParticleSubsteps ?? 4)))

  resetStabilityClampStats()

  const before = trackConservation && particles.length > 0
    ? computeConservationMetrics(particles)
    : null

  // Compute CFL-limited dt
  let substeps = 1
  let effectiveDt = dt
  let cflDt = Infinity
  let maxSpeed = 0

  if (useAdaptiveDt && particles.length > 1) {
    velocityComputer(particles, params)
    const cfl = computeCflDt(particles, params)
    cflDt = cfl.cflDt
    maxSpeed = cfl.maxSpeed

    if (Number.isFinite(cflDt) && cflDt < dt) {
      substeps = Math.min(maxSubsteps, Math.max(1, Math.ceil(dt / cflDt)))
      effectiveDt = dt / substeps
    }

    // First sub-step: velocity already computed, run directly
    if (integrator === 'rk2') {
      const savedPositions = capturePositions(particles)
      applyVorticityConfinement(particles, params)
      applyStabilityConstraints(particles, params)
      advectParticles(particles, effectiveDt * 0.5)
      velocityComputer(particles, params)
      applyVorticityConfinement(particles, params)
      applyStabilityConstraints(particles, params)
      advectParticlesRK2Final(particles, effectiveDt, savedPositions)
    } else {
      applyVorticityConfinement(particles, params)
      applyStabilityConstraints(particles, params)
      advectParticles(particles, effectiveDt)
    }

    const stageOrder = resolvePhysicalStageOrder(params)
    const stageExecutors = buildStageExecutors(particles, params, effectiveDt)
    for (let i = 0; i < stageOrder.length; i += 1) {
      const exec = stageExecutors[stageOrder[i]]
      if (typeof exec === 'function') exec()
    }

    // Remaining sub-steps
    for (let step = 1; step < substeps; step += 1) {
      if (integrator === 'rk2') {
        runSubstepRK2(particles, params, effectiveDt, velocityComputer)
      } else {
        runSubstepEuler(particles, params, effectiveDt, velocityComputer)
      }
    }
  } else {
    // No adaptive dt — single step
    if (integrator === 'rk2') {
      runSubstepRK2(particles, params, dt, velocityComputer)
    } else {
      runSubstepEuler(particles, params, dt, velocityComputer)
    }
  }

  vortexReconnection(particles, params)
  applyStabilityConstraints(particles, params)

  const remeshResult = maybeRemesh(particles, params, { current: findMaxParticleId(particles) + 1 })

  if (trackConservation && before && particles.length > 0) {
    const after = computeConservationMetrics(particles)
    const clampStats = getStabilityClampStats()
    const circulationDrift = before.circulation !== 0
      ? ((after.circulation - before.circulation) / Math.abs(before.circulation)) * 100
      : 0
    const energyDrift = before.energy > 1e-12
      ? ((after.energy - before.energy) / before.energy) * 100
      : 0
    lastPipelineDiagnostics = {
      energyBefore: before.energy,
      energyAfter: after.energy,
      energyDriftPercent: energyDrift,
      enstrophyBefore: before.enstrophy,
      enstrophyAfter: after.enstrophy,
      circulationBefore: before.circulation,
      circulationAfter: after.circulation,
      circulationDriftPercent: circulationDrift,
      particleCountBefore: before.count,
      particleCountAfter: after.count,
      velocityClampCount: clampStats.velocityClampCount,
      vorticityClampCount: clampStats.vorticityClampCount,
      coreRadiusClampMinCount: clampStats.coreRadiusClampMinCount,
      coreRadiusClampMaxCount: clampStats.coreRadiusClampMaxCount,
      coreRadiusOverrideCount: clampStats.coreRadiusOverrideCount,
      energyDestroyedByClamps: clampStats.totalEnergyDestroyedByVelocityClamp,
      enstrophyDestroyedByClamps: clampStats.totalEnstrophyDestroyedByVorticityClamp,
      substeps,
      effectiveDt,
      cflDt,
      maxSpeed,
      integrator,
      remeshed: remeshResult?.remeshed ?? false,
      remeshActiveNodes: remeshResult?.activeNodes ?? 0,
    }
  }
}
