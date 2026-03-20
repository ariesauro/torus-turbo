import fs from 'node:fs/promises'
import { chromium } from 'playwright'

const BASE_URL = process.env.TORUS_BASE_URL ?? 'http://localhost:5173/'
const OUTPUT_JSON =
  process.env.HYBRIDPLUS_SCHEDULER_OUTPUT_JSON ?? './hybridplus-scheduler-audit.json'
const OUTPUT_MD = process.env.HYBRIDPLUS_SCHEDULER_OUTPUT_MD ?? './hybridplus-scheduler-audit.md'
const FAIL_ON_GATE = String(process.env.HYBRIDPLUS_SCHEDULER_FAIL_ON_GATE ?? 'false') === 'true'
const PLAYWRIGHT_HEADLESS = String(process.env.PLAYWRIGHT_HEADLESS ?? 'false') === 'true'
const PLAYWRIGHT_BROWSER_CHANNEL =
  typeof process.env.PLAYWRIGHT_BROWSER_CHANNEL === 'string' &&
  process.env.PLAYWRIGHT_BROWSER_CHANNEL.trim().length > 0
    ? process.env.PLAYWRIGHT_BROWSER_CHANNEL.trim()
    : ''

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toFinite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toInt(value, fallback = 0) {
  return Math.max(0, Math.floor(toFinite(value, fallback)))
}

const CASES = [
  {
    id: 'balanced',
    title: 'Balanced scheduler',
    modePatch: {
      dynamicsMode: 'guidedPhysics',
      executionMode: 'hybrid',
      vortexRepresentation: 'hybrid',
      hybridPlusEnabled: true,
    },
    paramsPatch: {
      uiLanguage: 'en',
      emissionMode: 'vortexRing',
      particleCount: 12000,
      showVectors: false,
      showBoth: false,
      vectorDisplayMode: 'particles',
      vpmEnabled: true,
      useBiotSavart: true,
      hybridPlusEnabled: true,
      hybridPlusAssistBudgetMs: 2.0,
      hybridPlusAssistCadenceSteps: 1,
      hybridPlusAssistAdaptiveCadenceEnabled: true,
      hybridPlusAssistAdaptiveMaxCadenceSteps: 8,
      hybridPlusAssistOverBudgetTolerancePct: 15,
      hybridPlusAssistIdleDeltaThreshold: 10,
      hybridPlusTopologyCorrectionEnabled: true,
      hybridPlusTopologyStrength: 0.25,
      hybridPlusBarnesHutEnabled: true,
      hybridPlusBarnesHutAuto: false,
      hybridPlusBarnesHutStrength: 0.18,
    },
    warmupSec: 2,
    durationSec: 7,
    sampleEveryMs: 350,
  },
  {
    id: 'budget_guard',
    title: 'Budget guard and shedding',
    modePatch: {
      dynamicsMode: 'guidedPhysics',
      executionMode: 'hybrid',
      vortexRepresentation: 'hybrid',
      hybridPlusEnabled: true,
    },
    paramsPatch: {
      uiLanguage: 'en',
      emissionMode: 'vortexRing',
      particleCount: 15000,
      showVectors: false,
      showBoth: false,
      vectorDisplayMode: 'particles',
      vpmEnabled: true,
      useBiotSavart: true,
      hybridPlusEnabled: true,
      hybridPlusAssistBudgetMs: 0.25,
      hybridPlusAssistCadenceSteps: 1,
      hybridPlusAssistAdaptiveCadenceEnabled: true,
      hybridPlusAssistAdaptiveMaxCadenceSteps: 16,
      hybridPlusAssistOverBudgetTolerancePct: 0,
      hybridPlusAssistIdleDeltaThreshold: 8,
      hybridPlusTopologyCorrectionEnabled: true,
      hybridPlusTopologyStrength: 0.25,
      hybridPlusBarnesHutEnabled: true,
      hybridPlusBarnesHutAuto: false,
      hybridPlusBarnesHutStrength: 0.4,
    },
    warmupSec: 2,
    durationSec: 8,
    sampleEveryMs: 350,
  },
  {
    id: 'idle_throttle',
    title: 'Idle adaptive throttle',
    modePatch: {
      dynamicsMode: 'guidedPhysics',
      executionMode: 'hybrid',
      vortexRepresentation: 'hybrid',
      hybridPlusEnabled: true,
    },
    paramsPatch: {
      uiLanguage: 'en',
      emissionMode: 'vortexRing',
      particleCount: 9000,
      showVectors: false,
      showBoth: false,
      vectorDisplayMode: 'particles',
      vpmEnabled: true,
      useBiotSavart: true,
      hybridPlusEnabled: true,
      hybridPlusAssistBudgetMs: 1.5,
      hybridPlusAssistCadenceSteps: 1,
      hybridPlusAssistAdaptiveCadenceEnabled: true,
      hybridPlusAssistAdaptiveMaxCadenceSteps: 12,
      hybridPlusAssistOverBudgetTolerancePct: 50,
      hybridPlusAssistIdleDeltaThreshold: 1,
      hybridPlusTopologyCorrectionEnabled: true,
      hybridPlusTopologyStrength: 0,
      hybridPlusBarnesHutEnabled: false,
    },
    warmupSec: 2,
    durationSec: 7,
    sampleEveryMs: 350,
  },
]

