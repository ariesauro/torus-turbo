function magnitude(vector) {
  return Math.hypot(vector.x ?? 0, vector.y ?? 0, vector.z ?? 0)
}

export function applyVorticityConfinement(particles, params) {
  const count = particles.length
  const strength = params?.vorticityConfinementStrength ?? 0
  const interactionRadius = Math.max(params?.interactionRadius ?? 0, 0)
  const interactionRadius2 = interactionRadius * interactionRadius
  const minCore = Math.max(params?.minCoreRadius ?? 0.01, 1e-4)
  const baseCore = Math.max(params?.coreRadiusSigma ?? minCore, minCore)
  const eps = 1e-6

  if (Math.abs(strength) <= eps || count <= 1) {
    return
  }

  const confinementScale = strength * Math.max(params?.cellSizeMultiplier ?? 1, 1)

  for (let i = 0; i < count; i += 1) {
    const particle = particles[i]
    const omega = particle.vorticity ?? { x: 0, y: 0, z: 0 }
    const omegaMag = magnitude(omega)
    if (omegaMag <= eps) {
      continue
    }

    let gradX = 0
    let gradY = 0
    let gradZ = 0
    const px = particle.x ?? 0
    const py = particle.y ?? 0
    const pz = particle.z ?? 0

    for (let j = 0; j < count; j += 1) {
      if (i === j) {
        continue
      }
      const neighbor = particles[j]
      const rx = (neighbor.x ?? 0) - px
      const ry = (neighbor.y ?? 0) - py
      const rz = (neighbor.z ?? 0) - pz
      const r2 = rx * rx + ry * ry + rz * rz
      if (interactionRadius > 0 && r2 > interactionRadius2) {
        continue
      }
      const rLen = Math.sqrt(r2 + eps)
      if (rLen <= eps) {
        continue
      }

      // Use a wider baseline kernel than per-particle stabilized core radius.
      // Otherwise confinement can become numerically silent when sigma is tiny.
      const sigma = Math.max(neighbor.coreRadius ?? minCore, baseCore)
      const influence = Math.exp(-r2 / (2 * sigma * sigma))
      if (influence < 1e-4) {
        continue
      }

      const neighborOmegaMag = magnitude(neighbor.vorticity ?? { x: 0, y: 0, z: 0 })
      const domega = (neighborOmegaMag - omegaMag) * influence
      gradX += (rx / rLen) * domega
      gradY += (ry / rLen) * domega
      gradZ += (rz / rLen) * domega
    }

    const gradLen = Math.hypot(gradX, gradY, gradZ)
    if (gradLen <= eps) {
      continue
    }

    const nx = gradX / gradLen
    const ny = gradY / gradLen
    const nz = gradZ / gradLen

    // f_conf = eps * (N x omega), injected as a velocity correction.
    const confX = ny * omega.z - nz * omega.y
    const confY = nz * omega.x - nx * omega.z
    const confZ = nx * omega.y - ny * omega.x

    particle.flowVx = (particle.flowVx ?? 0) + confX * confinementScale
    particle.flowVy = (particle.flowVy ?? 0) + confY * confinementScale
    particle.flowVz = (particle.flowVz ?? 0) + confZ * confinementScale
  }
}
