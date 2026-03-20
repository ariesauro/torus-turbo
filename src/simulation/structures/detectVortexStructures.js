function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function toFinite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

function buildCellKey(ix, iy, iz) {
  return `${ix}:${iy}:${iz}`
}

function computeCovariance(points, center) {
  let cxx = 0
  let cxy = 0
  let cxz = 0
  let cyy = 0
  let cyz = 0
  let czz = 0
  const count = points.length
  if (count <= 1) {
    return { cxx: 0, cxy: 0, cxz: 0, cyy: 0, cyz: 0, czz: 0 }
  }
  for (let i = 0; i < count; i += 1) {
    const px = points[i].x - center.x
    const py = points[i].y - center.y
    const pz = points[i].z - center.z
    cxx += px * px
    cxy += px * py
    cxz += px * pz
    cyy += py * py
    cyz += py * pz
    czz += pz * pz
  }
  const inv = 1 / (count - 1)
  return {
    cxx: cxx * inv,
    cxy: cxy * inv,
    cxz: cxz * inv,
    cyy: cyy * inv,
    cyz: cyz * inv,
    czz: czz * inv,
  }
}

function eigenvalues3x3Symmetric(cov) {
  const a = cov.cxx, b = cov.cyy, c = cov.czz
  const d = cov.cxy, e = cov.cxz, f = cov.cyz
  const p1 = d * d + e * e + f * f
  if (p1 < 1e-20) {
    const vals = [a, b, c].sort((x, y) => y - x)
    return { l1: Math.max(0, vals[0]), l2: Math.max(0, vals[1]), l3: Math.max(0, vals[2]) }
  }
  const q = (a + b + c) / 3
  const p2 = (a - q) * (a - q) + (b - q) * (b - q) + (c - q) * (c - q) + 2 * p1
  const p = Math.sqrt(Math.max(0, p2 / 6))
  const invP = p > 1e-15 ? 1 / p : 0
  const B00 = (a - q) * invP, B11 = (b - q) * invP, B22 = (c - q) * invP
  const B01 = d * invP, B02 = e * invP, B12 = f * invP
  const detB = B00 * (B11 * B22 - B12 * B12) -
    B01 * (B01 * B22 - B12 * B02) +
    B02 * (B01 * B12 - B11 * B02)
  const halfDetB = clamp(detB / 2, -1, 1)
  const phi = Math.acos(halfDetB) / 3
  const l1 = q + 2 * p * Math.cos(phi)
  const l3 = q + 2 * p * Math.cos(phi + (2 * Math.PI / 3))
  const l2 = 3 * q - l1 - l3
  return { l1: Math.max(0, l1), l2: Math.max(0, l2), l3: Math.max(0, l3) }
}

function powerIterationLargestEigenvalue(cov, _iterations = 8) {
  return eigenvalues3x3Symmetric(cov).l1
}

function computeCirculationClosureScore(points, center) {
  if (points.length < 6) return 0
  const sorted = points.map((p) => {
    const dx = p.x - center.x
    const dy = p.y - center.y
    return Math.atan2(dy, dx)
  }).sort((a, b) => a - b)
  let maxGap = 0
  for (let i = 1; i < sorted.length; i++) {
    maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1])
  }
  maxGap = Math.max(maxGap, (2 * Math.PI) - sorted[sorted.length - 1] + sorted[0])
  const idealGap = (2 * Math.PI) / sorted.length
  return clamp(1 - (maxGap - idealGap) / Math.PI, 0, 1)
}

