import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

const CASE_POLICY_PATH =
  process.env.RESEARCH_PRESET_POLICY_INTEGRITY_CASE_POLICY_PATH ??
  path.join(SCRIPT_DIR, 'research-preset-pack-case-policy.v1.json')
const TREND_POLICY_PATH =
  process.env.RESEARCH_PRESET_POLICY_INTEGRITY_TREND_POLICY_PATH ??
  path.join(SCRIPT_DIR, 'research-preset-pack-trend-policy.v1.json')
const PRESET_AUDIT_JSON_PATH =
  process.env.RESEARCH_PRESET_POLICY_INTEGRITY_AUDIT_JSON_PATH ??
  path.join(SCRIPT_DIR, 'research-preset-pack-audit.json')
const OUTPUT_JSON =
  process.env.RESEARCH_PRESET_POLICY_INTEGRITY_OUTPUT_JSON ??
  path.join(SCRIPT_DIR, 'research-preset-policy-integrity-audit.json')
const OUTPUT_MD =
  process.env.RESEARCH_PRESET_POLICY_INTEGRITY_OUTPUT_MD ??
  path.join(SCRIPT_DIR, 'research-preset-policy-integrity-audit.md')
const FAIL_ON_GATE =
  String(process.env.RESEARCH_PRESET_POLICY_INTEGRITY_FAIL_ON_GATE ?? 'false') === 'true'
const REQUIRE_ARTIFACT_META =
  String(process.env.RESEARCH_PRESET_POLICY_INTEGRITY_REQUIRE_ARTIFACT_META ?? 'false') === 'true'

const EXPECTED_PROFILES = ['smoke', 'standard', 'nightly']
const EXPECTED_PRESETS = [
  'vortex_ring_collision',
  'vortex_leapfrogging',
  'jet_instability',
  'turbulence_cascade',
  'helmholtz_shear',
  'kelvin_wave_train',
  'reconnection_pair',
]

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

function boolCheck(checks, details, id, pass, passMsg, failMsg) {
  checks[id] = pass === true
  details.push((pass === true ? 'PASS' : 'FAIL') + ` ${id}: ${pass === true ? passMsg : failMsg}`)
}

function profileSet(policy) {
  return new Set(Object.keys(policy?.profiles ?? {}))
}

function evaluateCasePresetCoverage(casePolicy) {
  const issues = []
  const profiles = casePolicy?.profiles ?? {}
  for (const profileName of Object.keys(profiles)) {
    const perPreset = profiles?.[profileName]?.perPreset ?? {}
    const presetKeys = new Set(Object.keys(perPreset))
    for (const presetId of EXPECTED_PRESETS) {
      if (!presetKeys.has(presetId)) {
        issues.push(`${profileName}:missing:${presetId}`)
      }
    }
    for (const presetId of presetKeys) {
      if (!EXPECTED_PRESETS.includes(presetId)) {
        issues.push(`${profileName}:unexpected:${presetId}`)
      }
    }
  }
  return issues
}

function buildMarkdown(report) {
  const lines = [
    '# Research Preset Policy Integrity Audit',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Check | Result |',
    '|---|---|',
  ]
  for (const [id, pass] of Object.entries(report.gate.checks)) {
    lines.push(`| ${id} | ${pass ? 'PASS' : 'FAIL'} |`)
  }
  lines.push('', '## Details', '')
  for (const item of report.details) {
    lines.push(`- ${item}`)
  }
  lines.push('', `Overall gate: ${report.gate.pass ? 'PASS' : 'FAIL'}`)
  return lines.join('\n')
}

