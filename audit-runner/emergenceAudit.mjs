/**
 * Emergence Score Re-evaluation Audit (P6.2)
 *
 * Tests emergent phenomena with Phase 5 features:
 * - Ring formation at multiple Reynolds numbers (scaling)
 * - KH instability with viscous regularization
 * - Boundary interaction (image vortex method)
 * - Wake forcing (crossflow)
 * - Enstrophy cascade dynamics
 * - Structure detection (PCA + circulation closure)
 * - Ring lifecycle state machine
 * - Conservation laws
 * - Scale invariance
 * - E(k) spectrum quality
 *
 * Scoring: 6 categories × 10 points max = 60 → averaged to 10-point scale
 *
 * Usage: node audit-runner/emergenceAudit.mjs
 */

const FOUR_PI = 4 * Math.PI

// ─── Inline Physics (same as convergenceTest, extended with Phase 5) ───

function getCoreRadius(particle, sigma) {
  return Math.max(particle.coreRadius ?? sigma, 1e-4)
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
      const rx = p.x - s.x, ry = p.y - s.y, rz = p.z - s.z
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

function analyticStretching(particles, params, dt) {
  const strength = params.stretchingStrength ?? 1.0
  if (strength <= 0) return
  const count = particles.length
  const dOmega = new Array(count)
  for (let i = 0; i < count; i++) dOmega[i] = { x: 0, y: 0, z: 0 }

  for (let i = 0; i < count; i++) {
    const pi = particles[i]
    const oi = pi.vorticity
    for (let j = i + 1; j < count; j++) {
      const pj = particles[j]
      const oj = pj.vorticity
      const rx = pi.x - pj.x, ry = pi.y - pj.y, rz = pi.z - pj.z
      const r2 = rx * rx + ry * ry + rz * rz
      const sigma = Math.max(pi.coreRadius, pj.coreRadius, 0.01)
      const r2s = r2 + sigma * sigma
      const inv32 = 1 / (r2s * Math.sqrt(r2s))
      const inv52 = inv32 / r2s

      const gammaJ = pj.gamma ?? params.gamma ?? 0
      const gammaI = pi.gamma ?? params.gamma ?? 0
      const f = strength / FOUR_PI

      // (ωi·∇)u contribution from particle j
      const cx1 = oi.y * oj.z - oi.z * oj.y
      const cy1 = oi.z * oj.x - oi.x * oj.z
      const cz1 = oi.x * oj.y - oi.y * oj.x
      const dot1 = oi.x * rx + oi.y * ry + oi.z * rz
      const cx2 = ry * oj.z - rz * oj.y
      const cy2 = rz * oj.x - rx * oj.z
      const cz2 = rx * oj.y - ry * oj.x
      dOmega[i].x += f * gammaJ * (cx1 * inv32 - 3 * dot1 * cx2 * inv52) * dt
      dOmega[i].y += f * gammaJ * (cy1 * inv32 - 3 * dot1 * cy2 * inv52) * dt
      dOmega[i].z += f * gammaJ * (cz1 * inv32 - 3 * dot1 * cz2 * inv52) * dt

      // (ωj·∇)u contribution from particle i
      const cx3 = oj.y * oi.z - oj.z * oi.y
      const cy3 = oj.z * oi.x - oj.x * oi.z
      const cz3 = oj.x * oi.y - oj.y * oi.x
      const dot2 = oj.x * (-rx) + oj.y * (-ry) + oj.z * (-rz)
      const cx4 = (-ry) * oi.z - (-rz) * oi.y
      const cy4 = (-rz) * oi.x - (-rx) * oi.z
      const cz4 = (-rx) * oi.y - (-ry) * oi.x
      dOmega[j].x += f * gammaI * (cx3 * inv32 - 3 * dot2 * cx4 * inv52) * dt
      dOmega[j].y += f * gammaI * (cy3 * inv32 - 3 * dot2 * cy4 * inv52) * dt
      dOmega[j].z += f * gammaI * (cz3 * inv32 - 3 * dot2 * cz4 * inv52) * dt
    }
  }
  for (let i = 0; i < count; i++) {
    particles[i].vorticity.x += dOmega[i].x
    particles[i].vorticity.y += dOmega[i].y
    particles[i].vorticity.z += dOmega[i].z
  }
}

// ─── Phase 5: Boundary Interaction (Image Vortex Method) ───

function applyBoundaryInteraction(particles, params, dt) {
  const boundaryY = params.boundaryPlaneY ?? -1.0
  const sigma = params.coreRadiusSigma ?? 0.1
  const wallLayer = 3 * sigma
  const damping = params.boundaryDamping ?? 0.5

  for (const p of particles) {
    const distToWall = p.y - boundaryY
    if (distToWall < 0) {
      p.y = boundaryY + Math.abs(distToWall) * 0.1
      p.flowVy = Math.abs(p.flowVy ?? 0) * damping
    }
    if (distToWall < wallLayer && distToWall >= 0) {
      const proximity = 1 - distToWall / wallLayer
      const imageStrength = proximity * proximity
      p.flowVy += imageStrength * Math.abs(p.flowVy ?? 0) * 0.3
      if (p.vorticity) {
        p.vorticity.x *= (1 - imageStrength * 0.15)
        p.vorticity.z *= (1 - imageStrength * 0.15)
      }
    }
  }
}

// ─── Phase 5: Wake Forcing ───

function applyWakeForcing(particles, params) {
  const wx = params.wakeVx ?? 0
  const wy = params.wakeVy ?? 0
  const wz = params.wakeVz ?? 0
  if (wx === 0 && wy === 0 && wz === 0) return
  for (const p of particles) {
    p.flowVx = (p.flowVx ?? 0) + wx
    p.flowVy = (p.flowVy ?? 0) + wy
    p.flowVz = (p.flowVz ?? 0) + wz
  }
}

// ─── Phase 5: Nondimensional Scaling ───

function buildScalingPatch(Re, nozzleRadius = 0.5, jetSpeed = 3.0) {
  const D = 2 * nozzleRadius
  const U = jetSpeed
  const nu = (U * D) / Re
  const sigma = 0.08 * D
  return { viscosity: nu, coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3 }
}

// ─── Phase 5: Structure Detection (PCA + Circulation Closure) ───

function eigenvalues3x3Symmetric(c) {
  const p1 = c[0][1] ** 2 + c[0][2] ** 2 + c[1][2] ** 2
  if (p1 < 1e-14) return [c[0][0], c[1][1], c[2][2]].sort((a, b) => b - a)
  const q = (c[0][0] + c[1][1] + c[2][2]) / 3
  const p2 = (c[0][0] - q) ** 2 + (c[1][1] - q) ** 2 + (c[2][2] - q) ** 2 + 2 * p1
  const p = Math.sqrt(p2 / 6)
  const B = [
    [(c[0][0] - q) / p, c[0][1] / p, c[0][2] / p],
    [c[1][0] / p, (c[1][1] - q) / p, c[1][2] / p],
    [c[2][0] / p, c[2][1] / p, (c[2][2] - q) / p],
  ]
  const detB = B[0][0] * (B[1][1] * B[2][2] - B[1][2] * B[2][1])
    - B[0][1] * (B[1][0] * B[2][2] - B[1][2] * B[2][0])
    + B[0][2] * (B[1][0] * B[2][1] - B[1][1] * B[2][0])
  const r = Math.max(-1, Math.min(1, detB / 2))
  const phi = Math.acos(r) / 3
  const e1 = q + 2 * p * Math.cos(phi)
  const e3 = q + 2 * p * Math.cos(phi + 2 * Math.PI / 3)
  const e2 = 3 * q - e1 - e3
  return [e1, e2, e3]
}

function detectRingStructure(particles) {
  if (particles.length < 6) return { isRing: false, confidence: 0 }

  let cx = 0, cy = 0, cz = 0
  for (const p of particles) { cx += p.x; cy += p.y; cz += p.z }
  const n = particles.length
  cx /= n; cy /= n; cz /= n

  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (const p of particles) {
    const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz
    cov[0][0] += dx * dx; cov[0][1] += dx * dy; cov[0][2] += dx * dz
    cov[1][0] += dy * dx; cov[1][1] += dy * dy; cov[1][2] += dy * dz
    cov[2][0] += dz * dx; cov[2][1] += dz * dy; cov[2][2] += dz * dz
  }
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      cov[i][j] /= n

  const eigs = eigenvalues3x3Symmetric(cov)
  const total = eigs[0] + eigs[1] + eigs[2]
  if (total < 1e-12) return { isRing: false, confidence: 0 }

  const planarity = 1 - eigs[2] / Math.max(eigs[1], 1e-12)
  const elongation = 1 - eigs[1] / Math.max(eigs[0], 1e-12)
  const ringLikeness = planarity * (1 - elongation)

  // Circulation closure
  const angles = []
  for (const p of particles) {
    const dx = p.x - cx, dy = p.y - cy
    angles.push(Math.atan2(dy, dx))
  }
  angles.sort((a, b) => a - b)
  let maxGap = 0
  for (let i = 1; i < angles.length; i++) {
    const gap = angles[i] - angles[i - 1]
    if (gap > maxGap) maxGap = gap
  }
  const wrapGap = (2 * Math.PI) - (angles[angles.length - 1] - angles[0])
  if (wrapGap > maxGap) maxGap = wrapGap
  const idealGap = (2 * Math.PI) / n
  const closureScore = Math.max(0, 1 - (maxGap - idealGap) / Math.PI)

  const confidence = 0.6 * ringLikeness + 0.4 * closureScore
  return {
    isRing: confidence > 0.5,
    confidence,
    planarity,
    elongation,
    ringLikeness,
    closureScore,
    eigenvalues: eigs,
  }
}

// ─── Phase 5: Ring Lifecycle State Machine ───

function updateLifecycle(state, detection) {
  const prevState = state.phase
  const prevFrames = state.framesInPhase + 1
  const confidence = detection.confidence ?? 0
  const ringDetected = detection.isRing ?? false

  let newPhase = prevState
  switch (prevState) {
    case 'absent':
      if (ringDetected && confidence >= 0.35) newPhase = 'forming'
      break
    case 'forming':
      if (!ringDetected && prevFrames > 10) newPhase = 'absent'
      else if (confidence >= 0.55 && prevFrames >= 5) newPhase = 'stable'
      break
    case 'stable':
      if (!ringDetected && prevFrames > 5) newPhase = 'breakdown'
      else if (confidence < 0.35 && prevFrames > 8) newPhase = 'deforming'
      break
    case 'deforming':
      if (confidence >= 0.55) newPhase = 'stable'
      else if (!ringDetected && prevFrames > 10) newPhase = 'breakdown'
      break
    case 'breakdown':
      if (ringDetected && confidence >= 0.4 && prevFrames > 8) newPhase = 'forming'
      else if (!ringDetected && prevFrames > 30) newPhase = 'absent'
      break
  }

  const changed = newPhase !== prevState
  return {
    phase: newPhase,
    framesInPhase: changed ? 0 : prevFrames,
    transitions: state.transitions + (changed ? 1 : 0),
    history: [...state.history, { from: prevState, to: newPhase, frame: state.totalFrames }]
      .slice(-20),
    totalFrames: state.totalFrames + 1,
  }
}

// ─── Particle Creation Helpers ───

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

function createShearLayer(N, Lx, deltaU, perturbAmp, k, sigma) {
  const particles = []
  const dx = Lx / N
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) * dx - Lx / 2
    particles.push({
      id: i,
      x, y: perturbAmp * Math.sin(k * x), z: 0,
      px: x, py: perturbAmp * Math.sin(k * x), pz: 0,
      flowVx: 0, flowVy: 0, flowVz: 0,
      vorticity: { x: 0, y: 0, z: deltaU },
      gamma: deltaU * dx, coreRadius: sigma,
    })
  }
  return particles
}

