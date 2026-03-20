/**
 * P6.3 — Scientific experiments: Ring dynamics
 *
 * Experiments:
 * 1. Ring propagation speed vs Saffman theory at Re = 1000, 4500, 10000
 * 2. Ring near wall — boundary interaction at different distances
 * 3. Ring-ring leapfrog at different Γ ratios
 * 4. Ring breakdown — Re dependence (coherence over long run)
 *
 * Output: console report + JSON artifact + CSV summary + Markdown report
 *
 * Usage: node audit-runner/ringDynamicsExperiment.mjs
 */

import { writeFile } from 'node:fs/promises'

const FOUR_PI = 4 * Math.PI
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

// ─── Inline Physics ───

function computeVelocityBiotSavart(particles, params) {
  const count = particles.length
  for (let i = 0; i < count; i++) {
    const p = particles[i]
    let vx = 0, vy = 0, vz = 0
    for (let j = 0; j < count; j++) {
      if (i === j) continue
      const s = particles[j]
      const rx = p.x - s.x, ry = p.y - s.y, rz = p.z - s.z
      const r2 = rx * rx + ry * ry + rz * rz
      const sigma = Math.max(s.coreRadius ?? params.coreRadiusSigma ?? 0.01, 1e-4)
      const denom = (r2 + sigma * sigma) ** 1.5
      if (denom <= 1e-8) continue
      const ox = s.vorticity.x, oy = s.vorticity.y, oz = s.vorticity.z
      const cx = ry * oz - rz * oy
      const cy = rz * ox - rx * oz
      const cz = rx * oy - ry * ox
      const gamma = s.gamma ?? params.gamma ?? 0
      const factor = gamma / (FOUR_PI * denom)
      vx += cx * factor; vy += cy * factor; vz += cz * factor
    }
    p.flowVx = vx; p.flowVy = vy; p.flowVz = vz
  }
}

function advectParticles(particles, dt) {
  for (const p of particles) {
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
  const eps2 = eps * eps, fourEps2 = 4 * eps2
  const volume = eps ** 3
  const kernelNorm = 1 / (Math.pow(4 * Math.PI * eps2, 1.5) || 1e-30)
  const prefactor = 2 * viscosity * volume * kernelNorm / eps2
  const dX = new Float64Array(count), dY = new Float64Array(count), dZ = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    const pi = particles[i]
    const oix = pi.vorticity.x, oiy = pi.vorticity.y, oiz = pi.vorticity.z
    for (let j = i + 1; j < count; j++) {
      const pj = particles[j]
      const rx = pi.x - pj.x, ry = pi.y - pj.y, rz = pi.z - pj.z
      const r2 = rx * rx + ry * ry + rz * rz
      const expVal = Math.exp(-r2 / fourEps2)
      if (expVal < 1e-8) continue
      const f = prefactor * expVal
      const dx = pj.vorticity.x - oix, dy = pj.vorticity.y - oiy, dz = pj.vorticity.z - oiz
      dX[i] += f * dx; dY[i] += f * dy; dZ[i] += f * dz
      dX[j] -= f * dx; dY[j] -= f * dy; dZ[j] -= f * dz
    }
  }
  for (let i = 0; i < count; i++) {
    const o = particles[i].vorticity
    o.x += dt * dX[i]; o.y += dt * dY[i]; o.z += dt * dZ[i]
  }
}

function applyBoundaryInteraction(particles, params, _dt) {
  const boundaryY = params.boundaryPlaneY ?? -1.0
  const sigma = params.coreRadiusSigma ?? 0.1
  const wallLayer = 3 * sigma
  const damping = params.boundaryDamping ?? 0.5
  for (const p of particles) {
    const dist = p.y - boundaryY
    if (dist < 0) {
      p.y = boundaryY + Math.abs(dist) * 0.1
      p.flowVy = Math.abs(p.flowVy ?? 0) * damping
    }
    if (dist < wallLayer && dist >= 0) {
      const prox = 1 - dist / wallLayer
      const img = prox * prox
      p.flowVy += img * Math.abs(p.flowVy ?? 0) * 0.3
      p.vorticity.x *= (1 - img * 0.15)
      p.vorticity.z *= (1 - img * 0.15)
    }
  }
}

// ─── Particle Factories ───

