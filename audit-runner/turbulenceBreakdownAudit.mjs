import fs from 'node:fs/promises'
import { chromium } from 'playwright'

const BASE_URL = process.env.TORUS_BASE_URL ?? 'http://localhost:5173/'
const OUTPUT_JSON =
  process.env.TURBULENCE_BREAKDOWN_OUTPUT_JSON ?? './turbulence-breakdown-audit.json'
const OUTPUT_MD = process.env.TURBULENCE_BREAKDOWN_OUTPUT_MD ?? './turbulence-breakdown-audit.md'
const FAIL_ON_GATE = String(process.env.TURBULENCE_BREAKDOWN_FAIL_ON_GATE ?? 'false') === 'true'
const DURATION_SCALE = Math.max(
  0.1,
  Math.min(5, Number(process.env.TURBULENCE_BREAKDOWN_DURATION_SCALE ?? 1) || 1),
)
const CASE_TIMEOUT_SEC = Math.max(
  0,
  Number(process.env.TURBULENCE_BREAKDOWN_CASE_TIMEOUT_SEC ?? 0) || 0,
)
const CASE_TIMEOUT_MULTIPLIER_CPU = Math.max(
  1,
  Number(process.env.TURBULENCE_BREAKDOWN_CASE_TIMEOUT_MULTIPLIER_CPU ?? 5) || 5,
)
const CASE_TIMEOUT_MULTIPLIER_GPU = Math.max(
  1,
  Number(process.env.TURBULENCE_BREAKDOWN_CASE_TIMEOUT_MULTIPLIER_GPU ?? 2) || 2,
)
const CPU_TRAIN_DURATION_SCALE = Math.max(
  0.1,
  Math.min(1, Number(process.env.TURBULENCE_BREAKDOWN_CPU_TRAIN_DURATION_SCALE ?? 0.25) || 0.25),
)
const PLAYWRIGHT_HEADLESS = String(process.env.PLAYWRIGHT_HEADLESS ?? 'false') === 'true'
const PLAYWRIGHT_BROWSER_CHANNEL =
  typeof process.env.PLAYWRIGHT_BROWSER_CHANNEL === 'string' &&
  process.env.PLAYWRIGHT_BROWSER_CHANNEL.trim().length > 0
    ? process.env.PLAYWRIGHT_BROWSER_CHANNEL.trim()
    : ''

const BACKENDS = [
  {
    id: 'cpu',
    particleCount: 6000,
    modePatch: {
      dynamicsMode: 'guidedPhysics',
      executionMode: 'cpu',
      vortexRepresentation: 'particles',
      hybridPlusEnabled: false,
    },
  },
  {
    id: 'gpu',
    particleCount: 12000,
    modePatch: {
      dynamicsMode: 'guidedPhysics',
      executionMode: 'gpu',
      vortexRepresentation: 'particles',
      hybridPlusEnabled: false,
    },
  },
]

const SCENARIOS = [
  {
    id: 'single_pulse',
    title: 'Single pulse',
    action: 'singlePulse',
    durationSec: 24,
    sampleEveryMs: 400,
    thresholds: {
      circulationDriftAbsMaxPct: 7,
      sigmaOverRMin: 0.03,
      sigmaOverRMax: 0.35,
    },
  },
  {
    id: 'pulse_train',
    title: 'Pulse train',
    action: 'train',
    durationSec: 60,
    sampleEveryMs: 500,
    thresholds: {
      circulationDriftAbsMaxPct: 12,
      sigmaOverRMin: 0.03,
      sigmaOverRMax: 0.4,
    },
  },
  {
    id: 'long_run',
    title: 'Long run',
    action: 'train',
    durationSec: 180,
    sampleEveryMs: 750,
    thresholds: {
      circulationDriftAbsMaxPct: 18,
      sigmaOverRMin: 0.02,
      sigmaOverRMax: 0.45,
    },
  },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toFinite(value, fallback = null) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toBool(value) {
  return value === true
}

function readCirculationDrift(params = {}, diag = {}) {
  return (
    toFinite(params.circulationDriftPercent) ??
    toFinite(params.runtimeCirculationDriftPercent) ??
    toFinite(diag.circulationDriftPercent) ??
    toFinite(diag.runtimeCirculationDriftPercent)
  )
}

function readSigmaOverR(params = {}, diag = {}) {
  return (
    toFinite(params.sigmaOverR) ??
    toFinite(params.runtimeSigmaOverR) ??
    toFinite(diag.sigmaOverR) ??
    toFinite(diag.runtimeSigmaOverR)
  )
}

function readDispatchPending(params = {}, diag = {}) {
  if (typeof params.runtimeGpuDispatchPending === 'boolean') {
    return params.runtimeGpuDispatchPending
  }
  if (typeof diag.runtimeGpuDispatchPending === 'boolean') {
    return diag.runtimeGpuDispatchPending
  }
  return false
}

async function launchBrowser() {
  const options = {
    headless: PLAYWRIGHT_HEADLESS,
    args: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-angle=metal'],
  }
  if (PLAYWRIGHT_BROWSER_CHANNEL.length > 0) {
    try {
      return await chromium.launch({ ...options, channel: PLAYWRIGHT_BROWSER_CHANNEL })
    } catch (error) {
      console.warn(
        `[turbulence-audit] Failed to launch channel "${PLAYWRIGHT_BROWSER_CHANNEL}", fallback to bundled chromium: ${error.message}`,
      )
    }
  }
  return chromium.launch(options)
}

function evaluateCaseGate(row) {
  const sigmaAvailable =
    Number.isFinite(row.sigmaOverRMinObserved) && Number.isFinite(row.sigmaOverRMaxObserved)
  const checks = {
    case_completed: !row.runError,
    metrics_present: Number.isFinite(row.circulationDriftAbsMaxPct),
    drift_within_limit: Number.isFinite(row.circulationDriftAbsMaxPct)
      ? row.circulationDriftAbsMaxPct <= row.thresholds.circulationDriftAbsMaxPct
      : false,
    sigma_min_ok: !sigmaAvailable
      ? true
      : row.sigmaOverRMinObserved >= row.thresholds.sigmaOverRMin,
    sigma_max_ok: !sigmaAvailable
      ? true
      : row.sigmaOverRMaxObserved <= row.thresholds.sigmaOverRMax,
    gpu_dispatch_not_stuck: row.backend !== 'gpu' || row.dispatchStuck !== true,
  }
  const failedChecks = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([checkId]) => checkId)
  return {
    pass: failedChecks.length === 0,
    checks,
    failedChecks,
    notes: [
      ...(sigmaAvailable ? [] : ['sigma_metric_unavailable_in_runtime_params']),
      ...(row.runError ? [`case_error:${row.runError}`] : []),
    ],
  }
}

