/**
 * GPU Parity Audit (P3.3)
 *
 * Verifies that CPU (JS, float64) and GPU (WGSL, float32) solvers produce
 * equivalent results for the same initial condition and physics parameters.
 *
 * Test: 32 particles on a vortex ring, 100 Euler steps, dt = 0.002.
 * Pass criterion: max|δx|/h < 0.01 (relative position error vs core radius).
 *
 * Requires: dev server running at localhost:5173 (npm run dev).
 * Uses Playwright + Chrome with WebGPU flags.
 */

import { chromium } from 'playwright'

const BASE_URL = process.env.GPU_PARITY_BASE_URL || 'http://localhost:5173/'
const HEADLESS = process.env.GPU_PARITY_HEADLESS !== 'false'
const FAIL_ON_GATE = process.env.GPU_PARITY_FAIL_ON_GATE === 'true'
const BROWSER_CHANNEL = process.env.GPU_PARITY_BROWSER_CHANNEL || ''
const PARTICLE_COUNT = Math.max(8, Math.floor(Number(process.env.GPU_PARITY_PARTICLES) || 32))
const STEPS = Math.max(1, Math.floor(Number(process.env.GPU_PARITY_STEPS) || 100))
const DT = Math.max(1e-5, Number(process.env.GPU_PARITY_DT) || 0.002)

async function launchBrowser() {
  const options = {
    headless: HEADLESS,
    args: [
      '--ignore-gpu-blocklist',
      '--enable-unsafe-webgpu',
      '--use-angle=metal',
      '--enable-features=Vulkan,UseSkiaRenderer',
      '--disable-gpu-sandbox',
      '--no-sandbox',
    ],
  }
  if (BROWSER_CHANNEL.length > 0) {
    try {
      return await chromium.launch({ ...options, channel: BROWSER_CHANNEL })
    } catch (error) {
      console.warn(`[gpu-parity] Channel "${BROWSER_CHANNEL}" failed, using bundled: ${error.message}`)
    }
  }
  return chromium.launch(options)
}

async function waitForTestApi(page, timeoutMs = 15000) {
  const pollInterval = 250
  const maxPolls = Math.ceil(timeoutMs / pollInterval)
  for (let i = 0; i < maxPolls; i++) {
    const ready = await page.evaluate(() => typeof window.__torusTestApi !== 'undefined')
    if (ready) return true
    await new Promise((r) => setTimeout(r, pollInterval))
  }
  return false
}

async function run() {
  console.log('=== GPU Parity Audit (P3.3) ===')
  console.log(`Date: ${new Date().toISOString()}`)
  console.log(`Config: particles=${PARTICLE_COUNT}, steps=${STEPS}, dt=${DT}`)
  console.log(`Server: ${BASE_URL}`)
  console.log()

  let browser
  try {
    browser = await launchBrowser()
  } catch (error) {
    console.error(`[gpu-parity] Failed to launch browser: ${error.message}`)
    process.exit(1)
  }

  let result
  try {
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
    })
    context.addInitScript(() => {
      window.__torusDisableAutoCalibration = true
    })

    const page = await context.newPage()
    page.on('pageerror', (err) => console.error(`[page-error] ${err.message}`))
    page.on('console', (msg) => {
      const text = msg.text()
      if (msg.type() === 'error' || msg.type() === 'warn' || text.includes('[parity-debug]')) {
        console.log(`[page-${msg.type()}] ${text}`)
      }
    })

    console.log('[gpu-parity] Navigating to app...')
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })

    console.log('[gpu-parity] Waiting for test API...')
    const apiReady = await waitForTestApi(page, 20000)
    if (!apiReady) {
      console.error('[gpu-parity] FAIL: __torusTestApi not found (is dev server running?)')
      process.exit(1)
    }

    async function waitForRuntime(maxMs) {
      const start = Date.now()
      while (Date.now() - start < maxMs) {
        try {
          const ok = await page.evaluate(() => {
            try { return Boolean(window.__torusTestApi?.getHealth().hasRuntimeRef) }
            catch { return false }
          })
          if (ok) return true
        } catch { /* context destroyed by HMR — retry */ }
        await new Promise((r) => setTimeout(r, 1000))
      }
      return false
    }

    console.log('[gpu-parity] Waiting for runtime initialization (up to 90s)...')
    if (!(await waitForRuntime(90000))) {
      console.error('[gpu-parity] FAIL: runtime not available after 90s')
      process.exit(1)
    }
    await new Promise((r) => setTimeout(r, 2000))
    if (!(await waitForRuntime(30000))) {
      console.error('[gpu-parity] FAIL: runtime not stable after confirmation')
      process.exit(1)
    }

    const health = await page.evaluate(() => window.__torusTestApi.getHealth())
    console.log(`[gpu-parity] Health: backend=${health.runtimeBackend}, hasRuntime=${health.hasRuntimeRef}`)

    console.log(`[gpu-parity] Running parity test (${PARTICLE_COUNT} particles × ${STEPS} steps)...`)
    const startMs = Date.now()

    result = await page.evaluate(
      async ({ particleCount, steps, dt }) => {
        return window.__torusTestApi.runParityTest({ particleCount, steps, dt })
      },
      { particleCount: PARTICLE_COUNT, steps: STEPS, dt: DT },
    )

    const elapsedMs = Date.now() - startMs
    result.elapsedMs = elapsedMs
  } catch (error) {
    console.error(`[gpu-parity] Runtime error: ${error.message}`)
    result = { pass: false, error: error.message }
  } finally {
    await browser.close()
  }

  console.log()
  console.log('=== Results ===')

  if (result.error) {
    console.log(`  Status:  FAIL`)
    console.log(`  Error:   ${result.error}`)
  } else {
    const status = result.pass ? 'PASS' : 'FAIL'
    console.log(`  Status:          ${status}`)
    console.log(`  Particles:       ${result.particleCount}`)
    console.log(`  Steps:           ${result.steps}`)
    console.log(`  dt:              ${result.dt}`)
    console.log(`  Position error:  ${result.maxPositionError?.toFixed(8)} (threshold: ${result.threshold})`)
    console.log(`  Vorticity error: ${result.maxVorticityError?.toFixed(8)}`)
    console.log(`  Gamma error:     ${result.maxGammaError?.toFixed(8)}`)
    console.log(`  Worst particle:  ${result.worstParticleIndex}`)
    console.log(`  Elapsed:         ${result.elapsedMs} ms`)
  }

  console.log()
  console.log(`=== GPU Parity: ${result.pass ? 'PASS' : 'FAIL'} ===`)

  if (!result.pass && FAIL_ON_GATE) {
    process.exit(1)
  }
  process.exit(result.pass ? 0 : 1)
}

run()
