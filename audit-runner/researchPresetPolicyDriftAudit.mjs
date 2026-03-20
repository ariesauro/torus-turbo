import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const CASE_POLICY_PATH =
  process.env.RESEARCH_PRESET_POLICY_DRIFT_CASE_POLICY_PATH ??
  path.join(SCRIPT_DIR, 'research-preset-pack-case-policy.v1.json')
const ENVELOPE_POLICY_PATH =
  process.env.RESEARCH_PRESET_POLICY_DRIFT_ENVELOPE_POLICY_PATH ??
  path.join(SCRIPT_DIR, 'research-preset-policy-drift-envelope.v1.json')
const TEMPLATE_PATH =
  process.env.RESEARCH_PRESET_POLICY_DRIFT_TEMPLATE_PATH ??
  path.join(SCRIPT_DIR, 'research-preset-policy-template.suggested.v1.json')
const OUTPUT_JSON =
  process.env.RESEARCH_PRESET_POLICY_DRIFT_OUTPUT_JSON ??
  path.join(SCRIPT_DIR, 'research-preset-policy-drift-audit.json')
const OUTPUT_MD =
  process.env.RESEARCH_PRESET_POLICY_DRIFT_OUTPUT_MD ??
  path.join(SCRIPT_DIR, 'research-preset-policy-drift-audit.md')
const FAIL_ON_GATE =
  String(process.env.RESEARCH_PRESET_POLICY_DRIFT_FAIL_ON_GATE ?? 'false') === 'true'
const DRIFT_PROFILE = String(process.env.RESEARCH_PRESET_POLICY_DRIFT_PROFILE ?? '').trim()
const DRIFT_STAGE = String(process.env.RESEARCH_PRESET_POLICY_DRIFT_STAGE ?? '').trim()
const DEFAULT_ENVELOPE_THRESHOLDS = {
  circulationDeltaAbsMaxPct: 15,
  stepDeltaAbsMaxMs: 25,
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : Number.NaN
}

function sanitizeThresholds(input = {}, fallback = DEFAULT_ENVELOPE_THRESHOLDS) {
  return {
    circulationDeltaAbsMaxPct: Math.max(
      1,
      Number.isFinite(Number(input?.circulationDeltaAbsMaxPct))
        ? Number(input.circulationDeltaAbsMaxPct)
        : Number(fallback.circulationDeltaAbsMaxPct),
    ),
    stepDeltaAbsMaxMs: Math.max(
      1,
      Number.isFinite(Number(input?.stepDeltaAbsMaxMs))
        ? Number(input.stepDeltaAbsMaxMs)
        : Number(fallback.stepDeltaAbsMaxMs),
    ),
  }
}

function resolveEnvelopePolicy(policy, preferredProfile = '', preferredStage = '') {
  const profiles = policy?.profiles && typeof policy.profiles === 'object' ? policy.profiles : {}
  const defaultProfile = String(policy?.defaultProfile ?? 'standard')
  const defaultStage = String(policy?.defaultStage ?? 'default')
  const selectedProfile = preferredProfile.length > 0 ? preferredProfile : defaultProfile
  const profileConfig = profiles[selectedProfile] ?? profiles.standard ?? null
  const selectedStage = preferredStage.length > 0 ? preferredStage : defaultStage
  const stageConfig = profileConfig?.stages?.[selectedStage] ?? profileConfig?.stages?.default ?? null
  const thresholds = sanitizeThresholds(stageConfig, DEFAULT_ENVELOPE_THRESHOLDS)
  return {
    thresholds,
    meta: {
      profile: profileConfig ? selectedProfile : 'default',
      stage: stageConfig ? selectedStage : 'default',
      source: profileConfig && stageConfig ? 'policy_file_stage' : 'default',
      path: policy ? path.resolve(ENVELOPE_POLICY_PATH) : null,
      availableProfiles: Object.keys(profiles),
      availableStages: profileConfig?.stages ? Object.keys(profileConfig.stages) : [],
    },
  }
}

function toMarkdown(report) {
  const lines = [
    '# Research Preset Policy Drift Audit',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `- envelope profile: ${report.envelope?.profile ?? 'default'}`,
    `- envelope stage: ${report.envelope?.stage ?? 'default'}`,
    `- envelope source: ${report.envelope?.source ?? 'default'}`,
    `- envelope thresholds: driftΔ<=${report.thresholds?.circulationDeltaAbsMaxPct ?? 'n/a'}%, stepΔ<=${report.thresholds?.stepDeltaAbsMaxMs ?? 'n/a'}ms`,
    report.envelope?.path ? `- envelope policy path: ${report.envelope.path}` : '- envelope policy path: default',
    '',
    '| Check | Result |',
    '|---|---|',
  ]
  for (const [id, pass] of Object.entries(report.gate.checks)) {
    lines.push(`| ${id} | ${pass ? 'PASS' : 'FAIL'} |`)
  }
  lines.push('', '## Drift Rows', '')
  lines.push('| Profile | Preset | DriftΔ% | StepΔms | Gate |')
  lines.push('|---|---|---:|---:|---|')
  for (const row of report.rows) {
    lines.push(
      `| ${row.profile} | ${row.presetId} | ${Number.isFinite(row.circulationDeltaAbsPct) ? row.circulationDeltaAbsPct.toFixed(3) : 'n/a'} | ${Number.isFinite(row.stepDeltaAbsMs) ? row.stepDeltaAbsMs.toFixed(3) : 'n/a'} | ${row.pass ? 'PASS' : 'FAIL'} |`,
    )
  }
  if (report.failedRows.length > 0) {
    lines.push('', '## Failed Rows', '')
    for (const item of report.failedRows) {
      lines.push(`- ${item.profile}/${item.presetId}: ${item.failedChecks.join(', ')}`)
    }
  }
  lines.push('', `Overall gate: ${report.gate.pass ? 'PASS' : 'FAIL'}`)
  return lines.join('\n')
}