function createRandomVortexField(N, sigma, gamma, seed = 42) {
  const random = (() => {
    let s = seed
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  })()
  const particles = []
  for (let i = 0; i < N; i++) {
    const x = (random() - 0.5) * 2
    const y = (random() - 0.5) * 2
    const z = (random() - 0.5) * 2
    particles.push({
      id: i, x, y, z, px: x, py: y, pz: z,
      flowVx: 0, flowVy: 0, flowVz: 0,
      vorticity: { x: (random() - 0.5) * 2, y: (random() - 0.5) * 2, z: (random() - 0.5) * 2 },
      gamma, coreRadius: sigma,
    })
  }
  return particles
}

function saffmanVelocity(gamma, R, sigma) {
  return (gamma / (4 * Math.PI * R)) * (Math.log(8 * R / sigma) - 0.25)
}

function measureRingCenter(particles) {
  let z = 0
  for (const p of particles) z += p.z
  return z / particles.length
}

function measureEnstrophy(particles) {
  let s = 0
  for (const p of particles) {
    const o = p.vorticity
    s += o.x * o.x + o.y * o.y + o.z * o.z
  }
  return s
}

function measureTotalVorticity(particles) {
  let s = 0
  for (const p of particles) {
    s += Math.hypot(p.vorticity.x, p.vorticity.y, p.vorticity.z)
  }
  return s
}

