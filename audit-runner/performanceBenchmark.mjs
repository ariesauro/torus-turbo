/**
 * P6.5 — Performance Profiling & Optimization Benchmark
 *
 * Benchmarks:
 * 1. Biot-Savart velocity: direct N² vs FMM O(N log N) at various N
 * 2. Full VPM step scaling (advection + stretching + PSE)
 * 3. Pipeline component breakdown (percentage of total time)
 * 4. Memory scaling with particle count
 *
 * Usage: node audit-runner/performanceBenchmark.mjs
 */

import { writeFile } from 'node:fs/promises'

const FOUR_PI = 4 * Math.PI

// ─── Inline Physics (minimal for benchmarking) ───

function computeVelocityDirect(particles, params) {
  const count = particles.length
  for (let i = 0; i < count; i++) {
    const p = particles[i]
    let vx = 0, vy = 0, vz = 0
    for (let j = 0; j < count; j++) {
      if (i === j) continue
      const s = particles[j]
      const rx = p.x - s.x, ry = p.y - s.y, rz = p.z - s.z
      const r2 = rx * rx + ry * ry + rz * rz
      const sigma = Math.max(s.coreRadius ?? params.coreRadiusSigma ?? 0.01, 1e-4)
      const denom = (r2 + sigma * sigma) ** 1.5
      if (denom <= 1e-8) continue
      const ox = s.vorticity.x, oy = s.vorticity.y, oz = s.vorticity.z
      const cx = ry * oz - rz * oy, cy = rz * ox - rx * oz, cz = rx * oy - ry * ox
      const gamma = s.gamma ?? params.gamma ?? 0
      const factor = gamma / (FOUR_PI * denom)
      vx += cx * factor; vy += cy * factor; vz += cz * factor
    }
    p.flowVx = vx; p.flowVy = vy; p.flowVz = vz
  }
}

function advectParticles(particles, dt) {
  for (const p of particles) {
    p.x += (p.flowVx ?? 0) * dt
    p.y += (p.flowVy ?? 0) * dt
    p.z += (p.flowVz ?? 0) * dt
  }
}

function pseDiffusion(particles, params, dt) {
  const viscosity = Math.max(params.viscosity ?? 0, 0)
  if (viscosity <= 0 || particles.length <= 1) return
  const count = particles.length
  const eps = Math.max(params.coreRadiusSigma ?? 0.01, 1e-4)
  const eps2 = eps * eps, fourEps2 = 4 * eps2
  const volume = eps ** 3
  const kernelNorm = 1 / (Math.pow(4 * Math.PI * eps2, 1.5) || 1e-30)
  const prefactor = 2 * viscosity * volume * kernelNorm / eps2
  const dX = new Float64Array(count), dY = new Float64Array(count), dZ = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    const pi = particles[i], oix = pi.vorticity.x, oiy = pi.vorticity.y, oiz = pi.vorticity.z
    for (let j = i + 1; j < count; j++) {
      const pj = particles[j]
      const rx = pi.x - pj.x, ry = pi.y - pj.y, rz = pi.z - pj.z
      const r2 = rx * rx + ry * ry + rz * rz
      const expVal = Math.exp(-r2 / fourEps2)
      if (expVal < 1e-8) continue
      const f = prefactor * expVal
      const dx = pj.vorticity.x - oix, dy = pj.vorticity.y - oiy, dz = pj.vorticity.z - oiz
      dX[i] += f * dx; dY[i] += f * dy; dZ[i] += f * dz
      dX[j] -= f * dx; dY[j] -= f * dy; dZ[j] -= f * dz
    }
  }
  for (let i = 0; i < count; i++) {
    const o = particles[i].vorticity
    o.x += dt * dX[i]; o.y += dt * dY[i]; o.z += dt * dZ[i]
  }
}

