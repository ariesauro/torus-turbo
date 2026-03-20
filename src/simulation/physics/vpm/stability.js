/**
 * Stability constraints and conservation tracking.
 *
 * Philosophy (Audit v2):
 * - Hard clamps are SAFETY NETS, not physics. Every activation is an energy violation.
 * - All clamp activations are counted in stabilityClampStats for diagnostics.
 * - Conservation of Γ should be achieved by correct operators, not by global normalization.
 * - The global normalizer is kept as optional monitoring + gentle correction mode.
 */

let stabilityClampStats = {
  velocityClampCount: 0,
  vorticityClampCount: 0,
  coreRadiusClampMinCount: 0,
  coreRadiusClampMaxCount: 0,
  coreRadiusOverrideCount: 0,
  totalEnergyDestroyedByVelocityClamp: 0,
  totalEnstrophyDestroyedByVorticityClamp: 0,
}

export function getStabilityClampStats() {
  return { ...stabilityClampStats }
}

export function resetStabilityClampStats() {
  stabilityClampStats.velocityClampCount = 0
  stabilityClampStats.vorticityClampCount = 0
  stabilityClampStats.coreRadiusClampMinCount = 0
  stabilityClampStats.coreRadiusClampMaxCount = 0
  stabilityClampStats.coreRadiusOverrideCount = 0
  stabilityClampStats.totalEnergyDestroyedByVelocityClamp = 0
  stabilityClampStats.totalEnstrophyDestroyedByVorticityClamp = 0
}

/**
 * [STATUS]: SAFETY NET — not physics. Every activation is a conservation violation.
 */
export function applyStabilityConstraints(particles, params) {
  clampVelocityAndVorticity(particles, params)
  stabilizeCoreRadius(particles, params)
  limitCoreRadius(particles, params)
}

function clampMagnitude(x, y, z, maxValue) {
  if (!(maxValue > 0)) {
    return { x, y, z, clamped: false, destroyed: 0 }
  }
  const lengthValue = Math.hypot(x, y, z)
  if (lengthValue <= maxValue || lengthValue <= 1e-8) {
    return { x, y, z, clamped: false, destroyed: 0 }
  }
  const scale = maxValue / lengthValue
  const destroyed = 0.5 * (lengthValue * lengthValue - maxValue * maxValue)
  return { x: x * scale, y: y * scale, z: z * scale, clamped: true, destroyed }
}

function clampVelocityAndVorticity(particles, params) {
  const maxVelocity = Math.max(params?.maxVelocity ?? 0, 0)
  const maxVorticity = Math.max(params?.maxVorticity ?? 0, 0)

  if (!(maxVelocity > 0) && !(maxVorticity > 0)) {
    return
  }

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i]
    if (maxVelocity > 0) {
      const flow = clampMagnitude(
        p.flowVx ?? 0,
        p.flowVy ?? 0,
        p.flowVz ?? 0,
        maxVelocity,
      )
      p.flowVx = flow.x
      p.flowVy = flow.y
      p.flowVz = flow.z
      if (flow.clamped) {
        stabilityClampStats.velocityClampCount += 1
        stabilityClampStats.totalEnergyDestroyedByVelocityClamp += flow.destroyed
      }
    }
    if (maxVorticity > 0) {
      const omega = p.vorticity ?? { x: 0, y: 0, z: 0 }
      const clamped = clampMagnitude(omega.x ?? 0, omega.y ?? 0, omega.z ?? 0, maxVorticity)
      p.vorticity = { x: clamped.x, y: clamped.y, z: clamped.z }
      if (clamped.clamped) {
        stabilityClampStats.vorticityClampCount += 1
        stabilityClampStats.totalEnstrophyDestroyedByVorticityClamp += clamped.destroyed
      }
    }
  }
}

/**
 * Force σ = R * sigmaRatio for all particles.
 * [STATUS]: PROXY — overrides natural core dynamics. Use only for scripted mode.
 */
