import fs from 'node:fs/promises'
import { chromium } from 'playwright'

const BASE_URL = process.env.TORUS_BASE_URL ?? 'http://localhost:5173/'
const OUTPUT_JSON = process.env.HYBRID_SYNC_DIAG_OUTPUT_JSON ?? './hybrid-sync-diagnostic.json'
const OUTPUT_MD = process.env.HYBRID_SYNC_DIAG_OUTPUT_MD ?? './hybrid-sync-diagnostic.md'
const DURATION_SEC = Math.max(5, Number(process.env.HYBRID_SYNC_DIAG_DURATION_SEC ?? 16) || 16)
const SAMPLE_EVERY_MS = Math.max(100, Number(process.env.HYBRID_SYNC_DIAG_SAMPLE_EVERY_MS ?? 200) || 200)
const MIN_GPU_STEPS_DELTA = Math.max(1, Number(process.env.HYBRID_SYNC_DIAG_MIN_GPU_STEPS_DELTA ?? 5) || 5)
const MAX_PENDING_RATIO = Math.max(0, Math.min(1, Number(process.env.HYBRID_SYNC_DIAG_MAX_PENDING_RATIO ?? 0.95) || 0.95))
const MAX_CENTER_GAP_AVG = Math.max(0, Number(process.env.HYBRID_SYNC_DIAG_MAX_CENTER_GAP_AVG ?? 0.25) || 0.25)
const MAX_FROZEN_RATIO = Math.max(0, Math.min(1, Number(process.env.HYBRID_SYNC_DIAG_MAX_FROZEN_RATIO ?? 0.2) || 0.2))
const MAX_FROZEN_RATIO_HYBRID_PLUS = Math.max(
  0,
  Math.min(1, Number(process.env.HYBRID_SYNC_DIAG_MAX_FROZEN_RATIO_HYBRID_PLUS ?? MAX_FROZEN_RATIO) || MAX_FROZEN_RATIO),
)
const MAX_DECOUPLED_STREAK = Math.max(1, Number(process.env.HYBRID_SYNC_DIAG_MAX_DECOUPLED_STREAK ?? 2) || 2)
const REQUIRE_BLOCKED_UNSYNC = String(process.env.HYBRID_SYNC_DIAG_REQUIRE_BLOCKED_UNSYNC ?? 'false') === 'true'
const DIAG_MODES = String(process.env.HYBRID_SYNC_DIAG_MODES ?? 'hybrid,hybrid_plus')
  .split(',')
  .map((mode) => mode.trim())
  .filter((mode) => mode === 'hybrid' || mode === 'hybrid_plus')
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

function avg(values = []) {
  if (!Array.isArray(values) || values.length === 0) return 0
  let total = 0
  for (let i = 0; i < values.length; i += 1) {
    total += Number(values[i]) || 0
  }
  return total / values.length
}

async function launchBrowser() {
  const options = {
    headless: PLAYWRIGHT_HEADLESS,
    args: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-angle=metal'],
  }
  if (PLAYWRIGHT_BROWSER_CHANNEL.length > 0) {
    try {
      return await chromium.launch({ ...options, channel: PLAYWRIGHT_BROWSER_CHANNEL })
    } catch {
      return chromium.launch(options)
    }
  }
  return chromium.launch(options)
}