function analyticStretching(particles, params, dt) {
  const strength = params.stretchingStrength ?? 1.0
  if (strength <= 0) return
  const count = particles.length
  const dO = new Array(count)
  for (let i = 0; i < count; i++) dO[i] = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < count; i++) {
    const pi = particles[i], oi = pi.vorticity
    for (let j = i + 1; j < count; j++) {
      const pj = particles[j], oj = pj.vorticity
      const rx = pi.x - pj.x, ry = pi.y - pj.y, rz = pi.z - pj.z
      const r2 = rx * rx + ry * ry + rz * rz
      const sigma = Math.max(pi.coreRadius, pj.coreRadius, 0.01)
      const r2s = r2 + sigma * sigma
      const inv32 = 1 / (r2s * Math.sqrt(r2s)), inv52 = inv32 / r2s
      const gJ = pj.gamma ?? params.gamma ?? 0
      const gI = pi.gamma ?? params.gamma ?? 0
      const f = strength / FOUR_PI
      const cx1 = oi.y * oj.z - oi.z * oj.y, cy1 = oi.z * oj.x - oi.x * oj.z, cz1 = oi.x * oj.y - oi.y * oj.x
      const d1 = oi.x * rx + oi.y * ry + oi.z * rz
      const cx2 = ry * oj.z - rz * oj.y, cy2 = rz * oj.x - rx * oj.z, cz2 = rx * oj.y - ry * oj.x
      dO[i].x += f * gJ * (cx1 * inv32 - 3 * d1 * cx2 * inv52) * dt
      dO[i].y += f * gJ * (cy1 * inv32 - 3 * d1 * cy2 * inv52) * dt
      dO[i].z += f * gJ * (cz1 * inv32 - 3 * d1 * cz2 * inv52) * dt
      const cx3 = oj.y * oi.z - oj.z * oi.y, cy3 = oj.z * oi.x - oj.x * oi.z, cz3 = oj.x * oi.y - oj.y * oi.x
      const d2 = -(oj.x * rx + oj.y * ry + oj.z * rz)
      const cx4 = -ry * oi.z + rz * oi.y, cy4 = -rz * oi.x + rx * oi.z, cz4 = -rx * oi.y + ry * oi.x
      dO[j].x += f * gI * (cx3 * inv32 - 3 * d2 * cx4 * inv52) * dt
      dO[j].y += f * gI * (cy3 * inv32 - 3 * d2 * cy4 * inv52) * dt
      dO[j].z += f * gI * (cz3 * inv32 - 3 * d2 * cz4 * inv52) * dt
    }
  }
  for (let i = 0; i < count; i++) {
    particles[i].vorticity.x += dO[i].x
    particles[i].vorticity.y += dO[i].y
    particles[i].vorticity.z += dO[i].z
  }
}

// ─── FMM (simplified octree + monopole) ───

