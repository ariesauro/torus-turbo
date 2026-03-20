const LAB_STORAGE_SCHEMA_KEY = 'torusTurboLabStorageSchema'
const LAB_STORAGE_SCHEMA_VERSION = 2

const LAB_RUN_HISTORY_KEY_V2 = 'torusTurboLabRunHistoryV2'
const LAB_EXPERIMENTS_KEY_V2 = 'torusTurboLabExperimentsV2'
const LAB_ARTIFACT_INDEX_KEY_V2 = 'torusTurboLabArtifactIndexV2'

const LAB_RUN_HISTORY_KEY_V1 = 'torusTurboLabRunHistoryV1'
const LAB_EXPERIMENTS_KEY_V1 = 'torusTurboLabExperimentsV1'

const MAX_LAB_HISTORY = 60
const MAX_LAB_EXPERIMENTS = 60
const MAX_LAB_ARTIFACT_INDEX = 80

function canUseStorage() {
  return typeof window !== 'undefined' && window.localStorage != null
}

function readJsonArray(key) {
  if (!canUseStorage()) {
    return []
  }
  try {
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeJsonArray(key, value) {
  if (!canUseStorage()) {
    return
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.isArray(value) ? value : []))
  } catch {
    // Ignore quota/write errors to keep runtime resilient.
  }
}

function readSchemaVersion() {
  if (!canUseStorage()) {
    return 0
  }
  return Number(window.localStorage.getItem(LAB_STORAGE_SCHEMA_KEY) ?? 0) || 0
}

function writeSchemaVersion(version) {
  if (!canUseStorage()) {
    return
  }
  window.localStorage.setItem(LAB_STORAGE_SCHEMA_KEY, String(version))
}

function sanitizeIsoDate(value) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : new Date().toISOString()
}

function sanitizeRunHistory(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((item) => {
      const id = String(item?.id ?? '').trim()
      if (id.length === 0) return null
      return {
        id,
        timestamp: sanitizeIsoDate(item?.timestamp),
        title: String(item?.title ?? id).slice(0, 160),
        configHash: String(item?.configHash ?? 'unknown').slice(0, 128),
        totals: item?.totals ?? null,
        scaleApplicabilityLevel: String(item?.scaleApplicabilityLevel ?? 'n/a'),
        scalePresetId: String(item?.scalePresetId ?? 'custom'),
        runCount: Math.max(0, Math.floor(Number(item?.runCount ?? 0) || 0)),
        stepMedianMs: Number(item?.stepMedianMs ?? 0) || 0,
        throughputMedianPps: Number(item?.throughputMedianPps ?? 0) || 0,
        energyDriftPct: Number(item?.energyDriftPct ?? 0) || 0,
        adaptiveDecisionCount: Math.max(0, Math.floor(Number(item?.adaptiveDecisionCount ?? 0) || 0)),
        adaptiveRefineCount: Math.max(0, Math.floor(Number(item?.adaptiveRefineCount ?? 0) || 0)),
        adaptiveCoarsenCount: Math.max(0, Math.floor(Number(item?.adaptiveCoarsenCount ?? 0) || 0)),
        adaptiveAcceptanceOk: item?.adaptiveAcceptanceOk === true,
      }
    })
    .filter(Boolean)
    .slice(0, MAX_LAB_HISTORY)
}

function sanitizeExperiments(experiments) {
  return (Array.isArray(experiments) ? experiments : [])
    .map((item) => {
      const id = String(item?.id ?? '').trim()
      if (id.length === 0) return null
      return {
        id,
        name: String(item?.name ?? id).slice(0, 160),
        updatedAt: sanitizeIsoDate(item?.updatedAt),
        experiment: item?.experiment ?? null,
      }
    })
    .filter(Boolean)
    .slice(0, MAX_LAB_EXPERIMENTS)
}