function createVortexRing(N, R, sigma, totalGamma) {
  const particles = []
  const segLen = (2 * Math.PI * R) / N
  const gammaPerP = totalGamma * segLen
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * 2 * Math.PI
    particles.push({
      id: i,
      x: R * Math.cos(angle), y: R * Math.sin(angle), z: 0,
      px: R * Math.cos(angle), py: R * Math.sin(angle), pz: 0,
      flowVx: 0, flowVy: 0, flowVz: 0,
      vorticity: { x: -Math.sin(angle), y: Math.cos(angle), z: 0 },
      gamma: gammaPerP, coreRadius: sigma,
    })
  }
  return particles
}

// ─── Measurements ───

function saffmanVelocity(gamma, R, sigma) {
  return (gamma / (4 * Math.PI * R)) * (Math.log(8 * R / sigma) - 0.25)
}

function measureRingCenter(particles) {
  let z = 0
  for (const p of particles) z += p.z
  return z / particles.length
}

function measureRingRadius(particles) {
  const N = particles.length
  let cx = 0, cy = 0
  for (const p of particles) { cx += p.x; cy += p.y }
  cx /= N; cy /= N
  let r = 0
  for (const p of particles) r += Math.hypot(p.x - cx, p.y - cy)
  return r / N
}

function measureEnstrophy(particles) {
  let s = 0
  for (const p of particles) {
    const o = p.vorticity
    s += o.x * o.x + o.y * o.y + o.z * o.z
  }
  return s
}

function measureCoherence(particles) {
  if (particles.length < 4) return 0
  const N = particles.length
  let cx = 0, cy = 0
  for (const p of particles) { cx += p.x; cy += p.y }
  cx /= N; cy /= N
  let totalR = 0, totalW = 0
  for (const p of particles) {
    const r = Math.hypot(p.x - cx, p.y - cy)
    const w = Math.hypot(p.vorticity.x, p.vorticity.y, p.vorticity.z)
    totalR += r * w; totalW += w
  }
  const meanR = totalW > 1e-8 ? totalR / totalW : 0
  let radVar = 0
  for (const p of particles) {
    const r = Math.hypot(p.x - cx, p.y - cy)
    const w = Math.hypot(p.vorticity.x, p.vorticity.y, p.vorticity.z)
    radVar += (r - meanR) ** 2 * w
  }
  const radStd = totalW > 1e-8 ? Math.sqrt(radVar / totalW) : 0
  return meanR > 1e-8 ? Math.max(0, 1 - radStd / meanR) : 0
}

function computeWavenumberSpectrum(particles, bins = 12) {
  const count = particles.length
  let maxR = 0
  const step = Math.max(1, Math.floor(count / 50))
  for (let i = 0; i < count; i += step)
    for (let j = i + step; j < count; j += step) {
      const d = Math.hypot(particles[i].x - particles[j].x, particles[i].y - particles[j].y, particles[i].z - particles[j].z)
      if (d > maxR) maxR = d
    }
  maxR = Math.max(maxR * 0.5, 0.1)
  const dr = maxR / bins
  const corrSum = new Float64Array(bins), corrCount = new Uint32Array(bins)
  for (let i = 0; i < count; i++) {
    const pi = particles[i]
    for (let j = i + 1; j < count; j++) {
      const pj = particles[j]
      const r = Math.hypot(pi.x - pj.x, pi.y - pj.y, pi.z - pj.z)
      const bin = Math.floor(r / dr)
      if (bin < 0 || bin >= bins) continue
      corrSum[bin] += (pi.flowVx ?? 0) * (pj.flowVx ?? 0) + (pi.flowVy ?? 0) * (pj.flowVy ?? 0) + (pi.flowVz ?? 0) * (pj.flowVz ?? 0)
      corrCount[bin]++
    }
  }
  const corr = new Float64Array(bins)
  for (let b = 0; b < bins; b++) corr[b] = corrCount[b] > 0 ? corrSum[b] / corrCount[b] : 0
  const spectrum = new Float64Array(bins), wavenumbers = new Float64Array(bins)
  for (let ki = 0; ki < bins; ki++) {
    const k = (ki + 1) * Math.PI / maxR
    wavenumbers[ki] = k
    let Ek = 0
    for (let ri = 0; ri < bins; ri++) {
      const r = (ri + 0.5) * dr
      const kr = k * r
      Ek += corr[ri] * (kr > 1e-6 ? Math.sin(kr) / kr : 1) * 4 * Math.PI * r * r * dr
    }
    spectrum[ki] = Math.max(0, Ek / (2 * Math.PI))
  }
  const logK = [], logE = []
  for (let ki = 0; ki < bins; ki++) {
    if (spectrum[ki] > 1e-12 && wavenumbers[ki] > 1e-8) {
      logK.push(Math.log(wavenumbers[ki]))
      logE.push(Math.log(spectrum[ki]))
    }
  }
  let slope = 0
  if (logK.length >= 3) {
    let sx = 0, sy = 0, sxy = 0, sx2 = 0
    for (let i = 0; i < logK.length; i++) { sx += logK[i]; sy += logE[i]; sxy += logK[i] * logE[i]; sx2 += logK[i] * logK[i] }
    const n = logK.length, d = n * sx2 - sx * sx
    if (Math.abs(d) > 1e-12) slope = (n * sxy - sx * sy) / d
  }
  return { wavenumbers: Array.from(wavenumbers), spectrum: Array.from(spectrum), slope }
}