async function main() {
  const [casePolicy, template, envelopePolicy] = await Promise.all([
    readJsonIfExists(CASE_POLICY_PATH),
    readJsonIfExists(TEMPLATE_PATH),
    readJsonIfExists(ENVELOPE_POLICY_PATH),
  ])
  const envelopeResolution = resolveEnvelopePolicy(envelopePolicy, DRIFT_PROFILE, DRIFT_STAGE)
  const activeThresholds = envelopeResolution.thresholds
  const checks = {}
  checks.case_policy_exists = Boolean(casePolicy)
  checks.template_exists = Boolean(template)
  checks.envelope_policy_exists_or_default = Boolean(envelopePolicy) || envelopeResolution.meta.source === 'default'
  checks.envelope_profile_known =
    envelopeResolution.meta.source === 'default' ||
    envelopeResolution.meta.availableProfiles.includes(envelopeResolution.meta.profile)
  checks.envelope_stage_known =
    envelopeResolution.meta.source === 'default' ||
    envelopeResolution.meta.availableStages.includes(envelopeResolution.meta.stage)
  checks.profile_sets_match = false
  checks.all_rows_within_envelope = false
  const rows = []
  const failedRows = []

  if (casePolicy && template) {
    const caseProfiles = Object.keys(casePolicy?.profiles ?? {})
    const suggestedProfiles = Object.keys(template?.suggestedPolicy?.profiles ?? {})
    checks.profile_sets_match =
      caseProfiles.length === suggestedProfiles.length &&
      caseProfiles.every((profile) => suggestedProfiles.includes(profile))
    const fullProfileUniverse = [...new Set([...caseProfiles, ...suggestedProfiles])]
    const profileUniverse =
      envelopeResolution.meta.profile !== 'default'
        ? fullProfileUniverse.filter((profile) => profile === envelopeResolution.meta.profile)
        : fullProfileUniverse
    for (const profile of profileUniverse) {
      const currentPerPreset = casePolicy?.profiles?.[profile]?.perPreset ?? {}
      const suggestedPerPreset = template?.suggestedPolicy?.profiles?.[profile]?.perPreset ?? {}
      const presetUniverse = [...new Set([...Object.keys(currentPerPreset), ...Object.keys(suggestedPerPreset)])]
      for (const presetId of presetUniverse) {
        const current = currentPerPreset[presetId] ?? {}
        const suggested = suggestedPerPreset[presetId] ?? {}
        const currentDrift = toNumber(current.circulationDriftAbsMaxPct)
        const suggestedDrift = toNumber(suggested.circulationDriftAbsMaxPct)
        const currentStep = toNumber(current.stepP95MsMax)
        const suggestedStep = toNumber(suggested.stepP95MsMax)
        const circulationDeltaAbsPct =
          Number.isFinite(currentDrift) && Number.isFinite(suggestedDrift)
            ? Math.abs(currentDrift - suggestedDrift)
            : Number.NaN
        const stepDeltaAbsMs =
          Number.isFinite(currentStep) && Number.isFinite(suggestedStep)
            ? Math.abs(currentStep - suggestedStep)
            : Number.NaN
        const failedChecks = []
        if (
          !Number.isFinite(circulationDeltaAbsPct) ||
          circulationDeltaAbsPct > activeThresholds.circulationDeltaAbsMaxPct
        ) {
          failedChecks.push('circulation_threshold_drift')
        }
        if (!Number.isFinite(stepDeltaAbsMs) || stepDeltaAbsMs > activeThresholds.stepDeltaAbsMaxMs) {
          failedChecks.push('step_threshold_drift')
        }
        const pass = failedChecks.length === 0
        const row = {
          profile,
          presetId,
          circulationDeltaAbsPct,
          stepDeltaAbsMs,
          thresholds: activeThresholds,
          pass,
          failedChecks,
        }
        rows.push(row)
        if (!pass) failedRows.push(row)
      }
    }
    checks.all_rows_within_envelope = failedRows.length === 0
  }

  const failedChecks = Object.entries(checks)
    .filter(([, pass]) => pass !== true)
    .map(([id]) => id)
  const report = {
    generatedAt: new Date().toISOString(),
    paths: {
      casePolicy: path.resolve(CASE_POLICY_PATH),
      template: path.resolve(TEMPLATE_PATH),
      envelopePolicy: envelopeResolution.meta.path,
    },
    thresholds: {
      circulationDeltaAbsMaxPct: activeThresholds.circulationDeltaAbsMaxPct,
      stepDeltaAbsMaxMs: activeThresholds.stepDeltaAbsMaxMs,
    },
    envelope: envelopeResolution.meta,
    gate: {
      pass: failedChecks.length === 0,
      checks,
      failedChecks,
    },
    rows,
    failedRows,
  }
  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(OUTPUT_MD, `${toMarkdown(report)}\n`, 'utf8')
  console.table(
    Object.entries(checks).map(([id, pass]) => ({
      check: id,
      result: pass ? 'PASS' : 'FAIL',
    })),
  )
  if (FAIL_ON_GATE && report.gate.pass !== true) {
    throw new Error(`Research preset policy drift audit failed: ${report.gate.failedChecks.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
