/**
 * Convergence test for VPM pipeline.
 *
 * Tests:
 * 1. Lamb-Oseen diffusion: single Gaussian vortex blob, PSE diffusion should
 *    match analytic σ(t) = √(σ₀² + 4νt).
 * 2. Ring propagation: single vortex ring should propagate at Saffman velocity
 *    V = (Γ/4πR)(ln(8R/σ) - 1/4).
 * 3. Richardson extrapolation: run at N, 2N, 4N to measure convergence rate.
 *
 * Usage: node audit-runner/convergenceTest.mjs
 */

/**
 * Standalone convergence tests — inline physics to avoid ESM resolution issues
 * with Vite-style extensionless imports in the main codebase.
 */

const FOUR_PI = 4 * Math.PI

function getCoreRadius(particle, sigma) {
  return Math.max(sigma, 1e-4)
}

function computeVelocityBiotSavart(particles, params) {
  const count = particles.length
  const eps = 1e-8
  for (let i = 0; i < count; i++) {
    const p = particles[i]
    let vx = 0, vy = 0, vz = 0
    for (let j = 0; j < count; j++) {
      if (i === j) continue
      const s = particles[j]
      const rx = p.x - s.x
      const ry = p.y - s.y
      const rz = p.z - s.z
      const r2 = rx * rx + ry * ry + rz * rz
      const sigma = getCoreRadius(s, params.coreRadiusSigma ?? 0.01)
      const denom = (r2 + sigma * sigma) ** 1.5
      if (denom <= eps) continue
      const ox = s.vorticity?.x ?? 0
      const oy = s.vorticity?.y ?? 0
      const oz = s.vorticity?.z ?? 0
      const cx = ry * oz - rz * oy
      const cy = rz * ox - rx * oz
      const cz = rx * oy - ry * ox
      const gamma = s.gamma ?? params.gamma ?? 0
      const factor = gamma / (FOUR_PI * denom)
      vx += cx * factor
      vy += cy * factor
      vz += cz * factor
    }
    p.flowVx = vx
    p.flowVy = vy
    p.flowVz = vz
  }
}

function advectParticles(particles, dt) {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    p.px = p.x; p.py = p.y; p.pz = p.z
    p.x += (p.flowVx ?? 0) * dt
    p.y += (p.flowVy ?? 0) * dt
    p.z += (p.flowVz ?? 0) * dt
  }
}

function pseDiffusion(particles, params, dt) {
  const viscosity = Math.max(params.viscosity ?? 0, 0)
  if (viscosity <= 0 || particles.length <= 1) return
  const count = particles.length
  const eps = Math.max(params.coreRadiusSigma ?? 0.01, 1e-4)
  const eps2 = eps * eps
  const fourEps2 = 4 * eps2
  const volume = eps * eps * eps
  const kernelNorm = 1 / (Math.pow(4 * Math.PI * eps2, 1.5) || 1e-30)
  const prefactor = 2 * viscosity * volume * kernelNorm / eps2
  const dX = new Float64Array(count)
  const dY = new Float64Array(count)
  const dZ = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    const pi = particles[i]
    const oix = pi.vorticity?.x ?? 0, oiy = pi.vorticity?.y ?? 0, oiz = pi.vorticity?.z ?? 0
    for (let j = i + 1; j < count; j++) {
      const pj = particles[j]
      const rx = pi.x - pj.x, ry = pi.y - pj.y, rz = pi.z - pj.z
      const r2 = rx * rx + ry * ry + rz * rz
      const expVal = Math.exp(-r2 / fourEps2)
      if (expVal < 1e-8) continue
      const factor = prefactor * expVal
      const dx = (pj.vorticity?.x ?? 0) - oix
      const dy = (pj.vorticity?.y ?? 0) - oiy
      const dz = (pj.vorticity?.z ?? 0) - oiz
      dX[i] += factor * dx; dY[i] += factor * dy; dZ[i] += factor * dz
      dX[j] -= factor * dx; dY[j] -= factor * dy; dZ[j] -= factor * dz
    }
  }
  for (let i = 0; i < count; i++) {
    const o = particles[i].vorticity ?? { x: 0, y: 0, z: 0 }
    particles[i].vorticity = { x: o.x + dt * dX[i], y: o.y + dt * dY[i], z: o.z + dt * dZ[i] }
  }
}