export function stabilizeCoreRadius(particles, params) {
  const { autoCoreRadius, sigmaRatio = 0.08, ringMajor = 1 } = params

  if (!autoCoreRadius) {
    return
  }

  const targetSigma = ringMajor * sigmaRatio

  for (let i = 0; i < particles.length; i++) {
    const particle = particles[i]
    if (Math.abs(particle.coreRadius - targetSigma) > 1e-8) {
      stabilityClampStats.coreRadiusOverrideCount += 1
    }
    particle.coreRadius = targetSigma
  }
}

/**
 * Clamp σ to [minCoreRadius, R*maxSigmaRatio].
 * [STATUS]: SAFETY NET — prevents numerical blowup but violates energy conservation.
 */
export function limitCoreRadius(particles, params) {
  const { ringMajor = 1, maxSigmaRatio = 0.25, minCoreRadius = 0.01 } = params
  const maxSigma = ringMajor * maxSigmaRatio

  for (let i = 0; i < particles.length; i++) {
    const particle = particles[i]
    if (particle.coreRadius > maxSigma) {
      particle.coreRadius = maxSigma
      stabilityClampStats.coreRadiusClampMaxCount += 1
    }
    if (particle.coreRadius < minCoreRadius) {
      particle.coreRadius = minCoreRadius
      stabilityClampStats.coreRadiusClampMinCount += 1
    }
  }
}

/**
 * Circulation conservation.
 *
 * Mode 'enforce' (legacy): globally normalize all gammas to match initial total.
 *   This is a hack — it hides per-operator violations instead of fixing them.
 *
 * Mode 'monitor' (recommended): track drift but don't modify gammas.
 *   Operators should conserve Γ individually (PSE already does; analytic stretching does).
 *
 * [STATUS]: PARTIAL — enforcement available but monitoring preferred.
 */
export function conserveCirculation(particles, params, circulationState) {
  const mode = params?.circulationConservationMode ?? (params?.conserveCirculation === false ? 'off' : 'enforce')
  const targetGamma = params?.gamma ?? 1.0

  if (mode === 'off' || particles.length === 0) {
    return {
      changed: false,
      ratio: 1,
      mode,
      initialCirculation: circulationState?.initial ?? 0,
      currentCirculation: circulationState?.current ?? 0,
      driftPercent: 0,
    }
  }

  let currentCirculation = 0
  for (let i = 0; i < particles.length; i++) {
    currentCirculation += particles[i].gamma || targetGamma
  }

  const initialCirculation = circulationState.initial || currentCirculation
  const ratio = initialCirculation / (currentCirculation || initialCirculation)
  const driftPercent = Math.abs(initialCirculation) > 1e-8
    ? ((currentCirculation - initialCirculation) / Math.abs(initialCirculation)) * 100
    : 0
  const changed = Math.abs(ratio - 1) > 1e-6

  if (mode === 'enforce' && changed) {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      p.gamma = (p.gamma || targetGamma) * ratio
    }
  }

  circulationState.initial = initialCirculation
  circulationState.current = mode === 'enforce' ? currentCirculation * ratio : currentCirculation
  circulationState.particleCount = particles.length
  return {
    changed,
    ratio,
    mode,
    initialCirculation,
    currentCirculation: circulationState.current,
    driftPercent,
  }
}

/**
 * Вычисление статистики стабильности для debug
 */