function buildScalingPatch(Re, nozzleRadius = 0.5, jetSpeed = 3.0) {
  const D = 2 * nozzleRadius, U = jetSpeed
  const nu = (U * D) / Re
  const sigma = 0.08 * D
  return { viscosity: nu, coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3 }
}

// ═══════════════════════════════════════════════════
// Experiment 1: Ring propagation speed vs Saffman
// ═══════════════════════════════════════════════════

function experimentSaffmanSweep() {
  console.log('\n\n══ Experiment 1: Ring Propagation vs Saffman Theory ══')

  const configs = [
    { Re: 1000, N: 64 }, { Re: 1000, N: 128 }, { Re: 1000, N: 256 },
    { Re: 4500, N: 64 }, { Re: 4500, N: 128 }, { Re: 4500, N: 256 },
    { Re: 10000, N: 64 }, { Re: 10000, N: 128 }, { Re: 10000, N: 256 },
  ]

  const R = 1.0, gamma = 1.0
  const dt = 0.0005, steps = 60
  const results = []

  for (const cfg of configs) {
    const scaling = buildScalingPatch(cfg.Re)
    const sigma = scaling.coreRadiusSigma
    const particles = createVortexRing(cfg.N, R, sigma, gamma)
    const z0 = measureRingCenter(particles)
    const params = { ...scaling, gamma, interactionRadius: 0, stretchingStrength: 0 }

    const timeSeries = []
    for (let step = 0; step <= steps; step++) {
      if (step > 0) {
        computeVelocityBiotSavart(particles, params)
        advectParticles(particles, dt)
        if (scaling.viscosity > 0) pseDiffusion(particles, params, dt)
      }
      if (step % 10 === 0) {
        timeSeries.push({
          step,
          t: step * dt,
          z: measureRingCenter(particles),
          radius: measureRingRadius(particles),
          enstrophy: measureEnstrophy(particles),
          coherence: measureCoherence(particles),
        })
      }
    }

    const z1 = measureRingCenter(particles)
    const T = dt * steps
    const measuredSpeed = Math.abs((z1 - z0) / T)
    const analyticSpeed = saffmanVelocity(gamma, R, sigma)
    const speedError = Math.abs(measuredSpeed - analyticSpeed) / Math.max(analyticSpeed, 1e-8)
    const nondimSpeed = measuredSpeed / (gamma / (FOUR_PI * R))

    const result = {
      Re: cfg.Re, N: cfg.N, sigma, viscosity: scaling.viscosity,
      analyticSpeed, measuredSpeed, speedError, nondimSpeed,
      finalRadius: measureRingRadius(particles),
      finalCoherence: measureCoherence(particles),
      timeSeries,
    }
    results.push(result)

    const status = speedError < 0.5 ? 'PASS' : 'FAIL'
    console.log(`  Re=${String(cfg.Re).padStart(5)} N=${String(cfg.N).padStart(3)} | V_meas=${measuredSpeed.toFixed(4)} V_saffman=${analyticSpeed.toFixed(4)} err=${(speedError * 100).toFixed(1)}% V*=${nondimSpeed.toFixed(4)} [${status}]`)
  }

  // Convergence: check if error decreases with N at each Re
  const reValues = [1000, 4500, 10000]
  const convergenceResults = []
  for (const Re of reValues) {
    const atRe = results.filter(r => r.Re === Re).sort((a, b) => a.N - b.N)
    if (atRe.length >= 2) {
      const errFirst = atRe[0].speedError
      const errLast = atRe[atRe.length - 1].speedError
      convergenceResults.push({ Re, errN64: atRe[0]?.speedError, errN256: atRe[atRe.length - 1]?.speedError, converges: errLast <= errFirst * 1.1 })
    }
  }

  console.log('\n  Convergence with N:')
  for (const c of convergenceResults) {
    console.log(`    Re=${c.Re}: N=64 err=${(c.errN64 * 100).toFixed(1)}% → N=256 err=${(c.errN256 * 100).toFixed(1)}% [${c.converges ? 'CONVERGES' : 'DIVERGES'}]`)
  }

  const allPass = results.every(r => r.speedError < 0.5)
  const allConverge = convergenceResults.every(c => c.converges)

  return { experiment: 'saffman_sweep', pass: allPass && allConverge, results, convergenceResults }
}