function evaluate(samples = [], counters = {}, mode = 'hybrid') {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { pass: false, failedChecks: ['no_samples'] }
  }
  const pendingValues = samples.map((s) => (s.runtimeGpuDispatchPending ? 1 : 0))
  const particleSpeedValues = samples.map((s) => toFinite(s.hybridParticleSpeed))
  const filamentSpeedValues = samples.map((s) => toFinite(s.hybridFilamentSpeed))
  const ratioValues = samples.map((s) => toFinite(s.hybridSpeedRatio))
  const centerGapValues = samples.map((s) =>
    Math.abs(toFinite(s.hybridParticleCenterStep) - toFinite(s.hybridFilamentCenterStep)),
  )
  const gpuStepsDelta =
    Math.max(0, Math.floor(toFinite(samples[samples.length - 1]?.runtimeGpuSteps))) -
    Math.max(0, Math.floor(toFinite(samples[0]?.runtimeGpuSteps)))
  const pendingRatio = avg(pendingValues)
  const particleSpeedAvg = avg(particleSpeedValues)
  const filamentSpeedAvg = avg(filamentSpeedValues)
  const speedRatioAvg = avg(ratioValues)
  const centerGapAvg = avg(centerGapValues)
  const frozenParticleWhileFilamentMovesCount = samples.filter((s) => {
    const gpuSteps = Math.max(0, Math.floor(toFinite(s.runtimeGpuSteps)))
    const activeCount = Math.max(0, Math.floor(toFinite(s.runtimeActiveCount)))
    return (
      gpuSteps >= 5 &&
      activeCount >= 200 &&
      toFinite(s.hybridParticleSpeed) < 1e-4 &&
      toFinite(s.hybridFilamentSpeed) > 0.01
    )
  }).length
  let frozenDecoupledStreakMax = 0
  let frozenDecoupledStreakCurrent = 0
  for (let i = 0; i < samples.length; i += 1) {
    const row = samples[i]
    const prevGpuSteps = i > 0 ? Math.max(0, Math.floor(toFinite(samples[i - 1]?.runtimeGpuSteps))) : -1
    const gpuSteps = Math.max(0, Math.floor(toFinite(row.runtimeGpuSteps)))
    const decoupled =
      gpuSteps > prevGpuSteps &&
      toFinite(row.hybridParticleSpeed) < 1e-4 &&
      toFinite(row.hybridFilamentSpeed) > 0.01
    if (decoupled) {
      frozenDecoupledStreakCurrent += 1
      frozenDecoupledStreakMax = Math.max(frozenDecoupledStreakMax, frozenDecoupledStreakCurrent)
    } else {
      frozenDecoupledStreakCurrent = 0
    }
  }
  const unsafeUnsyncedDelta = Math.max(0, Math.floor(toFinite(counters.unsafeUnsyncedDelta)))

  const maxFrozenRatio = mode === 'hybrid_plus' ? MAX_FROZEN_RATIO_HYBRID_PLUS : MAX_FROZEN_RATIO
  const frozenLimit = Math.max(1, Math.floor(samples.length * maxFrozenRatio))
  const blockedUnsyncedDelta = Math.max(0, Math.floor(toFinite(counters.blockedUnsyncedDelta)))
  const checks = {
    gpu_steps_progress: gpuStepsDelta >= MIN_GPU_STEPS_DELTA,
    particle_filament_motion_not_decoupled: frozenParticleWhileFilamentMovesCount <= frozenLimit,
    no_long_decoupled_streak: frozenDecoupledStreakMax <= MAX_DECOUPLED_STREAK,
    no_unsafe_unsynced_filament_steps: unsafeUnsyncedDelta === 0,
    blocked_unsynced_observed: REQUIRE_BLOCKED_UNSYNC ? blockedUnsyncedDelta > 0 : true,
    center_gap_bounded: centerGapAvg < MAX_CENTER_GAP_AVG,
    pending_ratio_reasonable: pendingRatio < MAX_PENDING_RATIO,
  }
  const failedChecks = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([id]) => id)

  return {
    pass: failedChecks.length === 0,
    failedChecks,
    metrics: {
      sampleCount: samples.length,
      gpuStepsDelta,
      pendingRatio,
      particleSpeedAvg,
      filamentSpeedAvg,
      speedRatioAvg,
      centerGapAvg,
      frozenParticleWhileFilamentMovesCount,
      frozenDecoupledStreakMax,
      blockedUnsyncedDelta,
      unsafeUnsyncedDelta,
      thresholds: {
        minGpuStepsDelta: MIN_GPU_STEPS_DELTA,
        maxPendingRatio: MAX_PENDING_RATIO,
        maxCenterGapAvg: MAX_CENTER_GAP_AVG,
        maxFrozenRatio,
        maxDecoupledStreak: MAX_DECOUPLED_STREAK,
        requireBlockedUnsync: REQUIRE_BLOCKED_UNSYNC,
      },
    },
  }
}