function sanitizeArtifactIndex(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((item) => {
      const id = String(item?.id ?? '').trim()
      if (id.length === 0) return null
      return {
        id,
        timestamp: sanitizeIsoDate(item?.timestamp),
        title: String(item?.title ?? id).slice(0, 160),
        configHash: String(item?.configHash ?? 'unknown').slice(0, 128),
        ok: item?.ok === true,
        totalRuns: Math.max(0, Math.floor(Number(item?.totalRuns ?? 0) || 0)),
        completedRuns: Math.max(0, Math.floor(Number(item?.completedRuns ?? 0) || 0)),
        failedRuns: Math.max(0, Math.floor(Number(item?.failedRuns ?? 0) || 0)),
      }
    })
    .filter(Boolean)
    .slice(0, MAX_LAB_ARTIFACT_INDEX)
}

function ensureStorageSchema() {
  if (!canUseStorage()) {
    return
  }
  const current = readSchemaVersion()
  if (current >= LAB_STORAGE_SCHEMA_VERSION) {
    return
  }

  const migratedHistory = sanitizeRunHistory([
    ...readJsonArray(LAB_RUN_HISTORY_KEY_V2),
    ...readJsonArray(LAB_RUN_HISTORY_KEY_V1),
  ])
  const migratedExperiments = sanitizeExperiments([
    ...readJsonArray(LAB_EXPERIMENTS_KEY_V2),
    ...readJsonArray(LAB_EXPERIMENTS_KEY_V1),
  ])
  const migratedArtifacts = sanitizeArtifactIndex(readJsonArray(LAB_ARTIFACT_INDEX_KEY_V2))

  writeJsonArray(LAB_RUN_HISTORY_KEY_V2, migratedHistory)
  writeJsonArray(LAB_EXPERIMENTS_KEY_V2, migratedExperiments)
  writeJsonArray(LAB_ARTIFACT_INDEX_KEY_V2, migratedArtifacts)
  writeSchemaVersion(LAB_STORAGE_SCHEMA_VERSION)
}

export function loadLabRunHistory() {
  ensureStorageSchema()
  return sanitizeRunHistory(readJsonArray(LAB_RUN_HISTORY_KEY_V2))
}

export function saveLabRunHistory(entries) {
  ensureStorageSchema()
  writeJsonArray(LAB_RUN_HISTORY_KEY_V2, sanitizeRunHistory(entries))
}

export function appendLabRunHistory(entry) {
  const prev = loadLabRunHistory()
  const next = sanitizeRunHistory([entry, ...prev])
  saveLabRunHistory(next)
  return next
}

export function loadLabExperiments() {
  ensureStorageSchema()
  return sanitizeExperiments(readJsonArray(LAB_EXPERIMENTS_KEY_V2))
}

export function saveLabExperiments(experiments) {
  ensureStorageSchema()
  writeJsonArray(LAB_EXPERIMENTS_KEY_V2, sanitizeExperiments(experiments))
}

export function upsertLabExperiment(experiment) {
  const id = String(experiment?.id ?? '').trim()
  if (id.length === 0) {
    return loadLabExperiments()
  }
  const prev = loadLabExperiments()
  const normalized = {
    id,
    name: String(experiment?.name ?? id),
    updatedAt: new Date().toISOString(),
    experiment: experiment?.experiment ?? null,
  }
  const filtered = prev.filter((item) => String(item?.id ?? '') !== id)
  const next = sanitizeExperiments([normalized, ...filtered])
  saveLabExperiments(next)
  return next
}

export function loadLabArtifactIndex() {
  ensureStorageSchema()
  return sanitizeArtifactIndex(readJsonArray(LAB_ARTIFACT_INDEX_KEY_V2))
}

export function appendLabArtifactIndex(entry) {
  ensureStorageSchema()
  const prev = loadLabArtifactIndex()
  const next = sanitizeArtifactIndex([entry, ...prev])
  writeJsonArray(LAB_ARTIFACT_INDEX_KEY_V2, next)
  return next
}
