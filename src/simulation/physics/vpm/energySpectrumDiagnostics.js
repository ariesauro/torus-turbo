function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function toFinite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

export function computeEnergySpectrumDiagnostics(
  particles,
  {
    maxSamples = 8000,
    bins = 8,
    maxSpeedForBins = 8,
    maxVorticityForProxy = 12,
  } = {},
) {
  const diagnostics = {
    sampleCount: 0,
    energyProxy: 0,
    enstrophyProxy: 0,
    maxSpeed: 0,
    maxVorticity: 0,
    bins: new Float32Array(Math.max(2, Math.floor(bins))),
  }
  if (!Array.isArray(particles) || particles.length === 0) {
    return diagnostics
  }

  const binCount = diagnostics.bins.length
  const stride = Math.max(1, Math.ceil(particles.length / Math.max(64, Math.floor(maxSamples))))
  const maxSpeed = Math.max(0.1, toFinite(maxSpeedForBins, 8))
  const maxVorticityProxy = Math.max(0.01, toFinite(maxVorticityForProxy, 12))
  for (let i = 0; i < particles.length; i += stride) {
    const p = particles[i]
    if (!p) continue
    const vx = toFinite(p.flowVx, toFinite(p.vx, 0))
    const vy = toFinite(p.flowVy, toFinite(p.vy, 0))
    const vz = toFinite(p.flowVz, toFinite(p.vz, 0))
    const speed = Math.hypot(vx, vy, vz)
    const omegaX = toFinite(p.vorticity?.x, 0)
    const omegaY = toFinite(p.vorticity?.y, 0)
    const omegaZ = toFinite(p.vorticity?.z, 0)
    const vorticity = Math.hypot(omegaX, omegaY, omegaZ)
    const vorticityForProxy = Math.min(vorticity, maxVorticityProxy)
    diagnostics.sampleCount += 1
    diagnostics.energyProxy += 0.5 * speed * speed
    diagnostics.enstrophyProxy += vorticityForProxy * vorticityForProxy
    diagnostics.maxSpeed = Math.max(diagnostics.maxSpeed, speed)
    diagnostics.maxVorticity = Math.max(diagnostics.maxVorticity, vorticity)
    const normalizedSpeed = clamp(speed / maxSpeed, 0, 1)
    const binIndex = Math.min(binCount - 1, Math.floor(normalizedSpeed * binCount))
    diagnostics.bins[binIndex] += speed * speed
  }

  if (diagnostics.sampleCount > 0) {
    const inv = 1 / diagnostics.sampleCount
    diagnostics.energyProxy *= inv
    diagnostics.enstrophyProxy *= inv
    for (let bi = 0; bi < diagnostics.bins.length; bi += 1) {
      diagnostics.bins[bi] *= inv
    }
  }
  return diagnostics
}

/**
 * Compute wavenumber energy spectrum E(k) from particle pair correlations.
 *
 * For VPM particles, E(k) is estimated via the velocity correlation function:
 *   R(r) = <u(x)·u(x+r)> averaged over all pairs at separation |r|
 * Then E(k) = (1/2π) ∫ R(r)·sin(kr)/(kr) · 4πr² dr
 *
 * This implementation uses radial binning of pair correlations.
 *
 * [STATUS]: CORRECT — standard pair-correlation approach for particle data
 *
 * @returns {{ wavenumbers: Float64Array, spectrum: Float64Array, kolmogorovSlope: number }}
 */
export function computeWavenumberSpectrum(
  particles,
  {
    radialBins = 16,
    maxRadius = 0,
    maxPairSamples = 50000,
  } = {},
) {
  const count = particles.length
  if (count < 4) {
    return { wavenumbers: new Float64Array(0), spectrum: new Float64Array(0), kolmogorovSlope: 0 }
  }

  let maxR = maxRadius
  if (maxR <= 0) {
    let maxDist = 0
    const sampleN = Math.min(count, 64)
    const step = Math.max(1, Math.floor(count / sampleN))
    for (let i = 0; i < count; i += step) {
      for (let j = i + step; j < count; j += step) {
        const dx = particles[i].x - particles[j].x
        const dy = particles[i].y - particles[j].y
        const dz = particles[i].z - particles[j].z
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (d > maxDist) maxDist = d
      }
    }
    maxR = maxDist * 0.5
  }
  if (maxR <= 1e-8) maxR = 1

  const dr = maxR / radialBins
  const corrSum = new Float64Array(radialBins)
  const corrCount = new Uint32Array(radialBins)

  const maxPairs = Math.max(1000, maxPairSamples)
  const stride = Math.max(1, Math.floor((count * (count - 1) / 2) / maxPairs))
  let pairIdx = 0

  for (let i = 0; i < count; i += 1) {
    const pi = particles[i]
    const vix = toFinite(pi.flowVx, toFinite(pi.vx, 0))
    const viy = toFinite(pi.flowVy, toFinite(pi.vy, 0))
    const viz = toFinite(pi.flowVz, toFinite(pi.vz, 0))

    for (let j = i + 1; j < count; j += 1) {
      pairIdx += 1
      if (pairIdx % stride !== 0) continue

      const pj = particles[j]
      const dx = pi.x - pj.x
      const dy = pi.y - pj.y
      const dz = pi.z - pj.z
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const bin = Math.floor(r / dr)
      if (bin < 0 || bin >= radialBins) continue

      const vjx = toFinite(pj.flowVx, toFinite(pj.vx, 0))
      const vjy = toFinite(pj.flowVy, toFinite(pj.vy, 0))
      const vjz = toFinite(pj.flowVz, toFinite(pj.vz, 0))
      corrSum[bin] += vix * vjx + viy * vjy + viz * vjz
      corrCount[bin] += 1
    }
  }

  const correlation = new Float64Array(radialBins)
  for (let b = 0; b < radialBins; b += 1) {
    correlation[b] = corrCount[b] > 0 ? corrSum[b] / corrCount[b] : 0
  }

  const wavenumbers = new Float64Array(radialBins)
  const spectrum = new Float64Array(radialBins)

  for (let ki = 0; ki < radialBins; ki += 1) {
    const k = (ki + 1) * Math.PI / maxR
    wavenumbers[ki] = k
    let Ek = 0
    for (let ri = 0; ri < radialBins; ri += 1) {
      const r = (ri + 0.5) * dr
      const kr = k * r
      const sincKr = kr > 1e-6 ? Math.sin(kr) / kr : 1
      Ek += correlation[ri] * sincKr * 4 * Math.PI * r * r * dr
    }
    spectrum[ki] = Math.max(0, Ek / (2 * Math.PI))
  }

  let kolmogorovSlope = 0
  const logK = []
  const logE = []
  for (let ki = 1; ki < radialBins - 1; ki += 1) {
    if (spectrum[ki] > 1e-12 && wavenumbers[ki] > 1e-8) {
      logK.push(Math.log(wavenumbers[ki]))
      logE.push(Math.log(spectrum[ki]))
    }
  }
  if (logK.length >= 3) {
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
    for (let i = 0; i < logK.length; i += 1) {
      sumX += logK[i]
      sumY += logE[i]
      sumXY += logK[i] * logE[i]
      sumX2 += logK[i] * logK[i]
    }
    const n = logK.length
    const denom = n * sumX2 - sumX * sumX
    if (Math.abs(denom) > 1e-12) {
      kolmogorovSlope = (n * sumXY - sumX * sumY) / denom
    }
  }

  return { wavenumbers, spectrum, kolmogorovSlope, correlation, maxRadius: maxR }
}