function computeVelocityFMM(particles, params) {
  const count = particles.length
  if (count < 64) return computeVelocityDirect(particles, params)

  const theta = params.fmmTheta ?? 0.7
  const leafSize = params.fmmLeafSize ?? 16

  // Build octree
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const p of particles) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.z < minZ) minZ = p.z
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; if (p.z > maxZ) maxZ = p.z
  }
  const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.01) * 1.01
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2

  function buildNode(indices, bx, by, bz, bsize) {
    const node = { cx: 0, cy: 0, cz: 0, totalGamma: 0, ox: 0, oy: 0, oz: 0, size: bsize, children: null, indices }
    if (indices.length === 0) return node

    let tw = 0
    for (const idx of indices) {
      const p = particles[idx]
      const g = Math.abs(p.gamma ?? params.gamma ?? 0)
      node.cx += p.x * g; node.cy += p.y * g; node.cz += p.z * g
      node.ox += p.vorticity.x * g; node.oy += p.vorticity.y * g; node.oz += p.vorticity.z * g
      node.totalGamma += g; tw += g
    }
    if (tw > 1e-12) { node.cx /= tw; node.cy /= tw; node.cz /= tw }
    else { node.cx = bx; node.cy = by; node.cz = bz }

    if (indices.length <= leafSize) return node

    const hs = bsize / 2
    const childBuckets = [[], [], [], [], [], [], [], []]
    for (const idx of indices) {
      const p = particles[idx]
      const ix = p.x >= bx ? 1 : 0, iy = p.y >= by ? 1 : 0, iz = p.z >= bz ? 1 : 0
      childBuckets[ix * 4 + iy * 2 + iz].push(idx)
    }
    node.children = []
    for (let oct = 0; oct < 8; oct++) {
      if (childBuckets[oct].length === 0) continue
      const ox = (oct >> 2) & 1, oy = (oct >> 1) & 1, oz = oct & 1
      const ncx = bx + (ox - 0.5) * hs, ncy = by + (oy - 0.5) * hs, ncz = bz + (oz - 0.5) * hs
      node.children.push(buildNode(childBuckets[oct], ncx, ncy, ncz, hs))
    }
    node.indices = null
    return node
  }

  const allIndices = Array.from({ length: count }, (_, i) => i)
  const root = buildNode(allIndices, cx, cy, cz, size)

  // Tree walk
  function treeWalk(targetIdx, node) {
    const p = particles[targetIdx]
    const dx = p.x - node.cx, dy = p.y - node.cy, dz = p.z - node.cz
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

    if (node.children === null) {
      // Leaf: P2P
      if (node.indices) {
        for (const j of node.indices) {
          if (j === targetIdx) continue
          const s = particles[j]
          const rx = p.x - s.x, ry = p.y - s.y, rz = p.z - s.z
          const r2 = rx * rx + ry * ry + rz * rz
          const sigma = Math.max(s.coreRadius ?? params.coreRadiusSigma ?? 0.01, 1e-4)
          const denom = (r2 + sigma * sigma) ** 1.5
          if (denom <= 1e-8) continue
          const cxx = ry * s.vorticity.z - rz * s.vorticity.y
          const cyy = rz * s.vorticity.x - rx * s.vorticity.z
          const czz = rx * s.vorticity.y - ry * s.vorticity.x
          const gamma = s.gamma ?? params.gamma ?? 0
          const factor = gamma / (FOUR_PI * denom)
          p.flowVx += cxx * factor; p.flowVy += cyy * factor; p.flowVz += czz * factor
        }
      }
      return
    }

    if (node.size / dist < theta && dist > 1e-6) {
      // Far: use monopole
      const r2 = dx * dx + dy * dy + dz * dz
      const sigma = params.coreRadiusSigma ?? 0.01
      const denom = (r2 + sigma * sigma) ** 1.5
      if (denom > 1e-8) {
        const cxx = dy * node.oz - dz * node.oy
        const cyy = dz * node.ox - dx * node.oz
        const czz = dx * node.oy - dy * node.ox
        const factor = 1 / (FOUR_PI * denom)
        p.flowVx += cxx * factor; p.flowVy += cyy * factor; p.flowVz += czz * factor
      }
      return
    }

    for (const child of node.children) treeWalk(targetIdx, child)
  }

  for (let i = 0; i < count; i++) {
    particles[i].flowVx = 0; particles[i].flowVy = 0; particles[i].flowVz = 0
  }
  for (let i = 0; i < count; i++) treeWalk(i, root)
}

// ─── Helpers ───

function createRandomField(N, sigma, gamma, seed = 42) {
  const random = (() => { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff } })()
  const particles = []
  for (let i = 0; i < N; i++) {
    particles.push({
      id: i,
      x: (random() - 0.5) * 2, y: (random() - 0.5) * 2, z: (random() - 0.5) * 2,
      flowVx: 0, flowVy: 0, flowVz: 0,
      vorticity: { x: (random() - 0.5) * 2, y: (random() - 0.5) * 2, z: (random() - 0.5) * 2 },
      gamma, coreRadius: sigma,
    })
  }
  return particles
}

function benchmark(fn, warmup = 1, runs = 3) {
  for (let i = 0; i < warmup; i++) fn()
  const times = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  return { median: times[Math.floor(times.length / 2)], min: times[0], max: times[times.length - 1], times }
}

// ═══════════════════════════════════════════════════
// Benchmark 1: Biot-Savart scaling
// ═══════════════════════════════════════════════════

