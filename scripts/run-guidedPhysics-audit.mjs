import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { PNG } from 'pngjs'

const APP_URL = 'http://localhost:5173/'
const OUT_PATH = path.resolve('scripts/guidedPhysics-audit-results.json')
const SCREEN_DIR = path.resolve('scripts/guidedPhysics-audit-shots')

const RUNS = [
  { backend: 'cpu', scenario: 'single pulse', durationSec: 25, pulse: 'single' },
  { backend: 'cpu', scenario: 'pulse train', durationSec: 60, pulse: 'train' },
  { backend: 'cpu', scenario: 'long run', durationSec: 180, pulse: 'train' },
  { backend: 'gpu', scenario: 'single pulse', durationSec: 25, pulse: 'single' },
  { backend: 'gpu', scenario: 'pulse train', durationSec: 60, pulse: 'train' },
  { backend: 'gpu', scenario: 'long run', durationSec: 180, pulse: 'train' },
]

function parseNumber(raw) {
  if (!raw) return null
  const cleaned = raw.replace(',', '.')
  const value = Number.parseFloat(cleaned)
  return Number.isFinite(value) ? value : null
}

function parseDiagnostics(text) {
  const lines = text.split('\n').map((line) => line.trim())
  const activeBackendLine = lines.find((line) => line.startsWith('Активный бэкенд:'))
  const reasonLine = lines.find((line) => line.startsWith('Причина состояния:'))
  const errorLine = lines.find((line) => line.startsWith('Ошибка выполнения:'))
  const pendingLine = lines.find((line) => line.startsWith('Ожидание GPU-диспетча:'))
  const sigmaLine = lines.find((line) => line.startsWith('σ/R измеренное:'))
  const driftLine = lines.find((line) => line.startsWith('Дрейф:'))

  return {
    activeBackend: activeBackendLine ? activeBackendLine.split(':').slice(1).join(':').trim() : null,
    reason: reasonLine ? reasonLine.split(':').slice(1).join(':').trim() : null,
    error: errorLine ? errorLine.split(':').slice(1).join(':').trim() : null,
    dispatchPending: pendingLine ? pendingLine.includes('да') : null,
    sigmaOverR: parseNumber((sigmaLine || '').match(/:\s*([-+]?\d+[.,]?\d*)/)?.[1] || ''),
    driftPercent: parseNumber((driftLine || '').match(/:\s*([-+]?\d+[.,]?\d*)%?/)?.[1] || ''),
  }
}

function imageTiltEstimate(pngPath) {
  const data = fs.readFileSync(pngPath)
  const png = PNG.sync.read(data)
  const width = png.width
  const height = png.height
  const usefulWidth = Math.floor(width * 0.72)

  let weightSum = 0
  let meanX = 0
  let meanY = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < usefulWidth; x += 1) {
      const idx = (width * y + x) * 4
      const r = png.data[idx]
      const g = png.data[idx + 1]
      const b = png.data[idx + 2]
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      if (lum < 45) continue
      const w = lum
      weightSum += w
      meanX += x * w
      meanY += y * w
    }
  }

  if (weightSum <= 0) return null
  meanX /= weightSum
  meanY /= weightSum

  let sxx = 0
  let syy = 0
  let sxy = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < usefulWidth; x += 1) {
      const idx = (width * y + x) * 4
      const r = png.data[idx]
      const g = png.data[idx + 1]
      const b = png.data[idx + 2]
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      if (lum < 45) continue
      const dx = x - meanX
      const dy = y - meanY
      const w = lum
      sxx += w * dx * dx
      syy += w * dy * dy
      sxy += w * dx * dy
    }
  }

  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  return (angle * 180) / Math.PI
}

async function setSelectByLabel(page, labelText, value) {
  const field = page.locator(`div:has(> label:has-text("${labelText}"))`).first()
  await field.locator('select').selectOption(value)
  await page.waitForTimeout(300)
}

