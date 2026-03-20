import fs from 'node:fs/promises'
import { chromium } from 'playwright'

const BASE_URL = process.env.TORUS_BASE_URL ?? 'http://localhost:5173/'
const OUTPUT_JSON = process.env.PHYSICAL_BASELINE_OUTPUT_JSON ?? './physical-realism-baseline.json'
const OUTPUT_MD = process.env.PHYSICAL_BASELINE_OUTPUT_MD ?? './physical-realism-baseline.md'
const FAIL_ON_GATE = String(process.env.PHYSICAL_BASELINE_FAIL_ON_GATE ?? 'false') === 'true'
const BASE_PARTICLE_COUNT = Math.max(2000, Math.floor(Number(process.env.PHYSICAL_BASELINE_PARTICLE_COUNT ?? 9000) || 9000))
const BASE_WARMUP_SEC = Math.max(1, Number(process.env.PHYSICAL_BASELINE_WARMUP_SEC ?? 2) || 2)
const BASE_DURATION_SEC = Math.max(3, Number(process.env.PHYSICAL_BASELINE_DURATION_SEC ?? 8) || 8)
const BASE_SAMPLE_MS = Math.max(150, Math.floor(Number(process.env.PHYSICAL_BASELINE_SAMPLE_MS ?? 400) || 400))
const PLAYWRIGHT_HEADLESS = String(process.env.PLAYWRIGHT_HEADLESS ?? 'false') === 'true'
const PLAYWRIGHT_BROWSER_CHANNEL =
  typeof process.env.PLAYWRIGHT_BROWSER_CHANNEL === 'string' &&
  process.env.PLAYWRIGHT_BROWSER_CHANNEL.trim().length > 0
    ? process.env.PLAYWRIGHT_BROWSER_CHANNEL.trim()
    : ''
const EXPECTED_PROXY_WARNINGS = new Set([
  'pse_uses_core_spreading_proxy',
  'boundary_interaction_hook_noop_proxy',
  'wake_forcing_hook_noop_proxy',
])

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toFinite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toPctDelta(start, end) {
  const s = Math.max(1e-9, Math.abs(toFinite(start, 0)))
  return ((toFinite(end, 0) - toFinite(start, 0)) / s) * 100
}

function p95(values) {
  if (!Array.isArray(values) || values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))
  return sorted[idx]
}

function collectUnexpectedWarnings(warnings) {
  return Array.from(new Set(warnings.filter((item) => !EXPECTED_PROXY_WARNINGS.has(item))))
}

function buildCaseConfig(overrides = {}) {
  return {
    title: String(overrides.title ?? 'physical_case'),
    modePatch: {
      dynamicsMode: 'fullPhysics',
      executionMode: 'cpu',
      vortexRepresentation: 'particles',
      hybridPlusEnabled: false,
    },
    paramsPatch: {
      uiLanguage: 'en',
      particleCount: BASE_PARTICLE_COUNT,
      showVectors: false,
      showBoth: false,
      vectorDisplayMode: 'particles',
      vpmEnabled: true,
      useBiotSavart: true,
      emissionMode: 'vortexRing',
      physicalViscosityEnabled: true,
      physicalPseEnabled: true,
      physicalStretchingEnabled: true,
      physicalBoundaryEnabled: true,
      physicalBoundaryMode: 'planes',
      physicalNoSlipEnabled: true,
      physicalImageVorticesEnabled: true,
      physicalWakeEnabled: true,
      viscosity: 0.0003,
      physicalViscosityNu: 0.0003,
      stretchingStrength: 0.12,
      physicalStretchingStrength: 1,
      physicalIntegrationOrderProfile: 'canonical',
      ...(overrides.paramsPatch ?? {}),
    },
    warmupSec: Math.max(1, Number(overrides.warmupSec ?? BASE_WARMUP_SEC)),
    durationSec: Math.max(3, Number(overrides.durationSec ?? BASE_DURATION_SEC)),
    sampleEveryMs: Math.max(150, Math.floor(Number(overrides.sampleEveryMs ?? BASE_SAMPLE_MS))),
  }
}

