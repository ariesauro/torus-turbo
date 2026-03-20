function clampFinite(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  if (n < min) return min
  if (n > max) return max
  return n
}

function toPctDelta(start, end) {
  const s = Math.max(1e-9, Math.abs(Number(start) || 0))
  const e = Number(end) || 0
  return ((e - (Number(start) || 0)) / s) * 100
}

export function evaluateStabilitySnapshot({
  startEnergy = 0,
  endEnergy = 0,
  startCirculation = 0,
  endCirculation = 0,
  velocityDivergence = 0,
  spacingRatio = 1,
  curvaturePeak = 0,
} = {}) {
  const energyErrorPct = toPctDelta(startEnergy, endEnergy)
  const circulationErrorPct = toPctDelta(startCirculation, endCirculation)
  const divergence = Math.max(0, Number(velocityDivergence) || 0)
  const spacing = Math.max(0, Number(spacingRatio) || 0)
  const curvature = Math.max(0, Number(curvaturePeak) || 0)

  const warnings = []
  const corrections = []
  let level = 'ok'
  let suggestedDtScale = 1

  if (Math.abs(energyErrorPct) > 25 || Math.abs(circulationErrorPct) > 10) {
    warnings.push('conservation_drift')
    level = 'warn'
    suggestedDtScale = Math.min(suggestedDtScale, 0.75)
  }
  if (divergence > 1000 || curvature > 8) {
    warnings.push('high_velocity_or_curvature')
    level = 'critical'
    suggestedDtScale = Math.min(suggestedDtScale, 0.6)
    corrections.push('reduce_timestep')
  }
  if (spacing < 0.5) {
    warnings.push('particle_overclustering')
    level = 'critical'
    suggestedDtScale = Math.min(suggestedDtScale, 0.5)
    corrections.push('merge_particles')
  } else if (spacing > 2.0) {
    warnings.push('particle_oversparse')
    level = level === 'critical' ? 'critical' : 'warn'
    corrections.push('split_particles')
  }

  return {
    runtimeStabilityLevel: level,
    runtimeStabilityWarnings: warnings,
    runtimeStabilityCorrections: corrections,
    runtimeStabilityEnergyErrorPct: clampFinite(energyErrorPct, -1e6, 1e6, 0),
    runtimeStabilityCirculationErrorPct: clampFinite(circulationErrorPct, -1e6, 1e6, 0),
    runtimeStabilityVelocityDivergence: clampFinite(divergence, 0, 1e9, 0),
    runtimeStabilitySuggestedDtScale: clampFinite(suggestedDtScale, 0.05, 1, 1),
  }
}