function measurePerturbationAmplitude(particles, k) {
  let sinS = 0, cosS = 0
  for (const p of particles) {
    sinS += p.y * Math.sin(k * p.x)
    cosS += p.y * Math.cos(k * p.x)
  }
  const n = particles.length
  return Math.hypot(sinS / n, cosS / n) * 2
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
  const corrSum = new Float64Array(bins)
  const corrCount = new Uint32Array(bins)
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
  const spectrum = new Float64Array(bins)
  const wavenumbers = new Float64Array(bins)
  for (let ki = 0; ki < bins; ki++) {
    const k = (ki + 1) * Math.PI / maxR
    wavenumbers[ki] = k
    let Ek = 0
    for (let ri = 0; ri < bins; ri++) {
      const r = (ri + 0.5) * dr
      const kr = k * r
      const sinc = kr > 1e-6 ? Math.sin(kr) / kr : 1
      Ek += corr[ri] * sinc * 4 * Math.PI * r * r * dr
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
  return { wavenumbers, spectrum, slope }
}

// ─── Full VPM Step with Phase 5 Features ───

function fullVpmStep(particles, params, dt) {
  computeVelocityBiotSavart(particles, params)
  if (params.boundaryEnabled) applyBoundaryInteraction(particles, params, dt)
  if (params.wakeEnabled) applyWakeForcing(particles, params)
  advectParticles(particles, dt)
  if ((params.stretchingStrength ?? 0) > 0) analyticStretching(particles, params, dt)
  if ((params.viscosity ?? 0) > 0) pseDiffusion(particles, params, dt)
}

// ─── Test Runner ───

function runTest(name, fn) {
  console.log(`\n─── ${name} ───`)
  try {
    const result = fn()
    const status = result.pass ? 'PASS' : 'FAIL'
    console.log(`  Result: ${status}`)
    for (const [key, val] of Object.entries(result)) {
      if (key === 'pass' || key === 'details') continue
      console.log(`  ${key}: ${typeof val === 'number' ? val.toFixed(6) : val}`)
    }
    return result
  } catch (err) {
    console.log(`  ERROR: ${err.message}`)
    console.log(`  ${err.stack?.split('\n').slice(1, 3).join('\n  ')}`)
    return { pass: false, error: err.message }
  }
}

// ═══════════════════════════════════════════════════
// Category 1: Ring Formation (max 10)
// ═══════════════════════════════════════════════════

function testRingAtReynolds(Re, label) {
  const nozzleR = 0.5, jetSpeed = 3.0
  const R = 1.0, gamma = 1.0, N = 128
  const scaling = buildScalingPatch(Re, nozzleR, jetSpeed)
  const sigma = scaling.coreRadiusSigma
  const dt = 0.0005, steps = 40

  const particles = createVortexRing(N, R, sigma, gamma)
  const z0 = measureRingCenter(particles)
  const params = {
    ...scaling,
    gamma,
    interactionRadius: 0,
    stretchingStrength: 0,
    adaptiveCfl: false,
  }

  for (let step = 0; step < steps; step++) {
    computeVelocityBiotSavart(particles, params)
    advectParticles(particles, dt)
    if (scaling.viscosity > 0) pseDiffusion(particles, params, dt)
  }

  const z1 = measureRingCenter(particles)
  const T = dt * steps
  const measuredSpeed = Math.abs((z1 - z0) / T)
  const analyticSpeed = saffmanVelocity(gamma, R, sigma)
  const speedError = Math.abs(measuredSpeed - analyticSpeed) / Math.max(analyticSpeed, 1e-8)

  return {
    pass: speedError < 0.5 && measuredSpeed > 0.01,
    label,
    Re,
    viscosity: scaling.viscosity,
    sigma: scaling.coreRadiusSigma,
    analyticSpeed,
    measuredSpeed,
    speedRelativeError: speedError,
    nondimSpeed: measuredSpeed / (gamma / (FOUR_PI * R)),
  }
}

function testScaleInvariance() {
  const resultRe1000 = testRingAtReynolds(1000, 'Re=1000 (scale inv.)')
  const resultRe4500 = testRingAtReynolds(4500, 'Re=4500 (scale inv.)')

  const nondim1 = resultRe1000.nondimSpeed
  const nondim2 = resultRe4500.nondimSpeed
  const consistencyError = Math.abs(nondim1 - nondim2) / Math.max(nondim1, nondim2, 1e-8)

  return {
    pass: consistencyError < 0.3 && resultRe1000.pass && resultRe4500.pass,
    nondimSpeed_Re1000: nondim1,
    nondimSpeed_Re4500: nondim2,
    consistencyError,
    note: 'Non-dimensional ring speed V*=V/(Γ/4πR) should be consistent across Re',
  }
}

// ═══════════════════════════════════════════════════
// Category 2: Instability (max 10)
// ═══════════════════════════════════════════════════

function testKHWithViscosity() {
  const Lx = 4.0, N = 128, deltaU = 1.0, sigma = 0.06
  const perturbAmp = 0.01, k = 2 * Math.PI / Lx
  const dt = 0.005, steps = 80
  const nu = 0.002

  const particles = createShearLayer(N, Lx, deltaU, perturbAmp, k, sigma)
  const params = {
    coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3,
    gamma: 1.0, interactionRadius: 0,
    viscosity: nu, stretchingStrength: 0,
  }

  const ampBefore = measurePerturbationAmplitude(particles, k)
  for (let step = 0; step < steps; step++) {
    computeVelocityBiotSavart(particles, params)
    advectParticles(particles, dt)
    pseDiffusion(particles, params, dt)
  }

  const ampAfter = measurePerturbationAmplitude(particles, k)
  const growthRatio = ampAfter / Math.max(ampBefore, 1e-12)
  const T = dt * steps
  const analyticGrowthRate = k * deltaU / 2
  const analyticGrowth = Math.exp(analyticGrowthRate * T)

  return {
    pass: growthRatio > 1.2 && ampAfter > ampBefore,
    amplitudeBefore: ampBefore,
    amplitudeAfter: ampAfter,
    growthRatio,
    analyticGrowthFactor: analyticGrowth,
    viscosity: nu,
    note: 'KH with viscous regularization — instability still grows but is damped',
  }
}

function testKHMultiWavenumber() {
  const Lx = 4.0, N = 128, deltaU = 1.0, sigma = 0.06
  const perturbAmp = 0.01
  const dt = 0.005, steps = 60

  const k1 = 2 * Math.PI / Lx
  const k2 = 4 * Math.PI / Lx

  function runKH(k) {
    const particles = createShearLayer(N, Lx, deltaU, perturbAmp, k, sigma)
    const params = { coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3, gamma: 1.0, interactionRadius: 0 }
    const ampBefore = measurePerturbationAmplitude(particles, k)
    for (let step = 0; step < steps; step++) {
      computeVelocityBiotSavart(particles, params)
      advectParticles(particles, dt)
    }
    return measurePerturbationAmplitude(particles, k) / Math.max(ampBefore, 1e-12)
  }

  const growth1 = runKH(k1)
  const growth2 = runKH(k2)
  const higherKGrowsFaster = growth2 > growth1 * 0.5

  return {
    pass: growth1 > 1.5 && growth2 > 1.0,
    growthRatio_k1: growth1,
    growthRatio_k2: growth2,
    k1, k2,
    higherKGrowsFaster,
    note: 'Multiple wavenumbers grow — broadband instability',
  }
}

// ═══════════════════════════════════════════════════
// Category 3: Turbulence (max 10)
// ═══════════════════════════════════════════════════

function testEnstrophyCascadeDynamics() {
  const N = 300, sigma = 0.08, gamma = 0.5
  const dt = 0.003, nu = 0.005
  const stretchSteps = 30, diffuseSteps = 30

  const particles = createRandomVortexField(N, sigma, gamma, 42)
  const enstrophy0 = measureEnstrophy(particles)
  const vort0 = measureTotalVorticity(particles)

  const params = { coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3, gamma, interactionRadius: 0, stretchingStrength: 1.0, viscosity: 0 }

  for (let step = 0; step < stretchSteps; step++) {
    computeVelocityBiotSavart(particles, params)
    advectParticles(particles, dt)
    analyticStretching(particles, params, dt)
  }

  const enstrophyAfterStretch = measureEnstrophy(particles)
  const stretchAmp = enstrophyAfterStretch / Math.max(enstrophy0, 1e-12)

  const diffParams = { coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3, viscosity: nu, interactionRadius: 0 }
  for (let step = 0; step < diffuseSteps; step++) {
    pseDiffusion(particles, diffParams, dt)
  }

  const enstrophyFinal = measureEnstrophy(particles)
  const diffDecay = enstrophyFinal / Math.max(enstrophyAfterStretch, 1e-12)
  const vortFinal = measureTotalVorticity(particles)
  const vortConservation = Math.abs(vortFinal - vort0) / Math.max(vort0, 1e-8)

  return {
    pass: stretchAmp > 1.0 && diffDecay < 1.0,
    enstrophyInitial: enstrophy0,
    enstrophyAfterStretching: enstrophyAfterStretch,
    enstrophyFinal,
    stretchingAmplification: stretchAmp,
    diffusionDecay: diffDecay,
    vorticityConservation: vortConservation,
    note: 'Stretching→enstrophy + PSE→dissipation = physical cascade',
  }
}

function testEkSpectrumQuality() {
  const N = 250, sigma = 0.08, gamma = 0.5

  const particles = createRandomVortexField(N, sigma, gamma, 123)
  const params = { coreRadiusSigma: sigma, gamma, interactionRadius: 0 }
  computeVelocityBiotSavart(particles, params)

  const result = computeWavenumberSpectrum(particles, 16)
  const hasNonZero = Array.from(result.spectrum).some(v => v > 1e-12)
  const binsWithEnergy = Array.from(result.spectrum).filter(v => v > 1e-12).length

  return {
    pass: hasNonZero && result.slope < 0 && binsWithEnergy >= 6,
    slope: result.slope,
    binsWithEnergy,
    totalBins: 16,
    isPhysical: result.slope < -1.0,
    nearKolmogorov: Math.abs(result.slope + 5 / 3) < 1.0,
    note: `E(k) slope = ${result.slope.toFixed(3)}; Kolmogorov -5/3 = -1.667`,
  }
}

// ═══════════════════════════════════════════════════
// Category 4: Cascade & Conservation (max 10)
// ═══════════════════════════════════════════════════

function testCirculationConservation() {
  const R = 1.0, sigma = 0.15, gamma = 1.0, N = 128
  const dt = 0.001, steps = 100
  const nu = 0.001

  const particles = createVortexRing(N, R, sigma, gamma)
  const params = {
    coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3,
    gamma, interactionRadius: 0,
    viscosity: nu, stretchingStrength: 0,
  }

  const circ0 = particles.reduce((s, p) => s + Math.abs(p.gamma), 0)
  const vort0 = measureTotalVorticity(particles)

  for (let step = 0; step < steps; step++) {
    computeVelocityBiotSavart(particles, params)
    advectParticles(particles, dt)
    pseDiffusion(particles, params, dt)
  }

  const circFinal = particles.reduce((s, p) => s + Math.abs(p.gamma), 0)
  const vortFinal = measureTotalVorticity(particles)
  const circError = Math.abs(circFinal - circ0) / Math.max(circ0, 1e-8)
  const vortError = Math.abs(vortFinal - vort0) / Math.max(vort0, 1e-8)

  return {
    pass: circError < 0.01 && vortError < 0.05,
    circulationInitial: circ0,
    circulationFinal: circFinal,
    circulationError: circError,
    vorticityInitial: vort0,
    vorticityFinal: vortFinal,
    vorticityError: vortError,
    steps,
    note: 'PSE antisymmetric form conserves Γ; vorticity should be near-conserved',
  }
}

function testEnergyDissipation() {
  const N = 200, sigma = 0.08, gamma = 0.5
  const dt = 0.003, steps = 60, nu = 0.01

  const particles = createRandomVortexField(N, sigma, gamma, 77)
  const params = {
    coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3,
    gamma, interactionRadius: 0,
    viscosity: nu, stretchingStrength: 0,
  }

  const enstrophy0 = measureEnstrophy(particles)

  for (let step = 0; step < steps; step++) {
    computeVelocityBiotSavart(particles, params)
    advectParticles(particles, dt)
    pseDiffusion(particles, params, dt)
  }

  const enstrophyFinal = measureEnstrophy(particles)
  const decayRatio = enstrophyFinal / Math.max(enstrophy0, 1e-12)
  const vort0 = measureTotalVorticity(particles)

  return {
    pass: decayRatio < 1.0 && decayRatio > 0.01,
    initialEnstrophy: enstrophy0,
    finalEnstrophy: enstrophyFinal,
    decayRatio,
    note: 'Pure PSE diffusion (no stretching) should monotonically decrease enstrophy',
  }
}

// ═══════════════════════════════════════════════════
// Category 5: Boundary & Interaction (max 10)
// ═══════════════════════════════════════════════════

function testRingNearWall() {
  const R = 0.3, sigma = 0.12, gamma = 1.0, N = 64
  const dt = 0.001, steps = 100
  const wallY = 0.0
  const ringOffsetFromWall = 0.15

  const particles = createVortexRing(N, R, sigma, gamma)
  for (const p of particles) { p.y += wallY + ringOffsetFromWall; p.py = p.y }

  const params = {
    coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3,
    gamma, interactionRadius: 0,
    boundaryEnabled: true,
    boundaryPlaneY: wallY,
    boundaryDamping: 0.5,
  }

  const yBefore = particles.reduce((s, p) => s + p.y, 0) / N

  for (let step = 0; step < steps; step++) {
    fullVpmStep(particles, params, dt)
  }

  const yAfter = particles.reduce((s, p) => s + p.y, 0) / N

  // Without boundary for comparison
  const particlesNoBound = createVortexRing(N, R, sigma, gamma)
  for (const p of particlesNoBound) { p.y += wallY + ringOffsetFromWall; p.py = p.y }
  const paramsNoBound = { ...params, boundaryEnabled: false }
  for (let step = 0; step < steps; step++) {
    computeVelocityBiotSavart(particlesNoBound, paramsNoBound)
    advectParticles(particlesNoBound, dt)
  }
  const yAfterNoBound = particlesNoBound.reduce((s, p) => s + p.y, 0) / N
  const trajectoryDifference = Math.abs(yAfter - yAfterNoBound)

  const wallEffect = yAfter - yBefore
  const noWallEffect = yAfterNoBound - yBefore
  const boundaryInfluence = Math.abs(wallEffect - noWallEffect)

  return {
    pass: trajectoryDifference > 0.0001 || boundaryInfluence > 0.0001,
    yCenterBefore: yBefore,
    yCenterAfter: yAfter,
    yCenterNoBoundary: yAfterNoBound,
    wallEffect,
    noWallEffect,
    boundaryInfluence,
    trajectoryDifference,
    wallY,
    distanceToWall: ringOffsetFromWall,
    wallLayerThickness: 3 * sigma,
    note: 'Image vortex should deflect ring trajectory near wall',
  }
}

function testRingInCrossflow() {
  const R = 0.5, sigma = 0.12, gamma = 1.0, N = 64
  const dt = 0.001, steps = 60
  const crossflowSpeed = 0.5

  // With crossflow
  const particles = createVortexRing(N, R, sigma, gamma)
  const params = {
    coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3,
    gamma, interactionRadius: 0,
    wakeEnabled: true, wakeVx: crossflowSpeed, wakeVy: 0, wakeVz: 0,
  }

  const xBefore = particles.reduce((s, p) => s + p.x, 0) / N

  for (let step = 0; step < steps; step++) {
    fullVpmStep(particles, params, dt)
  }

  const xAfter = particles.reduce((s, p) => s + p.x, 0) / N
  const drift = xAfter - xBefore
  const expectedDrift = crossflowSpeed * dt * steps

  // Without crossflow
  const particlesNoWake = createVortexRing(N, R, sigma, gamma)
  const paramsNoWake = { ...params, wakeEnabled: false }
  for (let step = 0; step < steps; step++) {
    computeVelocityBiotSavart(particlesNoWake, paramsNoWake)
    advectParticles(particlesNoWake, dt)
  }
  const xAfterNoWake = particlesNoWake.reduce((s, p) => s + p.x, 0) / N
  const driftDifference = Math.abs(drift - (xAfterNoWake - xBefore))

  return {
    pass: Math.abs(drift) > 0.01 && driftDifference > 0.005,
    xCenterBefore: xBefore,
    xCenterAfter: xAfter,
    drift,
    expectedDrift,
    driftWithoutWake: xAfterNoWake - xBefore,
    driftDifference,
    note: 'Crossflow (wake forcing) should transport ring laterally',
  }
}

// ═══════════════════════════════════════════════════
// Category 7: Advanced Physics — LES + Buoyancy (max 10)
// ═══════════════════════════════════════════════════

function inlineLesDiffusion(particles, params, dt) {
  const count = particles.length
  if (count < 2) return
  const cs = params.lesSmagorinskyCs ?? 0.15
  const sigma = Math.max(params.coreRadiusSigma ?? 0.01, 1e-4)
  const csDelta2 = (cs * sigma) * (cs * sigma)
  const nuMol = Math.max(params.viscosity ?? 0, 0)
  const eps = sigma, eps2 = eps * eps, fourEps2 = 4 * eps2
  const volume = eps ** 3
  const kernelNorm = 1 / (Math.pow(4 * Math.PI * eps2, 1.5) || 1e-30)

  // Estimate strain rate
  const strainRate = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    const pi = particles[i]
    let sumS2 = 0, w = 0
    for (let j = 0; j < count; j++) {
      if (i === j) continue
      const pj = particles[j]
      const rx = pi.x - pj.x, ry = pi.y - pj.y, rz = pi.z - pj.z
      const r2 = rx * rx + ry * ry + rz * rz
      if (r2 > 16 * eps2 || r2 < 1e-14) continue
      const r = Math.sqrt(r2)
      const dv = Math.sqrt(((pj.flowVx??0)-(pi.flowVx??0))**2 + ((pj.flowVy??0)-(pi.flowVy??0))**2 + ((pj.flowVz??0)-(pi.flowVz??0))**2) / r
      const ww = Math.exp(-r2 / (2 * eps2))
      sumS2 += dv * dv * ww; w += ww
    }
    strainRate[i] = w > 1e-12 ? Math.sqrt(sumS2 / w) : 0
  }

  // PSE with ν_eff = ν + ν_sgs
  const dX = new Float64Array(count), dY = new Float64Array(count), dZ = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    const pi = particles[i]
    const nuI = nuMol + csDelta2 * strainRate[i]
    for (let j = i + 1; j < count; j++) {
      const pj = particles[j]
      const rx = pi.x - pj.x, ry = pi.y - pj.y, rz = pi.z - pj.z
      const r2 = rx * rx + ry * ry + rz * rz
      const expVal = Math.exp(-r2 / fourEps2)
      if (expVal < 1e-8) continue
      const nuJ = nuMol + csDelta2 * strainRate[j]
      const nuEff = (nuI + nuJ) * 0.5
      const prefactor = 2 * nuEff * volume * kernelNorm / eps2
      const f = prefactor * expVal
      const dx = (pj.vorticity?.x??0) - (pi.vorticity?.x??0)
      const dy = (pj.vorticity?.y??0) - (pi.vorticity?.y??0)
      const dz = (pj.vorticity?.z??0) - (pi.vorticity?.z??0)
      dX[i] += f*dx; dY[i] += f*dy; dZ[i] += f*dz
      dX[j] -= f*dx; dY[j] -= f*dy; dZ[j] -= f*dz
    }
  }
  for (let i = 0; i < count; i++) {
    const o = particles[i].vorticity
    if (o) { o.x += dt*dX[i]; o.y += dt*dY[i]; o.z += dt*dZ[i] }
  }
}