async function runCase(page, caseConfig) {
  return page.evaluate(async ({ caseInner }) => {
    const api = window.__torusTestApi
    if (!api) {
      throw new Error('__torusTestApi is unavailable')
    }
    api.pulse('stop')
    api.setMode(caseInner.modePatch)
    api.setParams(caseInner.paramsPatch)
    api.resetParticles()
    await api.waitForMs(350)
    api.pulse('startTrain')
    await api.waitForMs(Math.max(0, Math.floor(caseInner.warmupSec * 1000)))

    const samples = []
    const iterations = Math.max(1, Math.floor((caseInner.durationSec * 1000) / caseInner.sampleEveryMs))
    for (let i = 0; i < iterations; i += 1) {
      await api.waitForMs(caseInner.sampleEveryMs)
      samples.push({
        tMs: (i + 1) * caseInner.sampleEveryMs,
        diag: api.getRuntimeDiagnostics(),
        params: api.getParams(),
      })
    }
    api.pulse('stop')
    return {
      title: caseInner.title,
      paramsPatch: caseInner.paramsPatch,
      samples,
    }
  }, {
    caseInner: caseConfig,
  })
}

function summarizeCase(run) {
  const samples = Array.isArray(run?.samples) ? run.samples : []
  const first = samples[0]?.params ?? {}
  const last = samples[samples.length - 1]?.params ?? {}
  const stepSeries = samples.map((s) => toFinite(s?.diag?.stepMs, 0)).filter((v) => v > 0)
  const warnings = samples.flatMap((s) => (Array.isArray(s?.params?.runtimePhysicalWarnings) ? s.params.runtimePhysicalWarnings : []))
  const unexpectedWarnings = collectUnexpectedWarnings(warnings)
  const stabilityLevels = samples.map((s) => String(s?.params?.runtimeStabilityLevel ?? 'unknown'))
  const criticalCount = stabilityLevels.filter((item) => item === 'critical').length
  const criticalRatio = samples.length > 0 ? criticalCount / samples.length : 0
  const energyStart = toFinite(first.runtimeEnergyProxy, 0)
  const energyEnd = toFinite(last.runtimeEnergyProxy, 0)
  const energyErrorPctEnd = toFinite(last.runtimeStabilityEnergyErrorPct, Number.NaN)
  const enstrophyEnd = toFinite(last.runtimeEnstrophyProxy, 0)
  const circulationDriftPct = toFinite(last.runtimeStabilityCirculationErrorPct, 0)
  const nonFiniteDetected = [energyStart, energyEnd, enstrophyEnd, circulationDriftPct].some((v) => !Number.isFinite(v))
  const energyDriftPct = Number.isFinite(energyErrorPctEnd) ? energyErrorPctEnd : toPctDelta(energyStart, energyEnd)

  return {
    title: run?.title ?? 'unknown',
    integrationProfile: String(run?.paramsPatch?.physicalIntegrationOrderProfile ?? 'canonical'),
    physicalViscosityNu: toFinite(run?.paramsPatch?.physicalViscosityNu, 0),
    physicalStretchingStrength: toFinite(run?.paramsPatch?.physicalStretchingStrength, 0),
    energyDriftPct,
    circulationDriftPct,
    enstrophyEnd,
    stepP95Ms: p95(stepSeries),
    warningSet: Array.from(new Set(warnings)),
    unexpectedWarnings,
    criticalRatio,
    nonFiniteDetected,
  }
}

function evaluateOrderSensitivity(rows) {
  if (rows.length < 3) {
    return {
      ok: false,
      reason: 'insufficient_profiles',
      checks: [],
    }
  }
  const maxEnergyPairDelta = Math.max(
    Math.abs(rows[0].energyDriftPct - rows[1].energyDriftPct),
    Math.abs(rows[0].energyDriftPct - rows[2].energyDriftPct),
    Math.abs(rows[1].energyDriftPct - rows[2].energyDriftPct),
  )
  const maxCirculationPairDelta = Math.max(
    Math.abs(rows[0].circulationDriftPct - rows[1].circulationDriftPct),
    Math.abs(rows[0].circulationDriftPct - rows[2].circulationDriftPct),
    Math.abs(rows[1].circulationDriftPct - rows[2].circulationDriftPct),
  )
  const unexpectedWarningsCount = rows.reduce((acc, item) => acc + item.unexpectedWarnings.length, 0)
  const checks = [
    { id: 'order_energy_pair_delta', ok: maxEnergyPairDelta <= 12, value: maxEnergyPairDelta, threshold: 12 },
    { id: 'order_circulation_pair_delta', ok: maxCirculationPairDelta <= 6, value: maxCirculationPairDelta, threshold: 6 },
    {
      id: 'order_unexpected_warnings',
      ok: unexpectedWarningsCount === 0,
      value: unexpectedWarningsCount,
      threshold: 0,
    },
  ]
  const failed = checks.filter((item) => item.ok !== true).map((item) => item.id)
  return {
    ok: failed.length === 0,
    checks,
    failedChecks: failed,
  }
}

