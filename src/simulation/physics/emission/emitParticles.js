import { createParticle, spawnParticle } from '../spawnParticle'
import {
  advancePulse,
  getNozzle,
  shouldEmitTrailingJet,
} from './shared'
import { buildEmitterParams, getConfiguredEmitters } from './multiEmitter'
import { createVortexRingSeed } from './vortexRingSeed'
import { createVortexKnotSeed } from './vortexKnotSeed'
import { emitJetRollupParticles } from '../../emitters/jetRollupEmitter'

function emitLegacyParticles(params, idRef, spawnBudget, life = 0) {
  const particles = []

  for (let i = 0; i < spawnBudget; i += 1) {
    particles.push(spawnParticle(params, idRef.current, life))
    idRef.current += 1
  }

  return particles
}

function getLegacySpawnBudget(params, pulseState, signal, remainingCapacity) {
  const maxManualDensity = 360
  let spawnBudget = Math.max(0, Math.floor((params.spawnRate ?? 0) * signal))

  if (
    signal > 0 &&
    pulseState.mode === 'single' &&
    (params.spawnRate ?? 0) >= maxManualDensity
  ) {
    spawnBudget = remainingCapacity
  }

  if (signal > 0 && (pulseState.burstEmissionRemaining ?? 0) > 0) {
    spawnBudget = remainingCapacity
  }

  return Math.min(remainingCapacity, spawnBudget)
}

function emitStructuredVortexParticles(
  params,
  idRef,
  pulseState,
  dt,
  remainingCapacity,
  jetVelocity,
  mode = 'vortexRing',
) {
  const resolution = Math.max(8, Math.floor(params.ringResolution ?? 64))
  const spawnBudget = Math.min(remainingCapacity, resolution)
  const particles = []
  const phaseOffset =
    ((pulseState.emittedSlugLength ?? 0) / Math.max(getNozzle(params).radius, 1e-4)) % (Math.PI * 2)
  const seedBuilder = mode === 'vortexKnot' ? createVortexKnotSeed : createVortexRingSeed
  const ringSeed = seedBuilder(params, {
    resolution: spawnBudget,
    jetVelocity,
    axialDt: dt,
    totalCirculation: params.gamma ?? 1,
    phaseOffset,
  })

  for (let i = 0; i < ringSeed.samples.length; i += 1) {
    const sample = ringSeed.samples[i]
    particles.push(
      createParticle(params, idRef.current, {
        x: sample.position.x,
        y: sample.position.y,
        z: sample.position.z,
        vx: sample.velocity.x,
        vy: sample.velocity.y,
        vz: sample.velocity.z,
        velocity: { ...sample.velocity },
        vorticity: { ...sample.vorticity },
        gamma: ringSeed.gammaPerSample,
        coreRadius: Math.max(params.coreRadiusSigma ?? 0.01, params.minCoreRadius ?? 0.01),
      }),
    )
    idRef.current += 1
  }

  return particles
}

function emitForEmitter(
  particles,
  params,
  idRef,
  pulseState,
  dt,
  emission,
  emitterParams,
) {
  const remainingCapacity = Math.max(0, (params.particleCount ?? 0) - particles.length)
  if (remainingCapacity <= 0 || emission.signal <= 0) {
    return []
  }

  if (emitterParams.emissionMode === 'jetRollup') {
    const rollupResult = emitJetRollupParticles({
      particles,
      params: emitterParams,
      idRef,
      pulseState,
      dt,
      emissionSignal: emission.signal,
      jetVelocity: emission.jetVelocity,
    })
    return rollupResult.spawnedParticles
  }

  if (emitterParams.emissionMode === 'vortexRing' || emitterParams.emissionMode === 'vortexKnot') {
    const ringParticles = emitStructuredVortexParticles(
      emitterParams,
      idRef,
      pulseState,
      dt,
      remainingCapacity,
      emission.jetVelocity,
      emitterParams.emissionMode,
    )
    const trailingCapacity = Math.max(0, remainingCapacity - ringParticles.length)
    const trailingParticles = shouldEmitTrailingJet(pulseState)
      ? emitLegacyParticles(
          { ...emitterParams, jetSpeed: emission.jetVelocity },
          idRef,
          getLegacySpawnBudget(emitterParams, pulseState, emission.signal, trailingCapacity),
        )
      : []
    return [...ringParticles, ...trailingParticles]
  }

  return emitLegacyParticles(
    { ...emitterParams, jetSpeed: emission.jetVelocity },
    idRef,
    getLegacySpawnBudget(emitterParams, pulseState, emission.signal, remainingCapacity),
  )
}