function formatCase(lines, item) {
  const m = item.verdict?.metrics ?? {}
  lines.push(`## Mode: ${item.mode}`)
  lines.push('')
  lines.push(`Backend observed: ${item.backend}`)
  lines.push(`Gate: ${item.verdict?.pass ? 'PASS' : 'FAIL'}`)
  lines.push('')
  lines.push('### Metrics')
  lines.push('')
  lines.push(`- sampleCount: ${m.sampleCount ?? 0}`)
  lines.push(`- gpuStepsDelta: ${m.gpuStepsDelta ?? 0}`)
  lines.push(`- pendingRatio: ${Number(m.pendingRatio ?? 0).toFixed(3)}`)
  lines.push(`- hybridParticleSpeed avg: ${Number(m.particleSpeedAvg ?? 0).toFixed(4)}`)
  lines.push(`- hybridFilamentSpeed avg: ${Number(m.filamentSpeedAvg ?? 0).toFixed(4)}`)
  lines.push(`- hybridSpeedRatio avg: ${Number(m.speedRatioAvg ?? 0).toFixed(4)}`)
  lines.push(`- centerStepGap avg: ${Number(m.centerGapAvg ?? 0).toFixed(4)}`)
  lines.push(`- frozenParticleWhileFilamentMovesCount: ${m.frozenParticleWhileFilamentMovesCount ?? 0}`)
  lines.push(`- frozenDecoupledStreakMax: ${m.frozenDecoupledStreakMax ?? 0}`)
  lines.push(`- blockedUnsyncedDelta: ${m.blockedUnsyncedDelta ?? 0}`)
  lines.push(`- unsafeUnsyncedDelta: ${m.unsafeUnsyncedDelta ?? 0}`)
  lines.push(`- thresholds: minGpuStepsDelta=${m.thresholds?.minGpuStepsDelta ?? 0}, maxPendingRatio=${Number(m.thresholds?.maxPendingRatio ?? 0).toFixed(3)}, maxCenterGapAvg=${Number(m.thresholds?.maxCenterGapAvg ?? 0).toFixed(3)}, maxFrozenRatio=${Number(m.thresholds?.maxFrozenRatio ?? 0).toFixed(3)}, maxDecoupledStreak=${m.thresholds?.maxDecoupledStreak ?? 0}, requireBlockedUnsync=${m.thresholds?.requireBlockedUnsync ? 'yes' : 'no'}`)
  lines.push('')
  lines.push('### Failed checks')
  lines.push('')
  if (item.verdict?.failedChecks?.length > 0) {
    for (const checkId of item.verdict.failedChecks) {
      lines.push(`- ${checkId}`)
    }
  } else {
    lines.push('- none')
  }
  lines.push('')
}