async function main() {
  const checks = {}
  const details = []
  const casePolicy = await readJsonIfExists(CASE_POLICY_PATH)
  const trendPolicy = await readJsonIfExists(TREND_POLICY_PATH)
  const latestAudit = await readJsonIfExists(PRESET_AUDIT_JSON_PATH)

  boolCheck(
    checks,
    details,
    'case_policy_exists',
    Boolean(casePolicy),
    'case policy file is readable',
    `case policy file not found: ${path.resolve(CASE_POLICY_PATH)}`,
  )
  boolCheck(
    checks,
    details,
    'trend_policy_exists',
    Boolean(trendPolicy),
    'trend policy file is readable',
    `trend policy file not found: ${path.resolve(TREND_POLICY_PATH)}`,
  )

  boolCheck(
    checks,
    details,
    'case_policy_schema_valid',
    String(casePolicy?.schemaVersion ?? '') === 'tt052.research_preset_case_policy.v1',
    'case policy schema version matches tt052 v1',
    `unexpected case schema version: ${String(casePolicy?.schemaVersion ?? 'n/a')}`,
  )
  boolCheck(
    checks,
    details,
    'trend_policy_schema_valid',
    String(trendPolicy?.schemaVersion ?? '') === 'tt044.research_preset_trend_policy.v1',
    'trend policy schema version matches tt044 v1',
    `unexpected trend schema version: ${String(trendPolicy?.schemaVersion ?? 'n/a')}`,
  )

  const caseProfiles = profileSet(casePolicy)
  const trendProfiles = profileSet(trendPolicy)
  const missingCaseProfiles = EXPECTED_PROFILES.filter((name) => !caseProfiles.has(name))
  const missingTrendProfiles = EXPECTED_PROFILES.filter((name) => !trendProfiles.has(name))
  boolCheck(
    checks,
    details,
    'policy_profiles_complete',
    missingCaseProfiles.length === 0 && missingTrendProfiles.length === 0,
    'smoke/standard/nightly are present in both policies',
    `missing profiles case=${missingCaseProfiles.join(',') || '-'} trend=${missingTrendProfiles.join(',') || '-'}`,
  )

  boolCheck(
    checks,
    details,
    'policy_default_profiles_valid',
    EXPECTED_PROFILES.includes(String(casePolicy?.defaultProfile ?? '')) &&
      EXPECTED_PROFILES.includes(String(trendPolicy?.defaultProfile ?? '')),
    'default profiles are valid',
    `invalid default profiles case=${String(casePolicy?.defaultProfile ?? 'n/a')} trend=${String(trendPolicy?.defaultProfile ?? 'n/a')}`,
  )

  const profileSymmetric =
    EXPECTED_PROFILES.every((name) => caseProfiles.has(name) && trendProfiles.has(name)) &&
    [...caseProfiles].every((name) => trendProfiles.has(name))
  boolCheck(
    checks,
    details,
    'policy_profile_sets_aligned',
    profileSymmetric,
    'case/trend profile sets are aligned',
    `profile mismatch case=[${[...caseProfiles].join(',')}] trend=[${[...trendProfiles].join(',')}]`,
  )

  const caseCoverageIssues = evaluateCasePresetCoverage(casePolicy)
  boolCheck(
    checks,
    details,
    'case_policy_preset_coverage',
    caseCoverageIssues.length === 0,
    'all profiles define perPreset thresholds for expected presets',
    `coverage issues: ${caseCoverageIssues.join('; ')}`,
  )

  boolCheck(
    checks,
    details,
    'artifact_json_exists',
    Boolean(latestAudit),
    'research preset audit artifact exists',
    `audit artifact not found: ${path.resolve(PRESET_AUDIT_JSON_PATH)}`,
  )

  const hasArtifactMeta =
    latestAudit &&
    typeof latestAudit === 'object' &&
    latestAudit.casePolicy &&
    latestAudit.trend &&
    latestAudit.trend.policy
  boolCheck(
    checks,
    details,
    'artifact_policy_meta_present',
    REQUIRE_ARTIFACT_META ? Boolean(hasArtifactMeta) : true,
    'artifact policy meta is present',
    'artifact policy meta is missing',
  )

  const artifactCaseProfile = String(latestAudit?.casePolicy?.profile ?? '')
  const artifactTrendProfile = String(latestAudit?.trend?.policy?.profile ?? '')
  const artifactProfilesKnown =
    (!hasArtifactMeta && !REQUIRE_ARTIFACT_META) ||
    (EXPECTED_PROFILES.includes(artifactCaseProfile) && EXPECTED_PROFILES.includes(artifactTrendProfile))
  boolCheck(
    checks,
    details,
    'artifact_policy_profiles_known',
    artifactProfilesKnown,
    'artifact policy profiles are recognized',
    `unknown artifact profiles case=${artifactCaseProfile || 'n/a'} trend=${artifactTrendProfile || 'n/a'}`,
  )

  const artifactCaseThresholds = latestAudit?.casePolicy?.thresholdsByPreset ?? {}
  const artifactMissingPresets = EXPECTED_PRESETS.filter(
    (presetId) => !(presetId in artifactCaseThresholds),
  )
  boolCheck(
    checks,
    details,
    'artifact_case_thresholds_complete',
    (!REQUIRE_ARTIFACT_META && !hasArtifactMeta) || artifactMissingPresets.length === 0,
    'artifact case thresholds include all expected presets',
    `artifact missing preset thresholds: ${artifactMissingPresets.join(',')}`,
  )

  const failedChecks = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([id]) => id)
  const report = {
    generatedAt: new Date().toISOString(),
    paths: {
      casePolicy: path.resolve(CASE_POLICY_PATH),
      trendPolicy: path.resolve(TREND_POLICY_PATH),
      latestAuditJson: path.resolve(PRESET_AUDIT_JSON_PATH),
    },
    gate: {
      pass: failedChecks.length === 0,
      checks,
      failedChecks,
    },
    details,
    expected: {
      profiles: EXPECTED_PROFILES,
      presets: EXPECTED_PRESETS,
    },
    artifactMeta: hasArtifactMeta
      ? {
          casePolicyProfile: artifactCaseProfile,
          trendPolicyProfile: artifactTrendProfile,
          casePolicyPath: latestAudit?.casePolicy?.path ?? null,
          trendPolicyPath: latestAudit?.trend?.policy?.path ?? null,
        }
      : null,
  }

  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(OUTPUT_MD, `${buildMarkdown(report)}\n`, 'utf8')
  console.table(
    Object.entries(checks).map(([id, pass]) => ({
      check: id,
      result: pass ? 'PASS' : 'FAIL',
    })),
  )
  if (FAIL_ON_GATE && report.gate.pass !== true) {
    throw new Error(`Research preset policy integrity audit failed: ${report.gate.failedChecks.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
