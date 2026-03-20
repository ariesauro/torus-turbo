import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const REPEAT = Math.max(1, Number(process.env.HYBRID_SYNC_SOAK_REPEAT ?? 4) || 4)
const STRICT = String(process.env.HYBRID_SYNC_SOAK_STRICT ?? 'true') === 'true'
const OUTPUT_JSON = process.env.HYBRID_SYNC_SOAK_OUTPUT_JSON ?? './hybrid-sync-soak-audit.json'
const OUTPUT_MD = process.env.HYBRID_SYNC_SOAK_OUTPUT_MD ?? './hybrid-sync-soak-audit.md'
const TREND_PATH = process.env.HYBRID_SYNC_SOAK_TREND_PATH ?? './hybrid-sync-soak-trend.json'
const TREND_MAX = Math.max(10, Number(process.env.HYBRID_SYNC_SOAK_TREND_MAX ?? 120) || 120)
const FAIL_ON_TREND_REGRESS =
  String(process.env.HYBRID_SYNC_SOAK_FAIL_ON_TREND_REGRESS ?? 'false') === 'true'
const HYBRID_PLUS_FROZEN_P95_REGRESS_ABS_MAX = Math.max(
  0,
  Number(process.env.HYBRID_SYNC_SOAK_HYBRID_PLUS_FROZEN_P95_REGRESS_ABS_MAX ?? 2) || 2,
)

function runCommand(command, args, envPatch = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...envPatch,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk ?? '')
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk ?? '')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function percentile(values = [], q = 0.95) {
  if (!Array.isArray(values) || values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))
  return sorted[idx]
}

function runMetric(run, mode, metricKey, fallback = 0) {
  const modeReport = Array.isArray(run?.resultModes)
    ? run.resultModes.find((item) => String(item?.mode ?? '') === String(mode))
    : null
  const value = Number(modeReport?.metrics?.[metricKey])
  return Number.isFinite(value) ? value : fallback
}

function buildTrendRow(report) {
  const runs = Array.isArray(report?.runs) ? report.runs : []
  const failRunCount = runs.filter((item) => item?.gatePass !== true).length
  const unsafeUnsyncedTotal = runs.reduce((sum, item) => sum + Number(item?.unsafeUnsyncedTotal ?? 0), 0)
  const hybridPlusFrozenValues = runs.map((run) =>
    runMetric(run, 'hybrid_plus', 'frozenParticleWhileFilamentMovesCount', 0),
  )
  return {
    strict: report?.strict === true,
    repeat: Number(report?.repeat ?? 0),
    failRunCount,
    unsafeUnsyncedTotal,
    hybridPlusFrozenP95: Number.isFinite(percentile(hybridPlusFrozenValues, 0.95))
      ? percentile(hybridPlusFrozenValues, 0.95)
      : null,
  }
}

function comparableSnapshot(snapshot, strict, repeat) {
  return snapshot?.strict === strict && Number(snapshot?.repeat ?? Number.NaN) === Number(repeat)
}

function findPreviousComparableSnapshot(snapshots = [], strict, repeat) {
  for (let i = snapshots.length - 1; i >= 0; i -= 1) {
    const item = snapshots[i]
    if (!comparableSnapshot(item, strict, repeat)) continue
    if (item?.gatePass !== true) continue
    return item
  }
  return null
}

