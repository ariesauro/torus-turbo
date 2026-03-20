import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE_URL = process.env.TORUS_BASE_URL ?? 'http://localhost:5173/'
const OUTPUT_JSON = process.env.RESEARCH_PRESET_AUDIT_OUTPUT_JSON ?? './research-preset-pack-audit.json'
const OUTPUT_MD = process.env.RESEARCH_PRESET_AUDIT_OUTPUT_MD ?? './research-preset-pack-audit.md'
const FAIL_ON_GATE = String(process.env.RESEARCH_PRESET_AUDIT_FAIL_ON_GATE ?? 'false') === 'true'
const DURATION_SCALE = Math.max(
  0.1,
  Math.min(2, Number(process.env.RESEARCH_PRESET_AUDIT_DURATION_SCALE ?? 1) || 1),
)
const CASE_TIMEOUT_SEC = Math.max(0, Number(process.env.RESEARCH_PRESET_AUDIT_CASE_TIMEOUT_SEC ?? 0) || 0)
const TREND_PATH = process.env.RESEARCH_PRESET_AUDIT_TREND_PATH ?? './research-preset-pack-trend.json'
const TREND_MAX = Math.max(10, Number(process.env.RESEARCH_PRESET_AUDIT_TREND_MAX ?? 120) || 120)
const CASE_POLICY_PATH =
  process.env.RESEARCH_PRESET_AUDIT_CASE_POLICY_PATH ?? './research-preset-pack-case-policy.v1.json'
const CASE_POLICY_PROFILE = process.env.RESEARCH_PRESET_AUDIT_CASE_POLICY_PROFILE ?? ''
const TREND_POLICY_PATH =
  process.env.RESEARCH_PRESET_AUDIT_TREND_POLICY_PATH ?? './research-preset-pack-trend-policy.v1.json'
const TREND_POLICY_PROFILE = process.env.RESEARCH_PRESET_AUDIT_TREND_POLICY_PROFILE ?? ''
const DEFAULT_TREND_POLICY = {
  stepP95RegressMaxPct: 120,
  stepP95RegressBaselineFloor: 30,
  stepP95RegressAbsMs: 40,
  sampleCountDropMaxPct: 40,
  trendBaselineWindow: 6,
  trendMinBaselinePoints: 3,
}
let activeTrendPolicy = { ...DEFAULT_TREND_POLICY }
let activeTrendPolicyMeta = {
  path: null,
  profile: 'default',
  source: 'default',
}
const DEFAULT_CASE_THRESHOLDS_BY_PRESET = {
  vortex_ring_collision: { circulationDriftAbsMaxPct: 35, stepP95MsMax: 170 },
  vortex_leapfrogging: { circulationDriftAbsMaxPct: 35, stepP95MsMax: 170 },
  jet_instability: { circulationDriftAbsMaxPct: 45, stepP95MsMax: 170 },
  turbulence_cascade: { circulationDriftAbsMaxPct: 50, stepP95MsMax: 150 },
  helmholtz_shear: { circulationDriftAbsMaxPct: 45, stepP95MsMax: 170 },
  kelvin_wave_train: { circulationDriftAbsMaxPct: 40, stepP95MsMax: 170 },
  reconnection_pair: { circulationDriftAbsMaxPct: 50, stepP95MsMax: 170 },
}
let activeCaseThresholdsByPreset = { ...DEFAULT_CASE_THRESHOLDS_BY_PRESET }
let activeCasePolicyMeta = {
  path: null,
  profile: 'default',
  source: 'default',
}
const FAIL_ON_TREND_REGRESS =
  String(process.env.RESEARCH_PRESET_AUDIT_FAIL_ON_TREND_REGRESS ?? 'false') === 'true'
const FAIL_ON_INSUFFICIENT_BASELINE =
  String(process.env.RESEARCH_PRESET_AUDIT_FAIL_ON_INSUFFICIENT_BASELINE ?? 'false') === 'true'
const PLAYWRIGHT_HEADLESS = String(process.env.PLAYWRIGHT_HEADLESS ?? 'false') === 'true'
const PLAYWRIGHT_BROWSER_CHANNEL =
  typeof process.env.PLAYWRIGHT_BROWSER_CHANNEL === 'string' &&
  process.env.PLAYWRIGHT_BROWSER_CHANNEL.trim().length > 0
    ? process.env.PLAYWRIGHT_BROWSER_CHANNEL.trim()
    : ''

