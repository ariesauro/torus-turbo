export const EXPERIMENT_SCHEMA_VERSION = 1

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeString(item, ''))
    .filter((item) => item.length > 0)
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }
  if (isObject(value)) {
    const keys = Object.keys(value).sort()
    const parts = []
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i]
      parts.push(`${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    }
    return `{${parts.join(',')}}`
  }
  return JSON.stringify(value)
}

// Lightweight deterministic hash for metadata fingerprints.
function fnv1a32(input) {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function normalizeExperimentContract(raw = {}) {
  const source = isObject(raw) ? raw : {}
  const sweep = isObject(source.sweep) ? source.sweep : {}
  const runBudget = isObject(source.runBudget) ? source.runBudget : {}

  return {
    schemaVersion: Math.max(
      1,
      Math.floor(toFiniteNumber(source.schemaVersion, EXPERIMENT_SCHEMA_VERSION)),
    ),
    id: normalizeString(source.id, ''),
    title: normalizeString(source.title, ''),
    hypothesis: normalizeString(source.hypothesis, ''),
    initialConditions: isObject(source.initialConditions) ? { ...source.initialConditions } : {},
    sweep: {
      strategy: normalizeString(sweep.strategy, 'grid'),
      dimensions: Array.isArray(sweep.dimensions) ? sweep.dimensions : [],
    },
    metrics: normalizeStringArray(source.metrics),
    acceptanceChecks: normalizeStringArray(source.acceptanceChecks),
    runBudget: {
      maxRuns: Math.max(1, Math.floor(toFiniteNumber(runBudget.maxRuns, 1))),
      maxWallClockSec: Math.max(1, Math.floor(toFiniteNumber(runBudget.maxWallClockSec, 600))),
      maxRetries: Math.max(0, Math.floor(toFiniteNumber(runBudget.maxRetries, 1))),
    },
    artifacts: isObject(source.artifacts) ? { ...source.artifacts } : {},
    metadata: isObject(source.metadata) ? { ...source.metadata } : {},
  }
}

export function validateExperimentContract(raw = {}) {
  const normalized = normalizeExperimentContract(raw)
  const errors = []

  if (normalized.schemaVersion !== EXPERIMENT_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion ${String(
        normalized.schemaVersion,
      )} is unsupported; expected ${String(EXPERIMENT_SCHEMA_VERSION)}`,
    )
  }
  if (normalized.id.length === 0) {
    errors.push('id is required')
  }
  if (normalized.title.length === 0) {
    errors.push('title is required')
  }
  if (!isObject(normalized.initialConditions) || Object.keys(normalized.initialConditions).length === 0) {
    errors.push('initialConditions must be a non-empty object')
  }
  if (!Array.isArray(normalized.sweep.dimensions) || normalized.sweep.dimensions.length === 0) {
    errors.push('sweep.dimensions must contain at least one dimension')
  }
  if (!Array.isArray(normalized.metrics) || normalized.metrics.length === 0) {
    errors.push('metrics must contain at least one metric key')
  }
  if (!Array.isArray(normalized.acceptanceChecks) || normalized.acceptanceChecks.length === 0) {
    errors.push('acceptanceChecks must contain at least one check')
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized,
  }
}

export function computeExperimentConfigHash(experiment) {
  const normalized = normalizeExperimentContract(experiment)
  return fnv1a32(stableSerialize(normalized))
}