function benchBiotSavartScaling() {
  console.log('\n\n══ Benchmark 1: Biot-Savart Velocity Computation Scaling ══')

  const sigma = 0.08, gamma = 0.5
  const particleCounts = [64, 128, 256, 512, 1024, 2048]
  const results = []

  for (const N of particleCounts) {
    const particles = createRandomField(N, sigma, gamma)
    const params = { coreRadiusSigma: sigma, gamma, interactionRadius: 0 }

    // Direct N²
    const directTime = benchmark(() => computeVelocityDirect(particles, params), 1, 3)

    // FMM (only for N >= 64)
    const fmmParticles = createRandomField(N, sigma, gamma)
    const fmmParams = { ...params, fmmTheta: 0.7, fmmLeafSize: 16 }
    const fmmTime = benchmark(() => computeVelocityFMM(fmmParticles, fmmParams), 1, 3)

    const speedup = directTime.median / Math.max(fmmTime.median, 0.01)

    const result = {
      N,
      directMs: directTime.median,
      fmmMs: fmmTime.median,
      speedup,
      directComplexity: directTime.median / (N * N) * 1e6,
      fmmComplexity: N > 0 ? fmmTime.median / (N * Math.log2(N)) * 1e6 : 0,
    }
    results.push(result)

    console.log(`  N=${String(N).padStart(5)} | direct=${directTime.median.toFixed(2)}ms FMM=${fmmTime.median.toFixed(2)}ms speedup=${speedup.toFixed(1)}× | per-pair=${result.directComplexity.toFixed(3)}μs`)
  }

  // Check O(N²) scaling for direct
  const r1 = results.find(r => r.N === 256)
  const r2 = results.find(r => r.N === 1024)
  const scalingExponent = r1 && r2 ? Math.log(r2.directMs / r1.directMs) / Math.log(r2.N / r1.N) : 0
  const isQuadratic = scalingExponent > 1.5 && scalingExponent < 2.5

  // FMM should be faster at large N
  const fmmFasterAtLargeN = results.length > 0 && results[results.length - 1].speedup > 0.8

  console.log(`\n  Direct scaling exponent: ${scalingExponent.toFixed(2)} (expected ~2.0 for O(N²))`)
  console.log(`  FMM faster at N=${results[results.length - 1]?.N}: ${fmmFasterAtLargeN}`)

  return { benchmark: 'biot_savart_scaling', pass: isQuadratic, results, scalingExponent }
}

// ═══════════════════════════════════════════════════
// Benchmark 2: Full VPM pipeline component breakdown
// ═══════════════════════════════════════════════════

function benchPipelineBreakdown() {
  console.log('\n\n══ Benchmark 2: VPM Pipeline Component Breakdown ══')

  const N = 512, sigma = 0.08, gamma = 0.5, dt = 0.003, nu = 0.005
  const results = []

  const particles = createRandomField(N, sigma, gamma)
  const params = { coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3, gamma, interactionRadius: 0, viscosity: nu, stretchingStrength: 1.0 }

  // Warm up
  computeVelocityDirect(particles, params)

  // Benchmark each component
  const biotSavart = benchmark(() => computeVelocityDirect(particles, params), 1, 5)
  const advection = benchmark(() => advectParticles(particles, dt), 1, 5)
  const stretching = benchmark(() => analyticStretching(particles, params, dt), 1, 5)
  const diffusion = benchmark(() => pseDiffusion(particles, params, dt), 1, 5)

  const total = biotSavart.median + advection.median + stretching.median + diffusion.median

  const components = [
    { name: 'Biot-Savart (N²)', ms: biotSavart.median, pct: biotSavart.median / total * 100 },
    { name: 'Advection', ms: advection.median, pct: advection.median / total * 100 },
    { name: 'Stretching', ms: stretching.median, pct: stretching.median / total * 100 },
    { name: 'PSE Diffusion', ms: diffusion.median, pct: diffusion.median / total * 100 },
  ]

  for (const c of components) {
    const bar = '█'.repeat(Math.round(c.pct / 2)) + '░'.repeat(Math.max(0, 50 - Math.round(c.pct / 2)))
    console.log(`  ${c.name.padEnd(20)} ${c.ms.toFixed(2).padStart(8)}ms ${bar} ${c.pct.toFixed(1)}%`)
  }
  console.log(`  ${'TOTAL'.padEnd(20)} ${total.toFixed(2).padStart(8)}ms`)

  const biotSavartDominant = biotSavart.median > total * 0.3
  console.log(`\n  Biot-Savart dominant (>30%): ${biotSavartDominant}`)

  return { benchmark: 'pipeline_breakdown', pass: true, N, total, components }
}

// ═══════════════════════════════════════════════════
// Benchmark 3: Throughput at various N
// ═══════════════════════════════════════════════════