const PRESETS = [
  {
    id: 'vortex_ring_collision',
    family: 'rings',
    action: 'train',
    modePatch: { dynamicsMode: 'fullPhysics', executionMode: 'hybrid', vortexRepresentation: 'hybrid', hybridPlusEnabled: false },
    paramsPatch: { particleCount: 9000 },
    durationSec: 8,
    sampleEveryMs: 320,
  },
  {
    id: 'vortex_leapfrogging',
    family: 'rings',
    action: 'train',
    modePatch: { dynamicsMode: 'fullPhysics', executionMode: 'hybrid', vortexRepresentation: 'hybrid', hybridPlusEnabled: false },
    paramsPatch: { particleCount: 8500 },
    durationSec: 8,
    sampleEveryMs: 320,
  },
  {
    id: 'jet_instability',
    family: 'jets',
    action: 'train',
    modePatch: { dynamicsMode: 'guidedPhysics', executionMode: 'gpu', vortexRepresentation: 'particles', hybridPlusEnabled: false },
    paramsPatch: { particleCount: 12000 },
    durationSec: 9,
    sampleEveryMs: 320,
  },
  {
    id: 'turbulence_cascade',
    family: 'turbulence',
    action: 'train',
    modePatch: { dynamicsMode: 'fullPhysics', executionMode: 'hybrid_plus', vortexRepresentation: 'hybrid', hybridPlusEnabled: true },
    paramsPatch: { particleCount: 11000 },
    durationSec: 10,
    sampleEveryMs: 350,
  },
  {
    id: 'helmholtz_shear',
    family: 'helmholtz',
    action: 'train',
    modePatch: { dynamicsMode: 'guidedPhysics', executionMode: 'gpu', vortexRepresentation: 'particles', hybridPlusEnabled: false },
    paramsPatch: { particleCount: 10000 },
    durationSec: 8,
    sampleEveryMs: 300,
  },
  {
    id: 'kelvin_wave_train',
    family: 'kelvin',
    action: 'train',
    modePatch: { dynamicsMode: 'fullPhysics', executionMode: 'hybrid', vortexRepresentation: 'hybrid', hybridPlusEnabled: false },
    paramsPatch: { particleCount: 9000 },
    durationSec: 8,
    sampleEveryMs: 300,
  },
  {
    id: 'reconnection_pair',
    family: 'reconnection',
    action: 'train',
    modePatch: { dynamicsMode: 'fullPhysics', executionMode: 'hybrid_plus', vortexRepresentation: 'hybrid', hybridPlusEnabled: true },
    paramsPatch: { particleCount: 10000 },
    durationSec: 9,
    sampleEveryMs: 320,
  },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toFinite(value, fallback = null) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function percentile(values, q = 0.95) {
  if (!Array.isArray(values) || values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))
  return sorted[idx]
}

function readNumericEnv(name, min, fallback = null) {
  const raw = process.env[name]
  if (raw === undefined || raw === null || String(raw).trim().length === 0) {
    return fallback
  }
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, n)
}

function sanitizePolicyNumber(input, min, fallback) {
  const n = Number(input)
  return Number.isFinite(n) ? Math.max(min, n) : fallback
}

function readCirculationDrift(params = {}, diag = {}) {
  return (
    toFinite(params.circulationDriftPercent) ??
    toFinite(params.runtimeCirculationDriftPercent) ??
    toFinite(diag.circulationDriftPercent) ??
    toFinite(diag.runtimeCirculationDriftPercent)
  )
}

async function launchBrowser() {
  const options = {
    headless: PLAYWRIGHT_HEADLESS,
    args: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-angle=metal'],
  }
  if (PLAYWRIGHT_BROWSER_CHANNEL.length > 0) {
    try {
      return await chromium.launch({ ...options, channel: PLAYWRIGHT_BROWSER_CHANNEL })
    } catch (error) {
      console.warn(
        `[research-preset-audit] Failed to launch channel "${PLAYWRIGHT_BROWSER_CHANNEL}", fallback to bundled chromium: ${error.message}`,
      )
    }
  }
  return chromium.launch(options)
}

function evaluateCaseGate(row) {
  const checks = {
    case_completed: !row.runError,
    samples_present: row.sampleCount > 0,
    drift_within_limit: Number.isFinite(row.circulationDriftAbsMaxPct)
      ? row.circulationDriftAbsMaxPct <= row.thresholds.circulationDriftAbsMaxPct
      : false,
    step_p95_within_limit: Number.isFinite(row.stepP95Ms)
      ? row.stepP95Ms <= row.thresholds.stepP95MsMax
      : false,
    no_unsafe_unsynced_filament_steps:
      Number.isFinite(row.hybridUnsafeUnsyncedDelta) ? row.hybridUnsafeUnsyncedDelta <= 0 : false,
  }
  const failedChecks = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([id]) => id)
  return {
    pass: failedChecks.length === 0,
    checks,
    failedChecks,
    notes: row.runError ? [`case_error:${row.runError}`] : [],
  }
}