export function computeStabilityStats(particles, params) {
  const { ringMajor = 1 } = params
  const ringRadius = ringMajor

  if (particles.length === 0) {
    return {
      sigmaOverR: 0,
      totalCirculation: 0,
      particleCount: 0,
      avgSigma: 0,
      minSigma: 0,
      maxSigma: 0,
      tiltProxyDeg: 0,
      ringCoherence: 0,
    }
  }

  let totalSigma = 0
  let totalCirculation = 0
  let minSigma = Infinity
  let maxSigma = -Infinity
  let centerX = 0
  let centerY = 0
  let centerZ = 0

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    const sigma = p.coreRadius || 0.01
    const gamma = p.gamma || 0

    totalSigma += sigma
    totalCirculation += gamma
    centerX += p.x ?? 0
    centerY += p.y ?? 0
    centerZ += p.z ?? 0

    if (sigma < minSigma) minSigma = sigma
    if (sigma > maxSigma) maxSigma = sigma
  }

  const invCount = 1 / particles.length
  centerX *= invCount
  centerY *= invCount
  centerZ *= invCount

  // Measured ring radii around current particle cloud center.
  let ringMajorMeasured = 0
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i]
    ringMajorMeasured += Math.hypot((p.x ?? 0) - centerX, (p.y ?? 0) - centerY)
  }
  ringMajorMeasured *= invCount

  let ringMinorMeasured = 0
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i]
    const rho = Math.hypot((p.x ?? 0) - centerX, (p.y ?? 0) - centerY)
    const dz = (p.z ?? 0) - centerZ
    ringMinorMeasured += Math.hypot(rho - ringMajorMeasured, dz)
  }
  ringMinorMeasured *= invCount

  // Coherence as a bounded inverse dispersion score of local minor radius.
  let minorRadiusVariance = 0
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i]
    const rho = Math.hypot((p.x ?? 0) - centerX, (p.y ?? 0) - centerY)
    const dz = (p.z ?? 0) - centerZ
    const localMinor = Math.hypot(rho - ringMajorMeasured, dz)
    const delta = localMinor - ringMinorMeasured
    minorRadiusVariance += delta * delta
  }
  minorRadiusVariance *= invCount
  const minorRadiusStd = Math.sqrt(minorRadiusVariance)
  const coherenceCv = minorRadiusStd / Math.max(ringMinorMeasured, 1e-6)
  const ringCoherence = Math.max(0, Math.min(1, 1 - coherenceCv))

  // Tilt proxy based on toroidal/poloidal velocity decomposition.
  let thetaAbs = 0
  let phiAbs = 0
  let velSamples = 0
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i]
    const vx = p.velocity?.x ?? p.vx ?? 0
    const vy = p.velocity?.y ?? p.vy ?? 0
    const vz = p.velocity?.z ?? p.vz ?? 0
    const speed = Math.hypot(vx, vy, vz)
    if (speed <= 1e-8) {
      continue
    }

    const rx = (p.x ?? 0) - centerX
    const ry = (p.y ?? 0) - centerY
    const rz = (p.z ?? 0) - centerZ
    const radialLen = Math.hypot(rx, ry)
    if (radialLen <= 1e-8) {
      continue
    }

    const rdx = rx / radialLen
    const rdy = ry / radialLen
    const eThetaX = -rdy
    const eThetaY = rdx
    const eThetaZ = 0

    const normalLen = Math.hypot(rx, ry, rz)
    const nx = normalLen > 1e-8 ? rx / normalLen : rdx
    const ny = normalLen > 1e-8 ? ry / normalLen : rdy
    const nz = normalLen > 1e-8 ? rz / normalLen : 0

    let ePhiX = ny * eThetaZ - nz * eThetaY
    let ePhiY = nz * eThetaX - nx * eThetaZ
    let ePhiZ = nx * eThetaY - ny * eThetaX
    const ePhiLen = Math.hypot(ePhiX, ePhiY, ePhiZ)
    if (ePhiLen <= 1e-8) {
      continue
    }
    ePhiX /= ePhiLen
    ePhiY /= ePhiLen
    ePhiZ /= ePhiLen

    const vTheta = vx * eThetaX + vy * eThetaY + vz * eThetaZ
    const vPhi = vx * ePhiX + vy * ePhiY + vz * ePhiZ
    thetaAbs += Math.abs(vTheta)
    phiAbs += Math.abs(vPhi)
    velSamples += 1
  }

  const meanThetaAbs = velSamples > 0 ? thetaAbs / velSamples : 0
  const meanPhiAbs = velSamples > 0 ? phiAbs / velSamples : 0
  const tiltProxyDeg = (Math.atan2(meanPhiAbs, Math.max(meanThetaAbs, 1e-8)) * 180) / Math.PI

  const avgSigma = totalSigma / particles.length
  const sigmaOverR = avgSigma / ringRadius

  return {
    sigmaOverR,
    totalCirculation,
    particleCount: particles.length,
    avgSigma,
    minSigma,
    maxSigma,
    targetSigmaRatio: ringRadius > 0 ? avgSigma / ringRadius : 0,
    ringMajorMeasured,
    ringMinorMeasured,
    tiltProxyDeg,
    ringCoherence,
  }
}