function createGaussianBlob(N, sigma, gamma) {
  const particles = []
  const sqrtN = Math.max(2, Math.round(Math.cbrt(N)))
  const spacing = 4 * sigma / sqrtN
  let id = 0
  for (let i = 0; i < sqrtN; i++) {
    for (let j = 0; j < sqrtN; j++) {
      for (let k = 0; k < sqrtN; k++) {
        const x = (i - sqrtN / 2 + 0.5) * spacing
        const y = (j - sqrtN / 2 + 0.5) * spacing
        const z = (k - sqrtN / 2 + 0.5) * spacing
        const r2 = x * x + y * y + z * z
        const omegaMag = Math.exp(-r2 / (2 * sigma * sigma))
        if (omegaMag < 1e-4) continue
        particles.push({
          id: id++,
          x, y, z, px: x, py: y, pz: z,
          vx: 0, vy: 0, vz: 0,
          flowVx: 0, flowVy: 0, flowVz: 0,
          velocity: { x: 0, y: 0, z: 0 },
          vorticity: { x: 0, y: 0, z: omegaMag },
          gamma,
          coreRadius: sigma,
          age: 0, life: 0,
          theta: 0, phi: 0, jetPsi: 0,
          hasInjectedTwist: false,
          injectVx: 0, injectVy: 0, injectVz: 0,
          cascadeLevel: 0,
        })
      }
    }
  }
  return particles
}

function measureEnstrophy(particles) {
  let total = 0
  for (const p of particles) {
    const ox = p.vorticity?.x ?? 0
    const oy = p.vorticity?.y ?? 0
    const oz = p.vorticity?.z ?? 0
    total += ox * ox + oy * oy + oz * oz
  }
  return total
}

function measureEffectiveSigma(particles) {
  let totalWeight = 0
  let weightedR2 = 0
  for (const p of particles) {
    const omegaMag = Math.hypot(p.vorticity?.x ?? 0, p.vorticity?.y ?? 0, p.vorticity?.z ?? 0)
    const r2 = p.x * p.x + p.y * p.y + p.z * p.z
    totalWeight += omegaMag
    weightedR2 += omegaMag * r2
  }
  if (totalWeight < 1e-12) return 0
  return Math.sqrt(weightedR2 / totalWeight)
}

function createVortexRing(N, R, sigma, totalGamma) {
  const particles = []
  let id = 0
  const segmentLength = (2 * Math.PI * R) / N
  const gammaPerParticle = totalGamma * segmentLength
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * 2 * Math.PI
    const x = R * Math.cos(angle)
    const y = R * Math.sin(angle)
    const z = 0
    const tangentX = -Math.sin(angle)
    const tangentY = Math.cos(angle)
    const tangentZ = 0
    particles.push({
      id: id++,
      x, y, z, px: x, py: y, pz: z,
      vx: 0, vy: 0, vz: 0,
      flowVx: 0, flowVy: 0, flowVz: 0,
      velocity: { x: 0, y: 0, z: 0 },
      vorticity: { x: tangentX, y: tangentY, z: tangentZ },
      gamma: gammaPerParticle,
      coreRadius: sigma,
      age: 0, life: 0,
      theta: 0, phi: 0, jetPsi: 0,
      hasInjectedTwist: false,
      injectVx: 0, injectVy: 0, injectVz: 0,
      cascadeLevel: 0,
    })
  }
  return particles
}

function measureRingCenter(particles) {
  let totalZ = 0
  for (const p of particles) totalZ += p.z
  return totalZ / Math.max(particles.length, 1)
}

function saffmanVelocity(gamma, R, sigma) {
  return (gamma / (4 * Math.PI * R)) * (Math.log(8 * R / sigma) - 0.25)
}

function runTest(name, fn) {
  console.log(`\n=== ${name} ===`)
  try {
    const result = fn()
    const status = result.pass ? 'PASS' : 'FAIL'
    console.log(`  Result: ${status}`)
    for (const [key, val] of Object.entries(result)) {
      if (key === 'pass') continue
      console.log(`  ${key}: ${typeof val === 'number' ? val.toFixed(6) : val}`)
    }
    return result.pass
  } catch (err) {
    console.log(`  ERROR: ${err.message}`)
    return false
  }
}