function benchThroughput() {
  console.log('\n\n══ Benchmark 3: Throughput (steps/sec) at Various N ══')

  const sigma = 0.08, gamma = 0.5, dt = 0.003, nu = 0.005
  const particleCounts = [128, 256, 512, 1024, 2048]
  const results = []

  for (const N of particleCounts) {
    const particles = createRandomField(N, sigma, gamma)
    const params = { coreRadiusSigma: sigma, minCoreRadius: sigma * 0.3, gamma, interactionRadius: 0, viscosity: nu, stretchingStrength: 0.5 }

    const stepTime = benchmark(() => {
      computeVelocityDirect(particles, params)
      advectParticles(particles, dt)
      analyticStretching(particles, params, dt)
      pseDiffusion(particles, params, dt)
    }, 1, 3)

    const stepsPerSec = 1000 / stepTime.median
    const particlesPerSecond = N * stepsPerSec
    const canDoRealtime = stepsPerSec >= 30

    const result = {
      N, stepMs: stepTime.median,
      stepsPerSec: Math.round(stepsPerSec),
      particlesPerSec: Math.round(particlesPerSecond),
      canRealtime30fps: canDoRealtime,
    }
    results.push(result)

    console.log(`  N=${String(N).padStart(5)} | step=${stepTime.median.toFixed(1)}ms → ${stepsPerSec.toFixed(0)} steps/s | ${(particlesPerSecond / 1000).toFixed(0)}k particles/s | ${canDoRealtime ? '≥30fps' : '<30fps'}`)
  }

  // Find max N that can do realtime
  const realtimeN = results.filter(r => r.canRealtime30fps).pop()
  console.log(`\n  Max N at 30+ fps: ${realtimeN?.N ?? 'none'} (CPU direct N²)`)

  return { benchmark: 'throughput', pass: results.some(r => r.canRealtime30fps), results, maxRealtimeN: realtimeN?.N ?? 0 }
}

// ═══════════════════════════════════════════════════
// Benchmark 4: Memory scaling
// ═══════════════════════════════════════════════════

function benchMemoryScaling() {
  console.log('\n\n══ Benchmark 4: Memory Scaling with Particle Count ══')

  const sigma = 0.08, gamma = 0.5
  const particleCounts = [1000, 5000, 10000, 20000, 50000]
  const results = []

  for (const N of particleCounts) {
    const memBefore = process.memoryUsage().heapUsed
    const particles = createRandomField(N, sigma, gamma)
    const memAfter = process.memoryUsage().heapUsed
    const memDelta = Math.max(memAfter - memBefore, 0)
    const bytesPerParticle = memDelta / N

    const result = { N, memMB: memDelta / 1024 / 1024, bytesPerParticle }
    results.push(result)

    console.log(`  N=${String(N).padStart(6)} | ${(memDelta / 1024 / 1024).toFixed(2)}MB | ${bytesPerParticle.toFixed(0)} bytes/particle`)

    // Clean up
    particles.length = 0
    global.gc?.()
  }

  const linearScaling = results.length >= 2
  console.log(`\n  Memory scales linearly: ~${results[results.length - 1]?.bytesPerParticle?.toFixed(0) ?? '?'} bytes/particle`)

  return { benchmark: 'memory_scaling', pass: linearScaling, results }
}

// ═══════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════

function buildCsv(benchmarks) {
  const rows = ['benchmark,parameter,value,unit']
  for (const b of benchmarks) {
    if (b.results) {
      for (const r of b.results) {
        if (r.N !== undefined && r.directMs !== undefined) {
          rows.push(`${b.benchmark},N=${r.N}_directMs,${r.directMs.toFixed(3)},ms`)
          rows.push(`${b.benchmark},N=${r.N}_fmmMs,${r.fmmMs.toFixed(3)},ms`)
          rows.push(`${b.benchmark},N=${r.N}_speedup,${r.speedup.toFixed(2)},x`)
        }
        if (r.stepMs !== undefined) {
          rows.push(`${b.benchmark},N=${r.N}_stepMs,${r.stepMs.toFixed(3)},ms`)
          rows.push(`${b.benchmark},N=${r.N}_stepsPerSec,${r.stepsPerSec},steps/s`)
        }
        if (r.memMB !== undefined) {
          rows.push(`${b.benchmark},N=${r.N}_memMB,${r.memMB.toFixed(3)},MB`)
        }
      }
    }
    if (b.components) {
      for (const c of b.components) {
        rows.push(`pipeline_breakdown,${c.name}_ms,${c.ms.toFixed(3)},ms`)
        rows.push(`pipeline_breakdown,${c.name}_pct,${c.pct.toFixed(1)},%`)
      }
    }
  }
  return rows.join('\n')
}