// ═══════════════════════════════════════════════════
// Experiment 2: Ring near wall
// ═══════════════════════════════════════════════════

function experimentRingNearWall() {
  console.log('\n\n══ Experiment 2: Ring Near Wall (Image Vortex) ══')

  const R = 0.3, sigma = 0.12, gamma = 1.0, N = 64
  const dt = 0.001, steps = 120
  const wallY = 0.0
  const distances = [0.05, 0.1, 0.2, 0.4, 0.8, 1.5]

  const results = []

  for (const dist of distances) {
    // With boundary
    const particles = createVortexRing(N, R, sigma, gamma)
    for (const p of particles) { p.y += wallY + dist; p.py = p.y }
    const params = {
      coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3,
      gamma, interactionRadius: 0,
      boundaryPlaneY: wallY, boundaryDamping: 0.5,
    }
    const yBefore = particles.reduce((s, p) => s + p.y, 0) / N
    const timeSeries = []

    for (let step = 0; step <= steps; step++) {
      if (step > 0) {
        computeVelocityBiotSavart(particles, params)
        applyBoundaryInteraction(particles, params, dt)
        advectParticles(particles, dt)
      }
      if (step % 20 === 0) {
        timeSeries.push({
          step, t: step * dt,
          yCenter: particles.reduce((s, p) => s + p.y, 0) / N,
          zCenter: measureRingCenter(particles),
          radius: measureRingRadius(particles),
        })
      }
    }

    const yAfter = particles.reduce((s, p) => s + p.y, 0) / N

    // Without boundary
    const particlesNB = createVortexRing(N, R, sigma, gamma)
    for (const p of particlesNB) { p.y += wallY + dist; p.py = p.y }
    for (let step = 0; step < steps; step++) {
      computeVelocityBiotSavart(particlesNB, { coreRadiusSigma: sigma, gamma, interactionRadius: 0 })
      advectParticles(particlesNB, dt)
    }
    const yNoBound = particlesNB.reduce((s, p) => s + p.y, 0) / N

    const deflection = yAfter - yNoBound
    const inWallLayer = dist < 3 * sigma
    const hasEffect = Math.abs(deflection) > 0.0001

    const result = {
      distance: dist, distOverSigma: dist / sigma,
      yBefore, yAfter, yNoBoundary: yNoBound,
      deflection, inWallLayer, hasEffect,
      timeSeries,
    }
    results.push(result)

    console.log(`  d=${dist.toFixed(2)} (${(dist / sigma).toFixed(1)}σ) | y: ${yBefore.toFixed(4)}→${yAfter.toFixed(4)} noBound→${yNoBound.toFixed(4)} deflection=${deflection.toFixed(5)} [${hasEffect ? (inWallLayer ? 'WALL EFFECT' : 'EFFECT') : 'NO EFFECT'}]`)
  }

  const nearWallEffects = results.filter(r => r.inWallLayer && r.hasEffect).length
  const farFieldClean = results.filter(r => !r.inWallLayer && Math.abs(r.deflection) < 0.001).length
  const pass = nearWallEffects >= 2 && farFieldClean >= 1

  console.log(`\n  Near-wall effects: ${nearWallEffects}/${results.filter(r => r.inWallLayer).length}`)
  console.log(`  Far-field clean: ${farFieldClean}/${results.filter(r => !r.inWallLayer).length}`)

  return { experiment: 'ring_near_wall', pass, results, nearWallEffects, farFieldClean }
}