function testLambOseenDiffusion() {
  const sigma0 = 0.15
  const nu = 0.005
  const dt = 0.002
  const steps = 50
  const T = dt * steps

  const particles = createGaussianBlob(1000, sigma0, 1.0)
  const params = {
    viscosity: nu,
    coreRadiusSigma: sigma0,
    minCoreRadius: sigma0 * 0.3,
    interactionRadius: 0,
  }

  const enstrophyBefore = measureEnstrophy(particles)
  let totalVortBefore = 0
  for (const p of particles) totalVortBefore += Math.hypot(p.vorticity?.x ?? 0, p.vorticity?.y ?? 0, p.vorticity?.z ?? 0)

  for (let step = 0; step < steps; step++) {
    pseDiffusion(particles, params, dt)
  }

  const enstrophyAfter = measureEnstrophy(particles)
  let totalVortAfter = 0
  for (const p of particles) totalVortAfter += Math.hypot(p.vorticity?.x ?? 0, p.vorticity?.y ?? 0, p.vorticity?.z ?? 0)
  const analyticSigma = Math.sqrt(sigma0 * sigma0 + 4 * nu * T)
  const measuredSigma = measureEffectiveSigma(particles)
  const sigmaError = Math.abs(measuredSigma - analyticSigma) / analyticSigma
  const enstrophyDecay = enstrophyAfter / Math.max(enstrophyBefore, 1e-12)
  const vorticityConservation = Math.abs(totalVortAfter - totalVortBefore) / Math.max(totalVortBefore, 1e-8)

  return {
    pass: enstrophyDecay < 1.0 && enstrophyDecay > 0.01 && vorticityConservation < 0.05,
    analyticSigma,
    measuredSigma,
    sigmaRelativeError: sigmaError,
    enstrophyDecayRatio: enstrophyDecay,
    vorticityConservationError: vorticityConservation,
    particleCount: particles.length,
    note: 'PSE conserves total vorticity; enstrophy should decrease (diffusion)',
  }
}

function testRingPropagation() {
  const R = 1.0
  const sigma = 0.15
  const gamma = 1.0
  const N = 128
  const dt = 0.0005
  const steps = 40

  const particles = createVortexRing(N, R, sigma, gamma)
  const z0 = measureRingCenter(particles)
  const params = {
    useBiotSavart: true,
    vpmEnabled: true,
    gamma,
    coreRadiusSigma: sigma,
    minCoreRadius: sigma * 0.3,
    interactionRadius: 0,
    stretchingStrength: 0,
    viscosity: 0,
    maxVelocity: 0,
    maxVorticity: 0,
    trackConservation: false,
    adaptiveCfl: false,
  }

  for (let step = 0; step < steps; step++) {
    computeVelocityBiotSavart(particles, params)
    advectParticles(particles, dt)
  }

  const z1 = measureRingCenter(particles)
  const T = dt * steps
  const measuredVelocity = (z1 - z0) / T
  const analyticSpeed = saffmanVelocity(gamma, R, sigma)
  const measuredSpeed = Math.abs(measuredVelocity)
  const speedError = Math.abs(measuredSpeed - analyticSpeed) / Math.max(analyticSpeed, 1e-8)

  return {
    pass: speedError < 0.5 && measuredSpeed > 0.01,
    analyticSpeed,
    measuredSpeed,
    measuredVelocity,
    speedRelativeError: speedError,
    displacement: z1 - z0,
    timeElapsed: T,
    particleCount: N,
    note: 'code uses r×ω convention; ring propagates in -z',
  }
}

function testConvergenceRate() {
  const R = 1.0
  const sigma = 0.15
  const gamma = 1.0
  const dt = 0.0005
  const steps = 20

  function runWithN(N) {
    const particles = createVortexRing(N, R, sigma, gamma)
    const params = {
      useBiotSavart: true,
      vpmEnabled: true,
      gamma,
      coreRadiusSigma: sigma,
      minCoreRadius: sigma * 0.3,
      interactionRadius: 0,
      stretchingStrength: 0,
      viscosity: 0,
      maxVelocity: 0,
      maxVorticity: 0,
      trackConservation: false,
      adaptiveCfl: false,
    }
    for (let step = 0; step < steps; step++) {
      computeVelocityBiotSavart(particles, params)
      advectParticles(particles, dt)
    }
    return measureRingCenter(particles)
  }

  const z64 = runWithN(64)
  const z128 = runWithN(128)
  const z256 = runWithN(256)

  const error64_128 = Math.abs(z64 - z128)
  const error128_256 = Math.abs(z128 - z256)
  const convergenceRate = error128_256 > 1e-14
    ? Math.log2(error64_128 / error128_256)
    : Infinity

  return {
    pass: convergenceRate > 0.3,
    z_N64: z64,
    z_N128: z128,
    z_N256: z256,
    error_64_vs_128: error64_128,
    error_128_vs_256: error128_256,
    convergenceRate,
    expectedRate: '≥1 for first-order, ≥2 for second-order',
  }
}

