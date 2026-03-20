import fs from 'node:fs/promises'
import { chromium } from 'playwright'

const BASE_URL = 'http://localhost:5173/'
const OUTPUT_JSON_URL = new URL('./scalability-profile-results.json', import.meta.url)
const OUTPUT_MD_URL = new URL('./scalability-profile-results.md', import.meta.url)

const TARGET_COUNTS = [10000, 50000, 100000]

const MODE_SCENARIOS = [
  {
    key: 'scripted_gpu',
    title: 'scripted GPU',
    modePatch: {
      dynamicsMode: 'scripted',
      executionMode: 'gpu',
      vortexRepresentation: 'particles',
      hybridPlusEnabled: false,
      gpuAutoQualityGuardEnabled: false,
    },
  },
  {
    key: 'natural',
    title: 'natural',
    modePatch: {
      dynamicsMode: 'guidedPhysics',
      executionMode: 'gpu',
      vortexRepresentation: 'particles',
      hybridPlusEnabled: false,
      gpuAutoQualityGuardEnabled: false,
    },
  },
  {
    key: 'natural_tubes',
    title: 'natural tubes',
    modePatch: {
      dynamicsMode: 'guidedPhysics',
      executionMode: 'cpu',
      vortexRepresentation: 'tubes',
      hybridPlusEnabled: false,
      gpuAutoQualityGuardEnabled: false,
    },
    paramsPatch: {
      emissionMode: 'tube',
      tubeViewMode: 'spine_particles',
      showTubeParticles: true,
      showTubeSurface: false,
      showTubeSpine: true,
    },
  },
  {
    key: 'hybrid_plus_assist',
    title: 'hybrid+ assist',
    modePatch: {
      dynamicsMode: 'fullPhysics',
      executionMode: 'hybrid',
      vortexRepresentation: 'hybrid',
      hybridPlusEnabled: true,
      gpuAutoQualityGuardEnabled: false,
    },
  },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function median(values) {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

function p95(values) {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))
  return sorted[idx]
}

function toPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`
}

function summarizeCase(caseResult) {
  const stepSamples = caseResult.samples.map((sample) => sample.stepMs).filter((value) => value > 0)
  const dispatchSamples = caseResult.samples.map((sample) => sample.dispatchCount).filter((value) => value >= 0)
  const gridBuildSamples = caseResult.samples
    .map((sample) => sample.gridBuildCount)
    .filter((value) => value >= 0)
  const overflowSamples = caseResult.samples.map((sample) => sample.overflowCount)
  const collisionRatioSamples = caseResult.samples.map((sample) => sample.collisionRatio)
  const tubeStepSamples = caseResult.samples
    .map((sample) => Number(sample.runtimeTubeStepMs ?? 0) || 0)
    .filter((value) => value > 0)
  const tubeSpeedAvgSamples = caseResult.samples.map((sample) => Number(sample.runtimeTubeSpeedAvg ?? 0) || 0)
  const tubeSpeedMaxSamples = caseResult.samples.map((sample) => Number(sample.runtimeTubeSpeedMax ?? 0) || 0)
  const tubeSourceFilamentSamples = caseResult.samples.map(
    (sample) => Number(sample.runtimeTubeFilamentContributionAvg ?? 0) || 0,
  )
  const tubeSourceVpmSamples = caseResult.samples.map(
    (sample) => Number(sample.runtimeTubeVpmContributionAvg ?? 0) || 0,
  )
  const tubeSourceSelfSamples = caseResult.samples.map(
    (sample) => Number(sample.runtimeTubeSelfContributionAvg ?? 0) || 0,
  )

  const stepMedian = median(stepSamples)
  const stepP95 = p95(stepSamples)
  const dispatchMedian = median(dispatchSamples)
  const gridBuildMedian = median(gridBuildSamples)
  const overflowMax = overflowSamples.length > 0 ? Math.max(...overflowSamples) : 0
  const collisionRatioMax = collisionRatioSamples.length > 0 ? Math.max(...collisionRatioSamples) : 0
  const tubeStepMedian = median(tubeStepSamples)
  const tubeStepP95 = p95(tubeStepSamples)
  const tubeSpeedAvgMedian = median(tubeSpeedAvgSamples)
  const tubeSpeedMaxMax = tubeSpeedMaxSamples.length > 0 ? Math.max(...tubeSpeedMaxSamples) : 0
  const tubeSourceFilamentAvg = median(tubeSourceFilamentSamples)
  const tubeSourceVpmAvg = median(tubeSourceVpmSamples)
  const tubeSourceSelfAvg = median(tubeSourceSelfSamples)
  const fpsFromMedian = stepMedian > 0 ? 1000 / stepMedian : 0

  return {
    requestedParticles: caseResult.requestedParticles,
    actualParticles: caseResult.actualParticles,
    mode: caseResult.mode,
    stepMedianMs: stepMedian,
    stepP95Ms: stepP95,
    dispatchMedian,
    gridBuildMedian,
    overflowMax,
    collisionRatioMax,
    syncViolationDelta: caseResult.syncViolationDelta,
    fullReadbackDelta: caseResult.fullReadbackDelta,
    skippedReadbackDelta: caseResult.skippedReadbackDelta,
    fpsApprox: fpsFromMedian,
    tubeCount: Math.max(0, Math.floor(caseResult.end?.runtimeTubeCount ?? 0)),
    tubeParticleCount: Math.max(0, Math.floor(caseResult.end?.runtimeTubeParticleCount ?? 0)),
    tubeProjectedCount: Math.max(0, Math.floor(caseResult.end?.runtimeTubeProjectedCount ?? 0)),
    tubeAverageRadius: Number(caseResult.end?.runtimeTubeAverageRadius ?? 0) || 0,
    tubeStepMedianMs: tubeStepMedian,
    tubeStepP95Ms: tubeStepP95,
    tubeSpeedAvgMedian,
    tubeSpeedMaxMax,
    tubeSourceFilamentAvg,
    tubeSourceVpmAvg,
    tubeSourceSelfAvg,
  }
}

function buildMarkdownTable(rows) {
  const header =
    '| Mode | N requested | N actual | step median (ms) | step p95 (ms) | dispatch~ | gridBuild~ | overflow max | collision ratio max | sync viol Δ | full/skipped Δ | FPS~ | tubes | tube particles | tube step~ (ms) | tube speed med/max |\n' +
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
  const lines = rows.map(
    (row) =>
      `| ${row.mode} | ${row.requestedParticles} | ${row.actualParticles} | ${row.stepMedianMs.toFixed(2)} | ${row.stepP95Ms.toFixed(2)} | ${row.dispatchMedian.toFixed(1)} | ${row.gridBuildMedian.toFixed(1)} | ${row.overflowMax} | ${toPercent(row.collisionRatioMax)} | ${row.syncViolationDelta} | ${row.fullReadbackDelta}/${row.skippedReadbackDelta} | ${row.fpsApprox.toFixed(1)} | ${row.tubeCount} | ${row.tubeParticleCount} | ${row.tubeStepMedianMs.toFixed(2)} | ${row.tubeSpeedAvgMedian.toFixed(3)}/${row.tubeSpeedMaxMax.toFixed(3)} |`,
  )
  return [header, ...lines].join('\n')
}

function inferBottleneck(row) {
  if (row.overflowMax > 0) {
    return 'hash overflow pressure'
  }
  if (row.collisionRatioMax >= 0.2) {
    return 'hash collisions / load'
  }
  if (row.stepP95Ms >= 33) {
    return 'compute step latency'
  }
  if (row.syncViolationDelta > 0 || row.fullReadbackDelta > row.skippedReadbackDelta) {
    return 'cpu-gpu sync/readback pressure'
  }
  return 'no dominant bottleneck detected'
}

function inferRecommendation(row) {
  if (row.overflowMax > 0 || row.collisionRatioMax >= 0.2) {
    return 'raise hash capacity policy (table/bucket) and reduce dense burst zones'
  }
  if (row.stepP95Ms >= 33) {
    return 'trim optional GPU passes for heavy modes and keep diagnostics readback sparse'
  }
  if (row.syncViolationDelta > 0 || row.fullReadbackDelta > row.skippedReadbackDelta) {
    return 'keep relaxed policy for pure GPU particles, strict only where CPU coupling is required'
  }
  return 'current settings are stable for this load'
}

async function runCase(page, scenario, requestedParticles) {
  return page.evaluate(
    async ({ scenarioInner, requestedParticlesInner }) => {
      const api = window.__torusTestApi
      if (!api) {
        throw new Error('__torusTestApi is unavailable')
      }

      api.pulse('stop')
      api.setMode(scenarioInner.modePatch)
      api.setParams({
        uiLanguage: 'en',
        emissionMode: scenarioInner.paramsPatch?.emissionMode ?? 'particleStream',
        particleCount: requestedParticlesInner,
        vectorDisplayMode: 'particles',
        showVectors: false,
        showBoth: false,
        ...(scenarioInner.paramsPatch ?? {}),
      })
      api.resetParticles()
      await api.waitForMs(250)
      api.pulse('singleBurst')

      await api.waitForMs(4000)

      const start = api.getRuntimeDiagnostics()
      const startParams = api.getParams()
      const samples = []

      for (let i = 0; i < 24; i += 1) {
        await api.waitForMs(250)
        samples.push(api.getRuntimeDiagnostics())
      }

      const end = api.getRuntimeDiagnostics()
      const endParams = api.getParams()
      api.pulse('stop')

      return {
        mode: scenarioInner.title,
        requestedParticles: requestedParticlesInner,
        actualParticles: end.activeCount || end.runtimeParticleCount || 0,
        samples,
        syncViolationDelta:
          Math.max(0, (endParams.runtimeGpuSyncViolationCount ?? 0) - (startParams.runtimeGpuSyncViolationCount ?? 0)),
        fullReadbackDelta:
          Math.max(0, (endParams.runtimeGpuFullReadbackCount ?? 0) - (startParams.runtimeGpuFullReadbackCount ?? 0)),
        skippedReadbackDelta:
          Math.max(
            0,
            (endParams.runtimeGpuSkippedReadbackCount ?? 0) -
              (startParams.runtimeGpuSkippedReadbackCount ?? 0),
          ),
        start,
        end,
      }
    },
    { scenarioInner: scenario, requestedParticlesInner: requestedParticles },
  )
}

async function main() {
  const customExecutablePath =
    typeof process.env.PLAYWRIGHT_EXECUTABLE_PATH === 'string'
      ? process.env.PLAYWRIGHT_EXECUTABLE_PATH.trim()
      : ''
  const browser = await chromium.launch({
    headless: true,
    ...(customExecutablePath ? { executablePath: customExecutablePath } : {}),
  })
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  })
  await context.addInitScript(() => {
    localStorage.setItem('toroidalVortexParams', JSON.stringify({ uiLanguage: 'en' }))
  })
  const page = await context.newPage()
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  let apiReady = false
  for (let attempt = 0; attempt < 40; attempt += 1) {
    apiReady = await page.evaluate(() => Boolean(window.__torusTestApi))
    if (apiReady) {
      break
    }
    await sleep(250)
  }
  if (!apiReady) {
    throw new Error('__torusTestApi did not initialize in time')
  }
  await sleep(1500)
  const gpuAvailable = await page.evaluate(() => window.__torusTestApi?.getParams()?.gpuAvailable === true)
  if (!gpuAvailable) {
    throw new Error(
      'GPU backend is unavailable in this Playwright session. Run this script in an environment where WebGPU is enabled.',
    )
  }

  const rawResults = []
  for (const requestedParticles of TARGET_COUNTS) {
    for (const scenario of MODE_SCENARIOS) {
      const run = await runCase(page, scenario, requestedParticles)
      rawResults.push(run)
    }
  }

  const summaryRows = rawResults.map(summarizeCase)
  const bottlenecks = summaryRows.map((row) => ({
    ...row,
    bottleneck: inferBottleneck(row),
    recommendation: inferRecommendation(row),
  }))

  const cappedRows = summaryRows.filter((row) => row.actualParticles < row.requestedParticles)
  const payload = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    targetCounts: TARGET_COUNTS,
    modeScenarios: MODE_SCENARIOS.map((scenario) => scenario.title),
    notes: [
      'N actual reflects runtime active particles after normalization and burst emission.',
      'Requested 100000 is expected to clamp to project max particleCount (50000).',
    ],
    cappedRows,
    summaryRows,
    bottlenecks,
    rawResults,
  }

  await fs.writeFile(OUTPUT_JSON_URL, JSON.stringify(payload, null, 2))

  const markdown = [
    '# Scalability profile',
    '',
    `Generated: ${payload.generatedAt}`,
    '',
    '## Main metrics',
    '',
    buildMarkdownTable(summaryRows),
    '',
    '## Bottlenecks and target replacements',
    '',
    '| Mode | N actual | Bottleneck | Recommendation |',
    '|---|---:|---|---|',
    ...bottlenecks.map(
      (row) => `| ${row.mode} | ${row.actualParticles} | ${row.bottleneck} | ${row.recommendation} |`,
    ),
    '',
  ].join('\n')
  await fs.writeFile(OUTPUT_MD_URL, markdown)

  console.table(
    summaryRows.map((row) => ({
      mode: row.mode,
      requestedN: row.requestedParticles,
      actualN: row.actualParticles,
      stepMedianMs: Number(row.stepMedianMs.toFixed(2)),
      stepP95Ms: Number(row.stepP95Ms.toFixed(2)),
      dispatch: Number(row.dispatchMedian.toFixed(1)),
      gridBuild: Number(row.gridBuildMedian.toFixed(1)),
      overflowMax: row.overflowMax,
      collisionRatioMaxPct: Number((row.collisionRatioMax * 100).toFixed(1)),
      syncViolDelta: row.syncViolationDelta,
      readbackDelta: `${row.fullReadbackDelta}/${row.skippedReadbackDelta}`,
      fpsApprox: Number(row.fpsApprox.toFixed(1)),
      tubeCount: row.tubeCount,
      tubeParticles: row.tubeParticleCount,
      tubeStepMedianMs: Number(row.tubeStepMedianMs.toFixed(2)),
      tubeSpeedMedMax: `${row.tubeSpeedAvgMedian.toFixed(3)}/${row.tubeSpeedMaxMax.toFixed(3)}`,
    })),
  )

  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
