import fs from 'node:fs/promises'
import path from 'node:path'

function toFinite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const SCENARIOS = {
  'adaptive.low': {
    stepP95MaxMs: 500,
    energyDriftAbsMaxPct: 300,
    circulationDriftAbsMaxPct: 30,
    pathComplexityMax: 1.25,
  },
  'adaptive.mid': {
    stepP95MaxMs: 320,
    energyDriftAbsMaxPct: 150,
    circulationDriftAbsMaxPct: 25,
    pathComplexityMax: 1.0,
  },
  'adaptive.high': {
    stepP95MaxMs: 220,
    energyDriftAbsMaxPct: 80,
    circulationDriftAbsMaxPct: 20,
    pathComplexityMax: 0.9,
  },
}

function normalizeRows(payload = {}) {
  if (Array.isArray(payload?.summaryRows)) {
    return payload.summaryRows.map((row, index) => ({
      id: `${String(row.mode ?? 'mode')}:${index}`,
      source: 'longrun',
      stepP95Ms: toFinite(row.stepP95Ms, 0),
      energyDriftPct: toFinite(row.energyDriftPct, 0),
      circulationDriftPct: toFinite(row.circulationDriftPct, 0),
      pathComplexity: toFinite(row.adaptivePathComplexity, 0),
    }))
  }
  const runs = Array.isArray(payload?.batchResult?.runs)
    ? payload.batchResult.runs
    : Array.isArray(payload?.runs)
      ? payload.runs
      : []
  return runs.map((run, index) => {
    const summary = run?.result?.summary ?? {}
    return {
      id: `run:${Math.max(0, Math.floor(toFinite(run?.runIndex, index)))}`,
      source: 'lab',
      stepP95Ms: toFinite(summary.stepP95Ms, 0),
      energyDriftPct: toFinite(summary.energyDriftPct, 0),
      circulationDriftPct: toFinite(summary.circulationDriftPct, 0),
      pathComplexity: toFinite(summary.adaptivePathComplexity, 0),
    }
  })
}

function evaluateRow(row, threshold) {
  const checks = {
    stepP95: row.stepP95Ms <= threshold.stepP95MaxMs,
    energy: Math.abs(row.energyDriftPct) <= threshold.energyDriftAbsMaxPct,
    circulation: Math.abs(row.circulationDriftPct) <= threshold.circulationDriftAbsMaxPct,
    path: row.pathComplexity <= threshold.pathComplexityMax,
  }
  const failedChecks = Object.keys(checks).filter((key) => checks[key] !== true)
  return {
    ok: failedChecks.length === 0,
    failedChecks,
    checks,
  }
}

function buildReport(rows) {
  const scenarioEntries = Object.entries(SCENARIOS)
  const matrix = rows.map((row) => {
    const verdicts = {}
    for (let i = 0; i < scenarioEntries.length; i += 1) {
      const [scenarioId, threshold] = scenarioEntries[i]
      verdicts[scenarioId] = evaluateRow(row, threshold)
    }
    return {
      ...row,
      verdicts,
    }
  })

  const scenarioSummary = {}
  for (let i = 0; i < scenarioEntries.length; i += 1) {
    const [scenarioId] = scenarioEntries[i]
    const total = matrix.length
    const passed = matrix.filter((row) => row.verdicts?.[scenarioId]?.ok === true).length
    scenarioSummary[scenarioId] = { total, passed }
  }
  return { matrix, scenarioSummary }
}