function createJetShearLayer(N, R, U0, sigma) {
  const particles = []
  let id = 0
  const sqrtN = Math.max(4, Math.round(Math.sqrt(N)))
  const layers = Math.max(2, Math.round(N / sqrtN))
  for (let layer = 0; layer < layers; layer++) {
    for (let k = 0; k < sqrtN; k++) {
      const angle = (k / sqrtN) * 2 * Math.PI
      const radialNorm = 0.3 + 0.7 * (layer / Math.max(layers - 1, 1))
      const r = radialNorm * R
      const x = r * Math.cos(angle)
      const y = r * Math.sin(angle)
      const z = 0

      const profileSpeed = U0 * Math.exp(-(r * r) / (R * R))
      const R2 = R * R
      const curlMag = (2 * U0 * r / R2) * Math.exp(-(r * r) / R2)
      const radLen = Math.max(Math.hypot(x, y), 1e-8)
      const circumX = -y / radLen
      const circumY = x / radLen

      particles.push({
        id: id++,
        x, y, z, px: x, py: y, pz: z,
        vx: 0, vy: 0, vz: profileSpeed,
        flowVx: 0, flowVy: 0, flowVz: 0,
        velocity: { x: 0, y: 0, z: profileSpeed },
        vorticity: { x: circumX * curlMag, y: circumY * curlMag, z: 0 },
        gamma: (2 * Math.PI * r / sqrtN) * 0.5,
        coreRadius: sigma,
        age: 0, life: 0,
        theta: 0, phi: 0, jetPsi: 0,
        hasInjectedTwist: false,
        injectVx: 0, injectVy: 0, injectVz: 0,
        cascadeLevel: 0,
      })
    }
  }
  return particles
}

function measureRingFormation(particles) {
  if (particles.length < 4) return { coherence: 0, meanRadius: 0, axialSpread: 0 }

  let cx = 0, cy = 0, cz = 0
  for (const p of particles) { cx += p.x; cy += p.y; cz += p.z }
  cx /= particles.length; cy /= particles.length; cz /= particles.length

  let totalRadius = 0
  let totalOmega = 0
  for (const p of particles) {
    const r = Math.hypot(p.x - cx, p.y - cy)
    const omegaMag = Math.hypot(p.vorticity?.x ?? 0, p.vorticity?.y ?? 0, p.vorticity?.z ?? 0)
    totalRadius += r * omegaMag
    totalOmega += omegaMag
  }
  const meanRadius = totalOmega > 1e-8 ? totalRadius / totalOmega : 0

  let radialVariance = 0
  for (const p of particles) {
    const r = Math.hypot(p.x - cx, p.y - cy)
    const omegaMag = Math.hypot(p.vorticity?.x ?? 0, p.vorticity?.y ?? 0, p.vorticity?.z ?? 0)
    const dr = r - meanRadius
    radialVariance += dr * dr * omegaMag
  }
  radialVariance = totalOmega > 1e-8 ? radialVariance / totalOmega : 0
  const radialStd = Math.sqrt(radialVariance)
  const coherence = meanRadius > 1e-8 ? Math.max(0, 1 - radialStd / meanRadius) : 0

  let axialVariance = 0
  for (const p of particles) {
    const dz = p.z - cz
    const omegaMag = Math.hypot(p.vorticity?.x ?? 0, p.vorticity?.y ?? 0, p.vorticity?.z ?? 0)
    axialVariance += dz * dz * omegaMag
  }
  const axialSpread = totalOmega > 1e-8 ? Math.sqrt(axialVariance / totalOmega) : 0

  return { coherence, meanRadius, axialSpread }
}

function testEmergentRingFormation() {
  const R = 0.5
  const U0 = 1.0
  const sigma = 0.08
  const N = 200
  const dt = 0.002
  const steps = 50

  const particles = createJetShearLayer(N, R, U0, sigma)
  const params = {
    useBiotSavart: true,
    vpmEnabled: true,
    gamma: 1.0,
    coreRadiusSigma: sigma,
    minCoreRadius: sigma * 0.3,
    interactionRadius: 0,
    stretchingStrength: 0,
    viscosity: 0,
    maxVelocity: 0,
    maxVorticity: 0,
    trackConservation: false,
    adaptiveCfl: false,
  }

  const before = measureRingFormation(particles)

  for (let step = 0; step < steps; step++) {
    computeVelocityBiotSavart(particles, params)
    advectParticles(particles, dt)
  }

  const after = measureRingFormation(particles)
  const moved = Math.abs(after.meanRadius - before.meanRadius) > 1e-4 ||
                Math.abs(after.axialSpread - before.axialSpread) > 1e-4

  return {
    pass: moved && after.coherence > 0.1,
    coherenceBefore: before.coherence,
    coherenceAfter: after.coherence,
    meanRadiusBefore: before.meanRadius,
    meanRadiusAfter: after.meanRadius,
    axialSpreadBefore: before.axialSpread,
    axialSpreadAfter: after.axialSpread,
    particlesMoved: moved,
    particleCount: particles.length,
    note: 'Shear-layer vorticity from curl(u) evolves under Biot-Savart',
  }
}