function computeParticleCirculation(particles) {
  let total = 0
  for (let i = 0; i < particles.length; i += 1) {
    total += particles[i].gamma ?? 0
  }
  return total
}

function computeFilamentCirculation(filaments) {
  let total = 0
  for (let i = 0; i < filaments.length; i += 1) {
    total += filaments[i].circulation ?? 0
  }
  return total
}

function computeParticleCenter(particles) {
  if (!Array.isArray(particles) || particles.length === 0) {
    return { x: 0, y: 0, z: 0 }
  }

  let x = 0
  let y = 0
  let z = 0
  for (let i = 0; i < particles.length; i += 1) {
    x += particles[i].x ?? 0
    y += particles[i].y ?? 0
    z += particles[i].z ?? 0
  }

  const invCount = 1 / particles.length
  return { x: x * invCount, y: y * invCount, z: z * invCount }
}

function computeFilamentCenter(filaments) {
  if (!Array.isArray(filaments) || filaments.length === 0) {
    return { x: 0, y: 0, z: 0 }
  }

  let x = 0
  let y = 0
  let z = 0
  let count = 0
  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const nodes = filaments[filamentIndex].nodes ?? []
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      x += nodes[nodeIndex].position?.x ?? 0
      y += nodes[nodeIndex].position?.y ?? 0
      z += nodes[nodeIndex].position?.z ?? 0
      count += 1
    }
  }

  if (count === 0) {
    return { x: 0, y: 0, z: 0 }
  }

  const invCount = 1 / count
  return { x: x * invCount, y: y * invCount, z: z * invCount }
}

function computeCenterStepDelta(previousCenter, nextCenter) {
  if (!previousCenter) {
    return 0
  }

  return Math.hypot(
    (nextCenter.x ?? 0) - (previousCenter.x ?? 0),
    (nextCenter.y ?? 0) - (previousCenter.y ?? 0),
    (nextCenter.z ?? 0) - (previousCenter.z ?? 0),
  )
}

function computeParticleMeanRadius(particles, center) {
  if (!Array.isArray(particles) || particles.length === 0) {
    return 0
  }

  let totalRadius = 0
  for (let i = 0; i < particles.length; i += 1) {
    const dx = (particles[i].x ?? 0) - center.x
    const dy = (particles[i].y ?? 0) - center.y
    const dz = (particles[i].z ?? 0) - center.z
    totalRadius += Math.hypot(dx, dy, dz)
  }

  return totalRadius / particles.length
}

function computeFilamentGeometryStats(filaments, center) {
  if (!Array.isArray(filaments) || filaments.length === 0) {
    return { meanRadius: 0, arcLength: 0, nodeCount: 0 }
  }

  let totalRadius = 0
  let nodeCount = 0
  let arcLength = 0

  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const filament = filaments[filamentIndex]
    const nodes = filament.nodes ?? []
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      const position = nodes[nodeIndex].position ?? { x: 0, y: 0, z: 0 }
      totalRadius += Math.hypot(
        position.x - center.x,
        position.y - center.y,
        position.z - center.z,
      )
      nodeCount += 1
    }

    const segmentCount = filament.closedLoop !== false ? nodes.length : Math.max(0, nodes.length - 1)
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const a = nodes[segmentIndex]?.position
      const b = nodes[(segmentIndex + 1) % Math.max(nodes.length, 1)]?.position
      if (!a || !b) {
        continue
      }
      arcLength += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    }
  }

  return {
    meanRadius: nodeCount > 0 ? totalRadius / nodeCount : 0,
    arcLength,
    nodeCount,
  }
}

