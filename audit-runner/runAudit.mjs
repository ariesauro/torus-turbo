import { chromium } from 'playwright'
import fs from 'node:fs/promises'

const BASE_URL = 'http://localhost:5173/'

const scenarios = [
  { backend: 'CPU', scenario: 'single pulse', durationSec: 25, action: 'single' },
  { backend: 'CPU', scenario: 'pulse train', durationSec: 60, action: 'train' },
  { backend: 'CPU', scenario: 'long run', durationSec: 180, action: 'train' },
  { backend: 'GPU', scenario: 'single pulse', durationSec: 25, action: 'single' },
  { backend: 'GPU', scenario: 'pulse train', durationSec: 60, action: 'train' },
  { backend: 'GPU', scenario: 'long run', durationSec: 180, action: 'train' },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function clickButtonByText(page, text) {
  await page.evaluate((buttonText) => {
    const buttons = [...document.querySelectorAll('button')]
    const match = buttons.find((btn) => btn.textContent?.trim() === buttonText)
    if (!match) {
      throw new Error(`Button not found: ${buttonText}`)
    }
    match.click()
  }, text)
}

async function setSelectByLabel(page, labelText, value) {
  await page.evaluate(
    ({ labelTextInner, valueInner }) => {
      const labels = [...document.querySelectorAll('label')]
      const host = labels.find((node) => node.querySelector('span')?.textContent?.trim() === labelTextInner)
      if (!host) {
        throw new Error(`Select label not found: ${labelTextInner}`)
      }
      const select = host.querySelector('select')
      if (!select) {
        throw new Error(`Select element not found for label: ${labelTextInner}`)
      }
      select.value = valueInner
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
    },
    { labelTextInner: labelText, valueInner: value },
  )
}

async function setRangeByLabel(page, labelText, value) {
  await page.evaluate(
    ({ labelTextInner, valueInner }) => {
      const labels = [...document.querySelectorAll('label')]
      const host = labels.find((node) => node.querySelector('span')?.textContent?.trim() === labelTextInner)
      if (!host) {
        throw new Error(`Range label not found: ${labelTextInner}`)
      }
      const input = host.querySelector('input[type="range"]')
      if (!input) {
        throw new Error(`Range input not found for label: ${labelTextInner}`)
      }
      input.value = String(valueInner)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    { labelTextInner: labelText, valueInner: value },
  )
}

async function extractDiagnostics(page) {
  const panelText = await page.locator('aside').innerText()

  const pick = (re) => {
    const match = panelText.match(re)
    return match?.[1]?.trim() ?? null
  }

  const pickNumber = (re) => {
    const raw = pick(re)
    if (raw == null) return null
    const numeric = Number(raw)
    return Number.isFinite(numeric) ? numeric : null
  }

  const centerAxialMatch = panelText.match(
    /Hybrid center offset \/ axial offset:\s*([-+]?\d*\.?\d+)\s*\/\s*([-+]?\d*\.?\d+)/,
  )

  return {
    activeBackend: pick(/Active backend:\s*([^\n]+)/),
    statusReason: pick(/Status reason:\s*([^\n]+)/),
    runtimeError: pick(/Runtime error:\s*([^\n]+)/),
    gpuDispatchPending: pick(/GPU dispatch pending:\s*([^\n]+)/),
    sigmaOverR: pickNumber(/σ\/R measured:\s*([-+]?\d*\.?\d+)/),
    driftPercent: pickNumber(/Drift:\s*([-+]?\d*\.?\d+)%/),
    hybridCenterOffset: centerAxialMatch ? Number(centerAxialMatch[1]) : null,
    hybridAxialOffset: centerAxialMatch ? Number(centerAxialMatch[2]) : null,
  }
}

function evaluatePassFail(run) {
  const backendOk = run.end.activeBackend?.toUpperCase() === run.backend
  const runtimeOk = !(run.end.runtimeError && run.end.runtimeError.length > 0)
  const sigma = run.end.sigmaOverR
  const drift = run.end.driftPercent
  const sigmaOk = typeof sigma === 'number' ? sigma >= 0.05 && sigma <= 0.25 : false
  const driftOk = typeof drift === 'number' ? Math.abs(drift) <= 5 : false
  const alphaOk = run.alphaResponse.pass === true
  const pass = backendOk && runtimeOk && sigmaOk && driftOk && alphaOk

  return {
    pass,
    checks: { backendOk, runtimeOk, sigmaOk, driftOk, alphaOk },
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1800, height: 1200 } })
  await context.addInitScript(() => {
    localStorage.removeItem('toroidalVortexParams')
    localStorage.setItem('toroidalVortexParams', JSON.stringify({ uiLanguage: 'en' }))
  })

  const page = await context.newPage()
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await sleep(1500)

  // Open key sections/disclosures once to guarantee visibility of needed controls/diagnostics.
  for (const button of [
    'Particles and vectors',
    'Pulse control',
    'Vortex representation',
    'Solver',
    'Backend and diagnostics',
    'Runtime GPU diagnostics',
    'Stability metrics',
  ]) {
    try {
      await clickButtonByText(page, button)
      await sleep(250)
    } catch {
      // Continue; hidden elements can still be manipulated via direct DOM updates.
    }
  }

  // Global setup requested by procedure.
  await setSelectByLabel(page, 'Dynamics mode', 'guidedPhysics')
  await sleep(250)
  await setSelectByLabel(page, 'Representation mode', 'particles')
  await sleep(250)
  await clickButtonByText(page, 'Apply Natural preset')
  await sleep(500)

  const results = []
  let runIndex = 0

  for (const scenario of scenarios) {
    runIndex += 1
    const execMode = scenario.backend.toLowerCase()
    await setSelectByLabel(page, 'Execution mode', execMode)
    await sleep(350)
    await setSelectByLabel(page, 'Representation mode', 'particles')
    await sleep(250)

    await clickButtonByText(page, 'Reset particles')
    await sleep(600)

    if (scenario.action === 'single') {
      await clickButtonByText(page, 'Single pulse')
    } else {
      await clickButtonByText(page, 'Start train')
    }

    await sleep(Math.max(1000, Math.floor((scenario.durationSec * 1000) / 2)))
    const mid = await extractDiagnostics(page)

    // Alpha qualitative response probe with axial offset proxy.
    await setRangeByLabel(page, 'α target velocity tilt angle', -45)
    await sleep(1600)
    const alphaNeg = await extractDiagnostics(page)
    await setRangeByLabel(page, 'α target velocity tilt angle', 45)
    await sleep(1600)
    const alphaPos = await extractDiagnostics(page)
    await setRangeByLabel(page, 'α target velocity tilt angle', -45)
    await sleep(200)

    const elapsedForMiddleAndAlpha = Math.floor((scenario.durationSec * 1000) / 2) + 3400
    const remainingMs = Math.max(1500, scenario.durationSec * 1000 - elapsedForMiddleAndAlpha)
    await sleep(remainingMs)

    if (scenario.action === 'train') {
      await clickButtonByText(page, 'Stop train')
      await sleep(350)
    }

    const end = await extractDiagnostics(page)

    const aNeg = alphaNeg.hybridAxialOffset
    const aPos = alphaPos.hybridAxialOffset
    const alphaDelta = typeof aNeg === 'number' && typeof aPos === 'number' ? aPos - aNeg : null
    const alphaPass = typeof alphaDelta === 'number' ? Math.abs(alphaDelta) >= 0.015 : false

    const run = {
      id: runIndex,
      backend: scenario.backend,
      scenario: scenario.scenario,
      durationSec: scenario.durationSec,
      mid,
      end,
      alphaResponse: {
        pass: alphaPass,
        proxy: 'hybrid axial offset shift between alpha -45 and +45',
        alphaNegAxialOffset: aNeg,
        alphaPosAxialOffset: aPos,
        delta: alphaDelta,
      },
      notes: [],
    }

    if (end.runtimeError) {
      run.notes.push(`runtime error: ${end.runtimeError}`)
    }
    if (end.activeBackend?.toUpperCase() !== scenario.backend) {
      run.notes.push(`backend mismatch (expected ${scenario.backend}, got ${end.activeBackend ?? 'unknown'})`)
    }
    if (typeof end.driftPercent === 'number' && Math.abs(end.driftPercent) > 5) {
      run.notes.push('circulation drift out of nominal threshold (>5%)')
    }
    if (typeof end.sigmaOverR === 'number' && (end.sigmaOverR < 0.05 || end.sigmaOverR > 0.25)) {
      run.notes.push('sigmaOverR out of nominal threshold (0.05-0.25)')
    }
    if (!alphaPass) {
      run.notes.push('alpha response proxy did not show strong directional change')
    }
    if (run.notes.length === 0) {
      run.notes.push('no obvious instability/artifacts via diagnostics')
    }

    const judged = evaluatePassFail(run)
    run.pass = judged.pass
    run.checks = judged.checks
    results.push(run)
  }

  const cpu = results.filter((r) => r.backend === 'CPU')
  const gpu = results.filter((r) => r.backend === 'GPU')
  const cpuPassCount = cpu.filter((r) => r.pass).length
  const gpuPassCount = gpu.filter((r) => r.pass).length
  const consistencyPass =
    cpuPassCount >= 2 &&
    gpuPassCount >= 2 &&
    results.every((r) => r.end.runtimeError == null || r.end.runtimeError.length === 0)

  const payload = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    results,
    summary: {
      cpuPassCount,
      gpuPassCount,
      consistencyPass,
    },
  }

  await fs.writeFile(new URL('./guidedPhysicsAuditResults.json', import.meta.url), JSON.stringify(payload, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
