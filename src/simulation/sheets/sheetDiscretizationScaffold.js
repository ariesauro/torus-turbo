function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function toFinite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function structureClassWeight(kind) {
  if (kind === 'tube') return 1.35
  if (kind === 'ring') return 1.2
  if (kind === 'filament') return 0.95
  if (kind === 'cluster') return 0.8
  return 0.75
}

function fnv1a32(input) {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function buildMeshSeed(structures) {
  if (!Array.isArray(structures) || structures.length === 0) return 0
  let acc = ''
  for (let i = 0; i < structures.length; i += 1) {
    const item = structures[i] ?? {}
    const kind = String(item.class ?? 'cluster')
    const confidence = clamp01(toFinite(item.confidence, 0))
    const count = Math.max(1, Math.floor(toFinite(item.count, 1)))
    const radius = Math.max(1e-4, toFinite(item.radius, 0.2))
    acc += `${kind}:${count}:${confidence.toFixed(3)}:${radius.toFixed(4)}|`
  }
  return fnv1a32(acc)
}

function resolveQuadratureProfile(order, readiness) {
  if (order >= 4) return readiness >= 0.7 ? 'gauss_legendre_4x4' : 'gauss_legendre_4x2'
  if (order === 3) return readiness >= 0.55 ? 'gauss_legendre_3x3' : 'gauss_legendre_3x2'
  if (order === 2) return 'gauss_legendre_2x2'
  return 'gauss_legendre_1x2'
}

function resolveDiscretizationProfile(params, panelCount) {
  const hardwareClass = String(params?.performanceHardwareClass ?? 'unknown').toLowerCase()
  const mode = String(params?.executionMode ?? 'hybrid').toLowerCase()
  if (hardwareClass === 'high' || panelCount >= 2600) {
    return {
      id: 'sheet_profile_high_precision',
      maxQuadratureOrder: 4,
      epsilonScale: 0.9,
      imbalancePassMax: 0.45,
      imbalanceWarnMax: 0.8,
      edgeRatioPassMax: 2.5,
      edgeRatioWarnMax: 3.2,
      areaCvPassMax: 0.32,
      areaCvWarnMax: 0.5,
      curvaturePassMax: 3.2,
      curvatureWarnMax: 4.2,
    }
  }
  if (mode === 'gpu' || hardwareClass === 'entry_gpu') {
    return {
      id: 'sheet_profile_gpu_guarded',
      maxQuadratureOrder: 3,
      epsilonScale: 1.05,
      imbalancePassMax: 0.58,
      imbalanceWarnMax: 0.95,
      edgeRatioPassMax: 2.9,
      edgeRatioWarnMax: 3.6,
      areaCvPassMax: 0.42,
      areaCvWarnMax: 0.62,
      curvaturePassMax: 3.8,
      curvatureWarnMax: 4.9,
    }
  }
  if (hardwareClass === 'low') {
    return {
      id: 'sheet_profile_low_safe',
      maxQuadratureOrder: 2,
      epsilonScale: 1.12,
      imbalancePassMax: 0.72,
      imbalanceWarnMax: 1.1,
      edgeRatioPassMax: 3.3,
      edgeRatioWarnMax: 4.1,
      areaCvPassMax: 0.5,
      areaCvWarnMax: 0.72,
      curvaturePassMax: 4.2,
      curvatureWarnMax: 5.4,
    }
  }
  return {
    id: 'sheet_profile_balanced',
    maxQuadratureOrder: 3,
    epsilonScale: 1,
    imbalancePassMax: 0.52,
    imbalanceWarnMax: 0.88,
    edgeRatioPassMax: 2.7,
    edgeRatioWarnMax: 3.4,
    areaCvPassMax: 0.36,
    areaCvWarnMax: 0.56,
    curvaturePassMax: 3.4,
    curvatureWarnMax: 4.5,
  }
}

function resolveGateStatus(okPass, okWarn) {
  if (okPass) return 'pass'
  if (okWarn) return 'warn'
  return 'fail'
}

function buildDeterministicPatchPanelLayout({
  meshSeed,
  patchCount,
  panelCount,
}) {
  const safePatchCount = Math.max(1, Math.floor(toFinite(patchCount, 1)))
  const safePanelCount = Math.max(0, Math.floor(toFinite(panelCount, 0)))
  if (safePanelCount <= 0) {
    return {
      deterministic: true,
      layoutDigest: fnv1a32(`empty:${meshSeed}:${safePatchCount}`),
      patchPanelMin: 0,
      patchPanelMax: 0,
      patchPanelImbalance: 0,
    }
  }
  const base = Math.floor(safePanelCount / safePatchCount)
  let remainder = safePanelCount - base * safePatchCount
  const counts = new Array(safePatchCount).fill(base)
  for (let i = 0; i < safePatchCount; i += 1) {
    const roll = fnv1a32(`${meshSeed}:${i}:roll`)
    if (remainder > 0 && roll % 5 !== 0) {
      counts[i] += 1
      remainder -= 1
    }
  }
  for (let i = 0; i < safePatchCount && remainder > 0; i += 1) {
    counts[i] += 1
    remainder -= 1
  }
  const panelMin = counts.reduce((acc, value) => Math.min(acc, value), Number.POSITIVE_INFINITY)
  const panelMax = counts.reduce((acc, value) => Math.max(acc, value), 0)
  const panelAvg = safePanelCount / safePatchCount
  const imbalance = panelAvg > 0 ? (panelMax - panelMin) / panelAvg : 0
  const digestInput = counts.map((value, index) => `${index}:${value}`).join('|')
  return {
    deterministic: true,
    layoutDigest: fnv1a32(`${meshSeed}:${safePanelCount}:${digestInput}`),
    patchPanelMin: Number.isFinite(panelMin) ? panelMin : 0,
    patchPanelMax: panelMax,
    patchPanelImbalance: imbalance,
  }
}

function buildMeshBuilderContract({
  profile,
  avgRadius,
  patchCount,
  structureRichness,
  readiness,
  demandCoverage,
  meshLayout,
  qualityVerdict,
}) {
  const safePatchCount = Math.max(1, Math.floor(toFinite(patchCount, 1)))
  const safeRadius = Math.max(1e-4, toFinite(avgRadius, 0.15))
  const imbalance = Math.max(0, toFinite(meshLayout?.patchPanelImbalance, 0))
  const patchAreaMean = (Math.PI * safeRadius * safeRadius) / safePatchCount
  const patchAreaCv = clamp01((imbalance * 0.7 + (1 - demandCoverage) * 0.3) / 1.2)
  const edgeLengthRatioP95 = 1 + (1 - readiness) * 1.2 + imbalance * 0.8
  const curvatureProxyP95 = 1 + structureRichness * 2 + (1 - demandCoverage) * 1.5
  const gates = {
    imbalance: {
      status: resolveGateStatus(
        imbalance <= profile.imbalancePassMax,
        imbalance <= profile.imbalanceWarnMax,
      ),
      value: imbalance,
      passMax: profile.imbalancePassMax,
      warnMax: profile.imbalanceWarnMax,
    },
    areaCv: {
      status: resolveGateStatus(
        patchAreaCv <= profile.areaCvPassMax,
        patchAreaCv <= profile.areaCvWarnMax,
      ),
      value: patchAreaCv,
      passMax: profile.areaCvPassMax,
      warnMax: profile.areaCvWarnMax,
    },
    edgeRatioP95: {
      status: resolveGateStatus(
        edgeLengthRatioP95 <= profile.edgeRatioPassMax,
        edgeLengthRatioP95 <= profile.edgeRatioWarnMax,
      ),
      value: edgeLengthRatioP95,
      passMax: profile.edgeRatioPassMax,
      warnMax: profile.edgeRatioWarnMax,
    },
    curvatureProxyP95: {
      status: resolveGateStatus(
        curvatureProxyP95 <= profile.curvaturePassMax,
        curvatureProxyP95 <= profile.curvatureWarnMax,
      ),
      value: curvatureProxyP95,
      passMax: profile.curvaturePassMax,
      warnMax: profile.curvatureWarnMax,
    },
  }
  const gateStatuses = Object.values(gates).map((entry) => entry.status)
  const passCount = gateStatuses.filter((status) => status === 'pass').length
  const warnCount = gateStatuses.filter((status) => status === 'warn').length
  const failCount = gateStatuses.filter((status) => status === 'fail').length
  const issues = []
  if (qualityVerdict === 'fail') issues.push('quality_verdict_fail')
  if (failCount > 0) issues.push('mesh_contract_gate_fail')
  const verdict = failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass'
  const valid = verdict !== 'fail'
  const penalty = clamp01(failCount * 0.32 + warnCount * 0.1)
  return {
    version: 'tt021b.panel_mesh.v1',
    profileId: profile.id,
    valid,
    issueCount: issues.length,
    issues,
    gatePassCount: passCount,
    gateTotal: gateStatuses.length,
    verdict,
    penalty,
    envelope: {
      patchAreaMean,
      patchAreaCv,
      edgeLengthRatioP95,
      curvatureProxyP95,
    },
    gates,
  }
}

export function buildSheetPanelDiscretizationDiagnostics(params = {}) {
  const structures = Array.isArray(params.runtimeOverlayStructures) ? params.runtimeOverlayStructures : []
  const maxPanels = Math.max(64, Math.floor(toFinite(params.performanceMaxSheetPanels, 900)))
  const workloadBudget = clamp01(toFinite(params.performanceSheetWorkloadBudget, 0.35))
  const panelBudget = Math.max(32, Math.floor(maxPanels * Math.max(0.15, workloadBudget)))
  let demandedPanels = 0
  let avgRadiusAcc = 0
  let avgRadiusCount = 0
  for (let i = 0; i < structures.length; i += 1) {
    const item = structures[i] ?? {}
    const kind = String(item.class ?? 'cluster')
    const confidence = clamp01(toFinite(item.confidence, 0))
    const count = Math.max(1, Math.floor(toFinite(item.count, 1)))
    const radius = Math.max(1e-4, toFinite(item.radius, 0.2))
    const basePanels = Math.max(8, Math.floor(Math.sqrt(count) * 6 + Math.cbrt(radius) * 12))
    const weighted = Math.floor(basePanels * structureClassWeight(kind) * (0.45 + confidence * 0.55))
    demandedPanels += Math.max(8, weighted)
    avgRadiusAcc += radius
    avgRadiusCount += 1
  }
  const panelCount = Math.min(maxPanels, Math.min(panelBudget, demandedPanels))
  const avgRadius = avgRadiusCount > 0 ? avgRadiusAcc / avgRadiusCount : 0.15
  const profile = resolveDiscretizationProfile(params, panelCount)
  const quadratureOrderRaw =
    panelCount >= 2200 ? 4 : panelCount >= 900 ? 3 : panelCount >= 180 ? 2 : 1
  const quadratureOrder = Math.max(1, Math.min(profile.maxQuadratureOrder, quadratureOrderRaw))
  const desingularizationEpsilon = Math.max(1e-4, avgRadius * (0.12 - workloadBudget * 0.06) * profile.epsilonScale)
  const coverage = clamp01(panelCount / Math.max(1, maxPanels))
  const demandCoverage = clamp01(panelCount / Math.max(1, demandedPanels))
  const structureRichness = clamp01(structures.length / 8)
  const readiness = clamp01(coverage * 0.45 + demandCoverage * 0.3 + structureRichness * 0.25)
  const meshSeed = buildMeshSeed(structures)
  const topology = panelCount >= 1200 ? 'quad_patch' : panelCount >= 280 ? 'mixed_patch' : 'tri_fan'
  const panelsPerPatch = panelCount >= 1800 ? 96 : panelCount >= 700 ? 72 : 48
  const patchCount = Math.max(1, Math.ceil(Math.max(1, panelCount) / panelsPerPatch))
  const panelAspectP95 = Math.max(1, 1 + (1 - demandCoverage) * 1.5 + (1 - readiness) * 0.9)
  const quadratureProfile = resolveQuadratureProfile(quadratureOrder, readiness)
  const epsilonMin = Math.max(1e-5, avgRadius * 0.025)
  const epsilonMax = Math.max(epsilonMin, avgRadius * 0.15)
  const qualityGates = {
    aspect: {
      status: resolveGateStatus(panelAspectP95 <= 2.1, panelAspectP95 <= 2.6),
      value: panelAspectP95,
      passMax: 2.1,
      warnMax: 2.6,
    },
    coverage: {
      status: resolveGateStatus(coverage >= 0.45, coverage >= 0.3),
      value: coverage,
      passMin: 0.45,
      warnMin: 0.3,
    },
    demandCoverage: {
      status: resolveGateStatus(demandCoverage >= 0.7, demandCoverage >= 0.5),
      value: demandCoverage,
      passMin: 0.7,
      warnMin: 0.5,
    },
    epsilonBand: {
      status: resolveGateStatus(
        desingularizationEpsilon >= epsilonMin && desingularizationEpsilon <= epsilonMax,
        desingularizationEpsilon >= epsilonMin * 0.85 && desingularizationEpsilon <= epsilonMax * 1.2,
      ),
      value: desingularizationEpsilon,
      passRange: [epsilonMin, epsilonMax],
      warnRange: [epsilonMin * 0.85, epsilonMax * 1.2],
    },
  }
  const statuses = Object.values(qualityGates).map((entry) => entry.status)
  const gateTotal = statuses.length
  const gatePassCount = statuses.filter((status) => status === 'pass').length
  const gateWarnCount = statuses.filter((status) => status === 'warn').length
  const gateFailCount = statuses.filter((status) => status === 'fail').length
  const qualityVerdict = gateFailCount > 0 ? 'fail' : gateWarnCount > 0 ? 'warn' : 'pass'
  const qualityPenalty = clamp01(gateFailCount * 0.34 + gateWarnCount * 0.12)
  const meshLayout = buildDeterministicPatchPanelLayout({
    meshSeed,
    patchCount,
    panelCount,
  })
  const meshBuilderContract = buildMeshBuilderContract({
    profile,
    avgRadius,
    patchCount,
    structureRichness,
    readiness,
    demandCoverage,
    meshLayout,
    qualityVerdict,
  })
  return {
    panelCount,
    panelBudget,
    panelDemand: demandedPanels,
    profileId: profile.id,
    coverage,
    demandCoverage,
    quadratureOrder,
    quadratureProfile,
    desingularizationEpsilon,
    meshSeed,
    topology,
    patchCount,
    panelsPerPatch,
    panelAspectP95,
    qualityGates,
    qualityGatePassCount: gatePassCount,
    qualityGateTotal: gateTotal,
    qualityVerdict,
    qualityPenalty,
    meshLayout,
    meshBuilderContract,
    readiness,
  }
}