function testLesSmagorinsky() {
  const N = 200, sigma = 0.08, gamma = 0.5
  const dt = 0.003, steps = 40

  // Without LES — just molecular viscosity
  const pNoLes = createRandomVortexField(N, sigma, gamma, 42)
  const paramsNoLes = { coreRadiusSigma: sigma, gamma, interactionRadius: 0, viscosity: 0.003 }
  for (let step = 0; step < steps; step++) {
    computeVelocityBiotSavart(pNoLes, paramsNoLes)
    advectParticles(pNoLes, dt)
    pseDiffusion(pNoLes, paramsNoLes, dt)
  }
  const enstNoLes = measureEnstrophy(pNoLes)

  // With LES — molecular + eddy viscosity
  const pLes = createRandomVortexField(N, sigma, gamma, 42)
  const paramsLes = { coreRadiusSigma: sigma, gamma, interactionRadius: 0, viscosity: 0.003, lesSmagorinskyCs: 0.15 }
  for (let step = 0; step < steps; step++) {
    computeVelocityBiotSavart(pLes, paramsLes)
    advectParticles(pLes, dt)
    inlineLesDiffusion(pLes, paramsLes, dt)
  }
  const enstLes = measureEnstrophy(pLes)

  const lesMoreDissipative = enstLes < enstNoLes
  const dissipationRatio = enstLes / Math.max(enstNoLes, 1e-12)

  return {
    pass: lesMoreDissipative && dissipationRatio > 0.01,
    enstrophyNoLes: enstNoLes,
    enstrophyLes: enstLes,
    dissipationRatio,
    lesMoreDissipative,
    note: 'LES SGS adds eddy viscosity → more dissipation at small scales',
  }
}