function toMarkdown(report) {
  const lines = [
    '# Hybrid Sync Diagnostic',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Overall gate: ${report.gate?.pass ? 'PASS' : 'FAIL'}`,
    `Modes: ${(report.modes ?? []).join(', ')}`,
    '',
  ]
  for (const item of report.results ?? []) {
    formatCase(lines, item)
  }
  return lines.join('\n')
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
    if (!ready) throw new Error('__torusTestApi did not initialize in time')

    const results = []
    for (const mode of DIAG_MODES.length > 0 ? DIAG_MODES : ['hybrid', 'hybrid_plus']) {
      const samples = await page.evaluate(
        async ({ durationSec, sampleEveryMs, mode }) => {
        const api = window.__torusTestApi
        if (!api) throw new Error('__torusTestApi is unavailable')
        api.pulse('stop')
        api.setMode({
          dynamicsMode: 'fullPhysics',
          executionMode: mode,
          vortexRepresentation: 'hybrid',
          hybridPlusEnabled: mode === 'hybrid_plus',
        })
        api.setParams({
          uiLanguage: 'en',
          emissionMode: 'vortexRing',
          physicsBackend: 'webgpu',
          particleCount: 12000,
          vpmEnabled: true,
          useBiotSavart: true,
          hybridCouplingEnabled: true,
          showVectors: false,
          showBoth: false,
          vectorDisplayMode: 'particles',
        })
        api.resetParticles()
        await api.waitForMs(500)
        const startParams = api.getParams()
        api.pulse('startTrain')
        const rows = []
        const iterations = Math.max(1, Math.floor((durationSec * 1000) / sampleEveryMs))
        for (let i = 0; i < iterations; i += 1) {
          await api.waitForMs(sampleEveryMs)
          const params = api.getParams()
          const diag = api.getRuntimeDiagnostics()
          const filamentStats = api.getFilamentStats()
          const stabilityStats = api.getStabilityStats()
          rows.push({
            tMs: (i + 1) * sampleEveryMs,
            runtimeBackend: String(params.runtimeBackend ?? diag.runtimeBackend ?? 'unknown'),
            runtimeGpuDispatchPending: Boolean(params.runtimeGpuDispatchPending ?? diag.runtimeGpuDispatchPending),
            runtimeGpuSteps: Math.floor(Number(params.runtimeGpuSteps ?? diag.runtimeGpuSteps ?? 0)),
            runtimeCpuSteps: Math.floor(Number(params.runtimeCpuSteps ?? diag.runtimeCpuSteps ?? 0)),
            runtimeGpuStepMs: Number(params.runtimeGpuStepMs ?? diag.stepMs ?? 0),
            runtimeActiveCount: Math.floor(Number(diag.activeCount ?? 0)),
            hybridParticleSpeed: Number(filamentStats.hybridParticleSpeed ?? 0),
            hybridFilamentSpeed: Number(filamentStats.hybridFilamentSpeed ?? 0),
            hybridSpeedRatio: Number(filamentStats.hybridSpeedRatio ?? 0),
            hybridParticleCenterStep: Number(stabilityStats.hybridParticleCenterStep ?? 0),
            hybridFilamentCenterStep: Number(stabilityStats.hybridFilamentCenterStep ?? 0),
            hybridCenterOffset: Number(stabilityStats.hybridCenterOffset ?? 0),
          })
        }
        api.pulse('stop')
        const endParams = api.getParams()
        return {
          rows,
          counters: {
            blockedUnsyncedDelta:
              Number(endParams.runtimeHybridFilamentStepBlockedUnsyncedCount ?? 0) -
              Number(startParams.runtimeHybridFilamentStepBlockedUnsyncedCount ?? 0),
            unsafeUnsyncedDelta:
              Number(endParams.runtimeHybridFilamentStepUnsafeUnsyncedCount ?? 0) -
              Number(startParams.runtimeHybridFilamentStepUnsafeUnsyncedCount ?? 0),
          },
        }
      },
        { durationSec: DURATION_SEC, sampleEveryMs: SAMPLE_EVERY_MS, mode },
      )
      const sampleRows = Array.isArray(samples?.rows) ? samples.rows : []
      const counters = samples?.counters ?? {}
      const verdict = evaluate(sampleRows, counters, mode)
      results.push({
        mode,
        backend: String(sampleRows[sampleRows.length - 1]?.runtimeBackend ?? 'unknown'),
        verdict,
        samples: sampleRows,
      })
    }

    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      config: { durationSec: DURATION_SEC, sampleEveryMs: SAMPLE_EVERY_MS, modes: DIAG_MODES },
      modes: DIAG_MODES,
      gate: {
        pass: results.every((item) => item.verdict?.pass === true),
        failedChecks: results.flatMap((item) =>
          item.verdict?.pass === true
            ? []
            : (item.verdict?.failedChecks ?? []).map((checkId) => `${item.mode}:${checkId}`),
        ),
      },
      results,
    }
    await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await fs.writeFile(OUTPUT_MD, `${toMarkdown(report)}\n`, 'utf8')
    console.log(
      `Hybrid sync diagnostic: gate=${report.gate.pass ? 'PASS' : 'FAIL'} modes=${DIAG_MODES.join(',')} json=${OUTPUT_JSON} md=${OUTPUT_MD}`,
    )
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