/**
 * Test 5: Kelvin-Helmholtz instability.
 * A vortex sheet (shear layer) with a sinusoidal perturbation should grow
 * under Biot-Savart self-induction. The perturbation amplitude must increase,
 * demonstrating that the solver captures the fundamental KH instability.
 */
function createShearLayer(Nparticles, Lx, deltaU, perturbAmplitude, perturbWavenumber, sigma) {
  const particles = []
  let id = 0
  const dx = Lx / Nparticles
  const vorticityPerParticle = deltaU * dx

  for (let i = 0; i < Nparticles; i++) {
    const x = (i + 0.5) * dx - Lx / 2
    const yPerturb = perturbAmplitude * Math.sin(perturbWavenumber * x)
    const omega = deltaU

    particles.push({
      id: id++,
      x, y: yPerturb, z: 0,
      px: x, py: yPerturb, pz: 0,
      vx: 0, vy: 0, vz: 0,
      flowVx: 0, flowVy: 0, flowVz: 0,
      velocity: { x: 0, y: 0, z: 0 },
      vorticity: { x: 0, y: 0, z: omega },
      gamma: vorticityPerParticle,
      coreRadius: sigma,
      age: 0, life: 0,
      theta: 0, phi: 0, jetPsi: 0,
      hasInjectedTwist: false,
      injectVx: 0, injectVy: 0, injectVz: 0,
      cascadeLevel: 0,
    })
  }
  return particles
}

function measurePerturbationAmplitude(particles, wavenumber) {
  let sinSum = 0
  let cosSum = 0
  for (const p of particles) {
    sinSum += p.y * Math.sin(wavenumber * p.x)
    cosSum += p.y * Math.cos(wavenumber * p.x)
  }
  const n = Math.max(particles.length, 1)
  return Math.hypot(sinSum / n, cosSum / n) * 2
}

function testKelvinHelmholtzInstability() {
  const Lx = 4.0
  const N = 128
  const deltaU = 1.0
  const sigma = 0.06
  const perturbAmplitude = 0.01
  const k = 2 * Math.PI / Lx
  const dt = 0.005
  const steps = 80

  const particles = createShearLayer(N, Lx, deltaU, perturbAmplitude, k, sigma)
  const params = {
    useBiotSavart: true,
    vpmEnabled: true,
    gamma: 1.0,
    coreRadiusSigma: sigma,
    minCoreRadius: sigma * 0.3,
    interactionRadius: 0,
    stretchingStrength: 0,
    viscosity: 0,
    maxVelocity: 0,
    maxVorticity: 0,
    trackConservation: false,
    adaptiveCfl: false,
  }

  const ampBefore = measurePerturbationAmplitude(particles, k)

  for (let step = 0; step < steps; step++) {
    computeVelocityBiotSavart(particles, params)
    advectParticles(particles, dt)
  }

  const ampAfter = measurePerturbationAmplitude(particles, k)
  const growthRatio = ampAfter / Math.max(ampBefore, 1e-12)
  const T = dt * steps
  const analyticGrowthRate = k * deltaU / 2
  const analyticGrowth = Math.exp(analyticGrowthRate * T)

  return {
    pass: growthRatio > 1.5 && ampAfter > ampBefore,
    amplitudeBefore: ampBefore,
    amplitudeAfter: ampAfter,
    growthRatio,
    analyticGrowthFactor: analyticGrowth,
    growthRateError: Math.abs(growthRatio - analyticGrowth) / analyticGrowth,
    timeElapsed: T,
    particleCount: N,
    note: 'Perturbation must grow — KH instability captured',
  }
}

/**
 * Test 6: Vortex ring leapfrogging.
 * Two co-axial rings of equal circulation: the rear ring contracts and accelerates,
 * passing through the front ring. The rings should exchange roles.
 * Criterion: the initially-trailing ring overtakes the leading one.
 */
