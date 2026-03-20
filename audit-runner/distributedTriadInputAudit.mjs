import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

const CONTRACT_PATH =
  process.env.DISTRIBUTED_TRIAD_INPUT_CONTRACT_PATH ??
  path.join(SCRIPT_DIR, 'distributed-triad-run-input.contract.v1.json')
const INPUT_PATH =
  process.env.DISTRIBUTED_TRIAD_INPUT_PATH ??
  path.join(SCRIPT_DIR, 'distributed-triad-run-input.json')
const OUTPUT_JSON =
  process.env.DISTRIBUTED_TRIAD_INPUT_AUDIT_OUTPUT_JSON ??
  path.join(SCRIPT_DIR, 'distributed-triad-run-input-audit.json')
const OUTPUT_MD =
  process.env.DISTRIBUTED_TRIAD_INPUT_AUDIT_OUTPUT_MD ??
  path.join(SCRIPT_DIR, 'distributed-triad-run-input-audit.md')
const FAIL_ON_GATE = String(process.env.DISTRIBUTED_TRIAD_INPUT_FAIL_ON_GATE ?? 'false') === 'true'

function getByPath(source, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => (acc && key in acc ? acc[key] : undefined), source)
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
    '# Distributed Triad Input Audit',
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
  for (const detail of report.details) lines.push(`- ${detail}`)
  lines.push('', `Overall gate: ${report.gate.pass ? 'PASS' : 'FAIL'}`)
  return lines.join('\n')
}

async function main() {
  const checks = {}
  const details = []
  const contract = await readJson(CONTRACT_PATH)
  const input = await readJson(INPUT_PATH)

  boolCheck(
    checks,
    details,
    'contract_schema_valid',
    String(contract?.schemaVersion ?? '') === 'tt067.distributed_triad_run_input_contract.v1',
    'triad input contract schema is valid',
    `unexpected contract schema: ${String(contract?.schemaVersion ?? 'n/a')}`,
  )
  boolCheck(
    checks,
    details,
    'input_schema_valid',
    String(input?.schemaVersion ?? '') === 'tt067.distributed_triad_run_input.v1',
    'triad input schema is valid',
    `unexpected input schema: ${String(input?.schemaVersion ?? 'n/a')}`,
  )

  const requiredRootFields = Array.isArray(contract?.requiredRootFields) ? contract.requiredRootFields : []
  const missingRootFields = requiredRootFields.filter((fieldPath) => getByPath(input, fieldPath) === undefined)
  boolCheck(
    checks,
    details,
    'required_root_fields_present',
    missingRootFields.length === 0,
    'all required root fields are present',
    `missing root fields: ${missingRootFields.join(', ')}`,
  )

  const triadRuns = Array.isArray(input?.triadRuns) ? input.triadRuns : []
  const requiredTriadModes = Array.isArray(contract?.requiredTriadModes) ? contract.requiredTriadModes : []
  const observedModes = new Set(triadRuns.map((run) => String(run?.mode ?? '')))
  const missingModes = requiredTriadModes.filter((mode) => !observedModes.has(mode))
  boolCheck(
    checks,
    details,
    'triad_modes_complete',
    missingModes.length === 0,
    'all required triad modes are present',
    `missing triad modes: ${missingModes.join(', ')}`,
  )

  const requiredTriadRunFields = Array.isArray(contract?.requiredTriadRunFields)
    ? contract.requiredTriadRunFields
    : []
  const triadFieldIssues = []
  for (const run of triadRuns) {
    const mode = String(run?.mode ?? 'unknown')
    for (const fieldPath of requiredTriadRunFields) {
      if (getByPath(run, fieldPath) === undefined) {
        triadFieldIssues.push(`${mode}:${fieldPath}`)
      }
    }
  }
  boolCheck(
    checks,
    details,
    'triad_run_fields_present',
    triadFieldIssues.length === 0,
    'all triad run required fields are present',
    `triad run field issues: ${triadFieldIssues.join(', ')}`,
  )

  const acceptedStatuses = new Set(Array.isArray(contract?.acceptedStatuses) ? contract.acceptedStatuses : [])
  const invalidStatuses = triadRuns
    .filter((run) => !acceptedStatuses.has(String(run?.status ?? '')))
    .map((run) => `${String(run?.mode ?? 'unknown')}:${String(run?.status ?? 'n/a')}`)
  boolCheck(
    checks,
    details,
    'triad_statuses_valid',
    invalidStatuses.length === 0,
    'all triad statuses are valid',
    `invalid triad statuses: ${invalidStatuses.join(', ')}`,
  )

  const failedChecks = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([id]) => id)
  const report = {
    schemaVersion: 'tt067.distributed_triad_input_audit_report.v1',
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
    details,
    observed: {
      triadModes: [...observedModes],
      triadRunCount: triadRuns.length,
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
    throw new Error(`Distributed triad input audit failed: ${failedChecks.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