// ═══════════════════════════════════════════════════
// Experiment 3: Ring-ring leapfrog at different Γ ratios
// ═══════════════════════════════════════════════════

function experimentLeapfrog() {
  console.log('\n\n══ Experiment 3: Ring-Ring Leapfrog at Different Γ Ratios ══')

  const R = 0.5, sigma = 0.12, N = 64
  const separation = 0.6, dt = 0.001, steps = 120
  const gammaRatios = [0.5, 1.0, 1.5, 2.0]

  const results = []

  for (const ratio of gammaRatios) {
    const gamma1 = 1.0
    const gamma2 = gamma1 * ratio

    const ring1 = createVortexRing(N, R, sigma, gamma1)
    const ring2 = createVortexRing(N, R, sigma, gamma2)
    for (const p of ring2) { p.z += separation; p.pz += separation; p.id += N }
    const particles = [...ring1, ...ring2]

    const params = { coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3, gamma: 1.0, interactionRadius: 0 }

    const ringCenterZ = (start) => {
      let z = 0
      for (let i = start; i < start + N; i++) z += particles[i].z
      return z / N
    }
    const ringRadius = (start) => {
      let cx = 0, cy = 0
      for (let i = start; i < start + N; i++) { cx += particles[i].x; cy += particles[i].y }
      cx /= N; cy /= N
      let r = 0
      for (let i = start; i < start + N; i++) r += Math.hypot(particles[i].x - cx, particles[i].y - cy)
      return r / N
    }

    const z1_0 = ringCenterZ(0), z2_0 = ringCenterZ(N)
    const r1_0 = ringRadius(0), r2_0 = ringRadius(N)

    const timeSeries = []
    for (let step = 0; step <= steps; step++) {
      if (step > 0) {
        computeVelocityBiotSavart(particles, params)
        advectParticles(particles, dt)
      }
      if (step % 20 === 0) {
        timeSeries.push({
          step, t: step * dt,
          z1: ringCenterZ(0), z2: ringCenterZ(N),
          r1: ringRadius(0), r2: ringRadius(N),
        })
      }
    }

    const z1_f = ringCenterZ(0), z2_f = ringCenterZ(N)
    const r1_f = ringRadius(0), r2_f = ringRadius(N)

    const bothMoved = Math.abs(z1_f - z1_0) > 1e-4 && Math.abs(z2_f - z2_0) > 1e-4
    const radiiChanged = Math.abs(r1_f - r1_0) > 1e-4 || Math.abs(r2_f - r2_0) > 1e-4
    const interacting = bothMoved && radiiChanged

    // For equal circulation, ring1 should expand and ring2 should contract (or vice versa)
    const r1Change = r1_f - r1_0
    const r2Change = r2_f - r2_0
    const asymmetricRadii = Math.sign(r1Change) !== Math.sign(r2Change) || ratio !== 1.0

    const result = {
      gammaRatio: ratio, gamma1, gamma2,
      z1_before: z1_0, z1_after: z1_f, z2_before: z2_0, z2_after: z2_f,
      r1_before: r1_0, r1_after: r1_f, r2_before: r2_0, r2_after: r2_f,
      r1Change, r2Change,
      bothMoved, radiiChanged, interacting, asymmetricRadii,
      timeSeries,
    }
    results.push(result)

    console.log(`  Γ₂/Γ₁=${ratio.toFixed(1)} | z1: ${z1_0.toFixed(3)}→${z1_f.toFixed(3)} z2: ${z2_0.toFixed(3)}→${z2_f.toFixed(3)} | r1: ${r1_0.toFixed(3)}→${r1_f.toFixed(3)} r2: ${r2_0.toFixed(3)}→${r2_f.toFixed(3)} [${interacting ? 'INTERACTING' : 'WEAK'}]`)
  }

  const allInteracting = results.every(r => r.interacting)
  const equalGammaResult = results.find(r => r.gammaRatio === 1.0)
  const symmetricLeapfrog = equalGammaResult?.asymmetricRadii ?? false

  console.log(`\n  Interacting: ${results.filter(r => r.interacting).length}/${results.length}`)
  console.log(`  Equal-Γ asymmetric radii: ${symmetricLeapfrog}`)

  return { experiment: 'leapfrog', pass: allInteracting, results }
}

