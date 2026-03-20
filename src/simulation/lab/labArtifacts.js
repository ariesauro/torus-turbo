function toFinite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function quoteCsv(value) {
  const text = String(value ?? '')
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

function toSlug(value, fallback = 'unknown') {
  const text = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return text.length > 0 ? text : fallback
}

function toStamp(value = new Date().toISOString()) {
  const iso = String(value ?? new Date().toISOString())
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}z$/i, 'Z')
}

function toShortHash(value, maxLen = 12) {
  const normalized = String(value ?? 'unknown').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (normalized.length === 0) return 'unknown'
  return normalized.slice(0, Math.max(4, Math.floor(Number(maxLen) || 12)))
}

function deriveRunStatus(batchResult = {}) {
  const totals = batchResult?.totals ?? {}
  const failed = Math.max(0, Math.floor(Number(totals.failed ?? 0) || 0))
  const completed = Math.max(0, Math.floor(Number(totals.completed ?? 0) || 0))
  if (failed > 0 && completed > 0) return 'partial'
  if (failed > 0) return 'fail'
  return 'ok'
}

export function buildLabArtifactFileName({
  experiment,
  batchResult = {},
  artifactKind = 'result',
  extension = 'json',
  generatedAt = new Date().toISOString(),
} = {}) {
  const exp = experiment ?? {}
  const totals = batchResult?.totals ?? {}
  const runTotal = Math.max(0, Math.floor(Number(totals.total ?? 0) || 0))
  const status = deriveRunStatus(batchResult)
  const safeExperimentId = toSlug(exp.id ?? exp.title ?? 'lab-experiment', 'lab-experiment')
  const safeKind = toSlug(artifactKind, 'result')
  const safeExt = toSlug(extension, 'json')
  const shortHash = toShortHash(batchResult?.configHash ?? 'unknown')
  const stamp = toStamp(generatedAt)
  return `torus-lab-${safeExperimentId}-${safeKind}-${status}-r${runTotal}-${shortHash}-${stamp}.${safeExt}`
}

export function buildExperimentArtifactPayload({
  experiment,
  batchResult,
  metadata = {},
} = {}) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    experiment,
    metadata: {
      appVersion: metadata.appVersion ?? 'dev',
      gitSha: metadata.gitSha ?? 'unknown',
      configHash: batchResult?.configHash ?? 'unknown',
      hardwareProfile: metadata.hardwareProfile ?? 'unknown',
      runtimeBackend: metadata.runtimeBackend ?? 'unknown',
      performanceProfileId: metadata.performanceProfileId ?? 'unknown',
      uiLanguage: metadata.uiLanguage ?? 'unknown',
      timezone:
        metadata.timezone ??
        (typeof Intl !== 'undefined'
          ? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown'
          : 'unknown'),
      userAgent:
        metadata.userAgent ??
        (typeof navigator !== 'undefined' ? String(navigator.userAgent ?? 'unknown') : 'unknown'),
      source: metadata.source ?? 'lab_panel',
      artifactNamingContract: metadata.artifactNamingContract ?? 'tt038.lab_artifact_name.v1',
    },
    batchResult,
  }
}