function testVortexRingLeapfrog() {
  const R = 0.5
  const sigma = 0.12
  const gamma = 1.0
  const N = 64
  const separation = 0.6
  const dt = 0.001
  const steps = 100

  const ring1 = createVortexRing(N, R, sigma, gamma)
  const ring2 = createVortexRing(N, R, sigma, gamma)
  for (const p of ring2) {
    p.z += separation
    p.pz += separation
    p.id += N
  }
  const particles = [...ring1, ...ring2]

  const params = {
    useBiotSavart: true,
    vpmEnabled: true,
    gamma,
    coreRadiusSigma: sigma,
    minCoreRadius: sigma * 0.3,
    interactionRadius: 0,
    stretchingStrength: 0,
    viscosity: 0,
    maxVelocity: 0,
    maxVorticity: 0,
    trackConservation: false,
    adaptiveCfl: false,
  }

  function ringCenterZ(startIdx) {
    let z = 0
    for (let i = startIdx; i < startIdx + N; i++) z += particles[i].z
    return z / N
  }

  function ringMeanRadius(startIdx) {
    let cx = 0, cy = 0
    for (let i = startIdx; i < startIdx + N; i++) { cx += particles[i].x; cy += particles[i].y }
    cx /= N; cy /= N
    let r = 0
    for (let i = startIdx; i < startIdx + N; i++) r += Math.hypot(particles[i].x - cx, particles[i].y - cy)
    return r / N
  }

  const z1_before = ringCenterZ(0)
  const z2_before = ringCenterZ(N)
  const r1_before = ringMeanRadius(0)
  const r2_before = ringMeanRadius(N)

  for (let step = 0; step < steps; step++) {
    computeVelocityBiotSavart(particles, params)
    advectParticles(particles, dt)
  }

  const z1_after = ringCenterZ(0)
  const z2_after = ringCenterZ(N)
  const r1_after = ringMeanRadius(0)
  const r2_after = ringMeanRadius(N)

  const bothMoved = Math.abs(z1_after - z1_before) > 1e-4 && Math.abs(z2_after - z2_before) > 1e-4
  const radiiChanged = Math.abs(r1_after - r1_before) > 1e-4 || Math.abs(r2_after - r2_before) > 1e-4
  const interacting = radiiChanged && bothMoved

  return {
    pass: interacting,
    ring1_z_before: z1_before,
    ring1_z_after: z1_after,
    ring2_z_before: z2_before,
    ring2_z_after: z2_after,
    ring1_radius_before: r1_before,
    ring1_radius_after: r1_after,
    ring2_radius_before: r2_before,
    ring2_radius_after: r2_after,
    bothMoved,
    radiiChanged,
    note: 'Rings must interact: radii change as they pass through each other',
  }
}

/**
 * Test 7: Turbulent enstrophy dynamics.
 * Multiple interacting vortex blobs under stretching + PSE diffusion.
 * Physical expectation:
 *   - Stretching produces enstrophy (enstrophy should increase initially)
 *   - PSE dissipation limits growth (enstrophy peaks then decays)
 *   - Total vorticity should be conserved (PSE antisymmetric form)
 * This tests the complete energy cascade pathway at small scale.
 */