export function computeHybridConsistencyStats(particles, filaments, hybridState = null) {
  const particleCirculation = computeParticleCirculation(particles)
  const filamentCirculation = computeFilamentCirculation(filaments)
  const totalCirculation = particleCirculation + filamentCirculation
  const particleCenter = computeParticleCenter(particles)
  const filamentCenter = computeFilamentCenter(filaments)
  const particleMeanRadius = computeParticleMeanRadius(particles, particleCenter)
  const filamentGeometry = computeFilamentGeometryStats(filaments, filamentCenter)
  const centerOffset = Math.hypot(
    particleCenter.x - filamentCenter.x,
    particleCenter.y - filamentCenter.y,
    particleCenter.z - filamentCenter.z,
  )
  const axialOffset = particleCenter.z - filamentCenter.z
  const particleCenterStep = computeCenterStepDelta(hybridState?.lastParticleCenter, particleCenter)
  const filamentCenterStep = computeCenterStepDelta(hybridState?.lastFilamentCenter, filamentCenter)

  if (hybridState) {
    if (!Number.isFinite(hybridState.initialTotalCirculation)) {
      hybridState.initialTotalCirculation = totalCirculation
    }
    if (!Number.isFinite(hybridState.initialFilamentMeanRadius)) {
      hybridState.initialFilamentMeanRadius = filamentGeometry.meanRadius
    }
    if (!Number.isFinite(hybridState.initialFilamentArcLength)) {
      hybridState.initialFilamentArcLength = filamentGeometry.arcLength
    }
    hybridState.lastTotalCirculation = totalCirculation
    hybridState.lastParticleCenter = { ...particleCenter }
    hybridState.lastFilamentCenter = { ...filamentCenter }
  }

  const baseline = Number.isFinite(hybridState?.initialTotalCirculation)
    ? hybridState.initialTotalCirculation
    : totalCirculation
  const driftPercent =
    Math.abs(baseline) > 1e-8 ? ((totalCirculation - baseline) / baseline) * 100 : 0
  const filamentRadiusBaseline = Number.isFinite(hybridState?.initialFilamentMeanRadius)
    ? hybridState.initialFilamentMeanRadius
    : filamentGeometry.meanRadius
  const filamentArcLengthBaseline = Number.isFinite(hybridState?.initialFilamentArcLength)
    ? hybridState.initialFilamentArcLength
    : filamentGeometry.arcLength
  const filamentRadiusDriftPercent =
    Math.abs(filamentRadiusBaseline) > 1e-8
      ? ((filamentGeometry.meanRadius - filamentRadiusBaseline) / filamentRadiusBaseline) * 100
      : 0
  const filamentArcLengthDriftPercent =
    Math.abs(filamentArcLengthBaseline) > 1e-8
      ? ((filamentGeometry.arcLength - filamentArcLengthBaseline) / filamentArcLengthBaseline) * 100
      : 0

  return {
    hybridParticleCirculation: particleCirculation,
    hybridFilamentCirculation: filamentCirculation,
    hybridTotalCirculation: totalCirculation,
    hybridCirculationBaseline: baseline,
    hybridCirculationDriftPercent: driftPercent,
    hybridParticleCount: particles.length,
    hybridFilamentCount: filaments.length,
    hybridCenterOffset: centerOffset,
    hybridAxialOffset: axialOffset,
    hybridParticleCenterStep: particleCenterStep,
    hybridFilamentCenterStep: filamentCenterStep,
    hybridRadiusOffset: particleMeanRadius - filamentGeometry.meanRadius,
    hybridFilamentMeanRadius: filamentGeometry.meanRadius,
    hybridFilamentRadiusDriftPercent: filamentRadiusDriftPercent,
    hybridFilamentArcLength: filamentGeometry.arcLength,
    hybridFilamentArcLengthDriftPercent: filamentArcLengthDriftPercent,
  }
}