function fmtMaybeNumber(value) {
  return Number.isFinite(value) ? Number(value).toFixed(3) : 'n/a'
}

function toMarkdown(report) {
  const lines = [
    '# Turbulence Breakdown Audit',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Backend | Scenario | driftAbsMax% | sigmaMin | sigmaMax | dispatchStuck | Gate |',
    '|---|---|---:|---:|---:|---|---|',
  ]
  for (const row of report.rows) {
    lines.push(
      `| ${row.backend} | ${row.scenario} | ${fmtMaybeNumber(row.circulationDriftAbsMaxPct)} | ${fmtMaybeNumber(row.sigmaOverRMinObserved)} | ${fmtMaybeNumber(row.sigmaOverRMaxObserved)} | ${row.dispatchStuck ? 'yes' : 'no'} | ${row.gate.pass ? 'PASS' : 'FAIL'} |`,
    )
  }
  lines.push('', '## Failed checks', '')
  const failedRows = report.rows.filter((row) => row.gate.pass !== true)
  if (failedRows.length === 0) {
    lines.push('- none')
  } else {
    for (const row of failedRows) {
      lines.push(`- ${row.backend}/${row.scenario}: ${row.gate.failedChecks.join(', ')}`)
    }
  }
  lines.push('', `Overall gate: ${report.gate.pass ? 'PASS' : 'FAIL'}`)
  return lines.join('\n')
}

async function runCase(page, backend, scenario) {
  return page.evaluate(
    async ({ backendInner, scenarioInner }) => {
      const api = window.__torusTestApi
      if (!api) {
        throw new Error('__torusTestApi is unavailable')
      }
      api.pulse('stop')
      api.setMode(backendInner.modePatch)
      const effectiveParticleCount =
        backendInner.id === 'cpu' && scenarioInner.action !== 'singlePulse'
          ? Math.min(1500, Math.max(500, Math.floor(Number(backendInner.particleCount ?? 12000))))
          : Math.max(1000, Math.floor(Number(backendInner.particleCount ?? 12000)))
      api.setParams({
        uiLanguage: 'en',
        emissionMode: 'vortexRing',
        particleCount: effectiveParticleCount,
        showVectors: false,
        showBoth: false,
        vectorDisplayMode: 'particles',
        vpmEnabled: true,
        useBiotSavart: true,
      })
      api.resetParticles()
      await api.waitForMs(450)
      if (scenarioInner.action === 'singlePulse') {
        api.pulse('single')
      } else {
        if (backendInner.id !== 'cpu') {
          api.pulse('startTrain')
        }
      }

      const samples = []
      const iterations = Math.max(1, Math.floor((scenarioInner.durationSec * 1000) / scenarioInner.sampleEveryMs))
      for (let i = 0; i < iterations; i += 1) {
        if (scenarioInner.action !== 'singlePulse' && backendInner.id === 'cpu') {
          api.pulse('singleBurst')
        }
        await api.waitForMs(scenarioInner.sampleEveryMs)
        const params = api.getParams()
        const diag = api.getRuntimeDiagnostics()
        samples.push({
          tMs: (i + 1) * scenarioInner.sampleEveryMs,
          params,
          diag,
          runtimeGpuSteps: Number(params.runtimeGpuSteps ?? 0),
        })
      }
      api.pulse('stop')
      return { samples }
    },
    { backendInner: backend, scenarioInner: scenario },
  )
}

