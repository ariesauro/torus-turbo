import fs from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

import { computeVelocityBiotSavart } from '../src/simulation/physics/vpm/biotSavart.js'
import { computeVelocityBiotSavartSpatial } from '../src/simulation/physics/spatialAcceleration/biotSavartSpatial.js'
import { computeVelocityBiotSavartFMM } from '../src/simulation/physics/fmm/biotSavartFmm.js'

const OUTPUT_JSON_URL = new URL('./fmm-benchmark-matrix.json', import.meta.url)
const OUTPUT_MD_URL = new URL('./fmm-benchmark-matrix.md', import.meta.url)

const TARGET_COUNTS =
  typeof process.env.FMM_MATRIX_COUNTS === 'string' && process.env.FMM_MATRIX_COUNTS.trim().length > 0
    ? process.env.FMM_MATRIX_COUNTS.split(',')
        .map((v) => Math.max(1000, Math.floor(Number(v) || 0)))
        .filter((v) => Number.isFinite(v) && v > 0)
    : [10_000, 50_000, 100_000, 500_000]
const EXACT_FULL_LIMIT = Math.max(2000, Number(process.env.FMM_MATRIX_EXACT_FULL_LIMIT ?? 10_000) || 10_000)
const SPATIAL_FULL_LIMIT = Math.max(
  2000,
  Number(process.env.FMM_MATRIX_SPATIAL_FULL_LIMIT ?? 50_000) || 50_000,
)
const FMM_FULL_LIMIT = Math.max(2000, Number(process.env.FMM_MATRIX_FMM_FULL_LIMIT ?? 50_000) || 50_000)
const REFERENCE_BLOCK_SIZE = Math.max(
  512,
  Number(process.env.FMM_MATRIX_REFERENCE_BLOCK_SIZE ?? 4096) || 4096,
)
const REFERENCE_TARGET_COUNT = Math.max(
  64,
  Number(process.env.FMM_MATRIX_REFERENCE_TARGET_COUNT ?? 256) || 256,
)
const FAIL_ON_GATE = String(process.env.FMM_MATRIX_FAIL_ON_GATE ?? 'false') === 'true'
const GATE_REL_RMSE_SPATIAL = Math.max(
  0.01,
  Number(process.env.FMM_MATRIX_GATE_REL_RMSE_SPATIAL ?? 0.42) || 0.42,
)
const GATE_REL_RMSE_FMM = Math.max(0.01, Number(process.env.FMM_MATRIX_GATE_REL_RMSE_FMM ?? 0.38) || 0.38)
const GATE_SPEEDUP_MIN_FMM = Math.max(0.1, Number(process.env.FMM_MATRIX_GATE_SPEEDUP_MIN_FMM ?? 1.15) || 1.15)

const SOLVERS = [
  { id: 'exact', title: 'Naive exact', fn: computeVelocityBiotSavart },
  { id: 'spatialGrid', title: 'Spatial grid', fn: computeVelocityBiotSavartSpatial },
  { id: 'fmm', title: 'FMM', fn: computeVelocityBiotSavartFMM },
]

function mulberry32(seed) {
  let t = seed >>> 0
  return function next() {
    t += 0x6d2b79f5
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) * 0.5 : sorted[mid]
}

function p95(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))
  return sorted[index]
}

function makeParams() {
  return {
    useBiotSavart: true,
    timeScale: 1,
    pulseDuration: 1e-4,
    gamma: 4.8,
    coreRadiusSigma: 0.04,
    minCoreRadius: 0.008,
    interactionRadius: 0,
    dynamicsMode: 'guidedPhysics',
    cellSizeMultiplier: 4,
    neighborCellRange: 1,
    aggregationDistance: 2,
    fmmTheta: 0.65,
    fmmLeafSize: 16,
    fmmSoftening: 0.02,
    hybridPlusBarnesHutTheta: 0.65,
  }
}

function generateParticles(count, seed = 1337) {
  const random = mulberry32(seed)
  const particles = new Array(count)
  for (let i = 0; i < count; i += 1) {
    const r = 0.65 + random() * 0.65
    const a = random() * Math.PI * 2
    const z = (random() - 0.5) * 1.2
    const jitter = (random() - 0.5) * 0.04
    const x = Math.cos(a) * r + jitter
    const y = Math.sin(a) * r + jitter
    const omegaScale = 0.6 + random() * 0.8
    particles[i] = {
      id: i + 1,
      x,
      y,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      age: 1,
      gamma: 4 + random() * 1.5,
      coreRadius: 0.02 + random() * 0.05,
      vorticity: {
        x: -(y * 0.8 + z * 0.1) * omegaScale,
        y: (x * 0.8 - z * 0.1) * omegaScale,
        z: (1 - clamp(r * 0.45, 0, 1)) * omegaScale,
      },
    }
  }
  return particles
}