export function buildExperimentSummaryRows(batchResult = {}) {
  const runs = Array.isArray(batchResult.runs) ? batchResult.runs : []
  return runs.map((run) => {
    const summary = run?.result?.summary ?? {}
    return {
      runIndex: Math.max(0, Math.floor(toFinite(run.runIndex, 0))),
      ok: run.ok === true,
      stepMedianMs: toFinite(summary.stepMedianMs, 0),
      stepP95Ms: toFinite(summary.stepP95Ms, 0),
      throughputMedianPps: toFinite(summary.throughputMedianPps, 0),
      energyDriftPct: toFinite(summary.energyDriftPct, 0),
      enstrophyDriftPct: toFinite(summary.enstrophyDriftPct, 0),
      circulationDriftPct: toFinite(summary.circulationDriftPct, 0),
      scalePresetId: String(summary.scalePresetId ?? 'custom'),
      scaleClass: String(summary.scaleClass ?? 'none'),
      scaleApplicability: String(summary.scaleApplicability ?? 'n/a'),
      scaleApplicabilityLevel: String(summary.scaleApplicabilityLevel ?? summary.scaleApplicability ?? 'n/a'),
      scaleApplicabilityReasons: String(summary.scaleApplicabilityReasons ?? ''),
      scaleValidationErrors: String(summary.scaleValidationErrors ?? ''),
      scaleValidationWarnings: String(summary.scaleValidationWarnings ?? ''),
      scaleConsistencyMaxErrorPct: toFinite(summary.scaleConsistencyMaxErrorPct, 0),
      reynolds: toFinite(summary.reynolds, 0),
      strouhal: toFinite(summary.strouhal, 0),
      rossby: toFinite(summary.rossby, 0),
      adaptiveEnabled: summary.adaptiveEnabled === true,
      adaptiveApplyToRuntime: summary.adaptiveApplyToRuntime === true,
      adaptiveDecisionCount: Math.max(0, Math.floor(toFinite(summary.adaptiveDecisionCount, 0))),
      adaptiveRefineCount: Math.max(0, Math.floor(toFinite(summary.adaptiveRefineCount, 0))),
      adaptiveCoarsenCount: Math.max(0, Math.floor(toFinite(summary.adaptiveCoarsenCount, 0))),
      adaptiveActuationAppliedCount: Math.max(0, Math.floor(toFinite(summary.adaptiveActuationAppliedCount, 0))),
      adaptiveActuationSkippedCount: Math.max(0, Math.floor(toFinite(summary.adaptiveActuationSkippedCount, 0))),
      adaptiveAcceptanceOk: summary.adaptiveAcceptanceOk === true,
      adaptiveAcceptanceFailedChecks: String(summary.adaptiveAcceptanceFailedChecks ?? ''),
      adaptiveControllerVerificationOk: summary.adaptiveControllerVerificationOk === true,
      adaptiveControllerVerificationFailedChecks: String(summary.adaptiveControllerVerificationFailedChecks ?? ''),
      adaptiveDominantLevel: String(summary.adaptiveDominantLevel ?? 'L1'),
      adaptiveTransitionCount: Math.max(0, Math.floor(toFinite(summary.adaptiveTransitionCount, 0))),
      adaptivePathComplexity: toFinite(summary.adaptivePathComplexity, 0),
      adaptiveOccupancyL0Pct: toFinite(summary.adaptiveOccupancyL0Pct, 0),
      adaptiveOccupancyL1Pct: toFinite(summary.adaptiveOccupancyL1Pct, 0),
      adaptiveOccupancyL2Pct: toFinite(summary.adaptiveOccupancyL2Pct, 0),
      adaptiveOccupancyL3Pct: toFinite(summary.adaptiveOccupancyL3Pct, 0),
      adaptiveAverageLevelIndex: toFinite(summary.adaptiveAverageLevelIndex, 1),
      adaptiveBaselineScenarioId: String(summary.adaptiveBaselineScenarioId ?? 'adaptive.mid'),
      adaptiveBaselineOk: summary.adaptiveBaselineOk === true,
      adaptiveBaselineFailedChecks: String(summary.adaptiveBaselineFailedChecks ?? ''),
      adaptiveTimeInL0Ms: Math.max(0, Math.floor(toFinite(summary.adaptiveTimeInL0Ms, 0))),
      adaptiveTimeInL1Ms: Math.max(0, Math.floor(toFinite(summary.adaptiveTimeInL1Ms, 0))),
      adaptiveTimeInL2Ms: Math.max(0, Math.floor(toFinite(summary.adaptiveTimeInL2Ms, 0))),
      adaptiveTimeInL3Ms: Math.max(0, Math.floor(toFinite(summary.adaptiveTimeInL3Ms, 0))),
      error: run.ok === true ? '' : String(run.error ?? 'run_failed'),
    }
  })
}