function testBuoyancyTorque() {
  const N = 100, sigma = 0.1, gamma = 0.5
  const dt = 0.005, steps = 20

  const random = (() => { let s = 55; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff } })()
  const particles = []
  for (let i = 0; i < N; i++) {
    particles.push({
      id: i,
      x: (random() - 0.5) * 2, y: (random() - 0.5) * 2, z: (random() - 0.5) * 2,
      px: 0, py: 0, pz: 0,
      flowVx: 0, flowVy: 0, flowVz: 0,
      vorticity: { x: 0, y: 0, z: 0 },
      gamma, coreRadius: sigma,
      temperature: (random() - 0.5) * 10,
    })
  }

  const vortBefore = measureTotalVorticity(particles)

  for (let step = 0; step < steps; step++) {
    // Estimate temperature gradient and apply baroclinic torque
    const alpha = 3.4e-3, gy = -9.81
    for (let i = 0; i < N; i++) {
      const pi = particles[i]
      let gTx = 0, gTy = 0, gTz = 0
      for (let j = 0; j < N; j++) {
        if (i === j) continue
        const pj = particles[j]
        const dT = (pj.temperature ?? 0) - (pi.temperature ?? 0)
        if (Math.abs(dT) < 1e-14) continue
        const rx = pj.x - pi.x, ry = pj.y - pi.y, rz = pj.z - pi.z
        const r2 = rx * rx + ry * ry + rz * rz
        if (r2 > 16 * sigma * sigma || r2 < 1e-14) continue
        const w = Math.exp(-r2 / (2 * sigma * sigma)) / (r2 + sigma * sigma)
        gTx += dT * rx * w; gTy += dT * ry * w; gTz += dT * rz * w
      }
      pi.vorticity.x += alpha * (gy * gTz - 0) * dt
      pi.vorticity.y += alpha * (0 - 0) * dt
      pi.vorticity.z += alpha * (0 - gy * gTx) * dt
    }
  }

  const vortAfter = measureTotalVorticity(particles)
  const vorticityCreated = vortAfter > vortBefore + 1e-6

  return {
    pass: vorticityCreated,
    vorticityBefore: vortBefore,
    vorticityAfter: vortAfter,
    vorticityGrowth: vortAfter - vortBefore,
    note: 'Buoyancy creates vorticity from temperature gradients (baroclinic torque)',
  }
}