function evaluateTrendRegressions(currentRow, previousSnapshot) {
  if (!previousSnapshot?.row) {
    return {
      pass: true,
      comparedWithGeneratedAt: null,
      failedChecks: [],
      regressions: [],
    }
  }
  const prev = previousSnapshot.row
  const regressions = []
  if (Number(currentRow.failRunCount) > Number(prev.failRunCount ?? 0)) {
    regressions.push('fail_run_count_regress')
  }
  if (Number(currentRow.unsafeUnsyncedTotal) > Number(prev.unsafeUnsyncedTotal ?? 0)) {
    regressions.push('unsafe_unsynced_total_regress')
  }
  const currentFrozen = Number(currentRow.hybridPlusFrozenP95)
  const prevFrozen = Number(prev.hybridPlusFrozenP95)
  if (
    Number.isFinite(currentFrozen) &&
    Number.isFinite(prevFrozen) &&
    currentFrozen - prevFrozen > HYBRID_PLUS_FROZEN_P95_REGRESS_ABS_MAX
  ) {
    regressions.push('hybrid_plus_frozen_p95_regress')
  }
  return {
    pass: regressions.length === 0,
    comparedWithGeneratedAt: String(previousSnapshot.generatedAt ?? ''),
    failedChecks: regressions,
    regressions,
  }
}

