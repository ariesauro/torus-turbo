import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ARTIFACT_PATH =
  process.env.DISTRIBUTED_PARITY_ARTIFACT_PATH ??
  path.join(SCRIPT_DIR, 'distributed-validation-parity-audit.runtime.json')
const POLICY_PATH =
  process.env.DISTRIBUTED_PARITY_POLICY_PATH ??
  path.join(SCRIPT_DIR, 'distributed-parity-policy.v1.json')
const OUTPUT_JSON =
  process.env.DISTRIBUTED_PARITY_AUDIT_OUTPUT_JSON ??
  path.join(SCRIPT_DIR, 'distributed-parity-audit-report.json')
const OUTPUT_MD =
  process.env.DISTRIBUTED_PARITY_AUDIT_OUTPUT_MD ??
  path.join(SCRIPT_DIR, 'distributed-parity-audit-report.md')
const FAIL_ON_GATE = String(process.env.DISTRIBUTED_PARITY_AUDIT_FAIL_ON_GATE ?? 'false') === 'true'

const REQUIRED_MODES = ['local', 'server', 'distributed']
const REQUIRED_CHECKS = ['invariant_drift', 'contract_parity', 'timing_parity']

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

function boolCheck(checks, details, id, pass, passMsg, failMsg) {
  checks[id] = pass === true
  details.push(`${pass === true ? 'PASS' : 'FAIL'} ${id}: ${pass === true ? passMsg : failMsg}`)
}