function emitSingleMultiEmitterParticles(particles, params, idRef, pulseState, dt) {
  const emitters = getConfiguredEmitters(params)
  if (emitters.length <= 1) {
    return null
  }

  if (!pulseState.multiSinglePulseSchedule || pulseState.multiSinglePulseSchedule.length !== emitters.length) {
    pulseState.multiSinglePulseSchedule = emitters.map((emitter) => ({
      index: emitter.index,
      delaySec: Math.max(0, emitter.delaySec ?? 0),
      fired: false,
    }))
    pulseState.multiSinglePulseElapsed = 0
  }

  pulseState.multiSinglePulseElapsed = (pulseState.multiSinglePulseElapsed ?? 0) + dt
  const elapsed = pulseState.multiSinglePulseElapsed
  const spawnedParticles = []

  for (let i = 0; i < emitters.length; i += 1) {
    const emitter = emitters[i]
    const schedule = pulseState.multiSinglePulseSchedule.find((item) => item.index === emitter.index)
    if (!schedule || schedule.fired || elapsed + 1e-8 < schedule.delaySec) {
      continue
    }
    schedule.fired = true
    const emitterParams = buildEmitterParams(params, emitter)
    const currentPopulation = particles.length + spawnedParticles.length
    const totalRemainingCapacity = Math.max(0, (params.particleCount ?? 0) - currentPopulation)
    const pendingEmitters = pulseState.multiSinglePulseSchedule.filter((item) => !item.fired).length + 1
    const perEmitterCapacity = Math.max(1, Math.floor(totalRemainingCapacity / Math.max(pendingEmitters, 1)))
    const capacityScopedEmitterParams = {
      ...emitterParams,
      particleCount: currentPopulation + perEmitterCapacity,
    }
    const localPulseState = {
      mode: 'single',
      time: 0,
      singleElapsed: 0,
      singlePulseConsumed: false,
      burstEmissionRemaining: 0,
      pulseActive: false,
      pulseTimer: 0,
      emittedSlugLength: 0,
      trailingJetActive: false,
      jetRollupClock: 0,
    }
    const emission = {
      signal: 1,
      jetVelocity: Math.max(capacityScopedEmitterParams.jetSpeed ?? 0, 0),
      formationNumber: capacityScopedEmitterParams.nozzleRadius > 0
        ? (Math.max(capacityScopedEmitterParams.jetSpeed ?? 0, 0) *
            Math.max(capacityScopedEmitterParams.pulseDuration ?? 0, 0)) /
          Math.max(capacityScopedEmitterParams.nozzleRadius * 2, 1e-4)
        : 0,
      slugFormationNumber: 0,
    }
    const emitterSpawned = emitForEmitter(
      [...particles, ...spawnedParticles],
      params,
      idRef,
      localPulseState,
      dt,
      emission,
      capacityScopedEmitterParams,
    )
    if (emitterSpawned.length > 0) {
      spawnedParticles.push(...emitterSpawned)
    }
  }

  const allFired = pulseState.multiSinglePulseSchedule.every((item) => item.fired)
  if (allFired) {
    pulseState.singlePulseConsumed = true
  }

  return {
    signal: allFired ? 0 : 1,
    spawnedParticles,
    formationNumber: 0,
    slugFormationNumber: 0,
  }
}

export function emitParticles(particles, params, idRef, pulseState, dt) {
  if (
    params.multiEmitterPresetEnabled === true &&
    pulseState.mode === 'single' &&
    (pulseState.burstEmissionRemaining ?? 0) <= 0
  ) {
    const multiEmitterResult = emitSingleMultiEmitterParticles(particles, params, idRef, pulseState, dt)
    if (multiEmitterResult) {
      return multiEmitterResult
    }
  }

  const emission = advancePulse(params, pulseState, dt)
  const singleAlreadyConsumed =
    pulseState.mode === 'single' &&
    pulseState.burstEmissionRemaining <= 0 &&
    pulseState.singlePulseConsumed

  if (singleAlreadyConsumed) {
    return {
      signal: emission.signal,
      spawnedParticles: [],
      formationNumber: emission.formationNumber,
      slugFormationNumber: emission.slugFormationNumber,
    }
  }

  if (emission.signal <= 0) {
    return {
      signal: emission.signal,
      spawnedParticles: [],
      formationNumber: emission.formationNumber,
      slugFormationNumber: emission.slugFormationNumber,
    }
  }

  const spawnedParticles = emitForEmitter(
    particles,
    params,
    idRef,
    pulseState,
    dt,
    emission,
    params,
  )

  if (
    pulseState.mode === 'single' &&
    spawnedParticles.length > 0 &&
    params.emissionMode !== 'jetRollup'
  ) {
    pulseState.singlePulseConsumed = true
  }

  return {
    signal: emission.signal,
    spawnedParticles,
    formationNumber: emission.formationNumber,
    slugFormationNumber: emission.slugFormationNumber,
  }
}