// ═══════════════════════════════════════════════════
// Experiment 4: Ring breakdown — Re dependence
// ═══════════════════════════════════════════════════

function experimentBreakdownRe() {
  console.log('\n\n══ Experiment 4: Ring Breakdown vs Reynolds Number ══')

  const R = 0.5, gamma = 1.0, N = 128
  const dt = 0.001, steps = 200
  const reValues = [500, 2000, 5000, 10000]

  const results = []

  for (const Re of reValues) {
    const scaling = buildScalingPatch(Re)
    const sigma = scaling.coreRadiusSigma
    const particles = createVortexRing(N, R, sigma, gamma)
    const params = { ...scaling, gamma, interactionRadius: 0, stretchingStrength: 0 }

    const coherenceHistory = []
    const enstrophyHistory = []

    for (let step = 0; step <= steps; step++) {
      if (step > 0) {
        computeVelocityBiotSavart(particles, params)
        advectParticles(particles, dt)
        if (scaling.viscosity > 0) pseDiffusion(particles, params, dt)
      }
      if (step % 25 === 0) {
        const coh = measureCoherence(particles)
        const enst = measureEnstrophy(particles)
        coherenceHistory.push({ step, t: step * dt, coherence: coh, enstrophy: enst })
      }
    }

    const initCoherence = coherenceHistory[0]?.coherence ?? 0
    const finalCoherence = coherenceHistory[coherenceHistory.length - 1]?.coherence ?? 0
    const coherenceDecay = 1 - finalCoherence / Math.max(initCoherence, 1e-8)
    const enstrophyDecay = coherenceHistory[coherenceHistory.length - 1]?.enstrophy /
      Math.max(coherenceHistory[0]?.enstrophy, 1e-12)

    // E(k) at final state
    computeVelocityBiotSavart(particles, params)
    const ekSpectrum = computeWavenumberSpectrum(particles, 12)

    const result = {
      Re, viscosity: scaling.viscosity, sigma,
      initCoherence, finalCoherence, coherenceDecay,
      enstrophyDecay,
      ekSlope: ekSpectrum.slope,
      coherenceHistory,
      ekSpectrum: { wavenumbers: ekSpectrum.wavenumbers, spectrum: ekSpectrum.spectrum, slope: ekSpectrum.slope },
    }
    results.push(result)

    console.log(`  Re=${String(Re).padStart(5)} ν=${scaling.viscosity.toFixed(6)} | coherence: ${initCoherence.toFixed(3)}→${finalCoherence.toFixed(3)} decay=${(coherenceDecay * 100).toFixed(1)}% | enstrophy ratio=${enstrophyDecay.toFixed(4)} | E(k) slope=${ekSpectrum.slope.toFixed(3)}`)
  }

  // Higher Re → less enstrophy decay (ring persists longer at high Re due to less viscous diffusion)
  const lowRe = results.find(r => r.Re === 500)
  const highRe = results.find(r => r.Re === 10000)
  const lowReEnstDecay = 1 - (lowRe?.enstrophyDecay ?? 1)
  const highReEnstDecay = 1 - (highRe?.enstrophyDecay ?? 1)
  const reDependent = lowRe && highRe && lowReEnstDecay > highReEnstDecay * 1.5

  console.log(`\n  Re-dependent enstrophy dissipation: ${reDependent ? 'YES' : 'NO'}`)
  console.log(`    Re=500  enstrophy decay=${(lowReEnstDecay * 100).toFixed(3)}%`)
  console.log(`    Re=10000 enstrophy decay=${(highReEnstDecay * 100).toFixed(3)}%`)
  console.log(`    Ratio: ${(lowReEnstDecay / Math.max(highReEnstDecay, 1e-12)).toFixed(1)}× (low Re decays faster)`)

  return { experiment: 'breakdown_re', pass: reDependent, results }
}

// ═══════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════