function buildScenarioRatios(scenarioSummary = {}) {
  const output = {}
  for (const [scenarioId, summary] of Object.entries(scenarioSummary)) {
    const total = Math.max(1, Number(summary.total ?? 0))
    const passed = Math.max(0, Number(summary.passed ?? 0))
    output[scenarioId] = passed / total
  }
  return output
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

async function writeTrendSnapshot({
  trendPath,
  generatedAt,
  inputPath,
  scenarioSummary,
  maxEntries,
}) {
  const previous = (await readJsonIfExists(trendPath)) ?? { snapshots: [] }
  const snapshots = Array.isArray(previous.snapshots) ? previous.snapshots : []
  const ratios = buildScenarioRatios(scenarioSummary)
  const entry = {
    generatedAt,
    inputPath: path.resolve(inputPath),
    scenarios: scenarioSummary,
    scenarioRatios: ratios,
  }
  const next = [...snapshots, entry].slice(-Math.max(1, maxEntries))
  const payload = {
    updatedAt: generatedAt,
    snapshots: next,
  }
  await fs.writeFile(trendPath, JSON.stringify(payload, null, 2))
  return payload
}

function toMarkdown(report, inputPath) {
  const lines = [
    '# Adaptive Baseline Validation Matrix',
    '',
    `Input: ${inputPath}`,
    '',
    '## Scenario Summary',
  ]
  for (const [scenarioId, summary] of Object.entries(report.scenarioSummary)) {
    lines.push(`- ${scenarioId}: ${summary.passed}/${Math.max(1, summary.total)} pass`)
  }
  lines.push('', '## Matrix', '')
  lines.push('| Row | Source | stepP95 | energyDrift | circulationDrift | pathComplexity | low | mid | high |')
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (let i = 0; i < report.matrix.length; i += 1) {
    const row = report.matrix[i]
    const low = row.verdicts['adaptive.low']?.ok ? 'PASS' : 'FAIL'
    const mid = row.verdicts['adaptive.mid']?.ok ? 'PASS' : 'FAIL'
    const high = row.verdicts['adaptive.high']?.ok ? 'PASS' : 'FAIL'
    lines.push(
      `| ${row.id} | ${row.source} | ${row.stepP95Ms.toFixed(3)} | ${row.energyDriftPct.toFixed(3)} | ${row.circulationDriftPct.toFixed(3)} | ${row.pathComplexity.toFixed(3)} | ${low} | ${mid} | ${high} |`,
    )
  }
  lines.push('', '## Notes', '- `PASS` means all four checks passed for the scenario envelope.', '- `FAIL` means at least one check exceeded the scenario threshold.')
  return lines.join('\n')
}

async function main() {
  const inputPath = process.env.ADAPTIVE_MATRIX_INPUT ?? './long-run-benchmark-results.json'
  const outputJson = process.env.ADAPTIVE_MATRIX_OUTPUT_JSON ?? './adaptive-baseline-matrix.json'
  const outputMd = process.env.ADAPTIVE_MATRIX_OUTPUT_MD ?? './adaptive-baseline-matrix.md'
  const trendPath = process.env.ADAPTIVE_MATRIX_TREND_PATH ?? './adaptive-baseline-trend.json'
  const trendMaxEntries = Math.max(10, Number(process.env.ADAPTIVE_MATRIX_TREND_MAX ?? 120) || 120)
  const failOnScenario = String(process.env.ADAPTIVE_MATRIX_FAIL_ON_SCENARIO ?? '').trim()
  const minPassRatio = Math.min(1, Math.max(0, Number(process.env.ADAPTIVE_MATRIX_MIN_PASS_RATIO ?? 1) || 1))
  const payload = JSON.parse(await fs.readFile(inputPath, 'utf8'))
  const rows = normalizeRows(payload)
  if (rows.length === 0) {
    throw new Error('No compatible rows found in input payload')
  }
  const report = buildReport(rows)
  const generatedAt = new Date().toISOString()
  const scenarioRatios = buildScenarioRatios(report.scenarioSummary)
  const matrixGate =
    failOnScenario.length > 0
      ? {
          scenarioId: failOnScenario,
          minPassRatio,
          actualPassRatio: Number(scenarioRatios[failOnScenario] ?? 0),
          pass: Number(scenarioRatios[failOnScenario] ?? 0) >= minPassRatio,
        }
      : null
  await fs.writeFile(
    outputJson,
    JSON.stringify({ generatedAt, inputPath, scenarioRatios, matrixGate, ...report }, null, 2),
  )
  await fs.writeFile(outputMd, toMarkdown(report, path.resolve(inputPath)))
  await writeTrendSnapshot({
    trendPath,
    generatedAt,
    inputPath,
    scenarioSummary: report.scenarioSummary,
    maxEntries: trendMaxEntries,
  })
  if (matrixGate && !matrixGate.pass) {
    throw new Error(
      `Adaptive matrix gate failed for ${matrixGate.scenarioId}: ratio=${matrixGate.actualPassRatio.toFixed(
        3,
      )} < min=${matrixGate.minPassRatio.toFixed(3)}`,
    )
  }
  // eslint-disable-next-line no-console
  console.log(`Adaptive matrix written: ${outputJson}, ${outputMd}, trend=${trendPath}`)
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error)
  process.exitCode = 1
})
