function getFinite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

export function computeRingDiagnostics(particles) {
  if (!Array.isArray(particles) || particles.length === 0) {
    return {
      ringMajorMeasured: 0,
      ringMinorMeasured: 0,
      sigmaOverRMeasured: 0,
    }
  }

  let centerX = 0
  let centerY = 0
  let centerZ = 0
  let sigmaSum = 0

  for (let i = 0; i < particles.length; i += 1) {
    const particle = particles[i]
    centerX += getFinite(particle.x)
    centerY += getFinite(particle.y)
    centerZ += getFinite(particle.z)
    sigmaSum += getFinite(particle.coreRadius, 0.01)
  }

  const invCount = 1 / particles.length
  centerX *= invCount
  centerY *= invCount
  centerZ *= invCount

  let ringMajorMeasured = 0
  for (let i = 0; i < particles.length; i += 1) {
    const particle = particles[i]
    ringMajorMeasured += Math.hypot(
      getFinite(particle.x) - centerX,
      getFinite(particle.y) - centerY,
    )
  }
  ringMajorMeasured *= invCount

  let ringMinorMeasured = 0
  for (let i = 0; i < particles.length; i += 1) {
    const particle = particles[i]
    const rho = Math.hypot(getFinite(particle.x) - centerX, getFinite(particle.y) - centerY)
    const dz = getFinite(particle.z) - centerZ
    ringMinorMeasured += Math.hypot(rho - ringMajorMeasured, dz)
  }
  ringMinorMeasured *= invCount

  const avgSigma = sigmaSum * invCount
  const sigmaOverRMeasured =
    ringMajorMeasured > 1e-8 ? avgSigma / ringMajorMeasured : 0

  return {
    ringMajorMeasured,
    ringMinorMeasured,
    sigmaOverRMeasured,
  }
}
