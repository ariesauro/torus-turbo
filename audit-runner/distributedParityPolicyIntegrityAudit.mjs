import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

const POLICY_PATH =
  process.env.DISTRIBUTED_PARITY_POLICY_PATH ??
  path.join(SCRIPT_DIR, 'distributed-parity-policy.v1.json')
const ARTIFACT_PATH =
  process.env.DISTRIBUTED_PARITY_ARTIFACT_PATH ??
  path.join(SCRIPT_DIR, 'distributed-validation-parity-audit.runtime.json')
const OUTPUT_JSON =
  process.env.DISTRIBUTED_PARITY_POLICY_INTEGRITY_OUTPUT_JSON ??
  path.join(SCRIPT_DIR, 'distributed-parity-policy-integrity-audit.json')
const OUTPUT_MD =
  process.env.DISTRIBUTED_PARITY_POLICY_INTEGRITY_OUTPUT_MD ??
  path.join(SCRIPT_DIR, 'distributed-parity-policy-integrity-audit.md')
const REQUIRE_ARTIFACT =
  String(process.env.DISTRIBUTED_PARITY_POLICY_INTEGRITY_REQUIRE_ARTIFACT ?? 'false') === 'true'
const FAIL_ON_GATE =
  String(process.env.DISTRIBUTED_PARITY_POLICY_INTEGRITY_FAIL_ON_GATE ?? 'false') === 'true'

const REQUIRED_PROFILES = ['smoke', 'standard', 'nightly']
const REQUIRED_CHECKS = ['invariant_drift', 'contract_parity', 'timing_parity']

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
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

function asFiniteNumber(value, fallback = Number.NaN) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function approxEqual(a, b, eps = 1e-9) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.abs(a - b) <= eps
}

function boolCheck(checks, details, id, pass, passMsg, failMsg) {
  checks[id] = pass === true
  details.push(`${pass === true ? 'PASS' : 'FAIL'} ${id}: ${pass === true ? passMsg : failMsg}`)
}

