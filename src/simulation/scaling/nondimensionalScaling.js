export const SCALE_CLASSES = {
  micro: {
    id: 'micro',
    title: 'Micro',
    lengthRefM: 0.001,
    velocityRefMs: 0.02,
    viscosityRefM2s: 1.5e-6,
    notes: 'Approximate incompressible micro-scale window',
  },
  lab: {
    id: 'lab',
    title: 'Laboratory',
    lengthRefM: 0.05,
    velocityRefMs: 1.2,
    viscosityRefM2s: 1.5e-5,
    notes: 'Water/smoke ring class reference',
  },
  atmospheric: {
    id: 'atmospheric',
    title: 'Atmospheric',
    lengthRefM: 500,
    velocityRefMs: 25,
    viscosityRefM2s: 1.5e-5,
    notes: 'Toy atmospheric vortex regime (no stratification model)',
  },
  astro: {
    id: 'astro',
    title: 'Astrophysical (toy)',
    lengthRefM: 1.0e9,
    velocityRefMs: 4.0e3,
    viscosityRefM2s: 1.0e6,
    notes: 'Toy class only; lacks MHD/compressibility fidelity',
  },
}

export const SCALE_PRESETS = {
  custom: {
    id: 'custom',
    title: 'Custom',
    scaleClass: 'lab',
    targetReynolds: 4500,
    targetStrouhal: 0.22,
    notes: 'Manual control over class/Re/St',
  },
  ring_pair_lab: {
    id: 'ring_pair_lab',
    title: 'Ring Pair (Lab)',
    scaleClass: 'lab',
    targetReynolds: 4200,
    targetStrouhal: 0.24,
    notes: 'Bounded lab ring interaction envelope',
  },
  jet_window_lab: {
    id: 'jet_window_lab',
    title: 'Jet Window (Lab)',
    scaleClass: 'lab',
    targetReynolds: 6500,
    targetStrouhal: 0.28,
    notes: 'Jet instability window for incompressible surrogate',
  },
  turbulence_lab: {
    id: 'turbulence_lab',
    title: 'Turbulence Window (Lab)',
    scaleClass: 'lab',
    targetReynolds: 7000,
    targetStrouhal: 0.2,
    notes: 'Transient cascade regime in lab-scale surrogate',
  },
  atmospheric_toy: {
    id: 'atmospheric_toy',
    title: 'Atmospheric (Toy)',
    scaleClass: 'atmospheric',
    targetReynolds: 1500000,
    targetStrouhal: 0.16,
    notes: 'Approximate atmospheric regime without stratification physics',
  },
  astro_toy: {
    id: 'astro_toy',
    title: 'Astro (Toy)',
    scaleClass: 'astro',
    targetReynolds: 100000,
    targetStrouhal: 0.08,
    notes: 'Toy-only mode without MHD/compressibility',
  },
}

const APPLICABILITY_BANDS = {
  micro: {
    reValid: [80, 12000],
    reApprox: [20, 80000],
    stValid: [0.08, 1.2],
    stApprox: [0.02, 2.0],
    minRossby: 0.1,
  },
  lab: {
    reValid: [500, 30000],
    reApprox: [100, 200000],
    stValid: [0.1, 0.8],
    stApprox: [0.02, 1.5],
    minRossby: 0.08,
  },
  atmospheric: {
    reValid: [100000, 10000000],
    reApprox: [10000, 50000000],
    stValid: [0.05, 0.5],
    stApprox: [0.01, 1.0],
    minRossby: 0.2,
  },
  astro: {
    reValid: [50000, 2000000],
    reApprox: [10000, 10000000],
    stValid: [0.01, 0.3],
    stApprox: [0.005, 0.8],
    minRossby: 0.5,
  },
}

function toFinite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toPositiveFinite(value, fallback, min = 1e-12) {
  const n = toFinite(value, fallback)
  return Math.max(min, n)
}

export function getScaleClassConfig(scaleClassId) {
  return SCALE_CLASSES[scaleClassId] ?? SCALE_CLASSES.lab
}

export function getScalePresetById(presetId) {
  return SCALE_PRESETS[presetId] ?? SCALE_PRESETS.custom
}

export function getScalePresetOptions() {
  return Object.values(SCALE_PRESETS).map((preset) => ({
    value: preset.id,
    label: preset.title,
  }))
}