export function buildExperimentSummaryCsv(batchResult = {}) {
  const rows = buildExperimentSummaryRows(batchResult)
  const header = [
    'runIndex',
    'ok',
    'stepMedianMs',
    'stepP95Ms',
    'throughputMedianPps',
    'energyDriftPct',
    'enstrophyDriftPct',
    'circulationDriftPct',
    'scalePresetId',
    'scaleClass',
    'scaleApplicability',
    'scaleApplicabilityLevel',
    'scaleApplicabilityReasons',
    'scaleValidationErrors',
    'scaleValidationWarnings',
    'scaleConsistencyMaxErrorPct',
    'reynolds',
    'strouhal',
    'rossby',
    'adaptiveEnabled',
    'adaptiveApplyToRuntime',
    'adaptiveDecisionCount',
    'adaptiveRefineCount',
    'adaptiveCoarsenCount',
    'adaptiveActuationAppliedCount',
    'adaptiveActuationSkippedCount',
    'adaptiveAcceptanceOk',
    'adaptiveAcceptanceFailedChecks',
    'adaptiveControllerVerificationOk',
    'adaptiveControllerVerificationFailedChecks',
    'adaptiveDominantLevel',
    'adaptiveTransitionCount',
    'adaptivePathComplexity',
    'adaptiveOccupancyL0Pct',
    'adaptiveOccupancyL1Pct',
    'adaptiveOccupancyL2Pct',
    'adaptiveOccupancyL3Pct',
    'adaptiveAverageLevelIndex',
    'adaptiveBaselineScenarioId',
    'adaptiveBaselineOk',
    'adaptiveBaselineFailedChecks',
    'adaptiveTimeInL0Ms',
    'adaptiveTimeInL1Ms',
    'adaptiveTimeInL2Ms',
    'adaptiveTimeInL3Ms',
    'error',
  ]
  const lines = [header.join(',')]
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    lines.push(
      [
        row.runIndex,
        row.ok,
        row.stepMedianMs.toFixed(4),
        row.stepP95Ms.toFixed(4),
        row.throughputMedianPps.toFixed(2),
        row.energyDriftPct.toFixed(4),
        row.enstrophyDriftPct.toFixed(4),
        row.circulationDriftPct.toFixed(4),
        quoteCsv(row.scalePresetId),
        quoteCsv(row.scaleClass),
        quoteCsv(row.scaleApplicability),
        quoteCsv(row.scaleApplicabilityLevel),
        quoteCsv(row.scaleApplicabilityReasons),
        quoteCsv(row.scaleValidationErrors),
        quoteCsv(row.scaleValidationWarnings),
        row.scaleConsistencyMaxErrorPct.toFixed(6),
        row.reynolds.toFixed(4),
        row.strouhal.toFixed(6),
        Number.isFinite(row.rossby) ? row.rossby.toFixed(6) : 'inf',
        row.adaptiveEnabled,
        row.adaptiveApplyToRuntime,
        row.adaptiveDecisionCount,
        row.adaptiveRefineCount,
        row.adaptiveCoarsenCount,
        row.adaptiveActuationAppliedCount,
        row.adaptiveActuationSkippedCount,
        row.adaptiveAcceptanceOk,
        quoteCsv(row.adaptiveAcceptanceFailedChecks),
        row.adaptiveControllerVerificationOk,
        quoteCsv(row.adaptiveControllerVerificationFailedChecks),
        row.adaptiveDominantLevel,
        row.adaptiveTransitionCount,
        row.adaptivePathComplexity.toFixed(6),
        row.adaptiveOccupancyL0Pct.toFixed(4),
        row.adaptiveOccupancyL1Pct.toFixed(4),
        row.adaptiveOccupancyL2Pct.toFixed(4),
        row.adaptiveOccupancyL3Pct.toFixed(4),
        row.adaptiveAverageLevelIndex.toFixed(4),
        quoteCsv(row.adaptiveBaselineScenarioId),
        row.adaptiveBaselineOk,
        quoteCsv(row.adaptiveBaselineFailedChecks),
        row.adaptiveTimeInL0Ms,
        row.adaptiveTimeInL1Ms,
        row.adaptiveTimeInL2Ms,
        row.adaptiveTimeInL3Ms,
        quoteCsv(row.error),
      ].join(','),
    )
  }
  return lines.join('\n')
}

export function buildAdaptiveAcceptanceMatrixReport(batchResult = {}) {
  const rows = buildExperimentSummaryRows(batchResult)
  const total = rows.length
  const passAcceptance = rows.filter((row) => row.adaptiveAcceptanceOk).length
  const passController = rows.filter((row) => row.adaptiveControllerVerificationOk).length
  const passBaseline = rows.filter((row) => row.adaptiveBaselineOk).length
  const dominantCounts = { L0: 0, L1: 0, L2: 0, L3: 0 }
  for (let i = 0; i < rows.length; i += 1) {
    const level = String(rows[i].adaptiveDominantLevel ?? 'L1')
    if (Object.prototype.hasOwnProperty.call(dominantCounts, level)) {
      dominantCounts[level] += 1
    }
  }

  const byScenario = {}
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const id = String(row.adaptiveBaselineScenarioId ?? 'adaptive.mid')
    if (!byScenario[id]) {
      byScenario[id] = { total: 0, pass: 0 }
    }
    byScenario[id].total += 1
    if (row.adaptiveBaselineOk) byScenario[id].pass += 1
  }

  const lines = [
    '# Adaptive Acceptance Matrix',
    '',
    `Total runs: ${total}`,
    `Adaptive acceptance pass: ${passAcceptance}/${Math.max(1, total)}`,
    `Controller verification pass: ${passController}/${Math.max(1, total)}`,
    `Baseline scenario pass: ${passBaseline}/${Math.max(1, total)}`,
    '',
    '## Dominant Levels',
    `- L0: ${dominantCounts.L0}`,
    `- L1: ${dominantCounts.L1}`,
    `- L2: ${dominantCounts.L2}`,
    `- L3: ${dominantCounts.L3}`,
    '',
    '## Baseline Scenarios',
  ]
  const scenarioIds = Object.keys(byScenario).sort()
  for (let i = 0; i < scenarioIds.length; i += 1) {
    const id = scenarioIds[i]
    const item = byScenario[id]
    lines.push(`- ${id}: ${item.pass}/${Math.max(1, item.total)} pass`)
  }
  lines.push('', '## Run Rows')
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    lines.push(
      `- run ${row.runIndex}: acceptance=${row.adaptiveAcceptanceOk} controller=${row.adaptiveControllerVerificationOk} baseline=${row.adaptiveBaselineOk} scenario=${row.adaptiveBaselineScenarioId} dominant=${row.adaptiveDominantLevel} pathComplexity=${row.adaptivePathComplexity.toFixed(
        4,
      )}`,
    )
  }
  return lines.join('\n')
}