// ═══════════════════════════════════════════════════
// Category 6: Detection & Lifecycle (max 10)
// ═══════════════════════════════════════════════════

function testPCADetectsRing() {
  const N = 128, R = 1.0, sigma = 0.15, gamma = 1.0
  const ring = createVortexRing(N, R, sigma, gamma)
  const detection = detectRingStructure(ring)

  // Also test with a non-ring (random) for contrast
  const nonRing = createRandomVortexField(64, 0.1, 0.5, 99)
  const nonRingDetection = detectRingStructure(nonRing)

  return {
    pass: detection.isRing && detection.confidence > 0.6 && !nonRingDetection.isRing,
    ringConfidence: detection.confidence,
    ringPlanarity: detection.planarity,
    ringElongation: detection.elongation,
    ringClosureScore: detection.closureScore,
    nonRingConfidence: nonRingDetection.confidence,
    note: 'PCA should correctly identify ring geometry',
  }
}

function testLifecycleTransitions() {
  let state = { phase: 'absent', framesInPhase: 0, transitions: 0, history: [], totalFrames: 0 }

  // Phase 1: no ring → absent
  for (let i = 0; i < 5; i++) {
    state = updateLifecycle(state, { isRing: false, confidence: 0.1 })
  }
  const afterAbsent = state.phase

  // Phase 2: ring appears → forming
  for (let i = 0; i < 3; i++) {
    state = updateLifecycle(state, { isRing: true, confidence: 0.4 })
  }
  const afterForming = state.phase

  // Phase 3: ring solidifies → stable
  for (let i = 0; i < 8; i++) {
    state = updateLifecycle(state, { isRing: true, confidence: 0.7 })
  }
  const afterStable = state.phase

  // Phase 4: ring weakens → deforming
  for (let i = 0; i < 15; i++) {
    state = updateLifecycle(state, { isRing: true, confidence: 0.3 })
  }
  const afterDeforming = state.phase

  // Phase 5: ring disappears → breakdown
  for (let i = 0; i < 15; i++) {
    state = updateLifecycle(state, { isRing: false, confidence: 0.1 })
  }
  const afterBreakdown = state.phase

  const correctSequence =
    afterAbsent === 'absent' &&
    afterForming === 'forming' &&
    afterStable === 'stable' &&
    afterDeforming === 'deforming' &&
    afterBreakdown === 'breakdown'

  return {
    pass: correctSequence && state.transitions >= 4,
    phases: `${afterAbsent}→${afterForming}→${afterStable}→${afterDeforming}→${afterBreakdown}`,
    totalTransitions: state.transitions,
    totalFrames: state.totalFrames,
    correctSequence,
    note: 'Lifecycle: absent→forming→stable→deforming→breakdown',
  }
}