function evaluateDiffusionMonotonicity(rows) {
  if (rows.length < 3) {
    return {
      ok: false,
      reason: 'insufficient_nu_levels',
      checks: [],
    }
  }
  const sorted = [...rows].sort((a, b) => a.physicalViscosityNu - b.physicalViscosityNu)
  const monotonic = sorted[0].enstrophyEnd >= sorted[1].enstrophyEnd && sorted[1].enstrophyEnd >= sorted[2].enstrophyEnd
  const finite = sorted.every((item) => item.nonFiniteDetected !== true)
  const checks = [
    { id: 'diffusion_enstrophy_monotonic', ok: monotonic, value: sorted.map((r) => r.enstrophyEnd).join(' -> '), threshold: 'non-increasing' },
    { id: 'diffusion_finite_metrics', ok: finite, value: finite ? 0 : 1, threshold: 0 },
  ]
  const failed = checks.filter((item) => item.ok !== true).map((item) => item.id)
  return {
    ok: failed.length === 0,
    checks,
    failedChecks: failed,
  }
}

function evaluateStretchingBoundedness(rows) {
  if (rows.length < 3) {
    return {
      ok: false,
      reason: 'insufficient_gain_levels',
      checks: [],
    }
  }
  const stepLatencyFail = rows.some((item) => item.stepP95Ms > 400)
  const nonFinite = rows.some((item) => item.nonFiniteDetected === true)
  const checks = [
    { id: 'stretching_step_p95_guard', ok: !stepLatencyFail, value: Math.max(...rows.map((r) => r.stepP95Ms)), threshold: 400 },
    { id: 'stretching_finite_metrics', ok: !nonFinite, value: nonFinite ? 1 : 0, threshold: 0 },
  ]
  const failed = checks.filter((item) => item.ok !== true).map((item) => item.id)
  return {
    ok: failed.length === 0,
    checks,
    failedChecks: failed,
  }
}

function toMarkdown(report) {
  const lines = []
  lines.push('# Physical realism baseline report')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push('')
  lines.push('## Scenario rows')
  lines.push('')
  lines.push('| Case | profile | nu | stretch | stepP95 | energyDrift | circulationDrift | enstrophyEnd | criticalRatio | unexpectedWarnings |')
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---|')
  report.rows.forEach((row) => {
    lines.push(
      `| ${row.title} | ${row.integrationProfile} | ${row.physicalViscosityNu.toFixed(6)} | ${row.physicalStretchingStrength.toFixed(3)} | ${row.stepP95Ms.toFixed(3)} | ${row.energyDriftPct.toFixed(3)} | ${row.circulationDriftPct.toFixed(3)} | ${row.enstrophyEnd.toFixed(3)} | ${row.criticalRatio.toFixed(3)} | ${row.unexpectedWarnings.join(', ') || '-'} |`,
    )
  })
  lines.push('')
  lines.push('## Checks')
  lines.push('')
  const sections = [
    ['Order sensitivity', report.orderSensitivity],
    ['Diffusion monotonicity', report.diffusionMonotonicity],
    ['Stretching boundedness', report.stretchingBoundedness],
  ]
  sections.forEach(([title, section]) => {
    lines.push(`### ${title}`)
    lines.push('')
    lines.push(`- status: ${section.ok ? 'PASS' : 'FAIL'}`)
    if (Array.isArray(section.failedChecks) && section.failedChecks.length > 0) {
      lines.push(`- failed: ${section.failedChecks.join(', ')}`)
    }
    if (Array.isArray(section.checks)) {
      section.checks.forEach((check) => {
        lines.push(`- ${check.id}: ${check.ok ? 'PASS' : 'FAIL'} (value=${check.value}, threshold=${check.threshold})`)
      })
    }
    lines.push('')
  })
  lines.push(`Overall gate: ${report.gate.pass ? 'PASS' : 'FAIL'}`)
  return lines.join('\n')
}