function buildMarkdown(report) {
  const lines = [
    '# Distributed Parity Audit',
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

function asFiniteNumber(value, fallback = Number.NaN) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function resolvePolicyProfile(policy, artifact) {
  const profiles = policy?.profiles ?? {}
  const artifactProfile = String(artifact?.parity?.policy?.profile ?? '')
  if (artifactProfile && Object.prototype.hasOwnProperty.call(profiles, artifactProfile)) return artifactProfile
  const requested = String(process.env.DISTRIBUTED_PARITY_POLICY_PROFILE ?? '').trim()
  if (requested && Object.prototype.hasOwnProperty.call(profiles, requested)) return requested
  const fallback = String(policy?.defaultProfile ?? 'standard')
  if (Object.prototype.hasOwnProperty.call(profiles, fallback)) return fallback
  if (Object.prototype.hasOwnProperty.call(profiles, 'standard')) return 'standard'
  return Object.keys(profiles)[0] || 'standard'
}

async function main() {
  const checks = {}
  const details = []
  const artifact = await readJson(ARTIFACT_PATH)
  const policy = await readJson(POLICY_PATH)
  const policyProfile = resolvePolicyProfile(policy, artifact)
  const profileThresholds = policy?.profiles?.[policyProfile] ?? {}

  boolCheck(
    checks,
    details,
    'artifact_schema_valid',
    String(artifact?.schemaVersion ?? '') === 'tt067.distributed_validation_parity_audit.v1',
    'schema version matches tt067 parity audit v1',
    `unexpected schema version: ${String(artifact?.schemaVersion ?? 'n/a')}`,
  )

  const triadRuns = Array.isArray(artifact?.triadRuns) ? artifact.triadRuns : []
  const observedModes = new Set(triadRuns.map((run) => String(run?.mode ?? '')))
  const missingModes = REQUIRED_MODES.filter((mode) => !observedModes.has(mode))
  boolCheck(
    checks,
    details,
    'triad_modes_complete',
    missingModes.length === 0,
    'local/server/distributed triad is present',
    `missing modes: ${missingModes.join(', ')}`,
  )

  const allRunsComplete =
    triadRuns.length >= REQUIRED_MODES.length &&
    triadRuns.every((run) => String(run?.status ?? '').toLowerCase() === 'complete')
  boolCheck(
    checks,
    details,
    'triad_runs_complete',
    allRunsComplete,
    'all triad runs are complete',
    'one or more triad runs are not complete',
  )

  const parityChecks = Array.isArray(artifact?.parity?.checks) ? artifact.parity.checks : []
  const parityMap = new Map(parityChecks.map((item) => [String(item?.id ?? ''), item]))
  const missingChecks = REQUIRED_CHECKS.filter((id) => !parityMap.has(id))
  boolCheck(
    checks,
    details,
    'parity_checks_complete',
    missingChecks.length === 0,
    'all required parity checks are present',
    `missing checks: ${missingChecks.join(', ')}`,
  )

  const failingChecks = REQUIRED_CHECKS.filter((id) => {
    const status = String(parityMap.get(id)?.status ?? '').toLowerCase()
    return status !== 'pass'
  })
  boolCheck(
    checks,
    details,
    'parity_checks_pass',
    failingChecks.length === 0,
    'all required parity checks passed',
    `failed checks: ${failingChecks.join(', ')}`,
  )

  boolCheck(
    checks,
    details,
    'parity_verdict_pass',
    String(artifact?.parity?.verdict ?? '') === 'parity_pass',
    'parity verdict is parity_pass',
    `unexpected parity verdict: ${String(artifact?.parity?.verdict ?? 'n/a')}`,
  )
  boolCheck(
    checks,
    details,
    'network_envelope_eligible',
    String(artifact?.network?.envelopeClass ?? '') === 'eligible',
    'network envelope class is eligible',
    `unexpected envelope class: ${String(artifact?.network?.envelopeClass ?? 'n/a')}`,
  )
  boolCheck(
    checks,
    details,
    'natural_modifiers_inactive',
    artifact?.natural?.modifiersActive === false,
    'Natural modifiers are inactive',
    `natural modifiers active flag is ${String(artifact?.natural?.modifiersActive ?? 'n/a')}`,
  )

  const rttP95 = asFiniteNumber(artifact?.network?.metrics?.rttMsP95)
  const jitterP95 = asFiniteNumber(artifact?.network?.metrics?.jitterMsP95)
  const lossPct = asFiniteNumber(artifact?.network?.metrics?.lossPct)
  const rttLimit = asFiniteNumber(profileThresholds?.networkEligible?.rttMsP95Max, 20)
  const jitterLimit = asFiniteNumber(profileThresholds?.networkEligible?.jitterMsP95Max, 5)
  const lossLimit = asFiniteNumber(profileThresholds?.networkEligible?.lossPctMax, 0.1)
  boolCheck(
    checks,
    details,
    'network_metrics_within_eligible_thresholds',
    rttP95 <= rttLimit && jitterP95 <= jitterLimit && lossPct <= lossLimit,
    `metrics are within eligible thresholds (rtt=${rttP95}ms<=${rttLimit}, jitter=${jitterP95}ms<=${jitterLimit}, loss=${lossPct}%<=${lossLimit}%)`,
    `metrics exceed eligible thresholds (rtt=${rttP95}ms>${rttLimit}, jitter=${jitterP95}ms>${jitterLimit}, loss=${lossPct}%>${lossLimit}%)`,
  )

  const failedChecks = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([id]) => id)
  const report = {
    generatedAt: new Date().toISOString(),
    sourceArtifact: path.resolve(ARTIFACT_PATH),
    gate: {
      pass: failedChecks.length === 0,
      checks,
      failedChecks,
    },
    details,
    observed: {
      triadModes: [...observedModes],
      parityVerdict: String(artifact?.parity?.verdict ?? 'n/a'),
      policyProfile,
      networkEnvelopeClass: String(artifact?.network?.envelopeClass ?? 'n/a'),
      naturalModifiersActive: artifact?.natural?.modifiersActive ?? null,
      metrics: {
        rttMsP95: Number.isFinite(rttP95) ? rttP95 : null,
        jitterMsP95: Number.isFinite(jitterP95) ? jitterP95 : null,
        lossPct: Number.isFinite(lossPct) ? lossPct : null,
      },
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
    throw new Error(`Distributed parity audit failed: ${failedChecks.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