async function runCaseWithTimeout(page, backend, scenario, timeoutSec) {
  let timeoutId
  const timeoutMs = Math.max(30_000, Math.floor(timeoutSec * 1000))
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Case timeout for ${backend.id}/${scenario.id} after ${Math.floor(timeoutMs / 1000)}s`))
    }, timeoutMs)
    if (timeoutId && typeof timeoutId.unref === 'function') {
      timeoutId.unref()
    }
  })
  try {
    return await Promise.race([runCase(page, backend, scenario), timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
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
    for (const backend of BACKENDS) {
      for (const scenario of SCENARIOS) {
        const scaledScenario = {
          ...scenario,
          durationSec: Math.max(
            5,
            Math.round(
              scenario.durationSec *
                DURATION_SCALE *
                (backend.id === 'cpu' && scenario.action === 'train' ? CPU_TRAIN_DURATION_SCALE : 1),
            ),
          ),
        }
        const timeoutMultiplier = backend.id === 'cpu' ? CASE_TIMEOUT_MULTIPLIER_CPU : CASE_TIMEOUT_MULTIPLIER_GPU
        const timeoutSec =
          CASE_TIMEOUT_SEC > 0
            ? CASE_TIMEOUT_SEC
            : Math.max(60, Math.ceil(scaledScenario.durationSec * timeoutMultiplier))
        let run = null
        let runError = ''
        try {
          run = await runCaseWithTimeout(page, backend, scaledScenario, timeoutSec)
        } catch (error) {
          runError = String(error?.message ?? error ?? 'unknown_case_error')
        }
        const samples = Array.isArray(run?.samples) ? run.samples : []
        const driftAbsValues = samples
          .map((sample) =>
            Math.abs(readCirculationDrift(sample?.params ?? {}, sample?.diag ?? {})),
          )
          .filter(Number.isFinite)
        const sigmaValues = samples
          .map((sample) => readSigmaOverR(sample?.params ?? {}, sample?.diag ?? {}))
          .filter(Number.isFinite)
        let pendingStreak = 0
        let maxPendingStreak = 0
        for (const sample of samples) {
          const pending = toBool(readDispatchPending(sample?.params ?? {}, sample?.diag ?? {}))
          if (pending) {
            pendingStreak += 1
            maxPendingStreak = Math.max(maxPendingStreak, pendingStreak)
          } else {
            pendingStreak = 0
          }
        }
        const row = {
          backend: backend.id,
          scenario: scenario.id,
          sampleCount: samples.length,
          runError,
          thresholds: scenario.thresholds,
          circulationDriftAbsMaxPct:
            driftAbsValues.length > 0 ? Math.max(...driftAbsValues) : Number.NaN,
          sigmaOverRMinObserved: sigmaValues.length > 0 ? Math.min(...sigmaValues) : Number.NaN,
          sigmaOverRMaxObserved: sigmaValues.length > 0 ? Math.max(...sigmaValues) : Number.NaN,
          dispatchPendingMaxStreak: maxPendingStreak,
          gpuStepsDelta:
            backend.id === 'gpu' && samples.length > 1
              ? Math.max(
                  0,
                  Math.floor(Number(samples[samples.length - 1]?.runtimeGpuSteps ?? 0)) -
                    Math.floor(Number(samples[0]?.runtimeGpuSteps ?? 0)),
                )
              : 0,
          dispatchStuck:
            backend.id === 'gpu' &&
            samples.length >= 8 &&
            maxPendingStreak >= Math.max(8, samples.length - 1) &&
            Math.max(
              0,
              Math.floor(Number(samples[samples.length - 1]?.runtimeGpuSteps ?? 0)) -
                Math.floor(Number(samples[0]?.runtimeGpuSteps ?? 0)),
            ) <= 1,
        }
        row.gate = evaluateCaseGate(row)
        rows.push(row)
      }
    }

    const failedChecks = rows.flatMap((row) =>
      row.gate.pass
        ? []
        : row.gate.failedChecks.map((checkId) => `${row.backend}/${row.scenario}:${checkId}`),
    )
    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      rows,
      gate: {
        pass: failedChecks.length === 0,
        failedChecks,
      },
    }
    await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await fs.writeFile(OUTPUT_MD, `${toMarkdown(report)}\n`, 'utf8')
    console.table(
      rows.map((row) => ({
        backend: row.backend,
        scenario: row.scenario,
        driftAbsMaxPct: Number(row.circulationDriftAbsMaxPct.toFixed(3)),
        sigmaMin: Number.isFinite(row.sigmaOverRMinObserved)
          ? Number(row.sigmaOverRMinObserved.toFixed(3))
          : null,
        sigmaMax: Number.isFinite(row.sigmaOverRMaxObserved)
          ? Number(row.sigmaOverRMaxObserved.toFixed(3))
          : null,
        gpuStepsDelta: row.gpuStepsDelta,
        dispatchStuck: row.dispatchStuck ? 'yes' : 'no',
        gate: row.gate.pass ? 'PASS' : 'FAIL',
      })),
    )
    if (FAIL_ON_GATE && report.gate.pass !== true) {
      throw new Error(`Turbulence breakdown audit gate failed: ${report.gate.failedChecks.join(', ')}`)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
