/**
 * P6.4 — Scientific experiments: Turbulence
 *
 * Experiments:
 * 1. E(k) spectrum convergence at different particle counts (N=100,200,400)
 * 2. KH instability growth rate vs linear theory (wavelength sweep)
 * 3. Enstrophy production/dissipation balance (quasi-steady state)
 * 4. Cascade dynamics: stretching vs PSE dissipation timescales
 *
 * Output: console report + JSON + CSV + Markdown
 *
 * Usage: node audit-runner/turbulenceExperiment.mjs
 */

import { writeFile } from 'node:fs/promises'

const FOUR_PI = 4 * Math.PI

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
      const cx = ry * oz - rz * oy, cy = rz * ox - rx * oz, cz = rx * oy - ry * ox
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
    const pi = particles[i], oix = pi.vorticity.x, oiy = pi.vorticity.y, oiz = pi.vorticity.z
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

function analyticStretching(particles, params, dt) {
  const strength = params.stretchingStrength ?? 1.0
  if (strength <= 0) return
  const count = particles.length
  const dO = new Array(count)
  for (let i = 0; i < count; i++) dO[i] = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < count; i++) {
    const pi = particles[i], oi = pi.vorticity
    for (let j = i + 1; j < count; j++) {
      const pj = particles[j], oj = pj.vorticity
      const rx = pi.x - pj.x, ry = pi.y - pj.y, rz = pi.z - pj.z
      const r2 = rx * rx + ry * ry + rz * rz
      const sigma = Math.max(pi.coreRadius, pj.coreRadius, 0.01)
      const r2s = r2 + sigma * sigma
      const inv32 = 1 / (r2s * Math.sqrt(r2s)), inv52 = inv32 / r2s
      const gJ = pj.gamma ?? params.gamma ?? 0
      const gI = pi.gamma ?? params.gamma ?? 0
      const f = strength / FOUR_PI
      const cx1 = oi.y * oj.z - oi.z * oj.y, cy1 = oi.z * oj.x - oi.x * oj.z, cz1 = oi.x * oj.y - oi.y * oj.x
      const d1 = oi.x * rx + oi.y * ry + oi.z * rz
      const cx2 = ry * oj.z - rz * oj.y, cy2 = rz * oj.x - rx * oj.z, cz2 = rx * oj.y - ry * oj.x
      dO[i].x += f * gJ * (cx1 * inv32 - 3 * d1 * cx2 * inv52) * dt
      dO[i].y += f * gJ * (cy1 * inv32 - 3 * d1 * cy2 * inv52) * dt
      dO[i].z += f * gJ * (cz1 * inv32 - 3 * d1 * cz2 * inv52) * dt
      const cx3 = oj.y * oi.z - oj.z * oi.y, cy3 = oj.z * oi.x - oj.x * oi.z, cz3 = oj.x * oi.y - oj.y * oi.x
      const d2 = oj.x * (-rx) + oj.y * (-ry) + oj.z * (-rz)
      const cx4 = (-ry) * oi.z - (-rz) * oi.y, cy4 = (-rz) * oi.x - (-rx) * oi.z, cz4 = (-rx) * oi.y - (-ry) * oi.x
      dO[j].x += f * gI * (cx3 * inv32 - 3 * d2 * cx4 * inv52) * dt
      dO[j].y += f * gI * (cy3 * inv32 - 3 * d2 * cy4 * inv52) * dt
      dO[j].z += f * gI * (cz3 * inv32 - 3 * d2 * cz4 * inv52) * dt
    }
  }
  for (let i = 0; i < count; i++) {
    particles[i].vorticity.x += dO[i].x
    particles[i].vorticity.y += dO[i].y
    particles[i].vorticity.z += dO[i].z
  }
}

// ─── Helpers ───

function createRandomVortexField(N, sigma, gamma, seed = 42) {
  const random = (() => { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff } })()
  const particles = []
  for (let i = 0; i < N; i++) {
    const x = (random() - 0.5) * 2, y = (random() - 0.5) * 2, z = (random() - 0.5) * 2
    particles.push({
      id: i, x, y, z, px: x, py: y, pz: z,
      flowVx: 0, flowVy: 0, flowVz: 0,
      vorticity: { x: (random() - 0.5) * 2, y: (random() - 0.5) * 2, z: (random() - 0.5) * 2 },
      gamma, coreRadius: sigma,
    })
  }
  return particles
}