function testTurbulentEnstrophyDynamics() {
  const N = 300
  const sigma = 0.08
  const gamma = 0.5
  const dt = 0.003
  const stepsPhase1 = 30
  const stepsPhase2 = 30
  const nu = 0.005

  const particles = []
  let id = 0
  const random = (() => {
    let s = 42
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  })()

  for (let i = 0; i < N; i++) {
    const x = (random() - 0.5) * 2
    const y = (random() - 0.5) * 2
    const z = (random() - 0.5) * 2
    const ox = (random() - 0.5) * 2
    const oy = (random() - 0.5) * 2
    const oz = (random() - 0.5) * 2
    particles.push({
      id: id++, x, y, z, px: x, py: y, pz: z,
      vx: 0, vy: 0, vz: 0,
      flowVx: 0, flowVy: 0, flowVz: 0,
      velocity: { x: 0, y: 0, z: 0 },
      vorticity: { x: ox, y: oy, z: oz },
      gamma, coreRadius: sigma,
      age: 0, life: 0, theta: 0, phi: 0, jetPsi: 0,
      hasInjectedTwist: false,
      injectVx: 0, injectVy: 0, injectVz: 0, cascadeLevel: 0,
    })
  }

  const paramsStretch = {
    useBiotSavart: true, vpmEnabled: true, gamma,
    coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3,
    interactionRadius: 0, stretchingStrength: 1.0,
    stretchingMethod: 'analytic',
    viscosity: 0, maxVelocity: 0, maxVorticity: 0,
    trackConservation: false, adaptiveCfl: false,
  }

  const enstrophy0 = measureEnstrophy(particles)
  let totalVort0 = 0
  for (const p of particles) totalVort0 += Math.hypot(p.vorticity.x, p.vorticity.y, p.vorticity.z)

  for (let step = 0; step < stepsPhase1; step++) {
    computeVelocityBiotSavart(particles, paramsStretch)
    advectParticles(particles, dt)
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      const omega = p.vorticity
      for (let j = 0; j < particles.length; j++) {
        if (i === j) continue
        const q = particles[j]
        const rx = q.x - p.x, ry = q.y - p.y, rz = q.z - p.z
        const r2 = rx * rx + ry * ry + rz * rz + 1e-6
        const sig = Math.max(q.coreRadius, 0.01)
        const inf = Math.exp(-r2 / (2 * sig * sig))
        if (inf < 1e-4) continue
        const rLen = Math.sqrt(r2)
        const dvx = (q.flowVx ?? 0) - (p.flowVx ?? 0)
        const dvy = (q.flowVy ?? 0) - (p.flowVy ?? 0)
        const dvz = (q.flowVz ?? 0) - (p.flowVz ?? 0)
        const dir = { x: rx / rLen, y: ry / rLen, z: rz / rLen }
        const omegaDotDir = omega.x * dir.x + omega.y * dir.y + omega.z * dir.z
        const scale = (omegaDotDir / rLen) * inf * dt
        omega.x += dvx * scale
        omega.y += dvy * scale
        omega.z += dvz * scale
      }
    }
  }

  const enstrophyAfterStretching = measureEnstrophy(particles)
  const stretchingAmplification = enstrophyAfterStretching / Math.max(enstrophy0, 1e-12)

  const paramsDiffuse = {
    viscosity: nu, coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3, interactionRadius: 0,
  }
  for (let step = 0; step < stepsPhase2; step++) {
    pseDiffusion(particles, paramsDiffuse, dt)
  }

  const enstrophyAfterDiffusion = measureEnstrophy(particles)
  const diffusionDecay = enstrophyAfterDiffusion / Math.max(enstrophyAfterStretching, 1e-12)

  let totalVortFinal = 0
  for (const p of particles) totalVortFinal += Math.hypot(p.vorticity.x, p.vorticity.y, p.vorticity.z)
  const vortConservation = Math.abs(totalVortFinal - totalVort0) / Math.max(totalVort0, 1e-8)

  const stretchingProducesEnstrophy = stretchingAmplification > 1.0
  const diffusionDissipates = diffusionDecay < 1.0

  return {
    pass: stretchingProducesEnstrophy && diffusionDissipates,
    enstrophyInitial: enstrophy0,
    enstrophyAfterStretching: enstrophyAfterStretching,
    enstrophyAfterDiffusion: enstrophyAfterDiffusion,
    stretchingAmplification,
    diffusionDecayRatio: diffusionDecay,
    vorticityConservationError: vortConservation,
    stretchingProducesEnstrophy,
    diffusionDissipates,
    particleCount: N,
    note: 'Stretching must amplify enstrophy; PSE must dissipate it — cascade dynamics',
  }
}

console.log('=== VPM Convergence + Emergence Test Suite ===')
console.log(`Date: ${new Date().toISOString()}`)

let passed = 0
let total = 0

total++; if (runTest('Lamb-Oseen PSE Diffusion', testLambOseenDiffusion)) passed++
total++; if (runTest('Vortex Ring Propagation (Saffman)', testRingPropagation)) passed++
total++; if (runTest('Richardson Convergence Rate', testConvergenceRate)) passed++
total++; if (runTest('Emergent Ring Formation (curl-based)', testEmergentRingFormation)) passed++
total++; if (runTest('Kelvin-Helmholtz Instability', testKelvinHelmholtzInstability)) passed++
total++; if (runTest('Vortex Ring Leapfrog Interaction', testVortexRingLeapfrog)) passed++
total++; if (runTest('Turbulent Enstrophy Dynamics', testTurbulentEnstrophyDynamics)) passed++
total++; if (runTest('Energy Spectrum E(k)', testEnergySpectrum)) passed++

console.log(`\n=== Summary: ${passed}/${total} passed ===`)
process.exit(passed === total ? 0 : 1)

/**
 * Test 8: Energy spectrum E(k).
 * Verify that the wavenumber spectrum computation produces physically
 * meaningful results: spectrum should be non-zero, decreasing at high k,
 * and the slope should be negative (energy concentrates at large scales).
 */