export function evaluateScaleApplicability({
  scaleClass = 'lab',
  reynolds,
  strouhal,
  rossby = Number.POSITIVE_INFINITY,
} = {}) {
  const band = APPLICABILITY_BANDS[scaleClass] ?? APPLICABILITY_BANDS.lab
  const re = Math.max(0, toFinite(reynolds, 0))
  const st = Math.max(0, toFinite(strouhal, 0))
  const ro = Math.max(0, toFinite(rossby, Number.POSITIVE_INFINITY))
  const reasons = []
  let level = 'valid'

  if (scaleClass === 'astro') {
    level = 'approximate'
    reasons.push('astro_class_requires_mhd_and_compressibility_models')
  }
  if (scaleClass === 'atmospheric') {
    level = 'approximate'
    reasons.push('atmospheric_class_without_stratification_and_coriolis_closure')
  }
  if (re < band.reApprox[0] || re > band.reApprox[1]) {
    level = 'unsupported'
    reasons.push('reynolds_outside_supported_envelope')
  } else if (re < band.reValid[0] || re > band.reValid[1]) {
    level = level === 'valid' ? 'approximate' : level
    reasons.push('reynolds_outside_valid_window')
  }
  if (st < band.stApprox[0] || st > band.stApprox[1]) {
    level = 'unsupported'
    reasons.push('strouhal_outside_supported_envelope')
  } else if (st < band.stValid[0] || st > band.stValid[1]) {
    level = level === 'valid' ? 'approximate' : level
    reasons.push('strouhal_outside_valid_window')
  }
  if (Number.isFinite(ro) && ro < band.minRossby) {
    level = level === 'valid' ? 'approximate' : level
    reasons.push('strong_rotation_effects_not_fully_modeled')
  }

  return {
    level,
    reasons,
  }
}

export function validateScalingRequest({
  scaleClass = 'lab',
  targetReynolds,
  targetStrouhal,
  referenceLengthM,
} = {}) {
  const errors = []
  const warnings = []
  const cls = getScaleClassConfig(scaleClass)
  const Re = toFinite(targetReynolds, (cls.velocityRefMs * cls.lengthRefM) / cls.viscosityRefM2s)
  const St = toFinite(targetStrouhal, 0.2)
  const L = toFinite(referenceLengthM, cls.lengthRefM)
  if (!Number.isFinite(Re) || Re <= 0) {
    errors.push('target_reynolds_must_be_positive_finite')
  }
  if (!Number.isFinite(St) || St <= 0) {
    errors.push('target_strouhal_must_be_positive_finite')
  }
  if (!Number.isFinite(L) || L <= 0) {
    errors.push('reference_length_must_be_positive_finite')
  }
  if (Re > 1e9) {
    warnings.push('target_reynolds_extremely_high')
  }
  if (St > 10) {
    warnings.push('target_strouhal_extremely_high')
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalized: {
      scaleClass: cls.id,
      targetReynolds: toPositiveFinite(Re, 1e3, 1e-6),
      targetStrouhal: toPositiveFinite(St, 0.2, 1e-9),
      referenceLengthM: toPositiveFinite(L, cls.lengthRefM, 1e-9),
    },
  }
}

export function computeScalingConsistencyReport({
  lengthScale,
  velocityScale,
  kinematicViscosity,
  forcingPeriodSec,
  targetReynolds,
  targetStrouhal,
} = {}) {
  const achieved = computeNondimensionalGroups({
    lengthScale,
    velocityScale,
    kinematicViscosity,
    forcingPeriodSec,
  })
  const targetRe = toPositiveFinite(targetReynolds, achieved.reynolds, 1e-12)
  const targetSt = toPositiveFinite(targetStrouhal, achieved.strouhal, 1e-12)
  const reynoldsErrorPct = Math.abs(((achieved.reynolds - targetRe) / targetRe) * 100)
  const strouhalErrorPct = Math.abs(((achieved.strouhal - targetSt) / targetSt) * 100)
  return {
    achieved,
    errors: {
      reynoldsErrorPct,
      strouhalErrorPct,
      maxErrorPct: Math.max(reynoldsErrorPct, strouhalErrorPct),
    },
  }
}

export function computeNondimensionalGroups({
  lengthScale,
  velocityScale,
  kinematicViscosity,
  forcingPeriodSec,
  rotationRateRadSec,
} = {}) {
  const L = Math.max(1e-12, toFinite(lengthScale, 1))
  const U = Math.max(1e-12, toFinite(velocityScale, 1))
  const nu = Math.max(1e-16, toFinite(kinematicViscosity, 1e-3))
  const forcingPeriod = Math.max(1e-12, toFinite(forcingPeriodSec, L / U))
  const omega = Math.max(0, toFinite(rotationRateRadSec, 0))

  const reynolds = (U * L) / nu
  const strouhal = L / (U * forcingPeriod)
  const rossby = omega > 1e-12 ? U / (2 * omega * L) : Number.POSITIVE_INFINITY

  return {
    reynolds,
    strouhal,
    rossby,
    reference: {
      L,
      U,
      nu,
      forcingPeriod,
      omega,
    },
  }
}