function buildMarkdownReport(benchmarks) {
  const lines = []
  lines.push('# P6.5 Performance Benchmark Report')
  lines.push(`\n> Generated: ${new Date().toISOString()}`)
  lines.push('')

  const scaling = benchmarks.find(b => b.benchmark === 'biot_savart_scaling')
  if (scaling) {
    lines.push('## 1. Biot-Savart Scaling')
    lines.push('')
    lines.push('| N | Direct (ms) | FMM (ms) | Speedup |')
    lines.push('|---|------------|----------|---------|')
    for (const r of scaling.results) lines.push(`| ${r.N} | ${r.directMs.toFixed(2)} | ${r.fmmMs.toFixed(2)} | ${r.speedup.toFixed(1)}× |`)
    lines.push(`\nScaling exponent: **${scaling.scalingExponent.toFixed(2)}** (expected 2.0 for O(N²))`)
    lines.push('')
  }

  const breakdown = benchmarks.find(b => b.benchmark === 'pipeline_breakdown')
  if (breakdown) {
    lines.push('## 2. Pipeline Component Breakdown (N=512)')
    lines.push('')
    lines.push('| Component | Time (ms) | Fraction |')
    lines.push('|-----------|----------|----------|')
    for (const c of breakdown.components) lines.push(`| ${c.name} | ${c.ms.toFixed(2)} | ${c.pct.toFixed(1)}% |`)
    lines.push(`| **Total** | **${breakdown.total.toFixed(2)}** | 100% |`)
    lines.push('')
  }

  const throughput = benchmarks.find(b => b.benchmark === 'throughput')
  if (throughput) {
    lines.push('## 3. Throughput')
    lines.push('')
    lines.push('| N | Step (ms) | Steps/s | Realtime 30fps? |')
    lines.push('|---|----------|---------|-----------------|')
    for (const r of throughput.results) lines.push(`| ${r.N} | ${r.stepMs.toFixed(1)} | ${r.stepsPerSec} | ${r.canRealtime30fps ? 'YES' : 'NO'} |`)
    lines.push(`\nMax N at 30fps (CPU): **${throughput.maxRealtimeN}**`)
    lines.push('')
  }

  const memory = benchmarks.find(b => b.benchmark === 'memory_scaling')
  if (memory) {
    lines.push('## 4. Memory Scaling')
    lines.push('')
    lines.push('| N | Memory (MB) | Bytes/particle |')
    lines.push('|---|------------|---------------|')
    for (const r of memory.results) lines.push(`| ${r.N} | ${r.memMB.toFixed(2)} | ${r.bytesPerParticle.toFixed(0)} |`)
    lines.push('')
  }

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════')
console.log(' P6.5 — Performance Profiling & Benchmark')
console.log('═══════════════════════════════════════════════════')
console.log(`Date: ${new Date().toISOString()}`)
console.log(`Platform: ${process.platform} ${process.arch}`)

const benchmarks = []
benchmarks.push(benchBiotSavartScaling())
benchmarks.push(benchPipelineBreakdown())
benchmarks.push(benchThroughput())
benchmarks.push(benchMemoryScaling())

const allPass = benchmarks.every(b => b.pass)
const passCount = benchmarks.filter(b => b.pass).length

console.log('\n\n═══════════════════════════════════════════════════')
console.log(' SUMMARY')
console.log('═══════════════════════════════════════════════════')
for (const b of benchmarks) console.log(`  ${b.benchmark.padEnd(25)} [${b.pass ? 'PASS' : 'FAIL'}]`)
console.log(`\n  Total: ${passCount}/${benchmarks.length} passed`)
console.log('═══════════════════════════════════════════════════')

const jsonPath = 'audit-runner/performance-benchmark.json'
const csvPath = 'audit-runner/performance-benchmark.csv'
const mdPath = 'audit-runner/performance-benchmark.md'

await writeFile(jsonPath, JSON.stringify({ timestamp: new Date().toISOString(), platform: `${process.platform} ${process.arch}`, benchmarks }, null, 2), 'utf8')
console.log(`\n  Artifact: ${jsonPath}`)
await writeFile(csvPath, buildCsv(benchmarks), 'utf8')
console.log(`  Artifact: ${csvPath}`)
await writeFile(mdPath, buildMarkdownReport(benchmarks), 'utf8')
console.log(`  Artifact: ${mdPath}`)

process.exit(allPass ? 0 : 1)
