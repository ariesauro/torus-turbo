import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')

const CONTRACT_PATH =
  process.env.DISTRIBUTED_VALIDATION_CONTRACT_PATH ??
  path.join(REPO_ROOT, 'docs', 'distributed-validation-artifact.contract.v1.json')
const ARTIFACT_PATH =
  process.env.DISTRIBUTED_VALIDATION_ARTIFACT_PATH ??
  path.join(SCRIPT_DIR, 'distributed-validation-parity-audit.runtime.json')
const OUTPUT_JSON =
  process.env.DISTRIBUTED_VALIDATION_CONTRACT_AUDIT_OUTPUT_JSON ??
  path.join(SCRIPT_DIR, 'distributed-validation-contract-audit.json')
const OUTPUT_MD =
  process.env.DISTRIBUTED_VALIDATION_CONTRACT_AUDIT_OUTPUT_MD ??
  path.join(SCRIPT_DIR, 'distributed-validation-contract-audit.md')

const FAIL_ON_GATE =
  String(process.env.DISTRIBUTED_VALIDATION_CONTRACT_AUDIT_FAIL_ON_GATE ?? 'false') === 'true'
const REQUIRE_ARTIFACT =
  String(process.env.DISTRIBUTED_VALIDATION_CONTRACT_AUDIT_REQUIRE_ARTIFACT ?? 'false') === 'true'
const REQUIRE_ELIGIBLE_PARITY_PASS =
  String(process.env.DISTRIBUTED_VALIDATION_CONTRACT_AUDIT_REQUIRE_ELIGIBLE_PASS ?? 'false') ===
  'true'

function getByPath(source, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => (acc && key in acc ? acc[key] : undefined), source)
}

function boolCheck(checks, details, id, pass, passMsg, failMsg) {
  checks[id] = pass === true
  details.push(`${pass === true ? 'PASS' : 'FAIL'} ${id}: ${pass === true ? passMsg : failMsg}`)
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

function buildMarkdown(report) {
  const lines = [
    '# Distributed Validation Contract Audit',
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
  const contract = await readJsonIfExists(CONTRACT_PATH)
  const artifact = await readJsonIfExists(ARTIFACT_PATH)

  boolCheck(
    checks,
    details,
    'contract_exists',
    Boolean(contract),
    'contract file is readable',
    `contract file not found: ${path.resolve(CONTRACT_PATH)}`,
  )
  boolCheck(
    checks,
    details,
    'contract_schema_version_valid',
    String(contract?.schemaVersion ?? '') === 'tt067.distributed_validation_artifact_contract.v1',
    'schema version matches tt067 v1',
    `unexpected schema version: ${String(contract?.schemaVersion ?? 'n/a')}`,
  )
  boolCheck(
    checks,
    details,
    'contract_has_required_fields',
    Array.isArray(contract?.requiredFields) && contract.requiredFields.length > 0,
    `required field list size=${Array.isArray(contract?.requiredFields) ? contract.requiredFields.length : 0}`,
    'required field list is missing or empty',
  )
  boolCheck(
    checks,
    details,
    'contract_has_envelope_classes',
    Array.isArray(contract?.networkEnvelopeClasses) &&
      ['eligible', 'approximate', 'unsupported'].every((item) =>
        contract.networkEnvelopeClasses.includes(item),
      ),
    'network envelope classes include eligible/approximate/unsupported',
    'network envelope classes are incomplete',
  )
  boolCheck(
    checks,
    details,
    'artifact_presence',
    REQUIRE_ARTIFACT ? Boolean(artifact) : true,
    artifact ? 'artifact is present' : 'artifact optional and not provided',
    `artifact is required but not found: ${path.resolve(ARTIFACT_PATH)}`,
  )

  const requiredFields = Array.isArray(contract?.requiredFields) ? contract.requiredFields : []
  const missingFields = artifact
    ? requiredFields.filter((fieldPath) => getByPath(artifact, fieldPath) === undefined)
    : []
  boolCheck(
    checks,
    details,
    'artifact_required_fields_present',
    artifact ? missingFields.length === 0 : !REQUIRE_ARTIFACT,
    artifact ? 'all required fields are present in artifact' : 'artifact not required',
    `artifact missing fields: ${missingFields.join(', ')}`,
  )

  const envelopeClass = String(getByPath(artifact ?? {}, 'network.envelopeClass') ?? '')
  const parityVerdict = String(getByPath(artifact ?? {}, 'parity.verdict') ?? '')
  const eligibleRulePass = envelopeClass === 'eligible' && parityVerdict === 'parity_pass'
  boolCheck(
    checks,
    details,
    'artifact_eligible_parity_pass',
    artifact
      ? REQUIRE_ELIGIBLE_PARITY_PASS
        ? eligibleRulePass
        : true
      : !REQUIRE_ELIGIBLE_PARITY_PASS,
    artifact
      ? `eligibility/parity rule satisfied=${eligibleRulePass}`
      : 'eligible parity pass requirement disabled',
    `expected network.envelopeClass=eligible and parity.verdict=parity_pass, got ${envelopeClass || 'n/a'} / ${parityVerdict || 'n/a'}`,
  )

  const failedChecks = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([id]) => id)
  const report = {
    generatedAt: new Date().toISOString(),
    paths: {
      contract: path.resolve(CONTRACT_PATH),
      artifact: path.resolve(ARTIFACT_PATH),
    },
    gate: {
      pass: failedChecks.length === 0,
      checks,
      failedChecks,
    },
    details,
    observed: artifact
      ? {
          placementMode: String(getByPath(artifact, 'placement.mode') ?? 'n/a'),
          envelopeClass,
          parityVerdict,
        }
      : null,
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
    throw new Error(`Distributed validation contract audit failed: ${report.gate.failedChecks.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