function fmt(value, digits = 3) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : 'n/a'
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function buildTrendRows(rows = []) {
  return rows.map((row) => ({
    presetId: row.presetId,
    family: row.family,
    sampleCount: row.sampleCount,
    stepP95Ms: Number.isFinite(row.stepP95Ms) ? Number(row.stepP95Ms) : null,
    gatePass: row.gate?.pass === true,
  }))
}

function isComparableTrendProfile(snapshotProfile, targetProfile) {
  const snapshotKey = String(snapshotProfile ?? '').trim()
  const targetKey = String(targetProfile ?? '').trim()
  if (!targetKey || targetKey === 'default') {
    return true
  }
  if (snapshotKey.length === 0) {
    return targetKey === 'standard'
  }
  return snapshotKey === targetKey
}

function findComparableBaselineSnapshots(snapshots = [], durationScale, trendProfile) {
  const target = Number(durationScale)
  const baseline = []
  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    const snapshot = snapshots[i]
    const snapshotScale = Number(snapshot?.durationScale ?? Number.NaN)
    if (!Number.isFinite(snapshotScale)) continue
    if (snapshot?.gatePass !== true) continue
    if (!isComparableTrendProfile(snapshot?.trendPolicyProfile, trendProfile)) continue
    if (Math.abs(snapshotScale - target) < 1e-9) {
      baseline.push(snapshot)
      if (baseline.length >= activeTrendPolicy.trendBaselineWindow) {
        break
      }
    }
  }
  return baseline.reverse()
}

function ratioPctDelta(currentValue, previousValue, floor = 1e-6) {
  const prev = Number(previousValue)
  const curr = Number(currentValue)
  if (!Number.isFinite(prev) || !Number.isFinite(curr)) {
    return Number.NaN
  }
  const baseline = Math.max(floor, Math.abs(prev))
  return ((curr - prev) / baseline) * 100
}