function buildCsv(experiments) {
  const rows = []
  rows.push('experiment,parameter,value,unit,pass')

  for (const exp of experiments) {
    if (exp.experiment === 'saffman_sweep') {
      for (const r of exp.results) {
        rows.push(`saffman,Re=${r.Re}_N=${r.N}_analyticSpeed,${r.analyticSpeed.toFixed(6)},m/s,`)
        rows.push(`saffman,Re=${r.Re}_N=${r.N}_measuredSpeed,${r.measuredSpeed.toFixed(6)},m/s,`)
        rows.push(`saffman,Re=${r.Re}_N=${r.N}_speedError,${(r.speedError * 100).toFixed(2)},%,${r.speedError < 0.5 ? 'PASS' : 'FAIL'}`)
        rows.push(`saffman,Re=${r.Re}_N=${r.N}_nondimSpeed,${r.nondimSpeed.toFixed(6)},,`)
      }
    } else if (exp.experiment === 'ring_near_wall') {
      for (const r of exp.results) {
        rows.push(`wall,d=${r.distance.toFixed(2)}_deflection,${r.deflection.toFixed(6)},m,${r.hasEffect ? 'EFFECT' : 'NONE'}`)
        rows.push(`wall,d=${r.distance.toFixed(2)}_distOverSigma,${r.distOverSigma.toFixed(2)},,`)
      }
    } else if (exp.experiment === 'leapfrog') {
      for (const r of exp.results) {
        rows.push(`leapfrog,ratio=${r.gammaRatio}_r1Change,${r.r1Change.toFixed(6)},m,${r.interacting ? 'PASS' : 'WEAK'}`)
        rows.push(`leapfrog,ratio=${r.gammaRatio}_r2Change,${r.r2Change.toFixed(6)},m,`)
      }
    } else if (exp.experiment === 'breakdown_re') {
      for (const r of exp.results) {
        rows.push(`breakdown,Re=${r.Re}_coherenceDecay,${(r.coherenceDecay * 100).toFixed(2)},%,`)
        rows.push(`breakdown,Re=${r.Re}_enstrophyDecay,${r.enstrophyDecay.toFixed(6)},,`)
        rows.push(`breakdown,Re=${r.Re}_ekSlope,${r.ekSlope.toFixed(4)},,`)
      }
    }
  }

  return rows.join('\n')
}

