import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

const CONTRACT_PATH =
  process.env.CLASSIC_REPLICATION_CONTRACT_PATH ??
  path.join(SCRIPT_DIR, 'classic-replication-protocol.contract.v1.json')
const INPUT_PATH =
  process.env.CLASSIC_REPLICATION_INPUT_PATH ??
  path.join(SCRIPT_DIR, 'classic-replication-audit.input.json')
const OUTPUT_JSON =
  process.env.CLASSIC_REPLICATION_OUTPUT_JSON ??
  path.join(SCRIPT_DIR, 'classic-replication-audit-report.json')
const OUTPUT_MD =
  process.env.CLASSIC_REPLICATION_OUTPUT_MD ??
  path.join(SCRIPT_DIR, 'classic-replication-audit-report.md')
const FAIL_ON_GATE = String(process.env.CLASSIC_REPLICATION_FAIL_ON_GATE ?? 'false') === 'true'

function getByPath(source, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => (acc && key in acc ? acc[key] : undefined), source)
}

function toFinite(value, fallback = Number.NaN) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

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
    '# Classic Replication Audit',
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

async function main() {
  const checks = {}
  const details = []
  const contract = await readJson(CONTRACT_PATH)
  const input = await readJson(INPUT_PATH)

  const requiredRootFields = Array.isArray(contract?.requiredRootFields) ? contract.requiredRootFields : []
  const requiredRunFields = Array.isArray(contract?.requiredRunFields) ? contract.requiredRunFields : []
  const requiredChecks = Array.isArray(contract?.requiredChecks) ? contract.requiredChecks : []
  const allowedVerdicts = Array.isArray(contract?.allowedVerdicts) ? contract.allowedVerdicts : []

  boolCheck(
    checks,
    details,
    'contract_schema_valid',
    String(contract?.schemaVersion ?? '') === 'tt068.classic_replication_protocol_contract.v1',
    'replication contract schema version is valid',
    `unexpected contract schema version: ${String(contract?.schemaVersion ?? 'n/a')}`,
  )
  boolCheck(
    checks,
    details,
    'input_schema_valid',
    String(input?.schemaVersion ?? '') === 'tt068.classic_replication_audit_input.v1',
    'replication input schema version is valid',
    `unexpected input schema version: ${String(input?.schemaVersion ?? 'n/a')}`,
  )

  const missingRootFields = requiredRootFields.filter((fieldPath) => getByPath(input, fieldPath) === undefined)
  boolCheck(
    checks,
    details,
    'input_required_root_fields_present',
    missingRootFields.length === 0,
    'all required root fields are present',
    `missing root fields: ${missingRootFields.join(', ')}`,
  )

  const referenceRun = input?.referenceRun ?? {}
  const replicaRun = input?.replicaRun ?? {}
  const missingReferenceFields = requiredRunFields.filter((fieldPath) => getByPath(referenceRun, fieldPath) === undefined)
  const missingReplicaFields = requiredRunFields.filter((fieldPath) => getByPath(replicaRun, fieldPath) === undefined)
  boolCheck(
    checks,
    details,
    'input_required_run_fields_present',
    missingReferenceFields.length === 0 && missingReplicaFields.length === 0,
    'required run fields are present for both reference and replica',
    `missing reference fields: ${missingReferenceFields.join(', ') || '-'}; missing replica fields: ${missingReplicaFields.join(', ') || '-'}`,
  )

  const checksMap = new Map((Array.isArray(input?.checks) ? input.checks : []).map((item) => [String(item?.id ?? ''), item]))
  const missingChecks = requiredChecks.filter((id) => !checksMap.has(id))
  boolCheck(
    checks,
    details,
    'required_check_rows_present',
    missingChecks.length === 0,
    'all required check rows are present',
    `missing checks: ${missingChecks.join(', ')}`,
  )

  const failedRequiredChecks = requiredChecks.filter((id) => String(checksMap.get(id)?.status ?? '').toLowerCase() !== 'pass')
  boolCheck(
    checks,
    details,
    'required_checks_pass',
    failedRequiredChecks.length === 0,
    'all required checks have PASS status',
    `required checks not passing: ${failedRequiredChecks.join(', ')}`,
  )

  const verdict = String(input?.verdict ?? '')
  boolCheck(
    checks,
    details,
    'verdict_allowed',
    allowedVerdicts.includes(verdict),
    'verdict is allowed by contract',
    `verdict is not allowed: ${verdict || 'n/a'}`,
  )

  const requiredVerdict = String(contract?.acceptanceRule?.requiredVerdict ?? '')
  boolCheck(
    checks,
    details,
    'verdict_required_value',
    verdict === requiredVerdict,
    `verdict matches required value (${requiredVerdict})`,
    `expected verdict=${requiredVerdict}, got ${verdict || 'n/a'}`,
  )

  boolCheck(
    checks,
    details,
    'config_hash_match',
    String(referenceRun?.scenarioHash ?? '') === String(replicaRun?.scenarioHash ?? ''),
    'reference and replica scenario hash match',
    `scenario hash mismatch: ref=${String(referenceRun?.scenarioHash ?? 'n/a')} replica=${String(replicaRun?.scenarioHash ?? 'n/a')}`,
  )

  const classicProfileLockOk =
    referenceRun?.classicProfile === true &&
    replicaRun?.classicProfile === true &&
    referenceRun?.naturalModifiersActive === false &&
    replicaRun?.naturalModifiersActive === false
  boolCheck(
    checks,
    details,
    'classic_profile_lock',
    classicProfileLockOk,
    'classic profile lock is active for both runs',
    'classic profile lock failed (classicProfile/naturalModifiersActive mismatch)',
  )

  const contractsAligned = ['ring', 'jet', 'detector', 'topology'].every((key) => {
    const ref = String(referenceRun?.contracts?.[key] ?? '')
    const rep = String(replicaRun?.contracts?.[key] ?? '')
    return ref.length > 0 && ref === rep
  })
  boolCheck(
    checks,
    details,
    'contract_verdict_alignment',
    contractsAligned,
    'ring/jet/detector/topology verdicts are aligned',
    'contract verdict alignment failed for one or more contours',
  )

  const driftDelta =
    Math.abs(toFinite(referenceRun?.metrics?.invariantDriftPct, 0) - toFinite(replicaRun?.metrics?.invariantDriftPct, 0))
  const driftDeltaMax = toFinite(contract?.thresholds?.invariantDriftDeltaMaxPct, 2)
  boolCheck(
    checks,
    details,
    'invariant_drift_delta_within_limit',
    driftDelta <= driftDeltaMax,
    `invariant drift delta ${driftDelta.toFixed(3)} <= ${driftDeltaMax.toFixed(3)}`,
    `invariant drift delta ${driftDelta.toFixed(3)} > ${driftDeltaMax.toFixed(3)}`,
  )

  const refStepP95 = toFinite(referenceRun?.metrics?.stepP95Ms, Number.NaN)
  const repStepP95 = toFinite(replicaRun?.metrics?.stepP95Ms, Number.NaN)
  const timingDeltaPct =
    Number.isFinite(refStepP95) && refStepP95 > 1e-9 && Number.isFinite(repStepP95)
      ? Math.abs((repStepP95 - refStepP95) / refStepP95) * 100
      : Number.NaN
  const timingDeltaMaxPct = toFinite(contract?.thresholds?.timingStepP95DeltaMaxPct, 10)
  boolCheck(
    checks,
    details,
    'timing_envelope_within_limit',
    Number.isFinite(timingDeltaPct) && timingDeltaPct <= timingDeltaMaxPct,
    `timing delta ${timingDeltaPct.toFixed(3)}% <= ${timingDeltaMaxPct.toFixed(3)}%`,
    `timing delta ${Number.isFinite(timingDeltaPct) ? timingDeltaPct.toFixed(3) : 'n/a'}% > ${timingDeltaMaxPct.toFixed(3)}%`,
  )

  const failedChecks = Object.entries(checks)
    .filter(([, pass]) => pass !== true)
    .map(([id]) => id)

  const report = {
    schemaVersion: 'tt068.classic_replication_audit_report.v1',
    generatedAt: new Date().toISOString(),
    paths: {
      contract: path.resolve(CONTRACT_PATH),
      input: path.resolve(INPUT_PATH),
    },
    gate: {
      pass: failedChecks.length === 0,
      checks,
      failedChecks,
    },
    observed: {
      verdict,
      requiredVerdict,
      driftDeltaPct: Number.isFinite(driftDelta) ? driftDelta : null,
      timingStepP95DeltaPct: Number.isFinite(timingDeltaPct) ? timingDeltaPct : null,
      scenarioHashReference: String(referenceRun?.scenarioHash ?? ''),
      scenarioHashReplica: String(replicaRun?.scenarioHash ?? ''),
    },
    details,
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
    throw new Error(`Classic replication audit failed: ${failedChecks.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
