import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')

const CONTRACT_AUDIT_PATH =
  process.env.CLASSIC_EVIDENCE_CONTRACT_AUDIT_PATH ??
  path.join(SCRIPT_DIR, 'distributed-validation-contract-audit.json')
const PARITY_AUDIT_PATH =
  process.env.CLASSIC_EVIDENCE_PARITY_AUDIT_PATH ??
  path.join(SCRIPT_DIR, 'distributed-parity-audit-report.json')
const VALIDATION_POLICY_PATH =
  process.env.CLASSIC_EVIDENCE_VALIDATION_POLICY_PATH ??
  path.join(REPO_ROOT, 'docs', 'dashboard-external-validation-policy.v1.json')
const CLASSIC_CHECKLIST_PATH =
  process.env.CLASSIC_EVIDENCE_CLASSIC_CHECKLIST_PATH ??
  path.join(REPO_ROOT, 'docs', 'CLASSIC_EXTERNAL_VALIDATION_CLOSURE_CHECKLIST.md')
const OUTPUT_JSON =
  process.env.CLASSIC_EVIDENCE_OUTPUT_JSON ??
  path.join(SCRIPT_DIR, 'classic-external-validation-evidence-pack.json')
const OUTPUT_MD =
  process.env.CLASSIC_EVIDENCE_OUTPUT_MD ??
  path.join(SCRIPT_DIR, 'classic-external-validation-evidence-pack.md')
const FAIL_ON_GATE = String(process.env.CLASSIC_EVIDENCE_FAIL_ON_GATE ?? 'false') === 'true'

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

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function boolCheck(checks, details, id, pass, passMsg, failMsg) {
  checks[id] = pass === true
  details.push(`${pass === true ? 'PASS' : 'FAIL'} ${id}: ${pass === true ? passMsg : failMsg}`)
}

function buildMarkdown(report) {
  const lines = [
    '# Classic External Validation Evidence Pack',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Check | Result |',
    '|---|---|',
  ]
  for (const [id, pass] of Object.entries(report.gate.checks)) {
    lines.push(`| ${id} | ${pass ? 'PASS' : 'FAIL'} |`)
  }
  lines.push('', '## Acceptance Table', '', '| Criterion | Value | Verdict |', '|---|---|---|')
  for (const row of report.acceptanceTable) {
    lines.push(`| ${row.criterion} | ${row.value} | ${row.verdict} |`)
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
  const contractAudit = await readJsonIfExists(CONTRACT_AUDIT_PATH)
  const parityAudit = await readJsonIfExists(PARITY_AUDIT_PATH)
  const policy = await readJsonIfExists(VALIDATION_POLICY_PATH)
  const checklistExists = await exists(CLASSIC_CHECKLIST_PATH)

  boolCheck(
    checks,
    details,
    'contract_audit_present',
    Boolean(contractAudit),
    'contract audit artifact is present',
    `missing contract audit artifact: ${path.resolve(CONTRACT_AUDIT_PATH)}`,
  )
  boolCheck(
    checks,
    details,
    'contract_gate_pass',
    contractAudit?.gate?.pass === true,
    'contract gate is PASS',
    `contract gate failed: ${(contractAudit?.gate?.failedChecks ?? []).join(', ') || 'n/a'}`,
  )
  boolCheck(
    checks,
    details,
    'parity_audit_present',
    Boolean(parityAudit),
    'parity audit artifact is present',
    `missing parity audit artifact: ${path.resolve(PARITY_AUDIT_PATH)}`,
  )
  boolCheck(
    checks,
    details,
    'parity_gate_pass',
    parityAudit?.gate?.pass === true,
    'parity gate is PASS',
    `parity gate failed: ${(parityAudit?.gate?.failedChecks ?? []).join(', ') || 'n/a'}`,
  )

  const parityVerdict = String(parityAudit?.observed?.parityVerdict ?? 'n/a')
  const envelopeClass = String(parityAudit?.observed?.networkEnvelopeClass ?? 'n/a')
  const naturalModifiersActive = parityAudit?.observed?.naturalModifiersActive
  boolCheck(
    checks,
    details,
    'parity_verdict_pass',
    parityVerdict === 'parity_pass',
    'parity verdict is parity_pass',
    `unexpected parity verdict: ${parityVerdict}`,
  )
  boolCheck(
    checks,
    details,
    'network_envelope_eligible',
    envelopeClass === 'eligible',
    'network envelope class is eligible',
    `unexpected envelope class: ${envelopeClass}`,
  )
  boolCheck(
    checks,
    details,
    'natural_modifiers_inactive',
    naturalModifiersActive === false,
    'natural modifiers are inactive for evidence run',
    `natural modifiers active flag is ${String(naturalModifiersActive)}`,
  )
  boolCheck(
    checks,
    details,
    'validation_policy_present',
    String(policy?.schemaVersion ?? '') === 'tt062.dashboard_external_validation_policy.v1',
    'external validation policy v1 is present',
    `missing/invalid validation policy at ${path.resolve(VALIDATION_POLICY_PATH)}`,
  )
  boolCheck(
    checks,
    details,
    'classic_checklist_present',
    checklistExists === true,
    'classic closure checklist is present',
    `missing checklist: ${path.resolve(CLASSIC_CHECKLIST_PATH)}`,
  )

  const acceptanceTable = [
    {
      criterion: 'Contract gate',
      value: contractAudit?.gate?.pass === true ? 'PASS' : 'FAIL',
      verdict: contractAudit?.gate?.pass === true ? 'accepted' : 'rejected',
    },
    {
      criterion: 'Parity gate',
      value: parityAudit?.gate?.pass === true ? 'PASS' : 'FAIL',
      verdict: parityAudit?.gate?.pass === true ? 'accepted' : 'rejected',
    },
    {
      criterion: 'Parity verdict',
      value: parityVerdict,
      verdict: parityVerdict === 'parity_pass' ? 'accepted' : 'rejected',
    },
    {
      criterion: 'Network envelope',
      value: envelopeClass,
      verdict: envelopeClass === 'eligible' ? 'accepted' : 'rejected',
    },
    {
      criterion: 'Natural modifiers',
      value: naturalModifiersActive === false ? 'inactive' : 'active',
      verdict: naturalModifiersActive === false ? 'accepted' : 'rejected',
    },
  ]

  const failedChecks = Object.entries(checks)
    .filter(([, pass]) => pass !== true)
    .map(([id]) => id)
  const report = {
    schemaVersion: 'tt068.classic_external_validation_evidence_pack.v1',
    generatedAt: new Date().toISOString(),
    paths: {
      contractAudit: path.resolve(CONTRACT_AUDIT_PATH),
      parityAudit: path.resolve(PARITY_AUDIT_PATH),
      validationPolicy: path.resolve(VALIDATION_POLICY_PATH),
      classicChecklist: path.resolve(CLASSIC_CHECKLIST_PATH),
    },
    gate: {
      pass: failedChecks.length === 0,
      checks,
      failedChecks,
    },
    acceptanceTable,
    details,
    observed: {
      parityVerdict,
      envelopeClass,
      naturalModifiersActive: naturalModifiersActive === false ? false : true,
      policyVersion: String(policy?.schemaVersion ?? 'n/a'),
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
    throw new Error(`Classic external evidence pack failed: ${failedChecks.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