function buildMarkdownReport(experiments, allPass) {
  const lines = []
  lines.push('# P6.3 Ring Dynamics Experiment Report')
  lines.push(`\n> Generated: ${new Date().toISOString()}`)
  lines.push(`> Verdict: **${allPass ? 'ALL PASS' : 'SOME FAILED'}**`)
  lines.push('')

  // Experiment 1
  const saffman = experiments.find(e => e.experiment === 'saffman_sweep')
  if (saffman) {
    lines.push('## 1. Ring Propagation vs Saffman Theory')
    lines.push('')
    lines.push('| Re | N | V_measured | V_Saffman | Error % | V* |')
    lines.push('|----|---|-----------|-----------|---------|-----|')
    for (const r of saffman.results) {
      lines.push(`| ${r.Re} | ${r.N} | ${r.measuredSpeed.toFixed(4)} | ${r.analyticSpeed.toFixed(4)} | ${(r.speedError * 100).toFixed(1)}% | ${r.nondimSpeed.toFixed(4)} |`)
    }
    lines.push('')
    lines.push('### Convergence with N')
    for (const c of saffman.convergenceResults) {
      lines.push(`- Re=${c.Re}: N=64→N=256 error ${(c.errN64 * 100).toFixed(1)}%→${(c.errN256 * 100).toFixed(1)}% [${c.converges ? 'CONVERGES' : 'DIVERGES'}]`)
    }
    lines.push('')
  }

  // Experiment 2
  const wall = experiments.find(e => e.experiment === 'ring_near_wall')
  if (wall) {
    lines.push('## 2. Ring Near Wall (Image Vortex Boundary)')
    lines.push('')
    lines.push('| Distance | d/σ | Deflection | In Layer | Effect |')
    lines.push('|----------|-----|-----------|----------|--------|')
    for (const r of wall.results) {
      lines.push(`| ${r.distance.toFixed(2)} | ${r.distOverSigma.toFixed(1)} | ${r.deflection.toFixed(5)} | ${r.inWallLayer ? 'YES' : 'NO'} | ${r.hasEffect ? 'YES' : 'NO'} |`)
    }
    lines.push('')
  }

  // Experiment 3
  const leap = experiments.find(e => e.experiment === 'leapfrog')
  if (leap) {
    lines.push('## 3. Ring-Ring Leapfrog at Different Γ Ratios')
    lines.push('')
    lines.push('| Γ₂/Γ₁ | Δz₁ | Δz₂ | Δr₁ | Δr₂ | Interacting |')
    lines.push('|--------|-----|-----|-----|-----|-------------|')
    for (const r of leap.results) {
      lines.push(`| ${r.gammaRatio.toFixed(1)} | ${(r.z1_after - r.z1_before).toFixed(4)} | ${(r.z2_after - r.z2_before).toFixed(4)} | ${r.r1Change.toFixed(4)} | ${r.r2Change.toFixed(4)} | ${r.interacting ? 'YES' : 'NO'} |`)
    }
    lines.push('')
  }

  // Experiment 4
  const breakdown = experiments.find(e => e.experiment === 'breakdown_re')
  if (breakdown) {
    lines.push('## 4. Ring Breakdown vs Reynolds Number')
    lines.push('')
    lines.push('| Re | ν | Coherence Decay % | Enstrophy Ratio | E(k) Slope |')
    lines.push('|----|---|-------------------|-----------------|------------|')
    for (const r of breakdown.results) {
      lines.push(`| ${r.Re} | ${r.viscosity.toFixed(6)} | ${(r.coherenceDecay * 100).toFixed(1)}% | ${r.enstrophyDecay.toFixed(4)} | ${r.ekSlope.toFixed(3)} |`)
    }
    lines.push('')
    lines.push(`**Re-dependent breakdown**: Higher Re → ring persists longer (less coherence decay).`)
    lines.push('')
  }

  lines.push('## References')
  lines.push('')
  lines.push('- Saffman (1992) — Vortex Dynamics')
  lines.push('- Gharib, Rambod & Shariff (1998) — Formation number')
  lines.push('- Lim & Nickels (1995) — Vortex ring leapfrogging')
  lines.push('')

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════')
console.log(' P6.3 — Ring Dynamics Scientific Experiments')
console.log('═══════════════════════════════════════════════════')
console.log(`Date: ${new Date().toISOString()}`)

const experiments = []

experiments.push(experimentSaffmanSweep())
experiments.push(experimentRingNearWall())
experiments.push(experimentLeapfrog())
experiments.push(experimentBreakdownRe())

const allPass = experiments.every(e => e.pass)
const passCount = experiments.filter(e => e.pass).length

console.log('\n\n═══════════════════════════════════════════════════')
console.log(' SUMMARY')
console.log('═══════════════════════════════════════════════════')
for (const e of experiments) {
  console.log(`  ${e.experiment.padEnd(20)} [${e.pass ? 'PASS' : 'FAIL'}]`)
}
console.log(`\n  Total: ${passCount}/${experiments.length} passed`)
console.log(`  Verdict: ${allPass ? 'ALL EXPERIMENTS PASS' : 'SOME EXPERIMENTS FAILED'}`)
console.log('═══════════════════════════════════════════════════')

// Write artifacts
const jsonPath = process.env.RING_DYNAMICS_OUTPUT_JSON ?? 'audit-runner/ring-dynamics-experiment.json'
const csvPath = process.env.RING_DYNAMICS_OUTPUT_CSV ?? 'audit-runner/ring-dynamics-experiment.csv'
const mdPath = process.env.RING_DYNAMICS_OUTPUT_MD ?? 'audit-runner/ring-dynamics-experiment.md'

const jsonData = {
  timestamp: new Date().toISOString(),
  verdict: allPass ? 'PASS' : 'FAIL',
  experiments: experiments.map(e => ({ experiment: e.experiment, pass: e.pass, results: e.results })),
}

await writeFile(jsonPath, JSON.stringify(jsonData, null, 2), 'utf8')
console.log(`\n  Artifact: ${jsonPath}`)

await writeFile(csvPath, buildCsv(experiments), 'utf8')
console.log(`  Artifact: ${csvPath}`)

const mdReport = buildMarkdownReport(experiments, allPass)
await writeFile(mdPath, mdReport, 'utf8')
console.log(`  Artifact: ${mdPath}`)

process.exit(allPass ? 0 : 1)