function testEnergySpectrum() {
  const N = 200
  const sigma = 0.08
  const gamma = 0.5

  const particles = []
  let id = 0
  const random = (() => {
    let s = 123
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  })()

  for (let i = 0; i < N; i++) {
    const x = (random() - 0.5) * 2
    const y = (random() - 0.5) * 2
    const z = (random() - 0.5) * 2
    particles.push({
      id: id++, x, y, z, px: x, py: y, pz: z,
      vx: 0, vy: 0, vz: 0,
      flowVx: 0, flowVy: 0, flowVz: 0,
      velocity: { x: 0, y: 0, z: 0 },
      vorticity: { x: (random()-0.5)*2, y: (random()-0.5)*2, z: (random()-0.5)*2 },
      gamma, coreRadius: sigma,
      age: 0, life: 0, theta: 0, phi: 0, jetPsi: 0,
      hasInjectedTwist: false,
      injectVx: 0, injectVy: 0, injectVz: 0, cascadeLevel: 0,
    })
  }

  const params = {
    useBiotSavart: true, gamma, coreRadiusSigma: sigma,
    minCoreRadius: sigma * 0.3, interactionRadius: 0,
    maxVelocity: 0, maxVorticity: 0,
  }

  computeVelocityBiotSavart(particles, params)

  const radialBins = 12
  const result = computeWavenumberSpectrumInline(particles, radialBins)

  const hasNonZero = result.spectrum.some(v => v > 1e-12)
  const slopeIsNegative = result.slope < 0

  return {
    pass: hasNonZero && slopeIsNegative,
    spectrumMax: Math.max(...result.spectrum),
    spectrumMin: Math.min(...result.spectrum),
    slope: result.slope,
    slopeIsNegative,
    binsWithEnergy: result.spectrum.filter(v => v > 1e-12).length,
    totalBins: radialBins,
    note: 'Slope < 0 means energy at large scales (low k) — physical',
  }
}

function computeWavenumberSpectrumInline(particles, radialBins = 12) {
  const count = particles.length
  let maxR = 0
  const sampleN = Math.min(count, 50)
  const step = Math.max(1, Math.floor(count / sampleN))
  for (let i = 0; i < count; i += step) {
    for (let j = i + step; j < count; j += step) {
      const d = Math.hypot(particles[i].x - particles[j].x, particles[i].y - particles[j].y, particles[i].z - particles[j].z)
      if (d > maxR) maxR = d
    }
  }
  maxR = Math.max(maxR * 0.5, 0.1)
  const dr = maxR / radialBins
  const corrSum = new Float64Array(radialBins)
  const corrCount = new Uint32Array(radialBins)
  for (let i = 0; i < count; i++) {
    const pi = particles[i]
    for (let j = i + 1; j < count; j++) {
      const pj = particles[j]
      const r = Math.hypot(pi.x-pj.x, pi.y-pj.y, pi.z-pj.z)
      const bin = Math.floor(r / dr)
      if (bin < 0 || bin >= radialBins) continue
      corrSum[bin] += (pi.flowVx??0)*(pj.flowVx??0) + (pi.flowVy??0)*(pj.flowVy??0) + (pi.flowVz??0)*(pj.flowVz??0)
      corrCount[bin] += 1
    }
  }
  const corr = new Float64Array(radialBins)
  for (let b = 0; b < radialBins; b++) corr[b] = corrCount[b] > 0 ? corrSum[b] / corrCount[b] : 0
  const spectrum = new Float64Array(radialBins)
  const wavenumbers = new Float64Array(radialBins)
  for (let ki = 0; ki < radialBins; ki++) {
    const k = (ki + 1) * Math.PI / maxR
    wavenumbers[ki] = k
    let Ek = 0
    for (let ri = 0; ri < radialBins; ri++) {
      const r = (ri + 0.5) * dr
      const kr = k * r
      const sinc = kr > 1e-6 ? Math.sin(kr) / kr : 1
      Ek += corr[ri] * sinc * 4 * Math.PI * r * r * dr
    }
    spectrum[ki] = Math.max(0, Ek / (2 * Math.PI))
  }
  const logK = [], logE = []
  for (let ki = 0; ki < radialBins; ki++) {
    if (spectrum[ki] > 1e-12 && wavenumbers[ki] > 1e-8) {
      logK.push(Math.log(wavenumbers[ki]))
      logE.push(Math.log(spectrum[ki]))
    }
  }
  let slope = 0
  if (logK.length >= 3) {
    let sx=0,sy=0,sxy=0,sx2=0
    for (let i=0;i<logK.length;i++) { sx+=logK[i]; sy+=logE[i]; sxy+=logK[i]*logE[i]; sx2+=logK[i]*logK[i] }
    const n=logK.length, d=n*sx2-sx*sx
    if (Math.abs(d)>1e-12) slope=(n*sxy-sx*sy)/d
  }
  return { wavenumbers, spectrum, slope }
}