export const DISCRETIZATION_DENSITY_TARGETS = {
  micro: { particlesPerDiameter: 32, minRingResolution: 48, sigmaToLRatio: 0.06, interactionRadiusToL: 2.5 },
  lab: { particlesPerDiameter: 48, minRingResolution: 64, sigmaToLRatio: 0.05, interactionRadiusToL: 2.0 },
  atmospheric: { particlesPerDiameter: 24, minRingResolution: 48, sigmaToLRatio: 0.08, interactionRadiusToL: 3.0 },
  astro: { particlesPerDiameter: 16, minRingResolution: 32, sigmaToLRatio: 0.1, interactionRadiusToL: 4.0 },
}

export function buildRuntimeScalingPatch({
  scaleClass = 'lab',
  targetReynolds,
  targetStrouhal,
  currentParams = {},
} = {}) {
  const cls = getScaleClassConfig(scaleClass)
  const Re = toPositiveFinite(targetReynolds, 4500, 1)
  const St = toPositiveFinite(targetStrouhal, 0.22, 1e-6)

  const L_sim = toPositiveFinite(currentParams.nozzleRadius, 0.5, 0.01)
  const D_sim = 2 * L_sim
  const U_sim = toPositiveFinite(currentParams.jetSpeed, 3, 0.01)

  const nu = (U_sim * D_sim) / Re
  const forcingFreq = (St * U_sim) / D_sim
  const pulseDuration = forcingFreq > 0 ? 1 / forcingFreq : 0.05

  const density = DISCRETIZATION_DENSITY_TARGETS[scaleClass] ?? DISCRETIZATION_DENSITY_TARGETS.lab
  const sigma = density.sigmaToLRatio * D_sim
  const minSigma = sigma * 0.1
  const interactionR = density.interactionRadiusToL * L_sim
  const ringRes = Math.max(density.minRingResolution, Math.round(density.particlesPerDiameter * Math.PI))
  const reconnectDist = sigma * 0.1

  const physicsScaleFactor = cls.lengthRefM / L_sim
  const viewScale = 1 / physicsScaleFactor

  return {
    patch: {
      viscosity: nu,
      physicalViscosityNu: nu,
      physicalViscosityEnabled: nu > 1e-12,
      physicalPseEnabled: nu > 1e-12,
      coreRadiusSigma: sigma,
      minCoreRadius: minSigma,
      interactionRadius: interactionR,
      ringResolution: ringRes,
      pulseDuration,
      reconnectionDistance: reconnectDist,
      reconnectDistanceThreshold: reconnectDist,
    },
    scaling: {
      scaleClass: cls.id,
      lengthRefM: cls.lengthRefM,
      velocityRefMs: cls.velocityRefMs,
      L_sim,
      U_sim,
      D_sim,
      physicsScaleFactor,
      viewScale,
    },
    nondimensional: {
      reynolds: Re,
      strouhal: St,
      achievedReynolds: (U_sim * D_sim) / nu,
      achievedStrouhal: forcingFreq > 0 ? (forcingFreq * D_sim) / U_sim : 0,
    },
    density,
    applicability: evaluateScaleApplicability({
      scaleClass: cls.id,
      reynolds: Re,
      strouhal: St,
    }),
  }
}

export function buildDimensionalScalingPatch({
  scaleClass = 'lab',
  targetReynolds,
  targetStrouhal,
  referenceLengthM,
} = {}) {
  const validation = validateScalingRequest({
    scaleClass,
    targetReynolds,
    targetStrouhal,
    referenceLengthM,
  })
  const ref = getScaleClassConfig(validation.normalized.scaleClass)
  const L = validation.normalized.referenceLengthM
  const U = Math.max(1e-9, toFinite(ref.velocityRefMs, 1))
  const Re = Math.max(1e-3, validation.normalized.targetReynolds)
  const St = Math.max(1e-6, validation.normalized.targetStrouhal)

  const nu = (U * L) / Re
  const forcingPeriod = L / (U * St)
  const applicability = evaluateScaleApplicability({
    scaleClass: ref.id,
    reynolds: Re,
    strouhal: St,
  })

  return {
    scaleClass: ref.id,
    lengthScale: L,
    velocityScale: U,
    kinematicViscosity: nu,
    forcingPeriodSec: forcingPeriod,
    nondimensional: {
      reynolds: Re,
      strouhal: St,
    },
    applicability: applicability.level,
    applicabilityReasons: applicability.reasons,
    validation,
    consistency: computeScalingConsistencyReport({
      lengthScale: L,
      velocityScale: U,
      kinematicViscosity: nu,
      forcingPeriodSec: forcingPeriod,
      targetReynolds: Re,
      targetStrouhal: St,
    }),
    notes: ref.notes,
  }
}