async function runCase(page, caseConfig) {
  return page.evaluate(
    async ({ caseInner }) => {
      const api = window.__torusTestApi
      if (!api) {
        throw new Error('__torusTestApi is unavailable')
      }
      api.pulse('stop')
      api.setMode(caseInner.modePatch)
      api.setParams(caseInner.paramsPatch)
      api.resetParticles()
      await api.waitForMs(300)
      api.pulse('startTrain')
      await api.waitForMs(Math.max(0, Math.floor(caseInner.warmupSec * 1000)))

      const samples = []
      const iterations = Math.max(1, Math.floor((caseInner.durationSec * 1000) / caseInner.sampleEveryMs))
      for (let i = 0; i < iterations; i += 1) {
        await api.waitForMs(caseInner.sampleEveryMs)
        const params = api.getParams()
        samples.push({
          tMs: (i + 1) * caseInner.sampleEveryMs,
          runtimeHybridPlusActive: params.runtimeHybridPlusActive === true,
          runtimeHybridPlusReason: String(params.runtimeHybridPlusReason ?? 'none'),
          runtimeHybridPlusAssistCadenceBaseSteps: Number(
            params.runtimeHybridPlusAssistCadenceBaseSteps ?? 1,
          ),
          runtimeHybridPlusAssistCadenceRuntimeSteps: Number(
            params.runtimeHybridPlusAssistCadenceRuntimeSteps ?? 1,
          ),
          runtimeHybridPlusAssistOverBudgetStreak: Number(
            params.runtimeHybridPlusAssistOverBudgetStreak ?? 0,
          ),
          runtimeHybridPlusAssistIdleStreak: Number(params.runtimeHybridPlusAssistIdleStreak ?? 0),
          runtimeHybridPlusAssistBudgetPressure: Number(
            params.runtimeHybridPlusAssistBudgetPressure ?? 0,
          ),
          runtimeHybridPlusAssistRunCount: Number(params.runtimeHybridPlusAssistRunCount ?? 0),
          runtimeHybridPlusAssistSkipCadenceCount: Number(
            params.runtimeHybridPlusAssistSkipCadenceCount ?? 0,
          ),
          runtimeHybridPlusAssistSkipBudgetCount: Number(
            params.runtimeHybridPlusAssistSkipBudgetCount ?? 0,
          ),
          runtimeHybridPlusBarnesHutProducedCount: Number(
            params.runtimeHybridPlusBarnesHutProducedCount ?? 0,
          ),
          runtimeHybridPlusTopologyProducedCount: Number(
            params.runtimeHybridPlusTopologyProducedCount ?? 0,
          ),
        })
      }
      api.pulse('stop')
      return {
        id: caseInner.id,
        title: caseInner.title,
        samples,
      }
    },
    { caseInner: caseConfig },
  )
}

