import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

const POLICY_PATH =
  process.env.GOVERNANCE_POLICY_PATH ??
  path.join(SCRIPT_DIR, 'validation-governance-policy.v1.json')
const FRESHNESS_PATH =
  process.env.GOVERNANCE_FRESHNESS_PATH ??
  path.join(SCRIPT_DIR, 'validation-governance-freshness.json')
const OUTPUT_JSON =
  process.env.GOVERNANCE_OUTPUT_JSON ??
  path.join(SCRIPT_DIR, 'validation-governance-audit.json')
const OUTPUT_MD =
  process.env.GOVERNANCE_OUTPUT_MD ??
  path.join(SCRIPT_DIR, 'validation-governance-audit.md')
const GOVERNANCE_PROFILE =
  process.env.GOVERNANCE_PROFILE ?? ''
const FAIL_ON_GATE =
  String(process.env.GOVERNANCE_FAIL_ON_GATE ?? 'false') === 'true'
const REQUIRE_FRESHNESS =
  String(process.env.GOVERNANCE_REQUIRE_FRESHNESS ?? 'false') === 'true'

const REQUIRED_PROFILES = ['smoke', 'standard', 'nightly']
const REQUIRED_TIERS = ['tier1', 'tier2', 'tier3', 'tier4', 'tier5']
const EXPECTED_CONTOUR_COUNT = 20

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

function boolCheck(checks, details, id, pass, passMsg, failMsg) {
  checks[id] = pass === true
  details.push(`${pass === true ? 'PASS' : 'FAIL'} ${id}: ${pass === true ? passMsg : failMsg}`)
}

function resolveProfile(policy) {
  const explicit = GOVERNANCE_PROFILE
  if (explicit && Object.prototype.hasOwnProperty.call(policy?.profiles ?? {}, explicit)) {
    return explicit
  }
  return policy?.defaultProfile ?? 'standard'
}

function computeEscalationLevel(contourStates, profileConfig) {
  const tier1Fails = contourStates.filter(
    (s) => s.tier === 1 && s.status === 'FAIL' && s.confirmedFail,
  )
  const tier12ConfirmedFails = contourStates.filter(
    (s) => (s.tier === 1 || s.tier === 2) && s.status === 'FAIL' && s.confirmedFail,
  )
  const freezeThreshold = profileConfig?.escalation?.freezeThreshold ?? {}
  const tier1Threshold = freezeThreshold.tier1FailCount ?? 1
  const tier12Threshold = freezeThreshold.tier12ConfirmedFailCount ?? 2

  if (tier1Fails.length >= tier1Threshold || tier12ConfirmedFails.length >= tier12Threshold) {
    return 3
  }

  const anyConfirmedFail = contourStates.some((s) => s.status === 'FAIL' && s.confirmedFail)
  if (anyConfirmedFail) return 2

  const anyFail = contourStates.some((s) => s.status === 'FAIL')
  const anyStale = contourStates.some((s) => s.stale)
  if (anyFail || anyStale) return 1

  return 0
}

const LEVEL_NAMES = ['PASS', 'WARNING', 'STRICT', 'FREEZE']

function buildMarkdown(report) {
  const lines = [
    '# Validation Governance Audit',
    '',
    `Generated: ${report.generatedAt}`,
    `Profile: ${report.activeProfile}`,
    `Escalation level: ${report.escalation.level} (${report.escalation.name})`,
    '',
    '## Gate Checks',
    '',
    '| Check | Result |',
    '|---|---|',
  ]
  for (const [id, pass] of Object.entries(report.gate.checks)) {
    lines.push(`| ${id} | ${pass ? 'PASS' : 'FAIL'} |`)
  }

  if (report.contourStatus && report.contourStatus.length > 0) {
    lines.push('', '## Contour Status', '', '| ID | Name | Tier | Status | Stale | Last PASS |')
    lines.push('|---|---|---|---|---|---|')
    for (const c of report.contourStatus) {
      lines.push(
        `| ${c.id} | ${c.name} | ${c.tier} | ${c.status} | ${c.stale ? 'YES' : 'no'} | ${c.lastPass ?? 'n/a'} |`,
      )
    }
  }

  lines.push('', '## Details', '')
  for (const detail of report.details) {
    lines.push(`- ${detail}`)
  }
  lines.push('', `**Overall gate: ${report.gate.pass ? 'PASS' : 'FAIL'}**`)
  return lines.join('\n')
}