async function launchBrowser() {
  const options = {
    headless: PLAYWRIGHT_HEADLESS,
    args: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-angle=metal'],
  }
  if (PLAYWRIGHT_BROWSER_CHANNEL.length > 0) {
    return chromium.launch({
      ...options,
      channel: PLAYWRIGHT_BROWSER_CHANNEL,
    })
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

    const cases = [
      buildCaseConfig({ title: 'order.canonical', paramsPatch: { physicalIntegrationOrderProfile: 'canonical' } }),
      buildCaseConfig({ title: 'order.boundary_first', paramsPatch: { physicalIntegrationOrderProfile: 'boundary_first' } }),
      buildCaseConfig({ title: 'order.diffusion_first', paramsPatch: { physicalIntegrationOrderProfile: 'diffusion_first' } }),
      buildCaseConfig({ title: 'diffusion.nu_1e-4', paramsPatch: { physicalIntegrationOrderProfile: 'canonical', physicalViscosityNu: 0.0001 } }),
      buildCaseConfig({ title: 'diffusion.nu_5e-4', paramsPatch: { physicalIntegrationOrderProfile: 'canonical', physicalViscosityNu: 0.0005 } }),
      buildCaseConfig({ title: 'diffusion.nu_1e-3', paramsPatch: { physicalIntegrationOrderProfile: 'canonical', physicalViscosityNu: 0.001 } }),
      buildCaseConfig({ title: 'stretching.gain_0_5', paramsPatch: { physicalIntegrationOrderProfile: 'canonical', physicalStretchingStrength: 0.5 } }),
      buildCaseConfig({ title: 'stretching.gain_1_0', paramsPatch: { physicalIntegrationOrderProfile: 'canonical', physicalStretchingStrength: 1.0 } }),
      buildCaseConfig({ title: 'stretching.gain_1_5', paramsPatch: { physicalIntegrationOrderProfile: 'canonical', physicalStretchingStrength: 1.5 } }),
    ]

    const rows = []
    for (let i = 0; i < cases.length; i += 1) {
      const result = await runCase(page, cases[i])
      rows.push(summarizeCase(result))
    }

    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      rows,
    }
    report.orderSensitivity = evaluateOrderSensitivity(rows.filter((item) => item.title.startsWith('order.')))
    report.diffusionMonotonicity = evaluateDiffusionMonotonicity(rows.filter((item) => item.title.startsWith('diffusion.')))
    report.stretchingBoundedness = evaluateStretchingBoundedness(rows.filter((item) => item.title.startsWith('stretching.')))
    const failedGroups = [report.orderSensitivity, report.diffusionMonotonicity, report.stretchingBoundedness]
      .filter((item) => item.ok !== true)
      .map((item) => item.failedChecks ?? [item.reason ?? 'unknown'])
      .flat()
    report.gate = {
      pass: failedGroups.length === 0,
      failedChecks: failedGroups,
    }

    await fs.writeFile(OUTPUT_JSON, JSON.stringify(report, null, 2))
    await fs.writeFile(OUTPUT_MD, toMarkdown(report))
    console.table(
      rows.map((row) => ({
        case: row.title,
        profile: row.integrationProfile,
        nu: Number(row.physicalViscosityNu.toFixed(6)),
        stretch: Number(row.physicalStretchingStrength.toFixed(3)),
        stepP95Ms: Number(row.stepP95Ms.toFixed(3)),
        energyDriftPct: Number(row.energyDriftPct.toFixed(3)),
        circulationDriftPct: Number(row.circulationDriftPct.toFixed(3)),
        enstrophyEnd: Number(row.enstrophyEnd.toFixed(3)),
        criticalRatio: Number(row.criticalRatio.toFixed(3)),
        unexpectedWarnings: row.unexpectedWarnings.length,
      })),
    )
    if (FAIL_ON_GATE && report.gate.pass !== true) {
      throw new Error(`Physical realism baseline gate failed: ${report.gate.failedChecks.join(', ')}`)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
