import { controlNaturalCirculationDirection } from '../runtime/naturalBiotSavartModulation.js'
const FOUR_PI = 4 * Math.PI

function getCoreRadius(particle, params) {
  const minCore = Math.max(params.minCoreRadius ?? 0.01, 1e-4)
  const sigma = particle.coreRadius ?? params.coreRadiusSigma ?? minCore
  return Math.max(minCore, sigma)
}

function getInjectedVelocityContribution(particle, params) {
  const jetDuration = Math.max(params.pulseDuration ?? 0, 1e-4)
  const age = Math.max(particle.age ?? 0, 0)

  if (age >= jetDuration) {
    return { x: 0, y: 0, z: 0 }
  }

  const injectVx = particle.injectVx ?? particle.vx ?? 0
  const injectVy = particle.injectVy ?? particle.vy ?? 0
  const injectVz = particle.injectVz ?? particle.vz ?? 0
  const weight = 1 - age / jetDuration

  return {
    x: injectVx * weight,
    y: injectVy * weight,
    z: injectVz * weight,
  }
}

export function computeVelocityBiotSavart(particles, params) {
  const count = particles.length
  const eps = 1e-8
  const interactionRadius = Math.max(params.interactionRadius ?? 0, 0)
  const interactionRadius2 = interactionRadius * interactionRadius

  for (let i = 0; i < count; i += 1) {
    const particle = particles[i]
    const injectedVelocity = getInjectedVelocityContribution(particle, params)
    let vx = injectedVelocity.x
    let vy = injectedVelocity.y
    let vz = injectedVelocity.z

    if (params.useBiotSavart) {
      for (let j = 0; j < count; j += 1) {
        if (i === j) {
          continue
        }

        const source = particles[j]
        const rx = particle.x - source.x
        const ry = particle.y - source.y
        const rz = particle.z - source.z
        const r2 = rx * rx + ry * ry + rz * rz
        if (interactionRadius > 0 && r2 > interactionRadius2) {
          continue
        }
        const sigma = getCoreRadius(source, params)
        const denom = (r2 + sigma * sigma) ** 1.5

        if (denom <= eps) {
          continue
        }

        const omega = controlNaturalCirculationDirection(
          source,
          source.vorticity ?? { x: 0, y: 0, z: 0 },
          params,
        )
        const cx = ry * omega.z - rz * omega.y
        const cy = rz * omega.x - rx * omega.z
        const cz = rx * omega.y - ry * omega.x
        const gamma = source.gamma ?? params.gamma ?? 0
        const factor = gamma / (FOUR_PI * denom)

        vx += cx * factor
        vy += cy * factor
        vz += cz * factor
      }
    } else {
      vx += (particle.vx ?? 0) / Math.max(params.timeScale ?? 1, 1e-4)
      vy += (particle.vy ?? 0) / Math.max(params.timeScale ?? 1, 1e-4)
      vz += (particle.vz ?? 0) / Math.max(params.timeScale ?? 1, 1e-4)
    }

    particle.flowVx = vx
    particle.flowVy = vy
    particle.flowVz = vz
  }
}
