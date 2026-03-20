import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const TREND_PATH =
  process.env.RESEARCH_PRESET_POLICY_TEMPLATE_TREND_PATH ??
  path.join(SCRIPT_DIR, 'research-preset-pack-trend.json')
const AUDIT_JSON_PATH =
  process.env.RESEARCH_PRESET_POLICY_TEMPLATE_AUDIT_JSON_PATH ??
  path.join(SCRIPT_DIR, 'research-preset-pack-audit.json')
const CASE_POLICY_PATH =
  process.env.RESEARCH_PRESET_POLICY_TEMPLATE_CASE_POLICY_PATH ??
  path.join(SCRIPT_DIR, 'research-preset-pack-case-policy.v1.json')
const OUTPUT_PATH =
  process.env.RESEARCH_PRESET_POLICY_TEMPLATE_OUTPUT_PATH ??
  path.join(SCRIPT_DIR, 'research-preset-policy-template.suggested.v1.json')

const STEP_MARGIN_BY_PROFILE = {
  smoke: 1.2,
  standard: 1.12,
  nightly: 1.08,
}
const DRIFT_MARGIN_BY_PROFILE = {
  smoke: 1.2,
  standard: 1.1,
  nightly: 1.05,
}
const MIN_STEP_MS = 40
const MIN_DRIFT_PCT = 10

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function percentile(values, q = 0.9) {
  if (!Array.isArray(values) || values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))
  return sorted[idx]
}

function roundUp(value, step = 5) {
  if (!Number.isFinite(value)) return Number.NaN
  return Math.ceil(value / step) * step
}

function toProfile(snapshotProfile, fallback = 'standard') {
  const value = String(snapshotProfile ?? '').trim()
  return value.length > 0 ? value : fallback
}

function collectStepStatsByProfile(trendPayload) {
  const out = new Map()
  const snapshots = Array.isArray(trendPayload?.snapshots) ? trendPayload.snapshots : []
  for (const snapshot of snapshots) {
    if (snapshot?.gatePass !== true) continue
    const profile = toProfile(snapshot?.trendPolicyProfile, 'standard')
    const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : []
    for (const row of rows) {
      if (row?.gatePass !== true) continue
      const presetId = String(row?.presetId ?? '')
      const stepP95Ms = Number(row?.stepP95Ms)
      if (!presetId || !Number.isFinite(stepP95Ms)) continue
      const profileBucket = out.get(profile) ?? new Map()
      const values = profileBucket.get(presetId) ?? []
      values.push(stepP95Ms)
      profileBucket.set(presetId, values)
      out.set(profile, profileBucket)
    }
  }
  return out
}

function collectObservedDriftByPreset(latestAudit) {
  const out = new Map()
  const rows = Array.isArray(latestAudit?.rows) ? latestAudit.rows : []
  for (const row of rows) {
    const presetId = String(row?.presetId ?? '')
    const drift = Number(row?.circulationDriftAbsMaxPct)
    if (!presetId || !Number.isFinite(drift)) continue
    out.set(presetId, drift)
  }
  return out
}

function sanitizeThresholds(input = {}, fallback = {}) {
  const drift = Number(input?.circulationDriftAbsMaxPct)
  const step = Number(input?.stepP95MsMax)
  return {
    circulationDriftAbsMaxPct: Number.isFinite(drift)
      ? Math.max(MIN_DRIFT_PCT, drift)
      : fallback.circulationDriftAbsMaxPct,
    stepP95MsMax: Number.isFinite(step) ? Math.max(MIN_STEP_MS, step) : fallback.stepP95MsMax,
  }
}

