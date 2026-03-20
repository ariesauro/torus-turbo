function distanceSquared(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function isReconnectionEligible(particle, params) {
  const minAge = Math.max(params.reconnectionMinAge ?? params.pulseDuration ?? 0, 0)
  return (particle.age ?? 0) >= minAge
}

export function vortexReconnection(particles, params) {
  const threshold = Math.max(params.reconnectionDistance ?? 0, 0)

  if (threshold <= 0 || particles.length <= 1) {
    return
  }

  const threshold2 = threshold * threshold
  const targets = new Array(particles.length).fill(-1)
  const owners = new Array(particles.length).fill(-1)
  const mergedParticles = []

  for (let i = 0; i < particles.length; i += 1) {
    if (!isReconnectionEligible(particles[i], params)) {
      continue
    }

    for (let j = i + 1; j < particles.length; j += 1) {
      if (!isReconnectionEligible(particles[j], params)) {
        continue
      }

      if (distanceSquared(particles[i], particles[j]) >= threshold2) {
        continue
      }

      if (targets[i] === -1 || distanceSquared(particles[i], particles[j]) < distanceSquared(particles[i], particles[targets[i]])) {
        targets[i] = j
      }
    }
  }

  for (let i = 0; i < particles.length; i += 1) {
    const target = targets[i]
    if (target === -1) {
      continue
    }

    if (owners[target] === -1 || i < owners[target]) {
      owners[target] = i
    }
  }

  for (let i = 0; i < particles.length; i += 1) {
    if (owners[i] !== -1) {
      continue
    }

    const base = particles[i]
    const targetIndex = targets[i]
    if (targetIndex !== -1 && owners[targetIndex] === i) {
      const candidate = particles[targetIndex]
      const baseWeight = Math.abs(base.gamma ?? 0) + 1e-6
      const candidateWeight = Math.abs(candidate.gamma ?? 0) + 1e-6
      const weightSum = baseWeight + candidateWeight
      const baseOmega = base.vorticity ?? { x: 0, y: 0, z: 0 }
      const candidateOmega = candidate.vorticity ?? { x: 0, y: 0, z: 0 }

      base.x = (base.x * baseWeight + candidate.x * candidateWeight) / weightSum
      base.y = (base.y * baseWeight + candidate.y * candidateWeight) / weightSum
      base.z = (base.z * baseWeight + candidate.z * candidateWeight) / weightSum
      base.vorticity = {
        x: baseOmega.x + candidateOmega.x,
        y: baseOmega.y + candidateOmega.y,
        z: baseOmega.z + candidateOmega.z,
      }
      base.gamma = (base.gamma ?? 0) + (candidate.gamma ?? 0)
      base.coreRadius =
        ((base.coreRadius ?? params.coreRadiusSigma ?? params.minCoreRadius ?? 0.01) +
          (candidate.coreRadius ?? params.coreRadiusSigma ?? params.minCoreRadius ?? 0.01)) /
        2
    }

    mergedParticles.push(base)
  }

  particles.length = 0
  particles.push(...mergedParticles)
}
