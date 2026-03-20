import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONTROL_PANEL_MESSAGES } from '../src/ui/i18n/controlPanelMessages.js'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_JSON_PATH = path.join(MODULE_DIR, 'i18n-audit-report.json')
const OUTPUT_MD_PATH = path.join(MODULE_DIR, 'i18n-audit-report.md')
const FAIL_ON_ISSUES = String(process.env.I18N_AUDIT_FAIL_ON_ISSUES ?? 'false') === 'true'

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function runAudit(messages) {
  const keys = Object.keys(messages ?? {}).sort((a, b) => a.localeCompare(b))
  const missingRu = []
  const missingEn = []
  const emptyRu = []
  const emptyEn = []
  const sameRuEn = []

  for (const key of keys) {
    const item = messages?.[key] ?? {}
    const hasRu = Object.prototype.hasOwnProperty.call(item, 'ru')
    const hasEn = Object.prototype.hasOwnProperty.call(item, 'en')
    const ru = item.ru
    const en = item.en

    if (!hasRu) {
      missingRu.push(key)
    } else if (!isNonEmptyString(ru)) {
      emptyRu.push(key)
    }

    if (!hasEn) {
      missingEn.push(key)
    } else if (!isNonEmptyString(en)) {
      emptyEn.push(key)
    }

    if (isNonEmptyString(ru) && isNonEmptyString(en) && ru.trim() === en.trim()) {
      sameRuEn.push(key)
    }
  }

  const hardIssues = [...missingRu, ...missingEn, ...emptyRu, ...emptyEn]
  return {
    pass: hardIssues.length === 0,
    keyCount: keys.length,
    missingRu,
    missingEn,
    emptyRu,
    emptyEn,
    sameRuEn,
  }
}

function toMarkdown(report) {
  const lines = [
    '# i18n audit report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Total keys: ${report.keyCount}`,
    `Audit pass: ${report.pass ? 'PASS' : 'FAIL'}`,
    '',
    '## Hard issues',
    '',
    `- missing ru: ${report.missingRu.length}`,
    `- missing en: ${report.missingEn.length}`,
    `- empty ru: ${report.emptyRu.length}`,
    `- empty en: ${report.emptyEn.length}`,
    '',
    '## Soft signals',
    '',
    `- identical RU/EN strings: ${report.sameRuEn.length}`,
    '',
  ]

  const sections = [
    ['Missing RU keys', report.missingRu],
    ['Missing EN keys', report.missingEn],
    ['Empty RU keys', report.emptyRu],
    ['Empty EN keys', report.emptyEn],
    ['Identical RU/EN keys (soft)', report.sameRuEn],
  ]

  for (const [title, rows] of sections) {
    lines.push(`### ${title}`, '')
    if (!rows || rows.length === 0) {
      lines.push('- none', '')
      continue
    }
    for (const key of rows) {
      lines.push(`- \`${key}\``)
    }
    lines.push('')
  }

  return lines.join('\n')
}

async function main() {
  const report = runAudit(CONTROL_PANEL_MESSAGES)
  const payload = {
    generatedAt: new Date().toISOString(),
    ...report,
  }
  await fs.writeFile(OUTPUT_JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await fs.writeFile(OUTPUT_MD_PATH, `${toMarkdown(payload)}\n`, 'utf8')

  console.log(
    `[i18n-audit] keys=${payload.keyCount}, pass=${payload.pass}, hardIssues=${
      payload.missingRu.length + payload.missingEn.length + payload.emptyRu.length + payload.emptyEn.length
    }, sameRuEn=${payload.sameRuEn.length}`,
  )

  if (FAIL_ON_ISSUES && payload.pass !== true) {
    throw new Error('i18n audit failed with hard issues')
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