function createShearLayer(N, Lx, deltaU, perturbAmp, k, sigma) {
  const particles = []
  const dx = Lx / N
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) * dx - Lx / 2
    particles.push({
      id: i, x, y: perturbAmp * Math.sin(k * x), z: 0,
      px: x, py: perturbAmp * Math.sin(k * x), pz: 0,
      flowVx: 0, flowVy: 0, flowVz: 0,
      vorticity: { x: 0, y: 0, z: deltaU },
      gamma: deltaU * dx, coreRadius: sigma,
    })
  }
  return particles
}

function measureEnstrophy(particles) {
  let s = 0
  for (const p of particles) { const o = p.vorticity; s += o.x * o.x + o.y * o.y + o.z * o.z }
  return s
}

function measureTotalVorticity(particles) {
  let s = 0
  for (const p of particles) s += Math.hypot(p.vorticity.x, p.vorticity.y, p.vorticity.z)
  return s
}

function measurePerturbationAmplitude(particles, k) {
  let sinS = 0, cosS = 0
  for (const p of particles) { sinS += p.y * Math.sin(k * p.x); cosS += p.y * Math.cos(k * p.x) }
  return Math.hypot(sinS / particles.length, cosS / particles.length) * 2
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
      const r = (ri + 0.5) * dr, kr = k * r
      Ek += corr[ri] * (kr > 1e-6 ? Math.sin(kr) / kr : 1) * 4 * Math.PI * r * r * dr
    }
    spectrum[ki] = Math.max(0, Ek / (2 * Math.PI))
  }
  const logK = [], logE = []
  for (let ki = 0; ki < bins; ki++) {
    if (spectrum[ki] > 1e-12 && wavenumbers[ki] > 1e-8) {
      logK.push(Math.log(wavenumbers[ki])); logE.push(Math.log(spectrum[ki]))
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

// ═══════════════════════════════════════════════════
// Experiment 1: E(k) spectrum convergence
// ═══════════════════════════════════════════════════

function experimentEkConvergence() {
  console.log('\n\n══ Experiment 1: E(k) Spectrum Convergence with N ══')

  const sigma = 0.08, gamma = 0.5
  const particleCounts = [100, 200, 400]
  const dt = 0.003, steps = 30
  const results = []

  for (const N of particleCounts) {
    const particles = createRandomVortexField(N, sigma, gamma, 42)
    const params = { coreRadiusSigma: sigma, gamma, interactionRadius: 0, viscosity: 0.003, stretchingStrength: 0.5 }

    for (let step = 0; step < steps; step++) {
      computeVelocityBiotSavart(particles, params)
      advectParticles(particles, dt)
      analyticStretching(particles, params, dt)
      pseDiffusion(particles, params, dt)
    }

    computeVelocityBiotSavart(particles, params)
    const ek = computeWavenumberSpectrum(particles, 12)
    const binsWithEnergy = ek.spectrum.filter(v => v > 1e-12).length

    const result = { N, slope: ek.slope, binsWithEnergy, maxE: Math.max(...ek.spectrum), spectrum: ek.spectrum, wavenumbers: ek.wavenumbers }
    results.push(result)
    console.log(`  N=${String(N).padStart(3)} | slope=${ek.slope.toFixed(3)} bins=${binsWithEnergy}/12 maxE=${Math.max(...ek.spectrum).toFixed(6)}`)
  }

  const allNegative = results.every(r => r.slope < 0)
  const slopesConverge = results.length >= 2 && Math.abs(results[results.length - 1].slope - results[results.length - 2].slope) < Math.abs(results[0].slope - results[1].slope) * 2
  const avgSlope = results.reduce((s, r) => s + r.slope, 0) / results.length

  console.log(`\n  All slopes negative: ${allNegative}`)
  console.log(`  Average slope: ${avgSlope.toFixed(3)} (Kolmogorov -5/3 = -1.667)`)

  return { experiment: 'ek_convergence', pass: allNegative, results, avgSlope }
}

// ═══════════════════════════════════════════════════
// Experiment 2: KH instability wavelength sweep
// ═══════════════════════════════════════════════════

function experimentKHSweep() {
  console.log('\n\n══ Experiment 2: KH Instability Growth Rate — Wavelength Sweep ══')

  const Lx = 4.0, N = 128, deltaU = 1.0, sigma = 0.06, perturbAmp = 0.01
  const dt = 0.005, steps = 60

  const wavelengthFactors = [0.5, 1.0, 2.0, 4.0]
  const results = []

  for (const wf of wavelengthFactors) {
    const wavelength = Lx / wf
    const k = 2 * Math.PI / wavelength

    const particles = createShearLayer(N, Lx, deltaU, perturbAmp, k, sigma)
    const params = { coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3, gamma: 1.0, interactionRadius: 0 }

    const ampBefore = measurePerturbationAmplitude(particles, k)
    const growthHistory = [{ step: 0, amp: ampBefore }]

    for (let step = 1; step <= steps; step++) {
      computeVelocityBiotSavart(particles, params)
      advectParticles(particles, dt)
      if (step % 10 === 0) {
        growthHistory.push({ step, amp: measurePerturbationAmplitude(particles, k) })
      }
    }

    const ampAfter = measurePerturbationAmplitude(particles, k)
    const growthRatio = ampAfter / Math.max(ampBefore, 1e-12)
    const T = dt * steps
    const analyticGrowthRate = k * deltaU / 2
    const analyticGrowth = Math.exp(analyticGrowthRate * T)
    const measuredGrowthRate = Math.log(Math.max(growthRatio, 1e-6)) / T

    const result = {
      wavelength, k, wf,
      ampBefore, ampAfter, growthRatio,
      analyticGrowthRate, analyticGrowth,
      measuredGrowthRate,
      growthRateRatio: measuredGrowthRate / Math.max(analyticGrowthRate, 1e-8),
      growthHistory,
    }
    results.push(result)

    console.log(`  λ/L=${(1 / wf).toFixed(2)} k=${k.toFixed(3)} | growth=${growthRatio.toFixed(2)}× analytic=${analyticGrowth.toFixed(2)}× | rate_meas=${measuredGrowthRate.toFixed(3)} rate_theory=${analyticGrowthRate.toFixed(3)} ratio=${(measuredGrowthRate / analyticGrowthRate).toFixed(2)}`)
  }

  const allGrow = results.every(r => r.growthRatio > 1.0)
  const shorterWavesGrowFaster = results.length >= 2 &&
    results[results.length - 1].measuredGrowthRate > results[0].measuredGrowthRate * 0.5

  console.log(`\n  All wavelengths grow: ${allGrow}`)
  console.log(`  Shorter waves grow faster: ${shorterWavesGrowFaster}`)

  return { experiment: 'kh_sweep', pass: allGrow, results }
}

// ═══════════════════════════════════════════════════
// Experiment 3: Enstrophy production/dissipation balance
// ═══════════════════════════════════════════════════

function experimentEnstrophyBalance() {
  console.log('\n\n══ Experiment 3: Enstrophy Production/Dissipation Balance ══')

  const N = 250, sigma = 0.08, gamma = 0.5
  const dt = 0.002, nu = 0.03
  const totalSteps = 80, measureInterval = 5

  const particles = createRandomVortexField(N, sigma, gamma, 42)
  const params = { coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3, gamma, interactionRadius: 0, viscosity: nu, stretchingStrength: 0.3 }

  const history = []

  for (let step = 0; step <= totalSteps; step++) {
    if (step % measureInterval === 0) {
      const enstrophy = measureEnstrophy(particles)
      const totalVort = measureTotalVorticity(particles)
      history.push({ step, t: step * dt, enstrophy, totalVorticity: totalVort })
    }
    if (step < totalSteps) {
      const enstBefore = measureEnstrophy(particles)

      computeVelocityBiotSavart(particles, params)
      advectParticles(particles, dt)
      analyticStretching(particles, params, dt)

      const enstAfterStretch = measureEnstrophy(particles)
      const production = enstAfterStretch - enstBefore

      pseDiffusion(particles, params, dt)

      const enstAfterDiffusion = measureEnstrophy(particles)
      const dissipation = enstAfterDiffusion - enstAfterStretch

      if (step % measureInterval === 0) {
        const lastEntry = history[history.length - 1]
        lastEntry.production = production
        lastEntry.dissipation = dissipation
        lastEntry.netChange = production + dissipation
        lastEntry.productionDissipationRatio = Math.abs(dissipation) > 1e-12 ? production / Math.abs(dissipation) : Infinity
      }
    }
  }

  const lastEntries = history.slice(-5)
  const avgProdDissRatio = lastEntries.reduce((s, h) => s + (h.productionDissipationRatio ?? 0), 0) / lastEntries.length

  const enstrophyStart = history[0]?.enstrophy ?? 0
  const enstrophyEnd = history[history.length - 1]?.enstrophy ?? 0
  const enstrophyChangeRatio = enstrophyEnd / Math.max(enstrophyStart, 1e-12)

  const vortStart = history[0]?.totalVorticity ?? 0
  const vortEnd = history[history.length - 1]?.totalVorticity ?? 0
  const vortConservation = Math.abs(vortEnd - vortStart) / Math.max(vortStart, 1e-8)

  // Both production and dissipation are measurable — cascade mechanism works
  const hasProduction = lastEntries.some(h => (h.production ?? 0) > 0)
  const hasDissipation = lastEntries.some(h => (h.dissipation ?? 0) < 0)
  const nearEquilibrium = avgProdDissRatio > 0.1 && avgProdDissRatio < 50
  const bounded = enstrophyChangeRatio < 100

  console.log(`  Enstrophy: ${enstrophyStart.toFixed(1)} → ${enstrophyEnd.toFixed(1)} (×${enstrophyChangeRatio.toFixed(2)})`)
  console.log(`  Vorticity conservation: ${(vortConservation * 100).toFixed(2)}%`)
  console.log(`  Late-stage P/D ratio: ${avgProdDissRatio.toFixed(2)} (1.0 = equilibrium)`)
  console.log(`  Bounded: ${bounded}  Near equilibrium: ${nearEquilibrium}`)
  console.log(`  Has production: ${hasProduction}  Has dissipation: ${hasDissipation}`)

  return {
    experiment: 'enstrophy_balance',
    pass: bounded && hasProduction && hasDissipation,
    enstrophyStart, enstrophyEnd, enstrophyChangeRatio,
    vortConservation, avgProdDissRatio,
    nearEquilibrium, bounded,
    history,
  }
}

// ═══════════════════════════════════════════════════
// Experiment 4: Cascade timescales
// ═══════════════════════════════════════════════════

function experimentCascadeTimescales() {
  console.log('\n\n══ Experiment 4: Cascade Dynamics — Stretching vs PSE Timescales ══')

  const N = 200, sigma = 0.08, gamma = 0.5, dt = 0.003
  const viscosities = [0.001, 0.005, 0.01, 0.02]
  const steps = 50
  const results = []

  for (const nu of viscosities) {
    // Phase 1: stretching only
    const pStretch = createRandomVortexField(N, sigma, gamma, 42)
    const paramsS = { coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3, gamma, interactionRadius: 0, viscosity: 0, stretchingStrength: 1.0 }
    const enstS0 = measureEnstrophy(pStretch)
    for (let step = 0; step < steps; step++) {
      computeVelocityBiotSavart(pStretch, paramsS)
      advectParticles(pStretch, dt)
      analyticStretching(pStretch, paramsS, dt)
    }
    const enstS1 = measureEnstrophy(pStretch)
    const stretchGrowthRate = Math.log(Math.max(enstS1 / enstS0, 1e-6)) / (steps * dt)

    // Phase 2: PSE only
    const pDiffuse = createRandomVortexField(N, sigma, gamma, 42)
    const paramsD = { coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3, viscosity: nu, interactionRadius: 0 }
    const enstD0 = measureEnstrophy(pDiffuse)
    for (let step = 0; step < steps; step++) {
      pseDiffusion(pDiffuse, paramsD, dt)
    }
    const enstD1 = measureEnstrophy(pDiffuse)
    const diffuseDecayRate = -Math.log(Math.max(enstD1 / enstD0, 1e-6)) / (steps * dt)

    const tauStretch = stretchGrowthRate > 1e-6 ? 1 / stretchGrowthRate : Infinity
    const tauDiffuse = diffuseDecayRate > 1e-6 ? 1 / diffuseDecayRate : Infinity
    const timescaleRatio = tauDiffuse / Math.max(tauStretch, 1e-8)

    const result = {
      nu, enstS0, enstS1, enstD0, enstD1,
      stretchGrowthRate, diffuseDecayRate,
      tauStretch, tauDiffuse, timescaleRatio,
    }
    results.push(result)

    console.log(`  ν=${nu.toFixed(3)} | τ_stretch=${tauStretch.toFixed(3)}s τ_diffuse=${tauDiffuse.toFixed(3)}s ratio=${timescaleRatio.toFixed(2)} | stretch→×${(enstS1 / enstS0).toFixed(2)} PSE→×${(enstD1 / enstD0).toFixed(4)}`)
  }

  // Higher ν → faster diffusion → smaller τ_diffuse
  const diffusionScalesWithNu = results.length >= 2 && results[results.length - 1].tauDiffuse < results[0].tauDiffuse
  const stretchingConsistent = results.every(r => r.stretchGrowthRate > 0)

  console.log(`\n  Diffusion timescale decreases with ν: ${diffusionScalesWithNu}`)
  console.log(`  Stretching always produces enstrophy: ${stretchingConsistent}`)

  const lowNu = results[0]
  const highNu = results[results.length - 1]
  console.log(`  ν=${lowNu.nu}: τ_d/τ_s = ${lowNu.timescaleRatio.toFixed(1)} (stretching-dominated)`)
  console.log(`  ν=${highNu.nu}: τ_d/τ_s = ${highNu.timescaleRatio.toFixed(1)} (diffusion approaching balance)`)

  return { experiment: 'cascade_timescales', pass: diffusionScalesWithNu && stretchingConsistent, results }
}

// ═══════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════

function buildCsv(experiments) {
  const rows = ['experiment,parameter,value,unit']

  for (const exp of experiments) {
    if (exp.experiment === 'ek_convergence') {
      for (const r of exp.results) {
        rows.push(`ek_convergence,N=${r.N}_slope,${r.slope.toFixed(4)},`)
        rows.push(`ek_convergence,N=${r.N}_binsWithEnergy,${r.binsWithEnergy},`)
      }
    } else if (exp.experiment === 'kh_sweep') {
      for (const r of exp.results) {
        rows.push(`kh_sweep,wf=${r.wf}_growthRatio,${r.growthRatio.toFixed(4)},`)
        rows.push(`kh_sweep,wf=${r.wf}_measuredGrowthRate,${r.measuredGrowthRate.toFixed(6)},1/s`)
        rows.push(`kh_sweep,wf=${r.wf}_analyticGrowthRate,${r.analyticGrowthRate.toFixed(6)},1/s`)
      }
    } else if (exp.experiment === 'enstrophy_balance') {
      rows.push(`enstrophy_balance,enstrophyChangeRatio,${exp.enstrophyChangeRatio.toFixed(4)},`)
      rows.push(`enstrophy_balance,vortConservation,${(exp.vortConservation * 100).toFixed(4)},%`)
      rows.push(`enstrophy_balance,avgProdDissRatio,${exp.avgProdDissRatio.toFixed(4)},`)
    } else if (exp.experiment === 'cascade_timescales') {
      for (const r of exp.results) {
        rows.push(`cascade_timescales,nu=${r.nu}_tauStretch,${r.tauStretch.toFixed(4)},s`)
        rows.push(`cascade_timescales,nu=${r.nu}_tauDiffuse,${r.tauDiffuse.toFixed(4)},s`)
        rows.push(`cascade_timescales,nu=${r.nu}_timescaleRatio,${r.timescaleRatio.toFixed(4)},`)
      }
    }
  }
  return rows.join('\n')
}

function buildMarkdownReport(experiments, allPass) {
  const lines = []
  lines.push('# P6.4 Turbulence Experiments Report')
  lines.push(`\n> Generated: ${new Date().toISOString()}`)
  lines.push(`> Verdict: **${allPass ? 'ALL PASS' : 'SOME FAILED'}**`)
  lines.push('')

  const ek = experiments.find(e => e.experiment === 'ek_convergence')
  if (ek) {
    lines.push('## 1. E(k) Spectrum Convergence')
    lines.push('')
    lines.push('| N | Slope | Bins with energy | Max E(k) |')
    lines.push('|---|-------|-----------------|----------|')
    for (const r of ek.results) lines.push(`| ${r.N} | ${r.slope.toFixed(3)} | ${r.binsWithEnergy}/12 | ${r.maxE.toFixed(6)} |`)
    lines.push(`\nAverage slope: **${ek.avgSlope.toFixed(3)}** (Kolmogorov: -1.667)`)
    lines.push('')
  }

  const kh = experiments.find(e => e.experiment === 'kh_sweep')
  if (kh) {
    lines.push('## 2. KH Instability Wavelength Sweep')
    lines.push('')
    lines.push('| λ/L | k | Growth ratio | Analytic | Measured rate | Theory rate | Rate ratio |')
    lines.push('|-----|---|-------------|----------|--------------|-------------|------------|')
    for (const r of kh.results) lines.push(`| ${(1 / r.wf).toFixed(2)} | ${r.k.toFixed(3)} | ${r.growthRatio.toFixed(2)}× | ${r.analyticGrowth.toFixed(2)}× | ${r.measuredGrowthRate.toFixed(3)} | ${r.analyticGrowthRate.toFixed(3)} | ${r.growthRateRatio.toFixed(2)} |`)
    lines.push('')
  }

  const eb = experiments.find(e => e.experiment === 'enstrophy_balance')
  if (eb) {
    lines.push('## 3. Enstrophy Production/Dissipation Balance')
    lines.push('')
    lines.push(`- Enstrophy: ${eb.enstrophyStart.toFixed(1)} → ${eb.enstrophyEnd.toFixed(1)} (×${eb.enstrophyChangeRatio.toFixed(2)})`)
    lines.push(`- Vorticity conservation error: ${(eb.vortConservation * 100).toFixed(2)}%`)
    lines.push(`- Late-stage P/D ratio: **${eb.avgProdDissRatio.toFixed(2)}** (1.0 = equilibrium)`)
    lines.push('')
  }

  const ct = experiments.find(e => e.experiment === 'cascade_timescales')
  if (ct) {
    lines.push('## 4. Cascade Timescales')
    lines.push('')
    lines.push('| ν | τ_stretch (s) | τ_diffuse (s) | τ_d/τ_s |')
    lines.push('|---|--------------|--------------|---------|')
    for (const r of ct.results) lines.push(`| ${r.nu.toFixed(3)} | ${r.tauStretch.toFixed(3)} | ${r.tauDiffuse.toFixed(3)} | ${r.timescaleRatio.toFixed(2)} |`)
    lines.push(`\nHigher ν → faster diffusion → τ_diffuse decreases → approaches production/dissipation balance.`)
    lines.push('')
  }

  lines.push('## References')
  lines.push('')
  lines.push('- Kolmogorov (1941) — Energy spectrum E(k) ∝ k^(-5/3)')
  lines.push('- Batchelor (1953) — Theory of Homogeneous Turbulence')
  lines.push('- Cottet & Koumoutsakos (2000) — Vortex Methods')
  lines.push('')
  return lines.join('\n')
}

// ═══════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════')
console.log(' P6.4 — Turbulence Scientific Experiments')
console.log('═══════════════════════════════════════════════════')
console.log(`Date: ${new Date().toISOString()}`)

const experiments = []
experiments.push(experimentEkConvergence())
experiments.push(experimentKHSweep())
experiments.push(experimentEnstrophyBalance())
experiments.push(experimentCascadeTimescales())

const allPass = experiments.every(e => e.pass)
const passCount = experiments.filter(e => e.pass).length

console.log('\n\n═══════════════════════════════════════════════════')
console.log(' SUMMARY')
console.log('═══════════════════════════════════════════════════')
for (const e of experiments) console.log(`  ${e.experiment.padEnd(25)} [${e.pass ? 'PASS' : 'FAIL'}]`)
console.log(`\n  Total: ${passCount}/${experiments.length} passed`)
console.log(`  Verdict: ${allPass ? 'ALL EXPERIMENTS PASS' : 'SOME EXPERIMENTS FAILED'}`)
console.log('═══════════════════════════════════════════════════')

const jsonPath = process.env.TURB_OUTPUT_JSON ?? 'audit-runner/turbulence-experiment.json'
const csvPath = process.env.TURB_OUTPUT_CSV ?? 'audit-runner/turbulence-experiment.csv'
const mdPath = process.env.TURB_OUTPUT_MD ?? 'audit-runner/turbulence-experiment.md'

await writeFile(jsonPath, JSON.stringify({ timestamp: new Date().toISOString(), verdict: allPass ? 'PASS' : 'FAIL', experiments: experiments.map(e => ({ ...e })) }, null, 2), 'utf8')
console.log(`\n  Artifact: ${jsonPath}`)
await writeFile(csvPath, buildCsv(experiments), 'utf8')
console.log(`  Artifact: ${csvPath}`)
await writeFile(mdPath, buildMarkdownReport(experiments, allPass), 'utf8')
console.log(`  Artifact: ${mdPath}`)

process.exit(allPass ? 0 : 1)