function computeClusterShapeStats(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return {
      center: { x: 0, y: 0, z: 0 },
      meanRadius: 0,
      radiusStd: 0,
      elongation: 0,
      planarity: 0,
      linearity: 0,
      circulationClosure: 0,
      count: 0,
    }
  }
  let cx = 0
  let cy = 0
  let cz = 0
  for (let i = 0; i < points.length; i += 1) {
    cx += points[i].x
    cy += points[i].y
    cz += points[i].z
  }
  const inv = 1 / points.length
  const center = { x: cx * inv, y: cy * inv, z: cz * inv }
  let sumRadius = 0
  const radii = new Float32Array(points.length)
  for (let i = 0; i < points.length; i += 1) {
    const r = Math.hypot(points[i].x - center.x, points[i].y - center.y, points[i].z - center.z)
    radii[i] = r
    sumRadius += r
  }
  const meanRadius = sumRadius * inv
  let radiusVar = 0
  for (let i = 0; i < radii.length; i += 1) {
    const dr = radii[i] - meanRadius
    radiusVar += dr * dr
  }
  radiusVar *= inv
  const radiusStd = Math.sqrt(Math.max(0, radiusVar))
  const cov = computeCovariance(points, center)
  const eig = eigenvalues3x3Symmetric(cov)
  const trace = eig.l1 + eig.l2 + eig.l3
  const elongation = trace > 1e-8 ? clamp(eig.l1 / trace, 0, 1) : 0
  const planarity = trace > 1e-8 ? clamp((eig.l2 - eig.l3) / trace, 0, 1) : 0
  const linearity = trace > 1e-8 ? clamp((eig.l1 - eig.l2) / trace, 0, 1) : 0
  const circulationClosure = computeCirculationClosureScore(points, center)
  return {
    center,
    meanRadius,
    radiusStd,
    elongation,
    planarity,
    linearity,
    circulationClosure,
    count: points.length,
  }
}

export function createStructureDetectionState() {
  return {
    frameSerial: 0,
    confidenceEma: 0,
    calibration: {
      minClusterScale: 1,
      filamentElongationBias: 0,
      ringRadiusStdBias: 0,
      tubeRadiusStdBias: 0,
    },
    lastDetections: {
      filamentCount: 0,
      ringCount: 0,
      tubeCount: 0,
      sheetCount: 0,
      clusterCount: 0,
      confidence: 0,
      confidenceRaw: 0,
      sheetSurfaceCoherence: 0,
      sheetCurvatureAnisotropy: 0,
      classConfidenceFilament: 0,
      classConfidenceRing: 0,
      classConfidenceTube: 0,
      classConfidenceSheet: 0,
      sampleCount: 0,
      elapsedMs: 0,
      effectiveMinClusterSize: 0,
      effectiveFilamentElongationMin: 0,
      effectiveRingRadiusStdRatioMax: 0,
      effectiveTubeRadiusStdRatioMax: 0,
      overlayFeatures: [],
    },
  }
}