function avg(values) {
  if (!Array.isArray(values) || values.length === 0) return 0
  return values.reduce((acc, value) => acc + toFinite(value, 0), 0) / values.length
}

function summarizeCase(run) {
  const samples = Array.isArray(run?.samples) ? run.samples : []
  const first = samples[0] ?? {}
  const last = samples[samples.length - 1] ?? {}
  const cadenceBase = toInt(last.runtimeHybridPlusAssistCadenceBaseSteps, 1)
  const cadenceRuntimeMax = Math.max(
    cadenceBase,
    ...samples.map((item) => toInt(item.runtimeHybridPlusAssistCadenceRuntimeSteps, cadenceBase)),
  )
  const runCountDelta =
    toInt(last.runtimeHybridPlusAssistRunCount, 0) - toInt(first.runtimeHybridPlusAssistRunCount, 0)
  const skipCadenceDelta =
    toInt(last.runtimeHybridPlusAssistSkipCadenceCount, 0) -
    toInt(first.runtimeHybridPlusAssistSkipCadenceCount, 0)
  const skipBudgetDelta =
    toInt(last.runtimeHybridPlusAssistSkipBudgetCount, 0) -
    toInt(first.runtimeHybridPlusAssistSkipBudgetCount, 0)
  const overBudgetStreakMax = Math.max(
    0,
    ...samples.map((item) => toInt(item.runtimeHybridPlusAssistOverBudgetStreak, 0)),
  )
  const idleStreakMax = Math.max(
    0,
    ...samples.map((item) => toInt(item.runtimeHybridPlusAssistIdleStreak, 0)),
  )
  const budgetPressureMax = Math.max(
    0,
    ...samples.map((item) => toFinite(item.runtimeHybridPlusAssistBudgetPressure, 0)),
  )
  const activeSeen = samples.some((item) => item.runtimeHybridPlusActive === true)
  const reasonBudgetGuardSeen = samples.some((item) =>
    String(item.runtimeHybridPlusReason ?? '').includes('budget_guard'),
  )
  const barnesAvg = avg(samples.map((item) => toFinite(item.runtimeHybridPlusBarnesHutProducedCount, 0)))
  const topologyAvg = avg(samples.map((item) => toFinite(item.runtimeHybridPlusTopologyProducedCount, 0)))

  return {
    id: run?.id ?? 'unknown',
    title: run?.title ?? 'unknown',
    sampleCount: samples.length,
    activeSeen,
    cadenceBase,
    cadenceRuntimeMax,
    runCountDelta,
    skipCadenceDelta,
    skipBudgetDelta,
    overBudgetStreakMax,
    idleStreakMax,
    budgetPressureMax,
    reasonBudgetGuardSeen,
    barnesAvg,
    topologyAvg,
  }
}

function evaluateCaseGate(row) {
  const checks = {}
  if (row.id === 'balanced') {
    checks.active_seen = row.activeSeen
    checks.assist_engaged =
      row.runCountDelta >= 1 || row.skipCadenceDelta >= 1 || row.skipBudgetDelta >= 1
  } else if (row.id === 'budget_guard') {
    checks.over_budget_detected = row.overBudgetStreakMax >= 2 || row.budgetPressureMax > 1.1
    checks.scheduler_response = row.cadenceRuntimeMax > row.cadenceBase || row.skipBudgetDelta > 0
    checks.bh_shed_or_guard =
      row.reasonBudgetGuardSeen ||
      row.skipBudgetDelta > 0 ||
      row.barnesAvg <= row.topologyAvg ||
      (row.overBudgetStreakMax >= 2 && row.cadenceRuntimeMax >= row.cadenceBase + 2)
  } else if (row.id === 'idle_throttle') {
    checks.idle_detected = row.idleStreakMax >= 2
    checks.idle_cadence_scale =
      row.cadenceRuntimeMax > row.cadenceBase || row.skipCadenceDelta > 0 || row.runCountDelta === 0
  } else {
    checks.known_case = false
  }
  const failedChecks = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([id]) => id)
  return {
    pass: failedChecks.length === 0,
    checks,
    failedChecks,
  }
}

