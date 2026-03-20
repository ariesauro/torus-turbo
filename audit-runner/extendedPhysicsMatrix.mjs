import fs from 'node:fs/promises'
import { chromium } from 'playwright'

const BASE_URL = process.env.TORUS_BASE_URL ?? 'http://localhost:5173/'
const OUTPUT_JSON = process.env.EXTENDED_PHYSICS_MATRIX_OUTPUT_JSON ?? './extended-physics-matrix.json'
const OUTPUT_MD = process.env.EXTENDED_PHYSICS_MATRIX_OUTPUT_MD ?? './extended-physics-matrix.md'
const FAIL_ON_GATE = String(process.env.EXTENDED_PHYSICS_MATRIX_FAIL_ON_GATE ?? 'false') === 'true'
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

function p95(values) {
  if (!Array.isArray(values) || values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))
  return sorted[idx]
}

function toPctDelta(start, end) {
  const s = Math.max(1e-9, Math.abs(toFinite(start, 0)))
  return ((toFinite(end, 0) - toFinite(start, 0)) / s) * 100
}

const CASES = [
  {
    id: 'ring.canonical',
    title: 'Ring canonical',
    modePatch: {
      dynamicsMode: 'fullPhysics',
      executionMode: 'cpu',
      vortexRepresentation: 'particles',
      hybridPlusEnabled: false,
    },
    paramsPatch: {
      emissionMode: 'vortexRing',
      particleCount: 9000,
      physicalIntegrationOrderProfile: 'canonical',
      physicalViscosityEnabled: true,
      physicalViscosityNu: 0.0003,
      physicalStretchingEnabled: true,
      physicalStretchingStrength: 1.0,
      physicalBoundaryEnabled: true,
      physicalWakeEnabled: true,
      vpmEnabled: true,
      useBiotSavart: true,
    },
    warmupSec: 2,
    durationSec: 8,
    sampleEveryMs: 400,
    thresholds: {
      stepP95MsMax: 700,
      energyDriftAbsPctMax: 40,
      enstrophyDriftAbsPctMax: 70,
      criticalRatioMax: 0.25,
    },
  },
  {
    id: 'jet.shear',
    title: 'Jet shear-layer',
    modePatch: {
      dynamicsMode: 'guidedPhysics',
      executionMode: 'cpu',
      vortexRepresentation: 'particles',
      hybridPlusEnabled: false,
    },
    paramsPatch: {
      emissionMode: 'continuousJet',
      particleCount: 10000,
      jetSpeed: 3.8,
      pulseDuration: 0.06,
      pulseInterval: 0.6,
      physicalViscosityEnabled: true,
      physicalViscosityNu: 0.00025,
      physicalWakeEnabled: true,
      structureDetectionEnabled: true,
      vpmEnabled: true,
      useBiotSavart: true,
    },
    warmupSec: 2,
    durationSec: 9,
    sampleEveryMs: 450,
    thresholds: {
      stepP95MsMax: 800,
      energyDriftAbsPctMax: 55,
      enstrophyDriftAbsPctMax: 120,
      criticalRatioMax: 0.35,
    },
  },
  {
    id: 'turbulence.wake',
    title: 'Turbulence wake',
    modePatch: {
      dynamicsMode: 'fullPhysics',
      executionMode: 'hybrid',
      vortexRepresentation: 'hybrid',
      hybridPlusEnabled: true,
    },
    paramsPatch: {
      emissionMode: 'particleStream',
      particleCount: 12000,
      physicalViscosityEnabled: true,
      physicalViscosityNu: 0.00035,
      physicalStretchingEnabled: true,
      physicalStretchingStrength: 1.2,
      physicalBoundaryEnabled: true,
      physicalWakeEnabled: true,
      structureDetectionEnabled: true,
      vpmEnabled: true,
      useBiotSavart: true,
    },
    warmupSec: 2,
    durationSec: 10,
    sampleEveryMs: 500,
    thresholds: {
      stepP95MsMax: 900,
      energyDriftAbsPctMax: 65,
      enstrophyDriftAbsPctMax: 180,
      criticalRatioMax: 0.4,
    },
  },
]