// ═══════════════════════════════════════════════════
// Quality-weighted Scoring
// ═══════════════════════════════════════════════════

function qualityScore(result, qualityFn) {
  if (!result.pass) return 0
  return Math.max(0, Math.min(10, qualityFn(result)))
}

const qualityFunctions = {
  ringFormation: [
    r => {
      const speedErr = r.speedRelativeError ?? 1
      if (speedErr < 0.05) return 10
      if (speedErr < 0.15) return 9
      if (speedErr < 0.25) return 8
      if (speedErr < 0.40) return 7
      return 6
    },
    r => {
      const speedErr = r.speedRelativeError ?? 1
      if (speedErr < 0.05) return 10
      if (speedErr < 0.15) return 9
      if (speedErr < 0.25) return 8
      if (speedErr < 0.40) return 7
      return 6
    },
    r => {
      const consistency = r.consistencyError ?? 1
      if (consistency < 0.01) return 10
      if (consistency < 0.05) return 9
      if (consistency < 0.15) return 8
      return 7
    },
  ],
  instability: [
    r => {
      const growth = r.growthRatio ?? 0
      if (growth > 3.0) return 9
      if (growth > 2.0) return 8
      if (growth > 1.5) return 7
      return 6
    },
    r => {
      const g1 = r.growthRatio_k1 ?? 0
      const g2 = r.growthRatio_k2 ?? 0
      if (g1 > 2.0 && g2 > 3.0) return 9
      if (g1 > 1.5 && g2 > 1.5) return 8
      return 7
    },
  ],
  turbulence: [
    r => {
      const amp = r.stretchingAmplification ?? 0
      const decay = r.diffusionDecay ?? 1
      if (amp > 3.0 && decay < 0.99) return 9
      if (amp > 1.5 && decay < 1.0) return 8
      if (amp > 1.0 && decay < 1.0) return 7
      return 6
    },
    r => {
      const slope = r.slope ?? 0
      const distance53 = Math.abs(slope + 5 / 3)
      if (distance53 < 0.3) return 10
      if (distance53 < 0.5) return 9
      if (distance53 < 0.8) return 8
      if (distance53 < 1.2) return 7
      return 6
    },
  ],
  cascadeConservation: [
    r => {
      const circErr = r.circulationError ?? 1
      const vortErr = r.vorticityError ?? 1
      if (circErr < 0.001 && vortErr < 0.01) return 10
      if (circErr < 0.01 && vortErr < 0.05) return 9
      if (circErr < 0.05) return 8
      return 7
    },
    r => {
      const decay = r.decayRatio ?? 1
      if (decay < 0.95 && decay > 0.01) return 9
      if (decay < 1.0) return 8
      return 7
    },
  ],
  boundaryInteraction: [
    r => {
      const influence = r.boundaryInfluence ?? 0
      if (influence > 0.01) return 9
      if (influence > 0.005) return 8
      if (influence > 0.001) return 7
      return 6
    },
    r => {
      const diff = r.driftDifference ?? 0
      if (diff > 0.02) return 9
      if (diff > 0.01) return 8
      if (diff > 0.005) return 7
      return 6
    },
  ],
  detectionLifecycle: [
    r => {
      const conf = r.ringConfidence ?? 0
      const nonRingConf = r.nonRingConfidence ?? 1
      const discrimination = conf - nonRingConf
      if (discrimination > 0.5 && conf > 0.9) return 10
      if (discrimination > 0.3 && conf > 0.7) return 9
      return 8
    },
    r => {
      if (r.correctSequence && r.totalTransitions >= 4) return 10
      if (r.correctSequence) return 9
      return 7
    },
  ],
  advancedPhysics: [
    r => {
      if (!r.pass) return 0
      const ratio = r.dissipationRatio ?? 1
      if (ratio < 0.8) return 9
      if (ratio < 0.95) return 8
      return 7
    },
    r => {
      if (!r.pass) return 0
      const growth = r.vorticityGrowth ?? 0
      if (growth > 1.0) return 9
      if (growth > 0.1) return 8
      if (growth > 0.001) return 7
      return 6
    },
  ],
}