function evaluateTrendRegressions({ rows = [], baselineSnapshots = [] } = {}) {
  const comparableSnapshots = Array.isArray(baselineSnapshots) ? baselineSnapshots : []
  if (comparableSnapshots.length < activeTrendPolicy.trendMinBaselinePoints) {
    return {
      pass: true,
      comparedPresetCount: 0,
      comparedWithGeneratedAt: null,
      baselineSnapshotCount: comparableSnapshots.length,
      skippedReason: 'insufficient_baseline_snapshots',
      regressions: [],
      failedChecks: [],
    }
  }
  const baselineByPreset = new Map()
  for (const snapshot of comparableSnapshots) {
    for (const row of snapshot?.rows ?? []) {
      if (row?.gatePass !== true) continue
      const presetId = String(row?.presetId ?? '')
      if (!presetId) continue
      const bucket = baselineByPreset.get(presetId) ?? []
      bucket.push(row)
      baselineByPreset.set(presetId, bucket)
    }
  }
  const regressions = []
  let comparedPresetCount = 0
  for (const row of rows) {
    const baselineRows = baselineByPreset.get(String(row.presetId)) ?? []
    if (baselineRows.length < activeTrendPolicy.trendMinBaselinePoints) continue
    const baselineStepValues = baselineRows.map((item) => toFinite(item.stepP95Ms)).filter(Number.isFinite)
    const baselineSampleValues = baselineRows
      .map((item) => toFinite(item.sampleCount))
      .filter(Number.isFinite)
    if (
      baselineStepValues.length < activeTrendPolicy.trendMinBaselinePoints ||
      baselineSampleValues.length < activeTrendPolicy.trendMinBaselinePoints
    ) {
      continue
    }
    comparedPresetCount += 1
    const baselineStepMedian = percentile(baselineStepValues, 0.5)
    const baselineStepP90 = percentile(baselineStepValues, 0.9)
    const baselineSampleMedian = percentile(baselineSampleValues, 0.5)
    const stepP95RegressPct = ratioPctDelta(
      row.stepP95Ms,
      baselineStepMedian,
      activeTrendPolicy.stepP95RegressBaselineFloor,
    )
    const sampleDeltaPct = ratioPctDelta(row.sampleCount, baselineSampleMedian, 1)
    const sampleDropPct = Number.isFinite(sampleDeltaPct) ? Math.max(0, -sampleDeltaPct) : Number.NaN
    const stepP95AbsoluteRegressMs =
      Number.isFinite(row.stepP95Ms) && Number.isFinite(baselineStepP90)
        ? Math.max(0, row.stepP95Ms - baselineStepP90)
        : Number.NaN
    const failed = []
    if (
      Number.isFinite(stepP95RegressPct) &&
      Number.isFinite(stepP95AbsoluteRegressMs) &&
      stepP95RegressPct > activeTrendPolicy.stepP95RegressMaxPct &&
      stepP95AbsoluteRegressMs > activeTrendPolicy.stepP95RegressAbsMs
    ) {
      failed.push('step_p95_regress')
    }
    if (Number.isFinite(sampleDropPct) && sampleDropPct > activeTrendPolicy.sampleCountDropMaxPct) {
      failed.push('sample_count_drop')
    }
    if (failed.length > 0) {
      regressions.push({
        presetId: row.presetId,
        baselineStepP95MedianMs: baselineStepMedian,
        baselineStepP95P90Ms: baselineStepP90,
        currentStepP95Ms: row.stepP95Ms,
        stepP95RegressPct: Number.isFinite(stepP95RegressPct) ? stepP95RegressPct : null,
        stepP95AbsoluteRegressMs: Number.isFinite(stepP95AbsoluteRegressMs)
          ? stepP95AbsoluteRegressMs
          : null,
        baselineSampleCountMedian: baselineSampleMedian,
        currentSampleCount: row.sampleCount,
        sampleCountDropPct: Number.isFinite(sampleDropPct) ? sampleDropPct : null,
        failedChecks: failed,
      })
    }
  }
  const comparedWithGeneratedAt =
    comparableSnapshots.length > 0
      ? {
          oldest: String(comparableSnapshots[0]?.generatedAt ?? ''),
          latest: String(comparableSnapshots[comparableSnapshots.length - 1]?.generatedAt ?? ''),
        }
      : null
  return {
    pass: regressions.length === 0,
    comparedPresetCount,
    comparedWithGeneratedAt,
    baselineSnapshotCount: comparableSnapshots.length,
    skippedReason: null,
    regressions,
    failedChecks: regressions.flatMap((item) =>
      item.failedChecks.map((checkId) => `${item.presetId}:${checkId}`),
    ),
  }
}

async function resolveTrendPolicy() {
  const fallback = { ...DEFAULT_TREND_POLICY }
  const policyFile = await readJsonIfExists(TREND_POLICY_PATH)
  const availableProfiles = policyFile?.profiles && typeof policyFile.profiles === 'object' ? policyFile.profiles : {}
  const preferredProfile =
    TREND_POLICY_PROFILE.trim().length > 0
      ? TREND_POLICY_PROFILE.trim()
      : String(policyFile?.defaultProfile ?? 'standard')
  const selectedProfile = availableProfiles[preferredProfile] ?? availableProfiles.standard ?? null
  const merged = {
    stepP95RegressMaxPct: sanitizePolicyNumber(
      selectedProfile?.stepP95RegressMaxPct,
      0,
      fallback.stepP95RegressMaxPct,
    ),
    stepP95RegressBaselineFloor: sanitizePolicyNumber(
      selectedProfile?.stepP95RegressBaselineFloor,
      1,
      fallback.stepP95RegressBaselineFloor,
    ),
    stepP95RegressAbsMs: sanitizePolicyNumber(
      selectedProfile?.stepP95RegressAbsMs,
      0,
      fallback.stepP95RegressAbsMs,
    ),
    sampleCountDropMaxPct: sanitizePolicyNumber(
      selectedProfile?.sampleCountDropMaxPct,
      0,
      fallback.sampleCountDropMaxPct,
    ),
    trendBaselineWindow: sanitizePolicyNumber(
      selectedProfile?.trendBaselineWindow,
      1,
      fallback.trendBaselineWindow,
    ),
    trendMinBaselinePoints: sanitizePolicyNumber(
      selectedProfile?.trendMinBaselinePoints,
      1,
      fallback.trendMinBaselinePoints,
    ),
  }
  const envOverrides = {
    stepP95RegressMaxPct: readNumericEnv('RESEARCH_PRESET_AUDIT_STEP_P95_REGRESS_MAX_PCT', 0),
    stepP95RegressBaselineFloor: readNumericEnv('RESEARCH_PRESET_AUDIT_STEP_P95_REGRESS_BASELINE_FLOOR', 1),
    stepP95RegressAbsMs: readNumericEnv('RESEARCH_PRESET_AUDIT_STEP_P95_REGRESS_ABS_MS', 0),
    sampleCountDropMaxPct: readNumericEnv('RESEARCH_PRESET_AUDIT_SAMPLE_DROP_MAX_PCT', 0),
    trendBaselineWindow: readNumericEnv('RESEARCH_PRESET_AUDIT_TREND_BASELINE_WINDOW', 1),
    trendMinBaselinePoints: readNumericEnv('RESEARCH_PRESET_AUDIT_TREND_MIN_BASELINE_POINTS', 1),
  }
  const policy = {
    stepP95RegressMaxPct: envOverrides.stepP95RegressMaxPct ?? merged.stepP95RegressMaxPct,
    stepP95RegressBaselineFloor:
      envOverrides.stepP95RegressBaselineFloor ?? merged.stepP95RegressBaselineFloor,
    stepP95RegressAbsMs: envOverrides.stepP95RegressAbsMs ?? merged.stepP95RegressAbsMs,
    sampleCountDropMaxPct: envOverrides.sampleCountDropMaxPct ?? merged.sampleCountDropMaxPct,
    trendBaselineWindow: envOverrides.trendBaselineWindow ?? merged.trendBaselineWindow,
    trendMinBaselinePoints: envOverrides.trendMinBaselinePoints ?? merged.trendMinBaselinePoints,
  }
  const source = policyFile && selectedProfile ? 'policy_file_profile' : 'default'
  const profile =
    selectedProfile && availableProfiles[preferredProfile]
      ? preferredProfile
      : availableProfiles.standard
        ? 'standard'
        : 'default'
  return {
    policy,
    meta: {
      path: policyFile ? path.resolve(TREND_POLICY_PATH) : null,
      profile,
      source,
    },
  }
}