async function writeTrendSnapshot(report) {
  const previous = (await readJsonIfExists(TREND_PATH)) ?? { snapshots: [] }
  const snapshots = Array.isArray(previous.snapshots) ? previous.snapshots : []
  const row = buildTrendRow(report)
  const previousComparableSnapshot = findPreviousComparableSnapshot(snapshots, report.strict, report.repeat)
  const trendEval = evaluateTrendRegressions(row, previousComparableSnapshot)
  const entry = {
    generatedAt: report.generatedAt,
    strict: report.strict,
    repeat: report.repeat,
    gatePass: report.gate.pass === true,
    row,
  }
  const payload = {
    updatedAt: report.generatedAt,
    snapshots: [...snapshots, entry].slice(-TREND_MAX),
  }
  await fs.writeFile(TREND_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return {
    trend: {
      path: path.resolve(TREND_PATH),
      snapshots: payload.snapshots.length,
      comparedWithGeneratedAt: trendEval.comparedWithGeneratedAt,
      pass: trendEval.pass,
      failedChecks: trendEval.failedChecks,
      regressions: trendEval.regressions,
      thresholds: {
        hybridPlusFrozenP95RegressAbsMax: HYBRID_PLUS_FROZEN_P95_REGRESS_ABS_MAX,
      },
    },
  }
}

function toMarkdown(report) {
  const lines = [
    '# Hybrid Sync Soak Audit',
    '',
    `Generated: ${report.generatedAt}`,
    `Repeat: ${report.repeat}`,
    `Strict: ${report.strict ? 'yes' : 'no'}`,
    `Overall gate: ${report.gate.pass ? 'PASS' : 'FAIL'}`,
    '',
    '| Run | Gate | Failed checks | unsafeUnsyncedTotal |',
    '|---:|---|---|---:|',
  ]
  for (const run of report.runs) {
    lines.push(
      `| ${run.runIndex} | ${run.gatePass ? 'PASS' : 'FAIL'} | ${run.failedChecks.join(', ') || 'none'} | ${run.unsafeUnsyncedTotal} |`,
    )
  }
  lines.push('', '## Failed checks', '')
  if (report.gate.failedChecks.length === 0) {
    lines.push('- none')
  } else {
    for (const item of report.gate.failedChecks) {
      lines.push(`- ${item}`)
    }
  }
  lines.push('', '## Trend', '')
  lines.push(`- trend path: ${report.trend?.path ?? path.resolve(TREND_PATH)}`)
  lines.push(`- snapshots: ${report.trend?.snapshots ?? 0}`)
  if (report.trend?.comparedWithGeneratedAt) {
    lines.push(`- compared with snapshot: ${report.trend.comparedWithGeneratedAt}`)
  } else {
    lines.push('- compared with snapshot: none')
  }
  lines.push(`- trend gate: ${report.trend?.pass ? 'PASS' : 'FAIL'}`)
  if (Array.isArray(report.trend?.failedChecks) && report.trend.failedChecks.length > 0) {
    lines.push('- trend failed checks:')
    for (const checkId of report.trend.failedChecks) {
      lines.push(`  - ${checkId}`)
    }
  }
  return lines.join('\n')
}

async function main() {
  const runs = []
  for (let i = 0; i < REPEAT; i += 1) {
    const runIndex = i + 1
    const runJsonPath = `./hybrid-sync-diagnostic-run-${runIndex}.json`
    const runMdPath = `./hybrid-sync-diagnostic-run-${runIndex}.md`
    const envPatch = {
      HYBRID_SYNC_DIAG_OUTPUT_JSON: runJsonPath,
      HYBRID_SYNC_DIAG_OUTPUT_MD: runMdPath,
    }
    if (STRICT) {
      envPatch.PLAYWRIGHT_HEADLESS = envPatch.PLAYWRIGHT_HEADLESS ?? 'true'
      envPatch.HYBRID_SYNC_DIAG_MAX_FROZEN_RATIO = envPatch.HYBRID_SYNC_DIAG_MAX_FROZEN_RATIO ?? '0.1'
      envPatch.HYBRID_SYNC_DIAG_MAX_FROZEN_RATIO_HYBRID_PLUS =
        envPatch.HYBRID_SYNC_DIAG_MAX_FROZEN_RATIO_HYBRID_PLUS ?? '0.15'
      envPatch.HYBRID_SYNC_DIAG_MAX_DECOUPLED_STREAK =
        envPatch.HYBRID_SYNC_DIAG_MAX_DECOUPLED_STREAK ?? '1'
      envPatch.HYBRID_SYNC_DIAG_REQUIRE_BLOCKED_UNSYNC =
        envPatch.HYBRID_SYNC_DIAG_REQUIRE_BLOCKED_UNSYNC ?? 'true'
    }
    const runResult = await runCommand('node', ['./hybridSyncDiagnostic.mjs'], envPatch)
    let parsed = null
    try {
      parsed = await readJson(path.resolve(process.cwd(), runJsonPath))
    } catch {
      parsed = null
    }
    const failedChecks = Array.isArray(parsed?.gate?.failedChecks) ? parsed.gate.failedChecks : []
    const unsafeUnsyncedTotal = Array.isArray(parsed?.results)
      ? parsed.results.reduce(
          (sum, item) => sum + Number(item?.verdict?.metrics?.unsafeUnsyncedDelta ?? 0),
          0,
        )
      : 0
    const resultModes = Array.isArray(parsed?.results)
      ? parsed.results.map((item) => ({
          mode: String(item?.mode ?? ''),
          metrics: item?.verdict?.metrics ?? {},
        }))
      : []
    runs.push({
      runIndex,
      exitCode: runResult.code,
      gatePass: parsed?.gate?.pass === true,
      failedChecks,
      unsafeUnsyncedTotal,
      resultModes,
      stdoutTail: runResult.stdout.trim().split('\n').slice(-1)[0] ?? '',
    })
  }

  const gateFailedChecks = runs.flatMap((run) => {
    const local = []
    if (run.exitCode !== 0) local.push(`run_${run.runIndex}:exit_code`)
    if (run.gatePass !== true) local.push(`run_${run.runIndex}:gate_fail`)
    if (run.unsafeUnsyncedTotal > 0) local.push(`run_${run.runIndex}:unsafe_unsynced_delta`)
    return local
  })
  const report = {
    generatedAt: new Date().toISOString(),
    repeat: REPEAT,
    strict: STRICT,
    runs,
    gate: {
      pass: gateFailedChecks.length === 0,
      failedChecks: gateFailedChecks,
    },
  }
  const trendWrite = await writeTrendSnapshot(report)
  report.trend = trendWrite.trend
  await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(OUTPUT_MD, `${toMarkdown(report)}\n`, 'utf8')
  console.log(
    `Hybrid sync soak audit: gate=${report.gate.pass ? 'PASS' : 'FAIL'} repeat=${REPEAT} json=${OUTPUT_JSON} md=${OUTPUT_MD}`,
  )
  if (!report.gate.pass) {
    process.exit(1)
  }
  if (FAIL_ON_TREND_REGRESS && report.trend.pass !== true) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