async function main() {
  const checks = {}
  const details = []
  const policy = await readJson(POLICY_PATH)
  const freshness = await readJsonIfExists(FRESHNESS_PATH)

  boolCheck(
    checks, details, 'policy_schema_valid',
    String(policy?.schemaVersion ?? '') === 'tt070.validation_governance_policy.v1',
    'policy schema version matches v1',
    `unexpected policy schema: ${String(policy?.schemaVersion ?? 'n/a')}`,
  )

  const policyProfiles = policy?.profiles ?? {}
  const missingProfiles = REQUIRED_PROFILES.filter(
    (p) => !Object.prototype.hasOwnProperty.call(policyProfiles, p),
  )
  boolCheck(
    checks, details, 'required_profiles_present',
    missingProfiles.length === 0,
    'required profiles present (smoke/standard/nightly)',
    `missing profiles: ${missingProfiles.join(', ')}`,
  )

  const defaultProfile = String(policy?.defaultProfile ?? '')
  boolCheck(
    checks, details, 'default_profile_valid',
    defaultProfile.length > 0 && Object.prototype.hasOwnProperty.call(policyProfiles, defaultProfile),
    `default profile valid (${defaultProfile})`,
    `default profile invalid: ${defaultProfile || 'empty'}`,
  )

  const contours = policy?.contours ?? {}
  const contourIds = Object.keys(contours)
  boolCheck(
    checks, details, 'contour_registry_complete',
    contourIds.length >= EXPECTED_CONTOUR_COUNT,
    `${contourIds.length} contours registered (>= ${EXPECTED_CONTOUR_COUNT})`,
    `only ${contourIds.length} contours registered (expected >= ${EXPECTED_CONTOUR_COUNT})`,
  )

  for (const profile of REQUIRED_PROFILES) {
    const p = policyProfiles[profile] ?? {}
    const missingTiers = REQUIRED_TIERS.filter(
      (t) => typeof p?.maxStalenessDays?.[t] !== 'number',
    )
    boolCheck(
      checks, details, `profile_${profile}_staleness_complete`,
      missingTiers.length === 0,
      `profile ${profile}: all tier staleness thresholds present`,
      `profile ${profile}: missing tier staleness for ${missingTiers.join(', ')}`,
    )

    const esc = p?.escalation ?? {}
    boolCheck(
      checks, details, `profile_${profile}_escalation_complete`,
      typeof esc.retryWindowHours === 'number' &&
        typeof esc.strictDeadlineHours === 'number' &&
        typeof esc.freezeThreshold?.tier1FailCount === 'number' &&
        typeof esc.freezeThreshold?.tier12ConfirmedFailCount === 'number',
      `profile ${profile}: escalation policy complete`,
      `profile ${profile}: escalation policy incomplete`,
    )
  }

  for (const profile of REQUIRED_PROFILES) {
    const p = policyProfiles[profile] ?? {}
    const staleness = p?.maxStalenessDays ?? {}
    const tiers = REQUIRED_TIERS.map((t) => staleness[t] ?? Infinity)
    const monotonic = tiers.every((v, i, arr) => i === 0 || arr[i - 1] <= v)
    boolCheck(
      checks, details, `profile_${profile}_staleness_monotonic`,
      monotonic,
      `profile ${profile}: tier staleness monotonic (tier1 <= tier2 <= ... <= tier5)`,
      `profile ${profile}: tier staleness NOT monotonic: ${tiers.join(', ')}`,
    )
  }

  const contourHasRequiredFields = contourIds.every((id) => {
    const c = contours[id]
    return c.id && c.name && typeof c.tier === 'number' && c.cadence && c.command
  })
  boolCheck(
    checks, details, 'contour_fields_complete',
    contourHasRequiredFields,
    'all contours have required fields (id, name, tier, cadence, command)',
    'some contours missing required fields',
  )

  const activeProfile = resolveProfile(policy)
  const profileConfig = policyProfiles[activeProfile] ?? {}
  const now = Date.now()

  const freshnessExists = freshness !== null
  boolCheck(
    checks, details, 'freshness_present_if_required',
    !REQUIRE_FRESHNESS || freshnessExists,
    REQUIRE_FRESHNESS ? 'freshness log present' : 'freshness optional for this run',
    'freshness log missing while required',
  )

  let contourStatus = []
  if (freshnessExists) {
    const freshnessEntries = freshness?.contours ?? {}
    contourStatus = contourIds.map((id) => {
      const c = contours[id]
      const f = freshnessEntries[id] ?? {}
      const tier = c.tier
      const tierKey = `tier${tier}`
      const maxStaleDays = profileConfig?.maxStalenessDays?.[tierKey] ?? 30
      const lastPassTs = f.lastPassTimestamp ? new Date(f.lastPassTimestamp).getTime() : 0
      const daysSincePass = lastPassTs > 0 ? (now - lastPassTs) / (1000 * 60 * 60 * 24) : Infinity
      const stale = daysSincePass > maxStaleDays
      const status = f.lastResult ?? 'UNKNOWN'
      const confirmedFail = f.confirmedFail === true
      return {
        id,
        name: c.name,
        tier,
        status,
        stale,
        confirmedFail,
        daysSincePass: Number.isFinite(daysSincePass) ? Math.round(daysSincePass * 10) / 10 : null,
        lastPass: f.lastPassTimestamp ?? null,
      }
    })

    const staleContours = contourStatus.filter((s) => s.stale)
    boolCheck(
      checks, details, 'no_stale_contours',
      staleContours.length === 0,
      'all contours within freshness bounds',
      `${staleContours.length} stale contour(s): ${staleContours.map((s) => `${s.id} (${s.daysSincePass}d)`).join(', ')}`,
    )

    const failedContours = contourStatus.filter((s) => s.status === 'FAIL')
    const confirmedFailContours = contourStatus.filter((s) => s.confirmedFail)
    boolCheck(
      checks, details, 'no_unresolved_failures',
      confirmedFailContours.length === 0,
      'no confirmed (Level 2+) failures',
      `${confirmedFailContours.length} confirmed failure(s): ${confirmedFailContours.map((s) => s.id).join(', ')}`,
    )

    if (failedContours.length > 0) {
      details.push(`INFO: ${failedContours.length} contour(s) with FAIL status (may be unconfirmed): ${failedContours.map((s) => s.id).join(', ')}`)
    }
  }

  const escalationLevel = freshnessExists
    ? computeEscalationLevel(contourStatus, profileConfig)
    : 0
  const escalationName = LEVEL_NAMES[escalationLevel] ?? 'UNKNOWN'

  if (freshnessExists) {
    boolCheck(
      checks, details, 'escalation_level_acceptable',
      escalationLevel <= 1,
      `escalation level ${escalationLevel} (${escalationName}) is acceptable`,
      `escalation level ${escalationLevel} (${escalationName}) requires action`,
    )
  }

  const failedChecks = Object.entries(checks)
    .filter(([, pass]) => pass !== true)
    .map(([id]) => id)

  const report = {
    schemaVersion: 'tt070.validation_governance_audit.v1',
    generatedAt: new Date().toISOString(),
    policyPath: path.resolve(POLICY_PATH),
    freshnessPath: path.resolve(FRESHNESS_PATH),
    activeProfile,
    requireFreshness: REQUIRE_FRESHNESS,
    gate: {
      pass: failedChecks.length === 0,
      checks,
      failedChecks,
    },
    escalation: {
      level: escalationLevel,
      name: escalationName,
    },
    contourStatus,
    details,
    observed: {
      policySchemaVersion: String(policy?.schemaVersion ?? 'n/a'),
      policyDefaultProfile: defaultProfile,
      policyProfiles: Object.keys(policyProfiles),
      contourCount: contourIds.length,
      freshnessPresent: freshnessExists,
    },
  }

  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(OUTPUT_MD, `${buildMarkdown(report)}\n`, 'utf8')

  console.log(`\nGovernance profile: ${activeProfile}`)
  console.log(`Escalation level: ${escalationLevel} (${escalationName})`)
  console.table(
    Object.entries(checks).map(([check, pass]) => ({
      check,
      result: pass ? 'PASS' : 'FAIL',
    })),
  )

  if (FAIL_ON_GATE && report.gate.pass !== true) {
    throw new Error(`Governance gate FAIL: ${failedChecks.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