function sanitizeCaseThresholds(input = {}, fallback = {}) {
  return {
    circulationDriftAbsMaxPct: sanitizePolicyNumber(
      input?.circulationDriftAbsMaxPct,
      0,
      fallback.circulationDriftAbsMaxPct,
    ),
    stepP95MsMax: sanitizePolicyNumber(input?.stepP95MsMax, 1, fallback.stepP95MsMax),
  }
}

async function resolveCasePolicy() {
  const fallbackByPreset = { ...DEFAULT_CASE_THRESHOLDS_BY_PRESET }
  const policyFile = await readJsonIfExists(CASE_POLICY_PATH)
  const availableProfiles =
    policyFile?.profiles && typeof policyFile.profiles === 'object' ? policyFile.profiles : {}
  const preferredProfile =
    CASE_POLICY_PROFILE.trim().length > 0
      ? CASE_POLICY_PROFILE.trim()
      : TREND_POLICY_PROFILE.trim().length > 0
        ? TREND_POLICY_PROFILE.trim()
        : String(policyFile?.defaultProfile ?? 'standard')
  const selectedProfile = availableProfiles[preferredProfile] ?? availableProfiles.standard ?? null
  const profileDefaults = sanitizeCaseThresholds(selectedProfile?.defaults, {
    circulationDriftAbsMaxPct: 45,
    stepP95MsMax: 170,
  })
  const profilePerPreset =
    selectedProfile?.perPreset && typeof selectedProfile.perPreset === 'object'
      ? selectedProfile.perPreset
      : {}
  const thresholdsByPreset = {}
  for (const presetId of Object.keys(fallbackByPreset)) {
    thresholdsByPreset[presetId] = sanitizeCaseThresholds(profilePerPreset[presetId], {
      circulationDriftAbsMaxPct:
        fallbackByPreset[presetId]?.circulationDriftAbsMaxPct ?? profileDefaults.circulationDriftAbsMaxPct,
      stepP95MsMax: fallbackByPreset[presetId]?.stepP95MsMax ?? profileDefaults.stepP95MsMax,
    })
  }
  const source = policyFile && selectedProfile ? 'policy_file_profile' : 'default'
  const profile =
    selectedProfile && availableProfiles[preferredProfile]
      ? preferredProfile
      : availableProfiles.standard
        ? 'standard'
        : 'default'
  return {
    thresholdsByPreset,
    meta: {
      path: policyFile ? path.resolve(CASE_POLICY_PATH) : null,
      profile,
      source,
    },
  }
}

