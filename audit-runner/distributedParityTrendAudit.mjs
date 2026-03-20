import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

const POLICY_PATH =
  process.env.DISTRIBUTED_PARITY_POLICY_PATH ??
  path.join(SCRIPT_DIR, 'distributed-parity-policy.v1.json')
const ARTIFACT_PATH =
  process.env.DISTRIBUTED_PARITY_TREND_ARTIFACT_PATH ??
  path.join(SCRIPT_DIR, 'distributed-validation-parity-audit.runtime.json')
const TREND_PATH =
  process.env.DISTRIBUTED_PARITY_TREND_PATH ??
  path.join(SCRIPT_DIR, 'distributed-parity-trend.json')
const OUTPUT_MD =
  process.env.DISTRIBUTED_PARITY_TREND_OUTPUT_MD ??
  path.join(SCRIPT_DIR, 'distributed-parity-trend.md')
const FAIL_ON_REGRESS =
  String(process.env.DISTRIBUTED_PARITY_TREND_FAIL_ON_REGRESS ?? 'false') === 'true'

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

async function readJsonIfExists(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

function toFinite(value, fallback = Number.NaN) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function buildMarkdown(report) {
  const lines = [
    '# Distributed Parity Trend Audit',
    '',
    `Generated: ${report.generatedAt}`,
    `Profile: ${report.profile}`,
    '',
    '| Metric | Current | Previous | Regress |',
    '|---|---|---|---|',
    `| parity verdict | ${report.current.parityVerdict} | ${report.previous?.parityVerdict ?? 'n/a'} | ${report.regress.parityVerdict ? 'YES' : 'NO'} |`,
    `| invariant drift delta | ${report.current.invariantDriftDeltaPct ?? 'n/a'} | ${report.previous?.invariantDriftDeltaPct ?? 'n/a'} | ${report.regress.invariantDriftDelta ? 'YES' : 'NO'} |`,
    `| timing parity value | ${report.current.timingParityValue ?? 'n/a'} | ${report.previous?.timingParityValue ?? 'n/a'} | ${report.regress.timingParity ? 'YES' : 'NO'} |`,
    '',
    `Overall regress flag: ${report.regress.any ? 'YES' : 'NO'}`,
  ]
  return lines.join('\n')
}

async function main() {
  const policy = await readJson(POLICY_PATH)
  const artifact = await readJson(ARTIFACT_PATH)
  const trend = await readJsonIfExists(TREND_PATH, {
    schemaVersion: 'tt067.distributed_parity_trend.v1',
    history: [],
  })

  const profile = String(
    artifact?.parity?.policy?.profile || process.env.DISTRIBUTED_PARITY_POLICY_PROFILE || policy?.defaultProfile || 'standard',
  )
  const profilePolicy = policy?.profiles?.[profile] ?? {}
  const trendPolicy = policy?.trend?.regress ?? {}
  const historyMax = Math.max(8, Math.floor(toFinite(policy?.trend?.historyMax, 80)))

  const checks = new Map((Array.isArray(artifact?.parity?.checks) ? artifact.parity.checks : []).map((item) => [String(item?.id ?? ''), item]))
  const current = {
    generatedAt: String(artifact?.generatedAt ?? new Date().toISOString()),
    profile,
    parityVerdict: String(artifact?.parity?.verdict ?? 'unknown'),
    invariantDriftDeltaPct: toFinite(checks.get('invariant_drift')?.value, Number.NaN) * 100,
    timingParityValue: toFinite(checks.get('timing_parity')?.value, Number.NaN),
    contractParityValue: toFinite(checks.get('contract_parity')?.value, Number.NaN),
    envelopeClass: String(artifact?.network?.envelopeClass ?? 'unknown'),
  }

  const previous = [...(Array.isArray(trend.history) ? trend.history : [])]
    .reverse()
    .find((entry) => String(entry?.profile ?? '') === profile)

  const maxInvariantDriftDeltaIncreasePct = toFinite(
    trendPolicy?.maxInvariantDriftDeltaIncreasePct,
    0.5,
  )
  const maxTimingParityDrop = toFinite(trendPolicy?.maxTimingParityDrop, 0.05)
  const failOnCheckStatusDrop = trendPolicy?.failOnCheckStatusDrop !== false

  const regress = {
    parityVerdict:
      previous && failOnCheckStatusDrop
        ? previous.parityVerdict === 'parity_pass' && current.parityVerdict !== 'parity_pass'
        : false,
    invariantDriftDelta:
      previous && Number.isFinite(previous.invariantDriftDeltaPct) && Number.isFinite(current.invariantDriftDeltaPct)
        ? current.invariantDriftDeltaPct - previous.invariantDriftDeltaPct > maxInvariantDriftDeltaIncreasePct
        : false,
    timingParity:
      previous && Number.isFinite(previous.timingParityValue) && Number.isFinite(current.timingParityValue)
        ? previous.timingParityValue - current.timingParityValue > maxTimingParityDrop
        : false,
  }
  regress.any = regress.parityVerdict || regress.invariantDriftDelta || regress.timingParity

  const history = [...(Array.isArray(trend.history) ? trend.history : []), current].slice(-historyMax)
  const report = {
    schemaVersion: 'tt067.distributed_parity_trend.v1',
    generatedAt: new Date().toISOString(),
    profile,
    profileThresholds: {
      invariantDriftDeltaMaxPct: toFinite(profilePolicy?.invariantDriftDeltaMaxPct, Number.NaN),
      timingStepP95DeltaMaxPct: toFinite(profilePolicy?.timingStepP95DeltaMaxPct, Number.NaN),
    },
    regressPolicy: {
      maxInvariantDriftDeltaIncreasePct,
      maxTimingParityDrop,
      failOnCheckStatusDrop,
    },
    current,
    previous: previous ?? null,
    regress,
    history,
  }

  await fs.writeFile(TREND_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(OUTPUT_MD, `${buildMarkdown(report)}\n`, 'utf8')

  console.table([
    {
      profile,
      parityVerdict: current.parityVerdict,
      invariantDriftDeltaPct: Number.isFinite(current.invariantDriftDeltaPct)
        ? current.invariantDriftDeltaPct.toFixed(3)
        : 'n/a',
      timingParityValue: Number.isFinite(current.timingParityValue)
        ? current.timingParityValue.toFixed(4)
        : 'n/a',
      regress: regress.any ? 'YES' : 'NO',
    },
  ])

  if (FAIL_ON_REGRESS && regress.any) {
    throw new Error('Distributed parity trend regress detected')
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