function cloneParticles(particles) {
  return particles.map((p) => ({
    ...p,
    vorticity: { ...(p.vorticity ?? { x: 0, y: 0, z: 0 }) },
  }))
}

function benchmarkSolver({ particles, params, solverFn, repeats }) {
  const samplesMs = []
  const ppsSamples = []
  for (let i = 0; i < repeats; i += 1) {
    const localParticles = cloneParticles(particles)
    const t0 = performance.now()
    solverFn(localParticles, params)
    const elapsedMs = Math.max(1e-6, performance.now() - t0)
    samplesMs.push(elapsedMs)
    ppsSamples.push(localParticles.length / (elapsedMs / 1000))
  }
  return {
    repeats,
    stepMsMedian: median(samplesMs),
    stepMsP95: p95(samplesMs),
    throughputPpsMedian: median(ppsSamples),
    throughputPpsP95: p95(ppsSamples),
  }
}

function buildReferenceBlock(particles, blockSize, seed = 4242) {
  if (particles.length <= blockSize) {
    return cloneParticles(particles)
  }
  const random = mulberry32(seed ^ particles.length)
  const used = new Set()
  const block = []
  while (block.length < blockSize) {
    const idx = Math.floor(random() * particles.length)
    if (used.has(idx)) continue
    used.add(idx)
    const p = particles[idx]
    block.push({
      ...p,
      id: block.length + 1,
      vorticity: { ...(p.vorticity ?? { x: 0, y: 0, z: 0 }) },
    })
  }
  return block
}

function computeReferenceAccuracy({ particles, params }) {
  const exactParticles = cloneParticles(particles)
  const spatialParticles = cloneParticles(particles)
  const fmmParticles = cloneParticles(particles)

  const tExact0 = performance.now()
  computeVelocityBiotSavart(exactParticles, params)
  const tExact = performance.now() - tExact0

  const tSpatial0 = performance.now()
  computeVelocityBiotSavartSpatial(spatialParticles, params)
  const tSpatial = performance.now() - tSpatial0

  const tFmm0 = performance.now()
  computeVelocityBiotSavartFMM(fmmParticles, params)
  const tFmm = performance.now() - tFmm0

  const targetCount = Math.min(REFERENCE_TARGET_COUNT, exactParticles.length)
  const metrics = {
    spatialGrid: {
      absSum: 0,
      absMax: 0,
      relSqSum: 0,
      relCount: 0,
    },
    fmm: {
      absSum: 0,
      absMax: 0,
      relSqSum: 0,
      relCount: 0,
    },
  }

  for (let i = 0; i < targetCount; i += 1) {
    const ex = exactParticles[i]
    const exVecMag = Math.hypot(ex.flowVx ?? 0, ex.flowVy ?? 0, ex.flowVz ?? 0)
    for (const [mode, arr] of [
      ['spatialGrid', spatialParticles],
      ['fmm', fmmParticles],
    ]) {
      const cur = arr[i]
      const dx = (cur.flowVx ?? 0) - (ex.flowVx ?? 0)
      const dy = (cur.flowVy ?? 0) - (ex.flowVy ?? 0)
      const dz = (cur.flowVz ?? 0) - (ex.flowVz ?? 0)
      const absErr = Math.hypot(dx, dy, dz)
      metrics[mode].absSum += absErr
      metrics[mode].absMax = Math.max(metrics[mode].absMax, absErr)
      const relErr = absErr / Math.max(1e-9, exVecMag)
      metrics[mode].relSqSum += relErr * relErr
      metrics[mode].relCount += 1
    }
  }

  return {
    sampleSize: particles.length,
    targetCount,
    referenceTimingsMs: {
      exact: tExact,
      spatialGrid: tSpatial,
      fmm: tFmm,
    },
    metrics: {
      spatialGrid: {
        mae: metrics.spatialGrid.absSum / Math.max(1, metrics.spatialGrid.relCount),
        maxAbsErr: metrics.spatialGrid.absMax,
        relRmse: Math.sqrt(metrics.spatialGrid.relSqSum / Math.max(1, metrics.spatialGrid.relCount)),
      },
      fmm: {
        mae: metrics.fmm.absSum / Math.max(1, metrics.fmm.relCount),
        maxAbsErr: metrics.fmm.absMax,
        relRmse: Math.sqrt(metrics.fmm.relSqSum / Math.max(1, metrics.fmm.relCount)),
      },
    },
  }
}