function buildMarkdown(report) {
  const lines = [
    '# Distributed Parity Policy Integrity Audit',
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
  for (const detail of report.details) {
    lines.push(`- ${detail}`)
  }
  lines.push('', `Overall gate: ${report.gate.pass ? 'PASS' : 'FAIL'}`)
  return lines.join('\n')
}

function checkMonotonicThresholds(profiles) {
  const smoke = profiles?.smoke ?? {}
  const standard = profiles?.standard ?? {}
  const nightly = profiles?.nightly ?? {}

  const smokeDrift = asFiniteNumber(smoke?.invariantDriftDeltaMaxPct)
  const standardDrift = asFiniteNumber(standard?.invariantDriftDeltaMaxPct)
  const nightlyDrift = asFiniteNumber(nightly?.invariantDriftDeltaMaxPct)
  const smokeTiming = asFiniteNumber(smoke?.timingStepP95DeltaMaxPct)
  const standardTiming = asFiniteNumber(standard?.timingStepP95DeltaMaxPct)
  const nightlyTiming = asFiniteNumber(nightly?.timingStepP95DeltaMaxPct)
  const smokeRtt = asFiniteNumber(smoke?.networkEligible?.rttMsP95Max)
  const standardRtt = asFiniteNumber(standard?.networkEligible?.rttMsP95Max)
  const nightlyRtt = asFiniteNumber(nightly?.networkEligible?.rttMsP95Max)
  const smokeJitter = asFiniteNumber(smoke?.networkEligible?.jitterMsP95Max)
  const standardJitter = asFiniteNumber(standard?.networkEligible?.jitterMsP95Max)
  const nightlyJitter = asFiniteNumber(nightly?.networkEligible?.jitterMsP95Max)
  const smokeLoss = asFiniteNumber(smoke?.networkEligible?.lossPctMax)
  const standardLoss = asFiniteNumber(standard?.networkEligible?.lossPctMax)
  const nightlyLoss = asFiniteNumber(nightly?.networkEligible?.lossPctMax)

  return {
    ok:
      smokeDrift >= standardDrift &&
      standardDrift >= nightlyDrift &&
      smokeTiming >= standardTiming &&
      standardTiming >= nightlyTiming &&
      smokeRtt >= standardRtt &&
      standardRtt >= nightlyRtt &&
      smokeJitter >= standardJitter &&
      standardJitter >= nightlyJitter &&
      smokeLoss >= standardLoss &&
      standardLoss >= nightlyLoss,
    values: {
      drift: [smokeDrift, standardDrift, nightlyDrift],
      timing: [smokeTiming, standardTiming, nightlyTiming],
      rtt: [smokeRtt, standardRtt, nightlyRtt],
      jitter: [smokeJitter, standardJitter, nightlyJitter],
      loss: [smokeLoss, standardLoss, nightlyLoss],
    },
  }
}

async function main() {
  const checks = {}
  const details = []
  const policy = await readJson(POLICY_PATH)
  const artifact = await readJsonIfExists(ARTIFACT_PATH)

  boolCheck(
    checks,
    details,
    'policy_schema_valid',
    String(policy?.schemaVersion ?? '') === 'tt067.distributed_parity_policy.v1',
    'policy schema version matches v1',
    `unexpected policy schema: ${String(policy?.schemaVersion ?? 'n/a')}`,
  )

  const policyProfiles = policy?.profiles ?? {}
  const missingProfiles = REQUIRED_PROFILES.filter(
    (profile) => !Object.prototype.hasOwnProperty.call(policyProfiles, profile),
  )
  boolCheck(
    checks,
    details,
    'required_profiles_present',
    missingProfiles.length === 0,
    'required profiles are present (smoke/standard/nightly)',
    `missing profiles: ${missingProfiles.join(', ')}`,
  )

  const defaultProfile = String(policy?.defaultProfile ?? '')
  boolCheck(
    checks,
    details,
    'default_profile_present',
    defaultProfile.length > 0 && Object.prototype.hasOwnProperty.call(policyProfiles, defaultProfile),
    `default profile is valid (${defaultProfile})`,
    `default profile is invalid: ${defaultProfile || 'empty'}`,
  )

  const monotonic = checkMonotonicThresholds(policyProfiles)
  boolCheck(
    checks,
    details,
    'profile_thresholds_monotonic',
    monotonic.ok,
    'profile strictness is monotonic (smoke >= standard >= nightly)',
    `non-monotonic thresholds: ${JSON.stringify(monotonic.values)}`,
  )

  const trendRegress = policy?.trend?.regress ?? {}
  boolCheck(
    checks,
    details,
    'trend_regress_policy_present',
    typeof trendRegress === 'object' && trendRegress !== null,
    'trend regress policy block is present',
    'trend regress policy block is missing',
  )

  const artifactExists = artifact !== null
  boolCheck(
    checks,
    details,
    'artifact_present_if_required',
    !REQUIRE_ARTIFACT || artifactExists,
    REQUIRE_ARTIFACT ? 'runtime artifact is present' : 'artifact is optional for this run',
    'runtime artifact is missing while required',
  )

  if (artifactExists) {
    boolCheck(
      checks,
      details,
      'artifact_schema_valid',
      String(artifact?.schemaVersion ?? '') === 'tt067.distributed_validation_parity_audit.v1',
      'runtime artifact schema matches expected parity artifact schema',
      `unexpected runtime artifact schema: ${String(artifact?.schemaVersion ?? 'n/a')}`,
    )

    const artifactPolicySchema = String(artifact?.parity?.policy?.schemaVersion ?? '')
    boolCheck(
      checks,
      details,
      'artifact_policy_schema_matches',
      artifactPolicySchema === String(policy?.schemaVersion ?? ''),
      `artifact policy schema matches (${artifactPolicySchema})`,
      `artifact policy schema mismatch: artifact=${artifactPolicySchema || 'n/a'} policy=${String(policy?.schemaVersion ?? 'n/a')}`,
    )

    const artifactProfile = String(artifact?.parity?.policy?.profile ?? '')
    boolCheck(
      checks,
      details,
      'artifact_policy_profile_known',
      artifactProfile.length > 0 && Object.prototype.hasOwnProperty.call(policyProfiles, artifactProfile),
      `artifact profile is known (${artifactProfile})`,
      `artifact profile is unknown: ${artifactProfile || 'empty'}`,
    )

    const parityChecks = Array.isArray(artifact?.parity?.checks) ? artifact.parity.checks : []
    const parityMap = new Map(parityChecks.map((item) => [String(item?.id ?? ''), item]))
    const missingParityChecks = REQUIRED_CHECKS.filter((id) => !parityMap.has(id))
    boolCheck(
      checks,
      details,
      'artifact_required_checks_present',
      missingParityChecks.length === 0,
      'artifact contains required parity checks',
      `missing parity checks: ${missingParityChecks.join(', ')}`,
    )

    const activeProfile = policyProfiles[artifactProfile] ?? {}
    const expectedInvariantLimit = asFiniteNumber(activeProfile?.invariantDriftDeltaMaxPct, Number.NaN) / 100
    const expectedTimingLimit = 1 - asFiniteNumber(activeProfile?.timingStepP95DeltaMaxPct, Number.NaN) / 100
    const observedInvariantLimit = asFiniteNumber(parityMap.get('invariant_drift')?.limit, Number.NaN)
    const observedTimingLimit = asFiniteNumber(parityMap.get('timing_parity')?.limit, Number.NaN)
    boolCheck(
      checks,
      details,
      'artifact_limits_match_profile_thresholds',
      approxEqual(observedInvariantLimit, expectedInvariantLimit) &&
        approxEqual(observedTimingLimit, expectedTimingLimit),
      'artifact check limits match active profile thresholds',
      `limit mismatch: invariant=${observedInvariantLimit} expected=${expectedInvariantLimit}, timing=${observedTimingLimit} expected=${expectedTimingLimit}`,
    )
  }

  const failedChecks = Object.entries(checks)
    .filter(([, pass]) => pass !== true)
    .map(([id]) => id)

  const report = {
    schemaVersion: 'tt067.distributed_parity_policy_integrity_audit.v1',
    generatedAt: new Date().toISOString(),
    policyPath: path.resolve(POLICY_PATH),
    artifactPath: path.resolve(ARTIFACT_PATH),
    requireArtifact: REQUIRE_ARTIFACT,
    gate: {
      pass: failedChecks.length === 0,
      checks,
      failedChecks,
    },
    details,
    observed: {
      policySchemaVersion: String(policy?.schemaVersion ?? 'n/a'),
      policyDefaultProfile: String(policy?.defaultProfile ?? 'n/a'),
      policyProfiles: Object.keys(policyProfiles),
      artifactProfile: artifact ? String(artifact?.parity?.policy?.profile ?? 'n/a') : null,
      artifactPolicySchema: artifact ? String(artifact?.parity?.policy?.schemaVersion ?? 'n/a') : null,
    },
  }

  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(OUTPUT_MD, `${buildMarkdown(report)}\n`, 'utf8')
  console.table(
    Object.entries(checks).map(([check, pass]) => ({
      check,
      result: pass ? 'PASS' : 'FAIL',
    })),
  )
  if (FAIL_ON_GATE && report.gate.pass !== true) {
    throw new Error(`Distributed parity policy integrity gate failed: ${failedChecks.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