function toMarkdown(report) {
  const lines = []
  lines.push('# Hybrid+ scheduler audit')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push('')
  lines.push('| Case | cadence base/max | runΔ | skipCadenceΔ | skipBudgetΔ | overBudgetMax | idleMax | pressureMax | Gate |')
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---|')
  for (const row of report.rows) {
    lines.push(
      `| ${row.id} | ${row.cadenceBase}/${row.cadenceRuntimeMax} | ${row.runCountDelta} | ${row.skipCadenceDelta} | ${row.skipBudgetDelta} | ${row.overBudgetStreakMax} | ${row.idleStreakMax} | ${row.budgetPressureMax.toFixed(2)} | ${row.gate.pass ? 'PASS' : 'FAIL'} |`,
    )
  }
  lines.push('')
  lines.push('## Gate checks')
  lines.push('')
  for (const row of report.rows) {
    lines.push(`### ${row.id}`)
    lines.push(`- status: ${row.gate.pass ? 'PASS' : 'FAIL'}`)
    for (const [checkId, ok] of Object.entries(row.gate.checks ?? {})) {
      lines.push(`- ${checkId}: ${ok ? 'PASS' : 'FAIL'}`)
    }
    if (row.gate.failedChecks.length > 0) {
      lines.push(`- failed: ${row.gate.failedChecks.join(', ')}`)
    }
    lines.push('')
  }
  lines.push(`Overall gate: ${report.gate.pass ? 'PASS' : 'FAIL'}`)
  return lines.join('\n')
}

async function launchBrowser() {
  const options = {
    headless: PLAYWRIGHT_HEADLESS,
    args: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-angle=metal'],
  }
  if (PLAYWRIGHT_BROWSER_CHANNEL.length > 0) {
    return chromium.launch({ ...options, channel: PLAYWRIGHT_BROWSER_CHANNEL })
  }
  return chromium.launch(options)
}

async function main() {
  const browser = await launchBrowser()
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
    await context.addInitScript(() => {
      window.__torusDisableAutoCalibration = true
      localStorage.setItem('toroidalVortexParams', JSON.stringify({ uiLanguage: 'en' }))
    })
    const page = await context.newPage()
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    let ready = false
    for (let i = 0; i < 40; i += 1) {
      ready = await page.evaluate(() => Boolean(window.__torusTestApi))
      if (ready) break
      await sleep(250)
    }
    if (!ready) {
      throw new Error('__torusTestApi did not initialize in time')
    }
    await sleep(900)

    const rows = []
    for (let i = 0; i < CASES.length; i += 1) {
      const run = await runCase(page, CASES[i])
      const summary = summarizeCase(run)
      const gate = evaluateCaseGate(summary)
      rows.push({ ...summary, gate })
    }
    const failed = rows.flatMap((row) =>
      row.gate.pass ? [] : row.gate.failedChecks.map((checkId) => `${row.id}:${checkId}`),
    )
    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      rows,
      gate: {
        pass: failed.length === 0,
        failedChecks: failed,
      },
    }
    await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await fs.writeFile(OUTPUT_MD, `${toMarkdown(report)}\n`, 'utf8')
    console.table(
      rows.map((row) => ({
        case: row.id,
        cadence: `${row.cadenceBase}/${row.cadenceRuntimeMax}`,
        runDelta: row.runCountDelta,
        skipCadenceDelta: row.skipCadenceDelta,
        skipBudgetDelta: row.skipBudgetDelta,
        overBudget: row.overBudgetStreakMax,
        idle: row.idleStreakMax,
        pressureMax: Number(row.budgetPressureMax.toFixed(2)),
        gate: row.gate.pass ? 'PASS' : 'FAIL',
      })),
    )

    if (FAIL_ON_GATE && report.gate.pass !== true) {
      throw new Error(`Hybrid+ scheduler audit gate failed: ${report.gate.failedChecks.join(', ')}`)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