async function main() {
  const [trendPayload, latestAudit, casePolicy] = await Promise.all([
    readJsonIfExists(TREND_PATH),
    readJsonIfExists(AUDIT_JSON_PATH),
    readJsonIfExists(CASE_POLICY_PATH),
  ])
  if (!trendPayload) {
    throw new Error(`Trend payload not found: ${path.resolve(TREND_PATH)}`)
  }
  if (!casePolicy) {
    throw new Error(`Case policy not found: ${path.resolve(CASE_POLICY_PATH)}`)
  }

  const profiles = Object.keys(casePolicy?.profiles ?? {})
  if (profiles.length === 0) {
    throw new Error('Case policy profiles are empty')
  }

  const stepStatsByProfile = collectStepStatsByProfile(trendPayload)
  const observedDriftByPreset = collectObservedDriftByPreset(latestAudit)

  const suggestedProfiles = {}
  for (const profile of profiles) {
    const profilePolicy = casePolicy.profiles?.[profile] ?? {}
    const profileDefaults = sanitizeThresholds(profilePolicy?.defaults, {
      circulationDriftAbsMaxPct: 45,
      stepP95MsMax: 170,
    })
    const perPresetCurrent = profilePolicy?.perPreset ?? {}
    const stepStats = stepStatsByProfile.get(profile) ?? new Map()
    const stepMargin = STEP_MARGIN_BY_PROFILE[profile] ?? STEP_MARGIN_BY_PROFILE.standard
    const driftMargin = DRIFT_MARGIN_BY_PROFILE[profile] ?? DRIFT_MARGIN_BY_PROFILE.standard
    const perPresetSuggested = {}
    const allPresetIds = new Set([
      ...Object.keys(perPresetCurrent),
      ...Array.from(stepStats.keys()),
      ...Array.from(observedDriftByPreset.keys()),
    ])
    for (const presetId of allPresetIds) {
      const currentThresholds = sanitizeThresholds(perPresetCurrent[presetId], profileDefaults)
      const stepValues = stepStats.get(presetId) ?? []
      const baselineStepP90 = percentile(stepValues, 0.9)
      const observedDrift = observedDriftByPreset.get(presetId)
      const suggestedStep = Number.isFinite(baselineStepP90)
        ? roundUp(Math.max(currentThresholds.stepP95MsMax, baselineStepP90 * stepMargin), 5)
        : currentThresholds.stepP95MsMax
      const suggestedDrift = Number.isFinite(observedDrift)
        ? roundUp(
            Math.max(currentThresholds.circulationDriftAbsMaxPct, observedDrift * driftMargin, MIN_DRIFT_PCT),
            1,
          )
        : currentThresholds.circulationDriftAbsMaxPct
      perPresetSuggested[presetId] = {
        circulationDriftAbsMaxPct: suggestedDrift,
        stepP95MsMax: suggestedStep,
        basedOn: {
          trendSampleCount: stepValues.length,
          trendStepP90Ms: Number.isFinite(baselineStepP90) ? Number(baselineStepP90.toFixed(3)) : null,
          latestObservedDriftAbsMaxPct: Number.isFinite(observedDrift)
            ? Number(observedDrift.toFixed(3))
            : null,
        },
      }
    }
    suggestedProfiles[profile] = {
      defaults: profileDefaults,
      perPreset: perPresetSuggested,
    }
  }

  const payload = {
    schemaVersion: 'tt055.research_preset_policy_template.v1',
    generatedAt: new Date().toISOString(),
    source: {
      trendPath: path.resolve(TREND_PATH),
      auditJsonPath: path.resolve(AUDIT_JSON_PATH),
      casePolicyPath: path.resolve(CASE_POLICY_PATH),
      trendSnapshotCount: Array.isArray(trendPayload?.snapshots) ? trendPayload.snapshots.length : 0,
    },
    notes: [
      'Suggested template is generated from historical successful trend snapshots and latest audit drift signals.',
      'Review suggested thresholds manually before replacing production policy values.',
    ],
    suggestedPolicy: {
      defaultProfile: casePolicy?.defaultProfile ?? 'standard',
      profiles: suggestedProfiles,
    },
  }

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`[policy-template] written: ${path.resolve(OUTPUT_PATH)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