function resolveCaseThresholdsForPreset(presetId) {
  return (
    activeCaseThresholdsByPreset[String(presetId)] ??
    DEFAULT_CASE_THRESHOLDS_BY_PRESET[String(presetId)] ?? {
      circulationDriftAbsMaxPct: 45,
      stepP95MsMax: 170,
    }
  )
}

async function writeTrendSnapshot({
  trendPath,
  generatedAt,
  durationScale,
  rows,
  gatePass,
  trendPolicyProfile,
}) {
  const previous = (await readJsonIfExists(trendPath)) ?? { snapshots: [] }
  const snapshots = Array.isArray(previous.snapshots) ? previous.snapshots : []
  const baselineSnapshots = findComparableBaselineSnapshots(snapshots, durationScale, trendPolicyProfile)
  const entry = {
    generatedAt,
    durationScale,
    trendPolicyProfile: String(trendPolicyProfile ?? 'standard'),
    gatePass: gatePass === true,
    rows: buildTrendRows(rows),
  }
  const nextSnapshots = [...snapshots, entry].slice(-TREND_MAX)
  const payload = {
    updatedAt: generatedAt,
    snapshots: nextSnapshots,
  }
  await fs.writeFile(trendPath, JSON.stringify(payload, null, 2))
  return { payload, baselineSnapshots }
}

function toMarkdown(report) {
  const lines = [
    '# Research Preset Pack Audit',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Preset | Family | Samples | driftAbsMax% | stepP95ms | Gate |',
    '|---|---|---:|---:|---:|---|',
  ]
  for (const row of report.rows) {
    lines.push(
      `| ${row.presetId} | ${row.family} | ${row.sampleCount} | ${fmt(row.circulationDriftAbsMaxPct)} | ${fmt(row.stepP95Ms, 2)} | ${row.gate.pass ? 'PASS' : 'FAIL'} |`,
    )
  }
  lines.push('', '## Failed checks', '')
  const failedRows = report.rows.filter((row) => row.gate.pass !== true)
  if (failedRows.length === 0) {
    lines.push('- none')
  } else {
    for (const row of failedRows) {
      lines.push(`- ${row.presetId}: ${row.gate.failedChecks.join(', ')}`)
    }
  }
  lines.push('', '## Case Gate Policy')
  lines.push(`- case policy profile: ${report.casePolicy?.profile ?? 'default'}`)
  lines.push(`- case policy source: ${report.casePolicy?.source ?? 'default'}`)
  if (report.casePolicy?.path) {
    lines.push(`- case policy path: ${report.casePolicy.path}`)
  }
  lines.push('', '## Trend')
  if (report.trend?.comparedWithGeneratedAt?.latest) {
    lines.push(
      `- compared baseline snapshots: ${report.trend.comparedWithGeneratedAt.oldest} .. ${report.trend.comparedWithGeneratedAt.latest}`,
    )
  } else {
    lines.push('- compared baseline snapshots: none (insufficient history)')
  }
  lines.push(`- baseline snapshot count: ${report.trend?.baselineSnapshotCount ?? 0}`)
  lines.push(`- trend regress gate: ${report.trend?.pass ? 'PASS' : 'FAIL'}`)
  lines.push(`- trend path: ${report.trend?.path ?? path.resolve(TREND_PATH)}`)
  lines.push(`- trend policy profile: ${report.trend?.policy?.profile ?? 'default'}`)
  lines.push(`- trend policy source: ${report.trend?.policy?.source ?? 'default'}`)
  lines.push(`- trend compare profile: ${report.trend?.policy?.profile ?? 'default'}`)
  if (report.trend?.policy?.path) {
    lines.push(`- trend policy path: ${report.trend.policy.path}`)
  }
  if (report.trend?.skippedReason) {
    lines.push(`- trend comparison skipped: ${report.trend.skippedReason}`)
  }
  lines.push(
    `- fail on insufficient baseline: ${report.trend?.failOnInsufficientBaseline ? 'yes' : 'no'}`,
  )
  if (Array.isArray(report.trend?.failedChecks) && report.trend.failedChecks.length > 0) {
    lines.push('', '### Trend regressions', '')
    for (const item of report.trend.failedChecks) {
      lines.push(`- ${item}`)
    }
  }
  lines.push('', `Overall gate: ${report.gate.pass ? 'PASS' : 'FAIL'}`)
  return lines.join('\n')
}