export function detectVortexStructures(particles, params, detectionState = null) {
  const state = detectionState ?? createStructureDetectionState()
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const enabled = params?.structureDetectionEnabled !== false
  if (!enabled || !Array.isArray(particles) || particles.length === 0) {
    state.frameSerial += 1
    state.lastDetections = {
      filamentCount: 0,
      ringCount: 0,
      tubeCount: 0,
      sheetCount: 0,
      clusterCount: 0,
      confidence: 0,
      confidenceRaw: 0,
      sheetSurfaceCoherence: 0,
      sheetCurvatureAnisotropy: 0,
      classConfidenceFilament: 0,
      classConfidenceRing: 0,
      classConfidenceTube: 0,
      classConfidenceSheet: 0,
      sampleCount: 0,
      elapsedMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt,
      effectiveMinClusterSize: 0,
      effectiveFilamentElongationMin: 0,
      effectiveRingRadiusStdRatioMax: 0,
      effectiveTubeRadiusStdRatioMax: 0,
      overlayFeatures: [],
    }
    return state.lastDetections
  }

  const gridCellSize = Math.max(toFinite(params?.structureDetectionCellSize, 0.45), 0.05)
  const autoCalibrate = params?.structureDetectionAutoCalibrate !== false
  const confidenceTarget = clamp(toFinite(params?.structureDetectionConfidenceTarget, 0.62), 0.3, 0.95)
  const confidenceEmaAlpha = clamp(toFinite(params?.structureDetectionEmaAlpha, 0.2), 0.05, 0.8)
  const baseMinClusterSize = Math.max(
    4,
    Math.floor(toFinite(params?.structureDetectionMinClusterSize, 16)),
  )
  const baseFilamentElongationMin = clamp(
    toFinite(params?.structureDetectionFilamentElongationMin, 0.7),
    0.45,
    0.95,
  )
  const baseRingRadiusStdRatioMax = clamp(
    toFinite(params?.structureDetectionRingRadiusStdRatioMax, 0.28),
    0.08,
    0.6,
  )
  const baseTubeRadiusStdRatioMax = clamp(
    toFinite(params?.structureDetectionTubeRadiusStdRatioMax, 0.18),
    0.05,
    0.5,
  )
  const effectiveMinClusterSize = Math.max(
    4,
    Math.floor(baseMinClusterSize * (state.calibration.minClusterScale ?? 1)),
  )
  const effectiveFilamentElongationMin = clamp(
    baseFilamentElongationMin + (state.calibration.filamentElongationBias ?? 0),
    0.45,
    0.95,
  )
  const effectiveRingRadiusStdRatioMax = clamp(
    baseRingRadiusStdRatioMax + (state.calibration.ringRadiusStdBias ?? 0),
    0.08,
    0.6,
  )
  const effectiveTubeRadiusStdRatioMax = clamp(
    baseTubeRadiusStdRatioMax + (state.calibration.tubeRadiusStdBias ?? 0),
    0.05,
    0.5,
  )
  const maxSamples = Math.max(256, Math.floor(toFinite(params?.structureDetectionMaxSamples, 5000)))
  const sampleStride = Math.max(1, Math.ceil(particles.length / maxSamples))
  const cells = new Map()
  let sampleCount = 0
  for (let i = 0; i < particles.length; i += sampleStride) {
    const p = particles[i]
    if (!p) continue
    const ix = Math.floor((p.x ?? 0) / gridCellSize)
    const iy = Math.floor((p.y ?? 0) / gridCellSize)
    const iz = Math.floor((p.z ?? 0) / gridCellSize)
    const key = buildCellKey(ix, iy, iz)
    if (!cells.has(key)) {
      cells.set(key, [])
    }
    cells.get(key).push({ x: p.x ?? 0, y: p.y ?? 0, z: p.z ?? 0 })
    sampleCount += 1
  }

  let clusterCount = 0
  let filamentCount = 0
  let ringCount = 0
  let tubeCount = 0
  let sheetCount = 0
  let confidenceAccum = 0
  let confidenceCount = 0
  let sheetSurfaceCoherenceAccum = 0
  let sheetCurvatureAnisotropyAccum = 0
  let classConfidenceFilamentAccum = 0
  let classConfidenceRingAccum = 0
  let classConfidenceTubeAccum = 0
  let classConfidenceSheetAccum = 0
  const overlayFeatures = []
  for (const cellPoints of cells.values()) {
    if (cellPoints.length < effectiveMinClusterSize) {
      continue
    }
    clusterCount += 1
    const shape = computeClusterShapeStats(cellPoints)
    const filamentCandidate = shape.linearity >= 0.3 && shape.elongation >= effectiveFilamentElongationMin
    const radiusStdRatio = shape.radiusStd / Math.max(shape.meanRadius, 1e-6)
    const ringCandidate =
      shape.elongation >= 0.35 &&
      shape.elongation <= 0.78 &&
      shape.meanRadius > 1e-5 &&
      radiusStdRatio <= effectiveRingRadiusStdRatioMax &&
      shape.circulationClosure >= 0.3
    const tubeCandidate =
      ringCandidate &&
      shape.planarity >= 0.15 &&
      radiusStdRatio <= effectiveTubeRadiusStdRatioMax
    const curvatureAnisotropy = clamp(Math.abs(shape.elongation - shape.planarity), 0, 1)
    const surfaceCoherence = clamp(shape.planarity * (1 - curvatureAnisotropy * 0.65), 0, 1)
    const sheetCandidate =
      !tubeCandidate &&
      !ringCandidate &&
      shape.planarity >= 0.52 &&
      shape.elongation >= 0.2 &&
      shape.elongation <= 0.7
    if (filamentCandidate) filamentCount += 1
    if (ringCandidate) ringCount += 1
    if (tubeCandidate) tubeCount += 1
    if (sheetCandidate) sheetCount += 1
    const localConfidence = clamp(
      (shape.elongation * 0.55 + (1 - clamp(shape.radiusStd / Math.max(shape.meanRadius, 1e-6), 0, 1)) * 0.45),
      0,
      1,
    )
    const localFilamentConfidence = clamp(
      (shape.elongation - effectiveFilamentElongationMin) / Math.max(1e-6, 1 - effectiveFilamentElongationMin),
      0,
      1,
    )
    const localRingConfidence = clamp(
      (1 - clamp(shape.radiusStd / Math.max(shape.meanRadius, 1e-6), 0, 1)) * 0.6 +
        clamp(1 - Math.abs(shape.elongation - 0.62) / 0.38, 0, 1) * 0.4,
      0,
      1,
    )
    const localTubeConfidence = clamp(localRingConfidence * (0.45 + shape.planarity * 0.55), 0, 1)
    const localSheetConfidence = clamp(surfaceCoherence * 0.7 + (1 - curvatureAnisotropy) * 0.3, 0, 1)
    confidenceAccum += localConfidence
    confidenceCount += 1
    classConfidenceFilamentAccum += localFilamentConfidence
    classConfidenceRingAccum += localRingConfidence
    classConfidenceTubeAccum += localTubeConfidence
    classConfidenceSheetAccum += localSheetConfidence
    sheetSurfaceCoherenceAccum += surfaceCoherence
    sheetCurvatureAnisotropyAccum += curvatureAnisotropy
    const structureClass = tubeCandidate
      ? 'tube'
      : ringCandidate
        ? 'ring'
        : sheetCandidate
          ? 'sheet'
        : filamentCandidate
          ? 'filament'
          : 'cluster'
    overlayFeatures.push({
      class: structureClass,
      confidence: localConfidence,
      center: shape.center,
      radius: Math.max(1e-4, shape.meanRadius),
      count: shape.count,
      elongation: shape.elongation,
      planarity: shape.planarity,
      surfaceCoherence,
      curvatureAnisotropy,
    })
  }

  const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const confidenceRaw = confidenceCount > 0 ? confidenceAccum / confidenceCount : 0
  state.confidenceEma =
    state.frameSerial > 0
      ? state.confidenceEma + (confidenceRaw - state.confidenceEma) * confidenceEmaAlpha
      : confidenceRaw
  if (autoCalibrate) {
    const confidenceError = confidenceTarget - state.confidenceEma
    state.calibration.minClusterScale = clamp(
      (state.calibration.minClusterScale ?? 1) + confidenceError * -0.22,
      0.65,
      1.6,
    )
    state.calibration.filamentElongationBias = clamp(
      (state.calibration.filamentElongationBias ?? 0) + confidenceError * -0.08,
      -0.16,
      0.14,
    )
    state.calibration.ringRadiusStdBias = clamp(
      (state.calibration.ringRadiusStdBias ?? 0) + confidenceError * 0.06,
      -0.12,
      0.12,
    )
    state.calibration.tubeRadiusStdBias = clamp(
      (state.calibration.tubeRadiusStdBias ?? 0) + confidenceError * 0.05,
      -0.1,
      0.1,
    )
  }
  state.frameSerial += 1
  state.lastDetections = {
    filamentCount,
    ringCount,
    tubeCount,
    sheetCount,
    clusterCount,
    confidence: state.confidenceEma,
    confidenceRaw,
    sheetSurfaceCoherence:
      confidenceCount > 0 ? sheetSurfaceCoherenceAccum / confidenceCount : 0,
    sheetCurvatureAnisotropy:
      confidenceCount > 0 ? sheetCurvatureAnisotropyAccum / confidenceCount : 0,
    classConfidenceFilament:
      confidenceCount > 0 ? classConfidenceFilamentAccum / confidenceCount : 0,
    classConfidenceRing:
      confidenceCount > 0 ? classConfidenceRingAccum / confidenceCount : 0,
    classConfidenceTube:
      confidenceCount > 0 ? classConfidenceTubeAccum / confidenceCount : 0,
    classConfidenceSheet:
      confidenceCount > 0 ? classConfidenceSheetAccum / confidenceCount : 0,
    sampleCount,
    elapsedMs: finishedAt - startedAt,
    effectiveMinClusterSize,
    effectiveFilamentElongationMin,
    effectiveRingRadiusStdRatioMax,
    effectiveTubeRadiusStdRatioMax,
    overlayFeatures: overlayFeatures
      .slice()
      .sort((a, b) => b.confidence * b.count - a.confidence * a.count)
      .slice(0, 24),
  }
  return state.lastDetections
}