function inferRepeats(n) {
  if (n <= 10_000) return 3
  if (n <= 100_000) return 2
  return 1
}

function buildMarkdown(payload) {
  const lines = [
    '# FMM benchmark matrix',
    '',
    `Generated: ${payload.generatedAt}`,
    '',
    '## Full-step performance',
    '',
    '| N | Solver | repeats | step median/p95 (ms) | throughput median (pps) | speedup vs exact | note |',
    '|---:|---|---:|---:|---:|---:|---|',
  ]
  for (const row of payload.rows) {
    const speedup = Number.isFinite(row.speedupVsExact) ? row.speedupVsExact.toFixed(2) : '-'
    lines.push(
      `| ${row.n} | ${row.solver} | ${row.repeats} | ${row.stepMsMedian.toFixed(2)}/${row.stepMsP95.toFixed(2)} | ${Math.round(row.throughputPpsMedian)} | ${speedup} | ${row.note ?? '-'} |`,
    )
  }
  lines.push(
    '',
    '## Accuracy on exact reference block',
    '',
    '| N | block size | targets | Solver | rel RMSE | MAE | max abs err | ref speedup vs exact (block) |',
    '|---:|---:|---:|---|---:|---:|---:|---:|',
  )
  for (const acc of payload.accuracyRows) {
    lines.push(
      `| ${acc.n} | ${acc.sampleSize} | ${acc.targetCount} | ${acc.solver} | ${acc.relRmse.toFixed(4)} | ${acc.mae.toExponential(3)} | ${acc.maxAbsErr.toExponential(3)} | ${acc.referenceSpeedupVsExact.toFixed(2)} |`,
    )
  }
  lines.push(
    '',
    '## Gates',
    '',
    `- spatial relRMSE <= ${GATE_REL_RMSE_SPATIAL}`,
    `- fmm relRMSE <= ${GATE_REL_RMSE_FMM}`,
    `- fmm speedup vs exact (for N<=${EXACT_FULL_LIMIT}) >= ${GATE_SPEEDUP_MIN_FMM}`,
    `- full benchmark limits: exact<=${EXACT_FULL_LIMIT}, spatial<=${SPATIAL_FULL_LIMIT}, fmm<=${FMM_FULL_LIMIT}`,
    '',
    `Gate verdict: ${payload.gate.pass ? 'PASS' : 'FAIL'}`,
  )
  if (payload.gate.failedChecks.length > 0) {
    lines.push(`Failed checks: ${payload.gate.failedChecks.join(', ')}`)
  }
  return lines.join('\n')
}

function evaluateGate(payload) {
  const failedChecks = []
  for (const row of payload.accuracyRows) {
    if (row.solver === 'spatialGrid' && row.relRmse > GATE_REL_RMSE_SPATIAL) {
      failedChecks.push(`spatial_rel_rmse_n${row.n}`)
    }
    if (row.solver === 'fmm' && row.relRmse > GATE_REL_RMSE_FMM) {
      failedChecks.push(`fmm_rel_rmse_n${row.n}`)
    }
  }
  for (const row of payload.rows) {
    if (row.solver === 'fmm' && row.speedupVsExact != null && row.speedupVsExact < GATE_SPEEDUP_MIN_FMM) {
      failedChecks.push(`fmm_speedup_n${row.n}`)
    }
  }
  return {
    pass: failedChecks.length === 0,
    failedChecks,
  }
}