async function runCase(page, preset) {
  return page.evaluate(
    async ({ presetInner, durationScale }) => {
      const api = window.__torusTestApi
      if (!api) {
        throw new Error('__torusTestApi is unavailable')
      }
      api.pulse('stop')
      api.setMode(presetInner.modePatch)
      api.setParams({
        uiLanguage: 'en',
        emissionMode: 'vortexRing',
        showVectors: false,
        showBoth: false,
        vectorDisplayMode: 'particles',
        vpmEnabled: true,
        useBiotSavart: true,
        ...presetInner.paramsPatch,
      })
      const startParams = api.getParams()
      api.resetParticles()
      await api.waitForMs(450)
      if (presetInner.action === 'singlePulse') {
        api.pulse('single')
      } else {
        api.pulse('startTrain')
      }
      const durationSec = Math.max(3, Math.round(presetInner.durationSec * durationScale))
      const iterations = Math.max(1, Math.floor((durationSec * 1000) / presetInner.sampleEveryMs))
      const samples = []
      for (let i = 0; i < iterations; i += 1) {
        await api.waitForMs(presetInner.sampleEveryMs)
        const params = api.getParams()
        const diag = api.getRuntimeDiagnostics()
        samples.push({
          tMs: (i + 1) * presetInner.sampleEveryMs,
          params,
          diag,
          stepMs: Number(params.runtimeGpuStepMs ?? 0),
        })
      }
      const endParams = api.getParams()
      api.pulse('stop')
      return {
        samples,
        durationSec,
        counters: {
          hybridBlockedUnsyncedDelta:
            Number(endParams.runtimeHybridFilamentStepBlockedUnsyncedCount ?? 0) -
            Number(startParams.runtimeHybridFilamentStepBlockedUnsyncedCount ?? 0),
          hybridUnsafeUnsyncedDelta:
            Number(endParams.runtimeHybridFilamentStepUnsafeUnsyncedCount ?? 0) -
            Number(startParams.runtimeHybridFilamentStepUnsafeUnsyncedCount ?? 0),
        },
      }
    },
    { presetInner: preset, durationScale: DURATION_SCALE },
  )
}