async function setAlpha(page, value) {
  const field = page.locator('div:has(> label:has-text("α целевой угол наклона скорости"))').first()
  const range = field.locator('input[type="range"]')
  await range.evaluate((node, v) => {
    node.value = String(v)
    node.dispatchEvent(new Event('input', { bubbles: true }))
    node.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
  await page.waitForTimeout(250)
}

async function clickButton(page, text) {
  await page.getByRole('button', { name: text, exact: true }).click()
  await page.waitForTimeout(300)
}

async function collect(page) {
  const text = await page.locator('aside').innerText()
  return parseDiagnostics(text)
}

async function ensureBaseSetup(page) {
  await setSelectByLabel(page, 'Язык интерфейса', 'en')
  await setSelectByLabel(page, 'Dynamics mode', 'guidedPhysics')
  await clickButton(page, 'Apply Natural preset')
  await setSelectByLabel(page, 'Representation mode', 'particles')
}

async function alphaCheck(page, backend, index) {
  await clickButton(page, 'Reset particles')
  await setAlpha(page, -45)
  await clickButton(page, 'Single pulse')
  await page.waitForTimeout(3500)
  const negPath = path.join(SCREEN_DIR, `run${index + 1}-${backend}-alpha-neg.png`)
  await page.screenshot({ path: negPath, fullPage: true })

  await clickButton(page, 'Reset particles')
  await setAlpha(page, 45)
  await clickButton(page, 'Single pulse')
  await page.waitForTimeout(3500)
  const posPath = path.join(SCREEN_DIR, `run${index + 1}-${backend}-alpha-pos.png`)
  await page.screenshot({ path: posPath, fullPage: true })

  const negAngle = imageTiltEstimate(negPath)
  const posAngle = imageTiltEstimate(posPath)

  const changed =
    negAngle !== null &&
    posAngle !== null &&
    Math.abs(posAngle - negAngle) >= 8 &&
    Math.sign(posAngle) !== Math.sign(negAngle)

  return {
    pass: Boolean(changed),
    method: 'image-angle-approx',
    negAngle,
    posAngle,
    approximate: true,
  }
}

async function run() {
  fs.mkdirSync(SCREEN_DIR, { recursive: true })
  const browser = await chromium.launch({
    headless: false,
    args: ['--use-angle=metal'],
  })
  const page = await browser.newPage({ viewport: { width: 1800, height: 1400 } })
  await page.goto(APP_URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  await ensureBaseSetup(page)
  const results = []

  for (let i = 0; i < RUNS.length; i += 1) {
    const runDef = RUNS[i]
    await setSelectByLabel(page, 'Execution mode', runDef.backend)
    await clickButton(page, 'Apply Natural preset')
    const alpha = await alphaCheck(page, runDef.backend, i)

    await clickButton(page, 'Reset particles')

    if (runDef.pulse === 'single') {
      await clickButton(page, 'Single pulse')
    } else {
      await clickButton(page, 'Start train')
    }

    const midWaitMs = Math.floor((runDef.durationSec * 1000) / 2)
    await page.waitForTimeout(midWaitMs)
    const mid = await collect(page)
    await page.waitForTimeout(runDef.durationSec * 1000 - midWaitMs)

    if (runDef.pulse === 'train') {
      await clickButton(page, 'Stop train')
    }

    await page.waitForTimeout(1200)
    const end = await collect(page)

    const shot = path.join(
      SCREEN_DIR,
      `run${i + 1}-${runDef.backend}-${runDef.scenario.replace(/\s+/g, '-')}.png`,
    )
    await page.screenshot({ path: shot, fullPage: true })

    results.push({
      run: i + 1,
      backendRequested: runDef.backend.toUpperCase(),
      scenario: runDef.scenario,
      durationSec: runDef.durationSec,
      mid,
      end,
      alpha,
      screenshot: shot,
    })
  }

  await browser.close()
  fs.writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2))
  console.log(`Results written: ${OUT_PATH}`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