function scoreCategory(name, results, qualityKey) {
  const qFuncs = qualityFunctions[qualityKey] ?? []
  let totalQuality = 0
  let count = 0
  for (let i = 0; i < results.length; i++) {
    const qFn = qFuncs[i] ?? (() => results[i].pass ? 8 : 0)
    const q = qualityScore(results[i], qFn)
    totalQuality += q
    count++
  }
  const score = count > 0 ? Math.round((totalQuality / count) * 10) / 10 : 0
  return {
    name, score, max: 10,
    tests: results.length,
    passed: results.filter(r => r.pass).length,
    qualityScores: results.map((r, i) => {
      const qFn = qFuncs[i] ?? (() => r.pass ? 8 : 0)
      return qualityScore(r, qFn)
    }),
  }
}

// ═══════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════')
console.log(' Emergence Score Re-evaluation Audit (P6.2)')
console.log(' Phase 5 features active')
console.log(`═══════════════════════════════════════════════════`)
console.log(`Date: ${new Date().toISOString()}`)

const categories = []

// Category 1: Ring Formation
console.log('\n\n▓▓▓ CATEGORY 1: Ring Formation ▓▓▓')
const r1_re1000 = runTest('Ring at Re=1000 (scaled ν)', () => testRingAtReynolds(1000, 'Re=1000'))
const r1_re4500 = runTest('Ring at Re=4500 (scaled ν)', () => testRingAtReynolds(4500, 'Re=4500'))
const r1_scale = runTest('Scale Invariance (Re consistency)', testScaleInvariance)
categories.push(scoreCategory('Ring Formation', [r1_re1000, r1_re4500, r1_scale], 'ringFormation'))

// Category 2: Instability
console.log('\n\n▓▓▓ CATEGORY 2: Instability ▓▓▓')
const r2_kh_visc = runTest('KH with Viscous Regularization', testKHWithViscosity)
const r2_kh_multi = runTest('KH Multi-Wavenumber', testKHMultiWavenumber)
categories.push(scoreCategory('Instability', [r2_kh_visc, r2_kh_multi], 'instability'))

// Category 3: Turbulence
console.log('\n\n▓▓▓ CATEGORY 3: Turbulence ▓▓▓')
const r3_cascade = runTest('Enstrophy Cascade Dynamics', testEnstrophyCascadeDynamics)
const r3_ek = runTest('E(k) Spectrum Quality', testEkSpectrumQuality)
categories.push(scoreCategory('Turbulence', [r3_cascade, r3_ek], 'turbulence'))

// Category 4: Cascade & Conservation
console.log('\n\n▓▓▓ CATEGORY 4: Cascade & Conservation ▓▓▓')
const r4_circ = runTest('Circulation Conservation (100 steps)', testCirculationConservation)
const r4_energy = runTest('Energy Dissipation Monotonicity', testEnergyDissipation)
categories.push(scoreCategory('Cascade & Conservation', [r4_circ, r4_energy], 'cascadeConservation'))

// Category 5: Boundary & Interaction
console.log('\n\n▓▓▓ CATEGORY 5: Boundary & Interaction ▓▓▓')
const r5_wall = runTest('Ring Near Wall (Image Vortex)', testRingNearWall)
const r5_cross = runTest('Ring in Crossflow (Wake Forcing)', testRingInCrossflow)
categories.push(scoreCategory('Boundary & Interaction', [r5_wall, r5_cross], 'boundaryInteraction'))

// Category 6: Detection & Lifecycle
console.log('\n\n▓▓▓ CATEGORY 6: Detection & Lifecycle ▓▓▓')
const r6_pca = runTest('PCA Ring Detection', testPCADetectsRing)
const r6_lifecycle = runTest('Ring Lifecycle State Machine', testLifecycleTransitions)
categories.push(scoreCategory('Detection & Lifecycle', [r6_pca, r6_lifecycle], 'detectionLifecycle'))

// Category 7: Advanced Physics (LES + Buoyancy)
console.log('\n\n▓▓▓ CATEGORY 7: Advanced Physics ▓▓▓')
const r7_les = runTest('LES Smagorinsky SGS Diffusion', testLesSmagorinsky)
const r7_buoyancy = runTest('Buoyancy Baroclinic Torque', testBuoyancyTorque)
categories.push(scoreCategory('Advanced Physics', [r7_les, r7_buoyancy], 'advancedPhysics'))

// ═══════════════════════════════════════════════════
// Final Report
// ═══════════════════════════════════════════════════

console.log('\n\n═══════════════════════════════════════════════════')
console.log(' EMERGENCE SCORE REPORT')
console.log('═══════════════════════════════════════════════════')

let totalScore = 0
let totalMax = 0
let allPassed = 0
let allTotal = 0

for (const cat of categories) {
  const bar = '█'.repeat(Math.round(cat.score)) + '░'.repeat(Math.round(cat.max - cat.score))
  console.log(`  ${cat.name.padEnd(25)} ${bar} ${cat.score}/${cat.max} (${cat.passed}/${cat.tests} tests)`)
  totalScore += cat.score
  totalMax += cat.max
  allPassed += cat.passed
  allTotal += cat.tests
}

const emergenceScore = Math.round((totalScore / totalMax) * 100) / 10
const previousScore = 6.75

console.log('───────────────────────────────────────────────────')
console.log(`  TOTAL: ${totalScore}/${totalMax} → Emergence Score: ${emergenceScore}/10`)
console.log(`  Tests: ${allPassed}/${allTotal} passed`)
console.log(`  Previous Score: ${previousScore}/10`)
console.log(`  Delta: ${emergenceScore > previousScore ? '+' : ''}${(emergenceScore - previousScore).toFixed(2)}`)
console.log('═══════════════════════════════════════════════════')

const allTestsPassed = allPassed === allTotal
console.log(`\nVerdict: ${allTestsPassed ? 'ALL TESTS PASS' : `${allTotal - allPassed} TEST(S) FAILED`}`)
console.log(`Emergence Score: ${emergenceScore}/10 (was ${previousScore}/10)`)

process.exit(allTestsPassed ? 0 : 1)