async function runCaseWithTimeout(page, preset, timeoutSec) {
  let timeoutId
  const timeoutMs = Math.max(30_000, Math.floor(timeoutSec * 1000))
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Case timeout for ${preset.id} after ${Math.floor(timeoutMs / 1000)}s`))
    }, timeoutMs)
    if (timeoutId && typeof timeoutId.unref === 'function') {
      timeoutId.unref()
    }
  })
  try {
    return await Promise.race([runCase(page, preset), timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

async function main() {
  const trendPolicyResolution = await resolveTrendPolicy()
  activeTrendPolicy = trendPolicyResolution.policy
  activeTrendPolicyMeta = trendPolicyResolution.meta
  const casePolicyResolution = await resolveCasePolicy()
  activeCaseThresholdsByPreset = casePolicyResolution.thresholdsByPreset
  activeCasePolicyMeta = casePolicyResolution.meta
  const browser = await launchBrowser()
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
    await context.addInitScript(() => {
      window.__torusDisableAutoCalibration = true
      localStorage.setItem('toroidalVortexParams', JSON.stringify({ uiLanguage: 'en' }))
    })
    const page = await context.newPage()
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })

    let ready = false
    for (let i = 0; i < 40; i += 1) {
      ready = await page.evaluate(() => Boolean(window.__torusTestApi))
      if (ready) break
      await sleep(250)
    }
    if (!ready) throw new Error('__torusTestApi did not initialize in time')
    await sleep(900)

    const rows = []
    for (const preset of PRESETS) {
      let run = null
      let runError = ''
      const timeoutSec =
        CASE_TIMEOUT_SEC > 0
          ? CASE_TIMEOUT_SEC
          : Math.max(60, Math.ceil(Math.max(3, preset.durationSec * DURATION_SCALE) * 5))
      try {
        run = await runCaseWithTimeout(page, preset, timeoutSec)
      } catch (error) {
        runError = String(error?.message ?? error ?? 'unknown_case_error')
      }
      const samples = Array.isArray(run?.samples) ? run.samples : []
      const driftAbsValues = samples
        .map((sample) => Math.abs(readCirculationDrift(sample?.params ?? {}, sample?.diag ?? {})))
        .filter(Number.isFinite)
      const stepMsValues = samples.map((sample) => toFinite(sample?.stepMs)).filter(Number.isFinite)
      const row = {
        presetId: preset.id,
        family: preset.family,
        sampleCount: samples.length,
        runError,
        thresholds: resolveCaseThresholdsForPreset(preset.id),
        durationSecObserved: Number(run?.durationSec ?? Number.NaN),
        circulationDriftAbsMaxPct: driftAbsValues.length > 0 ? Math.max(...driftAbsValues) : Number.NaN,
        stepP95Ms: stepMsValues.length > 0 ? percentile(stepMsValues, 0.95) : Number.NaN,
        hybridBlockedUnsyncedDelta: Number(run?.counters?.hybridBlockedUnsyncedDelta ?? Number.NaN),
        hybridUnsafeUnsyncedDelta: Number(run?.counters?.hybridUnsafeUnsyncedDelta ?? Number.NaN),
      }
      row.gate = evaluateCaseGate(row)
      rows.push(row)
    }

    const failedChecks = rows.flatMap((row) =>
      row.gate.pass ? [] : row.gate.failedChecks.map((checkId) => `${row.presetId}:${checkId}`),
    )
    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      durationScale: DURATION_SCALE,
      rows,
      gate: {
        pass: failedChecks.length === 0,
        failedChecks,
      },
    }
    const trendWrite = await writeTrendSnapshot({
      trendPath: TREND_PATH,
      generatedAt: report.generatedAt,
      durationScale: DURATION_SCALE,
      rows,
      gatePass: report.gate.pass,
      trendPolicyProfile: activeTrendPolicyMeta.profile,
    })
    const trendRegressions = evaluateTrendRegressions({
      rows: trendWrite.payload.snapshots[trendWrite.payload.snapshots.length - 1]?.rows ?? [],
      baselineSnapshots: trendWrite.baselineSnapshots,
    })
    report.trend = {
      path: path.resolve(TREND_PATH),
      snapshots: trendWrite.payload.snapshots.length,
      comparedWithGeneratedAt: trendRegressions.comparedWithGeneratedAt || null,
      baselineSnapshotCount: trendRegressions.baselineSnapshotCount ?? 0,
      comparedPresetCount: trendRegressions.comparedPresetCount,
      skippedReason: trendRegressions.skippedReason ?? null,
      pass: trendRegressions.pass,
      failedChecks: trendRegressions.failedChecks,
      regressions: trendRegressions.regressions,
      failOnInsufficientBaseline: FAIL_ON_INSUFFICIENT_BASELINE,
      thresholds: {
        stepP95RegressMaxPct: activeTrendPolicy.stepP95RegressMaxPct,
        stepP95RegressBaselineFloor: activeTrendPolicy.stepP95RegressBaselineFloor,
        stepP95RegressAbsMs: activeTrendPolicy.stepP95RegressAbsMs,
        sampleCountDropMaxPct: activeTrendPolicy.sampleCountDropMaxPct,
        trendBaselineWindow: activeTrendPolicy.trendBaselineWindow,
        trendMinBaselinePoints: activeTrendPolicy.trendMinBaselinePoints,
      },
      policy: activeTrendPolicyMeta,
    }
    report.casePolicy = {
      profile: activeCasePolicyMeta.profile,
      source: activeCasePolicyMeta.source,
      path: activeCasePolicyMeta.path,
      thresholdsByPreset: activeCaseThresholdsByPreset,
    }
    await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await fs.writeFile(OUTPUT_MD, `${toMarkdown(report)}\n`, 'utf8')
    console.table(
      rows.map((row) => ({
        presetId: row.presetId,
        family: row.family,
        sampleCount: row.sampleCount,
        driftAbsMaxPct: Number.isFinite(row.circulationDriftAbsMaxPct)
          ? Number(row.circulationDriftAbsMaxPct.toFixed(3))
          : null,
        stepP95Ms: Number.isFinite(row.stepP95Ms) ? Number(row.stepP95Ms.toFixed(2)) : null,
        unsafeUnsyncedDelta: Number.isFinite(row.hybridUnsafeUnsyncedDelta)
          ? Number(row.hybridUnsafeUnsyncedDelta)
          : null,
        gate: row.gate.pass ? 'PASS' : 'FAIL',
      })),
    )
    if (FAIL_ON_GATE && report.gate.pass !== true) {
      throw new Error(`Research preset pack audit gate failed: ${report.gate.failedChecks.join(', ')}`)
    }
    if (FAIL_ON_TREND_REGRESS && report.trend.pass !== true) {
      throw new Error(`Research preset trend regressions detected: ${report.trend.failedChecks.join(', ')}`)
    }
    if (
      FAIL_ON_TREND_REGRESS &&
      FAIL_ON_INSUFFICIENT_BASELINE &&
      report.trend.skippedReason === 'insufficient_baseline_snapshots'
    ) {
      throw new Error(
        'Research preset trend baseline is insufficient for strict mode: insufficient_baseline_snapshots',
      )
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