async function main() {
  const params = makeParams()
  const rows = []
  const accuracyRows = []

  for (const n of TARGET_COUNTS) {
    console.log(`[fmm-matrix] N=${n} generating particles...`)
    const particles = generateParticles(n, 1337 + n)
    const repeats = inferRepeats(n)

    for (const solver of SOLVERS) {
      const shouldSkip =
        (solver.id === 'exact' && n > EXACT_FULL_LIMIT) ||
        (solver.id === 'spatialGrid' && n > SPATIAL_FULL_LIMIT) ||
        (solver.id === 'fmm' && n > FMM_FULL_LIMIT)
      if (shouldSkip) {
        const limitBySolver = solver.id === 'exact' ? EXACT_FULL_LIMIT : solver.id === 'spatialGrid' ? SPATIAL_FULL_LIMIT : FMM_FULL_LIMIT
        rows.push({
          n,
          solver: solver.id,
          repeats: 0,
          stepMsMedian: Number.NaN,
          stepMsP95: Number.NaN,
          throughputPpsMedian: Number.NaN,
          speedupVsExact: null,
          note: `skipped_full_above_${limitBySolver}`,
        })
        continue
      }
      console.log(`[fmm-matrix] N=${n} solver=${solver.id} ...`)
      const result = benchmarkSolver({
        particles,
        params,
        solverFn: solver.fn,
        repeats,
      })
      rows.push({
        n,
        solver: solver.id,
        repeats: result.repeats,
        stepMsMedian: result.stepMsMedian,
        stepMsP95: result.stepMsP95,
        throughputPpsMedian: result.throughputPpsMedian,
        speedupVsExact: null,
        note: '',
      })
    }

    const exactFull = rows.find((r) => r.n === n && r.solver === 'exact')
    if (exactFull && Number.isFinite(exactFull.stepMsMedian)) {
      for (const row of rows) {
        if (row.n !== n || !Number.isFinite(row.stepMsMedian)) continue
        row.speedupVsExact = exactFull.stepMsMedian / Math.max(1e-9, row.stepMsMedian)
      }
    }

    const referenceBlock = buildReferenceBlock(particles, Math.min(REFERENCE_BLOCK_SIZE, n), 4242 + n)
    const accuracy = computeReferenceAccuracy({ particles: referenceBlock, params })
    for (const solver of ['spatialGrid', 'fmm']) {
      const modeMetrics = accuracy.metrics[solver]
      const refSpeedup =
        accuracy.referenceTimingsMs.exact / Math.max(1e-9, accuracy.referenceTimingsMs[solver] ?? Number.NaN)
      accuracyRows.push({
        n,
        sampleSize: accuracy.sampleSize,
        targetCount: accuracy.targetCount,
        solver,
        relRmse: modeMetrics.relRmse,
        mae: modeMetrics.mae,
        maxAbsErr: modeMetrics.maxAbsErr,
        referenceSpeedupVsExact: refSpeedup,
      })
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    config: {
      targetCounts: TARGET_COUNTS,
      exactFullLimit: EXACT_FULL_LIMIT,
      spatialFullLimit: SPATIAL_FULL_LIMIT,
      fmmFullLimit: FMM_FULL_LIMIT,
      referenceBlockSize: REFERENCE_BLOCK_SIZE,
      referenceTargetCount: REFERENCE_TARGET_COUNT,
      gates: {
        spatialRelRmseMax: GATE_REL_RMSE_SPATIAL,
        fmmRelRmseMax: GATE_REL_RMSE_FMM,
        fmmSpeedupMin: GATE_SPEEDUP_MIN_FMM,
      },
    },
    rows,
    accuracyRows,
  }
  payload.gate = evaluateGate(payload)

  await fs.writeFile(OUTPUT_JSON_URL, JSON.stringify(payload, null, 2))
  await fs.writeFile(OUTPUT_MD_URL, buildMarkdown(payload))

  console.table(
    rows
      .filter((r) => Number.isFinite(r.stepMsMedian))
      .map((r) => ({
        N: r.n,
        solver: r.solver,
        stepMs: Number(r.stepMsMedian.toFixed(2)),
        p95: Number(r.stepMsP95.toFixed(2)),
        throughput: Math.round(r.throughputPpsMedian),
        speedupVsExact: Number.isFinite(r.speedupVsExact) ? Number(r.speedupVsExact.toFixed(2)) : null,
      })),
  )
  console.table(
    accuracyRows.map((r) => ({
      N: r.n,
      solver: r.solver,
      relRmse: Number(r.relRmse.toFixed(4)),
      mae: Number(r.mae.toExponential(3)),
      maxAbsErr: Number(r.maxAbsErr.toExponential(3)),
      refSpeedup: Number(r.referenceSpeedupVsExact.toFixed(2)),
    })),
  )
  console.log(`[fmm-matrix] gate=${payload.gate.pass ? 'PASS' : 'FAIL'} checks=${payload.gate.failedChecks.join(',') || '-'}`)

  if (FAIL_ON_GATE && payload.gate.pass !== true) {
    throw new Error(`FMM matrix gate failed: ${payload.gate.failedChecks.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