async function runCase(page, caseConfig) {
  return page.evaluate(
    async ({ inner }) => {
      const api = window.__torusTestApi
      if (!api) {
        throw new Error('__torusTestApi is unavailable')
      }
      api.pulse('stop')
      api.setMode(inner.modePatch)
      api.setParams({
        uiLanguage: 'en',
        showVectors: false,
        showBoth: false,
        vectorDisplayMode: 'particles',
        energyDiagnosticsEnabled: true,
        ...inner.paramsPatch,
      })
      api.resetParticles()
      await api.waitForMs(300)
      api.pulse('startTrain')
      await api.waitForMs(Math.max(0, Math.floor(inner.warmupSec * 1000)))

      const samples = []
      const iterations = Math.max(1, Math.floor((inner.durationSec * 1000) / inner.sampleEveryMs))
      for (let i = 0; i < iterations; i += 1) {
        await api.waitForMs(inner.sampleEveryMs)
        samples.push({
          tMs: (i + 1) * inner.sampleEveryMs,
          diag: api.getRuntimeDiagnostics(),
          params: api.getParams(),
        })
      }
      api.pulse('stop')
      return {
        id: inner.id,
        title: inner.title,
        thresholds: inner.thresholds,
        samples,
      }
    },
    { inner: caseConfig },
  )
}

function summarizeCase(run) {
  const samples = Array.isArray(run?.samples) ? run.samples : []
  const first = samples[0]?.params ?? {}
  const last = samples[samples.length - 1]?.params ?? {}
  const stepSeries = samples.map((s) => toFinite(s?.diag?.stepMs, 0)).filter((v) => v > 0)
  const stabilitySeries = samples.map((s) => String(s?.params?.runtimeStabilityLevel ?? 'unknown'))
  const criticalCount = stabilitySeries.filter((item) => item === 'critical').length
  const criticalRatio = samples.length > 0 ? criticalCount / samples.length : 0

  const energyStart = toFinite(first.runtimeEnergyProxy, 0)
  const energyEnd = toFinite(last.runtimeEnergyProxy, 0)
  const enstrophyStart = toFinite(first.runtimeEnstrophyProxy, 0)
  const enstrophyEnd = toFinite(last.runtimeEnstrophyProxy, 0)

  return {
    id: run?.id ?? 'unknown',
    title: run?.title ?? 'unknown',
    sampleCount: samples.length,
    stepP95Ms: p95(stepSeries),
    energyDriftPct: toPctDelta(energyStart, energyEnd),
    enstrophyDriftPct: toPctDelta(enstrophyStart, enstrophyEnd),
    criticalRatio,
    thresholds: run?.thresholds ?? {},
  }
}

function evaluateCaseGate(row) {
  const threshold = row.thresholds ?? {}
  const checks = {
    stepP95Ms: row.stepP95Ms <= toFinite(threshold.stepP95MsMax, 1e9),
    energyDriftAbsPct: Math.abs(row.energyDriftPct) <= toFinite(threshold.energyDriftAbsPctMax, 1e9),
    enstrophyDriftAbsPct: Math.abs(row.enstrophyDriftPct) <= toFinite(threshold.enstrophyDriftAbsPctMax, 1e9),
    criticalRatio: row.criticalRatio <= toFinite(threshold.criticalRatioMax, 1),
  }
  const failedChecks = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([id]) => id)
  return {
    pass: failedChecks.length === 0,
    failedChecks,
    checks,
  }
}

function toMarkdown(report) {
  const lines = [
    '# Extended physics matrix',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| Case | stepP95 (ms) | energy drift % | enstrophy drift % | critical ratio | Gate | Failed checks |',
    '|---|---:|---:|---:|---:|---|---|',
  ]
  for (const row of report.rows) {
    const gate = row.gate?.pass === true ? 'PASS' : 'FAIL'
    const failed = Array.isArray(row.gate?.failedChecks) && row.gate.failedChecks.length > 0 ? row.gate.failedChecks.join(', ') : '-'
    lines.push(
      `| ${row.id} | ${row.stepP95Ms.toFixed(2)} | ${row.energyDriftPct.toFixed(2)} | ${row.enstrophyDriftPct.toFixed(2)} | ${row.criticalRatio.toFixed(3)} | ${gate} | ${failed} |`,
    )
  }
  lines.push('', `Overall gate: ${report.gate.pass ? 'PASS' : 'FAIL'}`)
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
      rows.push({
        ...summary,
        gate,
      })
    }

    const failed = rows.flatMap((row) => row.gate.pass ? [] : row.gate.failedChecks.map((id) => `${row.id}:${id}`))
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
        stepP95Ms: Number(row.stepP95Ms.toFixed(2)),
        energyDriftPct: Number(row.energyDriftPct.toFixed(2)),
        enstrophyDriftPct: Number(row.enstrophyDriftPct.toFixed(2)),
        criticalRatio: Number(row.criticalRatio.toFixed(3)),
        gate: row.gate.pass ? 'PASS' : 'FAIL',
      })),
    )

    if (FAIL_ON_GATE && report.gate.pass !== true) {
      throw new Error(`Extended physics matrix gate failed: ${report.gate.failedChecks.join(', ')}`)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
