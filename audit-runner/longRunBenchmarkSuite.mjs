import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { execFile as execFileCb } from 'node:child_process'
import { chromium } from 'playwright'

const BASE_URL = process.env.TORUS_BASE_URL ?? 'http://localhost:5173/'
const OUTPUT_JSON_URL = new URL('./long-run-benchmark-results.json', import.meta.url)
const OUTPUT_MD_URL = new URL('./long-run-benchmark-results.md', import.meta.url)
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const execFile = promisify(execFileCb)

function resolveSuitePath(rawPath, fallbackFileName) {
  const fallback = path.join(MODULE_DIR, fallbackFileName)
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    return fallback
  }
  const provided = rawPath.trim()
  if (path.isAbsolute(provided)) {
    return provided
  }
  const normalized = provided.replace(/\\/g, '/')
  const normalizedWithoutAuditRunnerPrefix = normalized.startsWith('./audit-runner/')
    ? `./${normalized.slice('./audit-runner/'.length)}`
    : normalized.startsWith('audit-runner/')
      ? `./${normalized.slice('audit-runner/'.length)}`
      : normalized
  if (path.basename(process.cwd()) === 'audit-runner') {
    return path.resolve(MODULE_DIR, normalizedWithoutAuditRunnerPrefix)
  }
  return path.resolve(process.cwd(), provided)
}

const PROFILE_CONFIGS = {
  standard: {
    particleCount: 30000,
    warmupSec: 6,
    durationSec: 45,
    sampleEveryMs: 500,
    thresholds: {
      stepP95RegressPct: 25,
      throughputDropPct: 20,
      energyDriftAbsPct: 35,
      enstrophyDriftAbsPct: 40,
      autoCorrectionPer1kStepsRegressPct: 45,
      autoCorrectionPer1kStepsAbsMax: 35,
      driftSeverityP95RegressPct: 35,
      driftSeverityP95AbsMax: 0.85,
      overrideFallbackStormCountMax: 6,
      overrideTimeoutBurstCountMax: 4,
      overrideInvariantGuardCountMax: 2,
    },
    thresholdsByMode: {
      cpu: {
        stepP95RegressPct: 35,
        throughputDropPct: 28,
        energyDriftAbsPct: 50,
        enstrophyDriftAbsPct: 50,
        autoCorrectionPer1kStepsRegressPct: 60,
        autoCorrectionPer1kStepsAbsMax: 55,
        driftSeverityP95RegressPct: 45,
        driftSeverityP95AbsMax: 0.9,
        overrideFallbackStormCountMax: 8,
        overrideTimeoutBurstCountMax: 6,
        overrideInvariantGuardCountMax: 3,
      },
      gpu: {
        stepP95RegressPct: 22,
        throughputDropPct: 20,
        energyDriftAbsPct: 90,
        enstrophyDriftAbsPct: 2000,
        autoCorrectionPer1kStepsRegressPct: 45,
        autoCorrectionPer1kStepsAbsMax: 32,
        driftSeverityP95RegressPct: 35,
        driftSeverityP95AbsMax: 0.85,
        overrideFallbackStormCountMax: 6,
        overrideTimeoutBurstCountMax: 4,
        overrideInvariantGuardCountMax: 2,
      },
      hybrid: {
        stepP95RegressPct: 25,
        throughputDropPct: 22,
        energyDriftAbsPct: 35,
        enstrophyDriftAbsPct: 40,
        autoCorrectionPer1kStepsRegressPct: 40,
        autoCorrectionPer1kStepsAbsMax: 30,
        driftSeverityP95RegressPct: 35,
        driftSeverityP95AbsMax: 0.82,
        overrideFallbackStormCountMax: 6,
        overrideTimeoutBurstCountMax: 4,
        overrideInvariantGuardCountMax: 2,
      },
      hybrid_plus: {
        stepP95RegressPct: 22,
        throughputDropPct: 20,
        energyDriftAbsPct: 30,
        enstrophyDriftAbsPct: 35,
        autoCorrectionPer1kStepsRegressPct: 35,
        autoCorrectionPer1kStepsAbsMax: 24,
        driftSeverityP95RegressPct: 30,
        driftSeverityP95AbsMax: 0.8,
        overrideFallbackStormCountMax: 5,
        overrideTimeoutBurstCountMax: 3,
        overrideInvariantGuardCountMax: 1,
      },
    },
  },
  smoke: {
    particleCount: 12000,
    warmupSec: 2,
    durationSec: 10,
    sampleEveryMs: 500,
    thresholds: {
      stepP95RegressPct: 40,
      throughputDropPct: 30,
      energyDriftAbsPct: 80,
      enstrophyDriftAbsPct: 1200,
      autoCorrectionPer1kStepsRegressPct: 75,
      autoCorrectionPer1kStepsAbsMax: 70,
      driftSeverityP95RegressPct: 60,
      driftSeverityP95AbsMax: 0.9,
      overrideFallbackStormCountMax: 4,
      overrideTimeoutBurstCountMax: 3,
      overrideInvariantGuardCountMax: 1,
    },
    thresholdsByMode: {
      cpu: {
        stepP95RegressPct: 50,
        throughputDropPct: 40,
        energyDriftAbsPct: 100,
        enstrophyDriftAbsPct: 1300,
        autoCorrectionPer1kStepsRegressPct: 90,
        autoCorrectionPer1kStepsAbsMax: 90,
        driftSeverityP95RegressPct: 80,
        driftSeverityP95AbsMax: 0.95,
        overrideFallbackStormCountMax: 5,
        overrideTimeoutBurstCountMax: 4,
        overrideInvariantGuardCountMax: 2,
      },
      gpu: {
        stepP95RegressPct: 35,
        throughputDropPct: 70,
        energyDriftAbsPct: 150,
        enstrophyDriftAbsPct: 1800,
        autoCorrectionPer1kStepsRegressPct: 80,
        autoCorrectionPer1kStepsAbsMax: 75,
        driftSeverityP95RegressPct: 65,
        driftSeverityP95AbsMax: 0.92,
        overrideFallbackStormCountMax: 4,
        overrideTimeoutBurstCountMax: 3,
        overrideInvariantGuardCountMax: 1,
      },
      hybrid: {
        stepP95RegressPct: 40,
        throughputDropPct: 65,
        energyDriftAbsPct: 80,
        enstrophyDriftAbsPct: 1200,
        autoCorrectionPer1kStepsRegressPct: 75,
        autoCorrectionPer1kStepsAbsMax: 70,
        driftSeverityP95RegressPct: 65,
        driftSeverityP95AbsMax: 0.9,
        overrideFallbackStormCountMax: 4,
        overrideTimeoutBurstCountMax: 3,
        overrideInvariantGuardCountMax: 1,
      },
      hybrid_plus: {
        stepP95RegressPct: 35,
        throughputDropPct: 70,
        energyDriftAbsPct: 70,
        enstrophyDriftAbsPct: 1200,
        autoCorrectionPer1kStepsRegressPct: 70,
        autoCorrectionPer1kStepsAbsMax: 65,
        driftSeverityP95RegressPct: 60,
        driftSeverityP95AbsMax: 0.88,
        overrideFallbackStormCountMax: 3,
        overrideTimeoutBurstCountMax: 2,
        overrideInvariantGuardCountMax: 1,
      },
    },
  },
  nightly: {
    particleCount: 30000,
    warmupSec: 8,
    durationSec: 120,
    sampleEveryMs: 400,
    thresholds: {
      stepP95RegressPct: 20,
      throughputDropPct: 15,
      energyDriftAbsPct: 25,
      enstrophyDriftAbsPct: 30,
      autoCorrectionPer1kStepsRegressPct: 30,
      autoCorrectionPer1kStepsAbsMax: 20,
      driftSeverityP95RegressPct: 25,
      driftSeverityP95AbsMax: 0.78,
      overrideFallbackStormCountMax: 3,
      overrideTimeoutBurstCountMax: 2,
      overrideInvariantGuardCountMax: 1,
    },
    thresholdsByMode: {
      cpu: {
        stepP95RegressPct: 28,
        throughputDropPct: 22,
        energyDriftAbsPct: 150,
        enstrophyDriftAbsPct: 45,
        autoCorrectionPer1kStepsRegressPct: 45,
        autoCorrectionPer1kStepsAbsMax: 35,
        driftSeverityP95RegressPct: 35,
        driftSeverityP95AbsMax: 0.85,
        overrideFallbackStormCountMax: 4,
        overrideTimeoutBurstCountMax: 3,
        overrideInvariantGuardCountMax: 2,
      },
      gpu: {
        stepP95RegressPct: 18,
        throughputDropPct: 14,
        energyDriftAbsPct: 90,
        enstrophyDriftAbsPct: 1000,
        autoCorrectionPer1kStepsRegressPct: 30,
        autoCorrectionPer1kStepsAbsMax: 20,
        driftSeverityP95RegressPct: 25,
        driftSeverityP95AbsMax: 0.8,
        overrideFallbackStormCountMax: 3,
        overrideTimeoutBurstCountMax: 2,
        overrideInvariantGuardCountMax: 1,
      },
      hybrid: {
        stepP95RegressPct: 20,
        throughputDropPct: 16,
        energyDriftAbsPct: 25,
        enstrophyDriftAbsPct: 30,
        autoCorrectionPer1kStepsRegressPct: 28,
        autoCorrectionPer1kStepsAbsMax: 18,
        driftSeverityP95RegressPct: 25,
        driftSeverityP95AbsMax: 0.78,
        overrideFallbackStormCountMax: 3,
        overrideTimeoutBurstCountMax: 2,
        overrideInvariantGuardCountMax: 1,
      },
      hybrid_plus: {
        stepP95RegressPct: 18,
        throughputDropPct: 14,
        energyDriftAbsPct: 20,
        enstrophyDriftAbsPct: 25,
        autoCorrectionPer1kStepsRegressPct: 24,
        autoCorrectionPer1kStepsAbsMax: 15,
        driftSeverityP95RegressPct: 22,
        driftSeverityP95AbsMax: 0.75,
        overrideFallbackStormCountMax: 2,
        overrideTimeoutBurstCountMax: 1,
        overrideInvariantGuardCountMax: 1,
      },
    },
  },
}

const HARDWARE_CLASS_THRESHOLD_PATCHES = {
  standard: {
    low: {
      stepP95RegressPct: 45,
      throughputDropPct: 32,
      driftSeverityP95RegressPct: 55,
      driftSeverityP95AbsMax: 0.92,
      overrideFallbackStormCountMax: 9,
      overrideTimeoutBurstCountMax: 7,
      overrideInvariantGuardCountMax: 4,
    },
    entry_gpu: {
      stepP95RegressPct: 35,
      throughputDropPct: 26,
      driftSeverityP95RegressPct: 45,
      driftSeverityP95AbsMax: 0.88,
      overrideFallbackStormCountMax: 7,
      overrideTimeoutBurstCountMax: 5,
      overrideInvariantGuardCountMax: 3,
    },
    mid: {
      stepP95RegressPct: 28,
      throughputDropPct: 22,
      driftSeverityP95RegressPct: 38,
      driftSeverityP95AbsMax: 0.84,
      overrideFallbackStormCountMax: 6,
      overrideTimeoutBurstCountMax: 4,
      overrideInvariantGuardCountMax: 2,
    },
    high: {
      stepP95RegressPct: 22,
      throughputDropPct: 18,
      driftSeverityP95RegressPct: 30,
      driftSeverityP95AbsMax: 0.8,
      overrideFallbackStormCountMax: 5,
      overrideTimeoutBurstCountMax: 3,
      overrideInvariantGuardCountMax: 1,
    },
  },
  smoke: {
    low: {
      stepP95RegressPct: 60,
      throughputDropPct: 45,
      driftSeverityP95RegressPct: 90,
      driftSeverityP95AbsMax: 0.98,
      overrideFallbackStormCountMax: 6,
      overrideTimeoutBurstCountMax: 5,
      overrideInvariantGuardCountMax: 2,
    },
    entry_gpu: {
      stepP95RegressPct: 50,
      throughputDropPct: 40,
      driftSeverityP95RegressPct: 75,
      driftSeverityP95AbsMax: 0.95,
      overrideFallbackStormCountMax: 5,
      overrideTimeoutBurstCountMax: 4,
      overrideInvariantGuardCountMax: 2,
    },
    mid: {
      stepP95RegressPct: 42,
      throughputDropPct: 34,
      driftSeverityP95RegressPct: 65,
      driftSeverityP95AbsMax: 0.9,
      overrideFallbackStormCountMax: 4,
      overrideTimeoutBurstCountMax: 3,
      overrideInvariantGuardCountMax: 1,
    },
    high: {
      stepP95RegressPct: 35,
      throughputDropPct: 28,
      driftSeverityP95RegressPct: 55,
      driftSeverityP95AbsMax: 0.86,
      overrideFallbackStormCountMax: 3,
      overrideTimeoutBurstCountMax: 2,
      overrideInvariantGuardCountMax: 1,
    },
  },
  nightly: {
    low: {
      stepP95RegressPct: 35,
      throughputDropPct: 26,
      driftSeverityP95RegressPct: 45,
      driftSeverityP95AbsMax: 0.88,
      overrideFallbackStormCountMax: 5,
      overrideTimeoutBurstCountMax: 4,
      overrideInvariantGuardCountMax: 2,
    },
    entry_gpu: {
      stepP95RegressPct: 30,
      throughputDropPct: 22,
      driftSeverityP95RegressPct: 35,
      driftSeverityP95AbsMax: 0.84,
      overrideFallbackStormCountMax: 4,
      overrideTimeoutBurstCountMax: 3,
      overrideInvariantGuardCountMax: 2,
    },
    mid: {
      stepP95RegressPct: 24,
      throughputDropPct: 18,
      driftSeverityP95RegressPct: 28,
      driftSeverityP95AbsMax: 0.8,
      overrideFallbackStormCountMax: 3,
      overrideTimeoutBurstCountMax: 2,
      overrideInvariantGuardCountMax: 1,
    },
    high: {
      stepP95RegressPct: 20,
      throughputDropPct: 15,
      driftSeverityP95RegressPct: 24,
      driftSeverityP95AbsMax: 0.76,
      overrideFallbackStormCountMax: 2,
      overrideTimeoutBurstCountMax: 1,
      overrideInvariantGuardCountMax: 1,
    },
  },
}

const LONGRUN_PROFILE_RAW = String(process.env.LONGRUN_PROFILE ?? 'standard').toLowerCase().trim()
const LONGRUN_PROFILE = Object.prototype.hasOwnProperty.call(PROFILE_CONFIGS, LONGRUN_PROFILE_RAW)
  ? LONGRUN_PROFILE_RAW
  : 'standard'
const LONGRUN_RUNNER_MODE_RAW = String(process.env.LONGRUN_RUNNER_MODE ?? 'default').toLowerCase().trim()
const LONGRUN_RUNNER_MODE =
  LONGRUN_RUNNER_MODE_RAW === 'controlled' || LONGRUN_RUNNER_MODE_RAW === 'default'
    ? LONGRUN_RUNNER_MODE_RAW
    : 'default'
const RUNNER_MODE_OVERRIDES = {
  controlled: {
    standard: {
      warmupSecMin: 8,
      durationSecMin: 60,
      sampleEveryMsMin: 600,
      caseTimeoutSecMin: 360,
      browserChannelDefault: 'chrome',
      headlessDefault: false,
    },
    nightly: {
      warmupSecMin: 10,
      durationSecMin: 150,
      sampleEveryMsMin: 600,
      caseTimeoutSecMin: 720,
      browserChannelDefault: 'chrome',
      headlessDefault: false,
    },
  },
}
function hasEnv(name) {
  return typeof process.env[name] === 'string' && process.env[name].trim().length > 0
}
function normalizeHardwareClass(raw) {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (value === 'low' || value === 'entry_gpu' || value === 'mid' || value === 'high') {
    return value
  }
  return 'unknown'
}
const LONGRUN_HARDWARE_CLASS_OVERRIDE = normalizeHardwareClass(process.env.LONGRUN_HARDWARE_CLASS ?? 'unknown')
let ACTIVE_LONGRUN_HARDWARE_CLASS = LONGRUN_HARDWARE_CLASS_OVERRIDE
const ACTIVE_PROFILE = PROFILE_CONFIGS[LONGRUN_PROFILE]
const RUNNER_PROFILE_OVERRIDES =
  RUNNER_MODE_OVERRIDES[LONGRUN_RUNNER_MODE]?.[LONGRUN_PROFILE] ?? null
const PARTICLE_COUNT = Math.max(
  2000,
  Number(process.env.LONGRUN_PARTICLE_COUNT ?? ACTIVE_PROFILE.particleCount) || ACTIVE_PROFILE.particleCount,
)
const WARMUP_SEC_RAW = Number(process.env.LONGRUN_WARMUP_SEC ?? ACTIVE_PROFILE.warmupSec) || ACTIVE_PROFILE.warmupSec
const DURATION_SEC_RAW = Number(process.env.LONGRUN_DURATION_SEC ?? ACTIVE_PROFILE.durationSec) || ACTIVE_PROFILE.durationSec
const SAMPLE_EVERY_MS_RAW = Number(process.env.LONGRUN_SAMPLE_MS ?? ACTIVE_PROFILE.sampleEveryMs) || ACTIVE_PROFILE.sampleEveryMs
const WARMUP_SEC_BASE = Math.max(1, WARMUP_SEC_RAW)
const DURATION_SEC_BASE = Math.max(
  10,
  DURATION_SEC_RAW,
)
const SAMPLE_EVERY_MS_BASE = Math.max(
  100,
  SAMPLE_EVERY_MS_RAW,
)
const WARMUP_SEC =
  RUNNER_PROFILE_OVERRIDES && !hasEnv('LONGRUN_WARMUP_SEC')
    ? Math.max(WARMUP_SEC_BASE, RUNNER_PROFILE_OVERRIDES.warmupSecMin ?? WARMUP_SEC_BASE)
    : WARMUP_SEC_BASE
const DURATION_SEC =
  RUNNER_PROFILE_OVERRIDES && !hasEnv('LONGRUN_DURATION_SEC')
    ? Math.max(DURATION_SEC_BASE, RUNNER_PROFILE_OVERRIDES.durationSecMin ?? DURATION_SEC_BASE)
    : DURATION_SEC_BASE
const SAMPLE_EVERY_MS =
  RUNNER_PROFILE_OVERRIDES && !hasEnv('LONGRUN_SAMPLE_MS')
    ? Math.max(SAMPLE_EVERY_MS_BASE, RUNNER_PROFILE_OVERRIDES.sampleEveryMsMin ?? SAMPLE_EVERY_MS_BASE)
    : SAMPLE_EVERY_MS_BASE
const PLAYWRIGHT_HEADLESS = hasEnv('PLAYWRIGHT_HEADLESS')
  ? String(process.env.PLAYWRIGHT_HEADLESS ?? 'false') === 'true'
  : Boolean(RUNNER_PROFILE_OVERRIDES?.headlessDefault ?? false)
const PLAYWRIGHT_BROWSER_CHANNEL =
  hasEnv('PLAYWRIGHT_BROWSER_CHANNEL')
    ? process.env.PLAYWRIGHT_BROWSER_CHANNEL.trim()
    : String(RUNNER_PROFILE_OVERRIDES?.browserChannelDefault ?? '')
const BASELINE_PATH = resolveSuitePath(
  process.env.LONGRUN_BASELINE_PATH ?? './audit-runner/long-run-baseline.json',
  'long-run-baseline.json',
)
const POLICY_GATE_TREND_PATH = resolveSuitePath(
  process.env.LONGRUN_POLICY_GATE_TREND_PATH ?? './audit-runner/policy-gate-trend.json',
  'policy-gate-trend.json',
)
const POLICY_GATE_TREND_MAX = Math.max(20, Number(process.env.LONGRUN_POLICY_GATE_TREND_MAX ?? 180) || 180)
const UPDATE_BASELINE = String(process.env.LONGRUN_UPDATE_BASELINE ?? 'false') === 'true'
const FAIL_ON_GATE = String(process.env.LONGRUN_FAIL_ON_GATE ?? 'false') === 'true'
const RUN_ADAPTIVE_MATRIX = String(process.env.LONGRUN_ADAPTIVE_MATRIX ?? 'true') === 'true'
const RUN_PHYSICAL_BASELINE = String(process.env.LONGRUN_PHYSICAL_BASELINE ?? 'false') === 'true'
const RUN_EXTENDED_PHYSICS_MATRIX =
  String(process.env.LONGRUN_EXTENDED_PHYSICS_MATRIX ?? 'false') === 'true'
const RUN_HYBRIDPLUS_SCHEDULER_AUDIT =
  String(process.env.LONGRUN_HYBRIDPLUS_SCHEDULER_AUDIT ?? 'false') === 'true'
const APPLY_RETUNING_HINTS = String(process.env.LONGRUN_APPLY_RETUNING_HINTS ?? 'false') === 'true'
const ADAPTIVE_MATRIX_FAIL_ON_SCENARIO =
  typeof process.env.LONGRUN_ADAPTIVE_MATRIX_FAIL_ON_SCENARIO === 'string' &&
  process.env.LONGRUN_ADAPTIVE_MATRIX_FAIL_ON_SCENARIO.trim().length > 0
    ? process.env.LONGRUN_ADAPTIVE_MATRIX_FAIL_ON_SCENARIO.trim()
    : FAIL_ON_GATE
      ? LONGRUN_PROFILE === 'nightly'
        ? 'adaptive.mid'
        : 'adaptive.low'
      : ''
const DEFAULT_ADAPTIVE_MATRIX_MIN_PASS_RATIO =
  FAIL_ON_GATE && (LONGRUN_PROFILE === 'nightly' || LONGRUN_PROFILE === 'standard') ? 2 / 3 : 1
const ADAPTIVE_MATRIX_MIN_PASS_RATIO = Math.min(
  1,
  Math.max(
    0,
    Number(process.env.LONGRUN_ADAPTIVE_MATRIX_MIN_PASS_RATIO ?? DEFAULT_ADAPTIVE_MATRIX_MIN_PASS_RATIO) ||
      DEFAULT_ADAPTIVE_MATRIX_MIN_PASS_RATIO,
  ),
)
const PHYSICAL_BASELINE_FAIL_ON_GATE = String(process.env.LONGRUN_PHYSICAL_BASELINE_FAIL_ON_GATE ?? FAIL_ON_GATE) === 'true'
const DRIFT_SEVERITY_REGRESS_BASELINE_FLOOR = Math.max(
  0,
  Number(process.env.LONGRUN_DRIFT_SEVERITY_REGRESS_BASELINE_FLOOR ?? 0.05) || 0.05,
)
const AUTOCORRECTION_REGRESS_BASELINE_FLOOR = Math.max(
  0,
  Number(process.env.LONGRUN_AUTOCORRECTION_REGRESS_BASELINE_FLOOR ?? 1) || 1,
)
const RETUNE_HEADROOM_PCT = Math.max(0, Math.min(200, Number(process.env.LONGRUN_RETUNE_HEADROOM_PCT ?? 12) || 12))
const RETUNE_INCLUDE_NEAR_PASS = String(process.env.LONGRUN_RETUNE_INCLUDE_NEAR_PASS ?? 'false') === 'true'
const CASE_TIMEOUT_SEC = Math.max(
  30,
  RUNNER_PROFILE_OVERRIDES && !hasEnv('LONGRUN_CASE_TIMEOUT_SEC')
    ? Math.max(
        Number(RUNNER_PROFILE_OVERRIDES.caseTimeoutSecMin ?? 0) || 0,
        Number(WARMUP_SEC + DURATION_SEC + 120) || 0,
      )
    : Number(process.env.LONGRUN_CASE_TIMEOUT_SEC ?? (WARMUP_SEC + DURATION_SEC + 120)) ||
      (WARMUP_SEC + DURATION_SEC + 120),
)
const DEFAULT_GATE_THRESHOLDS = ACTIVE_PROFILE.thresholds
const DEFAULT_GATE_THRESHOLDS_BY_MODE = ACTIVE_PROFILE.thresholdsByMode
function getDefaultGateThresholdsByHardwareClass(hardwareClass) {
  return HARDWARE_CLASS_THRESHOLD_PATCHES[LONGRUN_PROFILE]?.[hardwareClass] ?? {}
}
const LONGRUN_CPU_PARTICLE_COUNT_RAW = Number(process.env.LONGRUN_CPU_PARTICLE_COUNT ?? Number.NaN)
const LONGRUN_CPU_WARMUP_SEC_RAW = Number(process.env.LONGRUN_CPU_WARMUP_SEC ?? Number.NaN)
const LONGRUN_CPU_DURATION_SEC_RAW = Number(process.env.LONGRUN_CPU_DURATION_SEC ?? Number.NaN)
const LONGRUN_CPU_SAMPLE_MS_RAW = Number(process.env.LONGRUN_CPU_SAMPLE_MS ?? Number.NaN)

const MODE_SCENARIOS = [
  {
    key: 'cpu',
    title: 'CPU',
    modePatch: {
      dynamicsMode: 'guidedPhysics',
      executionMode: 'cpu',
      vortexRepresentation: 'particles',
      hybridPlusEnabled: false,
      gpuAutoQualityGuardEnabled: false,
    },
    paramsPatch: {
      emissionMode: 'particleStream',
    },
  },
  {
    key: 'gpu',
    title: 'GPU',
    modePatch: {
      dynamicsMode: 'guidedPhysics',
      executionMode: 'gpu',
      vortexRepresentation: 'particles',
      hybridPlusEnabled: false,
      gpuAutoQualityGuardEnabled: false,
    },
    paramsPatch: {
      emissionMode: 'particleStream',
    },
  },
  {
    key: 'hybrid',
    title: 'Hybrid',
    modePatch: {
      dynamicsMode: 'fullPhysics',
      executionMode: 'hybrid',
      vortexRepresentation: 'hybrid',
      hybridPlusEnabled: false,
      gpuAutoQualityGuardEnabled: false,
    },
    paramsPatch: {
      emissionMode: 'particleStream',
      hybridFilamentToParticleBatchingEnabled: true,
    },
  },
  {
    key: 'hybrid_plus',
    title: 'Hybrid+',
    modePatch: {
      dynamicsMode: 'fullPhysics',
      executionMode: 'hybrid',
      vortexRepresentation: 'hybrid',
      hybridPlusEnabled: true,
      gpuAutoQualityGuardEnabled: false,
    },
    paramsPatch: {
      emissionMode: 'particleStream',
      hybridFilamentToParticleBatchingEnabled: true,
    },
  },
]
const MODE_FILTER_RAW =
  typeof process.env.LONGRUN_MODES === 'string' && process.env.LONGRUN_MODES.trim().length > 0
    ? process.env.LONGRUN_MODES
        .split(',')
        .map((v) => modeToKey(v))
        .filter(Boolean)
    : []
const ACTIVE_MODE_SCENARIOS =
  MODE_FILTER_RAW.length > 0
    ? MODE_SCENARIOS.filter((scenario) => MODE_FILTER_RAW.includes(modeToKey(scenario.key)))
    : MODE_SCENARIOS

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

function p95(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))
  return sorted[idx]
}

function average(values) {
  if (values.length === 0) return 0
  return values.reduce((acc, v) => acc + v, 0) / values.length
}

function toFinite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toPctDelta(start, end) {
  const s = Math.max(1e-9, Math.abs(toFinite(start, 0)))
  const e = toFinite(end, 0)
  return ((e - toFinite(start, 0)) / s) * 100
}

function pickMetricSeriesValue(samples, key, selector = 'first') {
  if (!Array.isArray(samples) || samples.length === 0) {
    return null
  }
  const ordered = selector === 'last' ? [...samples].reverse() : samples
  for (let i = 0; i < ordered.length; i += 1) {
    const value = toFinite(ordered[i]?.params?.[key], Number.NaN)
    if (Number.isFinite(value) && Math.abs(value) > 1e-12) {
      return value
    }
  }
  return null
}

function classifyStability(summary) {
  const modeKey = modeToKey(summary.mode)
  const latencyWarnMs =
    modeKey === 'gpu'
      ? 50
      : modeKey === 'hybrid' || modeKey === 'hybrid_plus'
        ? 28
        : 24
  const latencyFailMs =
    modeKey === 'gpu'
      ? 65
      : modeKey === 'hybrid' || modeKey === 'hybrid_plus'
        ? 45
        : 40
  const latencyRisk =
    summary.stepP95Ms > latencyFailMs ? 2 : summary.stepP95Ms > latencyWarnMs ? 1 : 0
  let syncRisk = 0
  if (summary.syncViolationDelta > 0) {
    syncRisk = 2
  } else if (modeKey !== 'gpu') {
    const full = Math.max(0, Number(summary.fullReadbackDelta ?? 0) || 0)
    const skipped = Math.max(0, Number(summary.skippedReadbackDelta ?? 0) || 0)
    const total = full + skipped
    const fullRatio = total > 0 ? full / total : 0
    if (full >= 80 && fullRatio > 0.7) {
      syncRisk = 1
    }
  }
  const energyRisk =
    Math.abs(summary.energyDriftPct) > 50 || Math.abs(summary.enstrophyDriftPct) > 60
      ? 2
      : Math.abs(summary.energyDriftPct) > 25 || Math.abs(summary.enstrophyDriftPct) > 30
        ? 1
        : 0
  const risk = latencyRisk + syncRisk + energyRisk
  if (risk >= 4) return 'FAIL'
  if (risk >= 2) return 'WARN'
  return 'PASS'
}

function collectRenderPolicySignals(samples) {
  const reasonCounts = {
    fallback_storm: 0,
    timeout_burst: 0,
    invariant_guard: 0,
  }
  const driftSeveritySamples = []
  for (const sample of samples) {
    const reason = String(sample?.params?.runtimeRenderOverrideReason ?? 'none')
    if (Object.prototype.hasOwnProperty.call(reasonCounts, reason)) {
      reasonCounts[reason] += 1
    }
    const driftSeverity = toFinite(sample?.params?.runtimeRenderHealthDriftSeverity, Number.NaN)
    if (Number.isFinite(driftSeverity)) {
      driftSeveritySamples.push(Math.max(0, Math.min(1, driftSeverity)))
    }
  }
  const overrideTotal =
    reasonCounts.fallback_storm + reasonCounts.timeout_burst + reasonCounts.invariant_guard
  return {
    reasonCounts,
    overrideTotal,
    driftSeverityP95: p95(driftSeveritySamples),
    driftSeverityAvg: average(driftSeveritySamples),
  }
}

function summarizeCase(caseResult) {
  const stepSamples = caseResult.samples.map((s) => toFinite(s.diag.stepMs, 0)).filter((v) => v > 0)
  const activeSamples = caseResult.samples.map((s) => Math.max(0, Math.floor(toFinite(s.diag.activeCount, 0))))
  const throughputSamples = caseResult.samples
    .map((s) => {
      const stepMs = toFinite(s.diag.stepMs, 0)
      const activeCount = Math.max(0, Math.floor(toFinite(s.diag.activeCount, 0)))
      if (stepMs <= 1e-6 || activeCount <= 0) return 0
      return activeCount / (stepMs / 1000)
    })
    .filter((v) => v > 0)
  const syncPolicySamples = caseResult.samples.map((s) => String(s.diag.syncPolicy ?? 'unknown'))
  const modeSwitches = syncPolicySamples.reduce((acc, current, idx, arr) => {
    if (idx === 0) return 0
    return acc + (current !== arr[idx - 1] ? 1 : 0)
  }, 0)

  const startEnergy =
    pickMetricSeriesValue(caseResult.samples, 'runtimeEnergyProxy', 'first') ??
    toFinite(caseResult.startParams.runtimeEnergyProxy, 0)
  const endEnergy =
    pickMetricSeriesValue(caseResult.samples, 'runtimeEnergyProxy', 'last') ??
    toFinite(caseResult.endParams.runtimeEnergyProxy, 0)
  const startEnstrophy =
    pickMetricSeriesValue(caseResult.samples, 'runtimeEnstrophyProxy', 'first') ??
    toFinite(caseResult.startParams.runtimeEnstrophyProxy, 0)
  const endEnstrophy =
    pickMetricSeriesValue(caseResult.samples, 'runtimeEnstrophyProxy', 'last') ??
    toFinite(caseResult.endParams.runtimeEnstrophyProxy, 0)
  const newtoniumTransitionsStart = Math.max(
    0,
    Math.floor(toFinite(caseResult.startParams.runtimeNewtoniumTransitions, 0)),
  )
  const newtoniumTransitionsEnd = Math.max(
    0,
    Math.floor(toFinite(caseResult.endParams.runtimeNewtoniumTransitions, 0)),
  )
  const summary = {
    mode: caseResult.mode,
    requestedParticles: caseResult.requestedParticles,
    actualParticles: Math.max(0, Math.floor(toFinite(caseResult.endDiag.activeCount, 0))),
    stepMedianMs: median(stepSamples),
    stepP95Ms: p95(stepSamples),
    throughputMedianPps: median(throughputSamples),
    throughputAvgPps: average(throughputSamples),
    activeMedian: median(activeSamples),
    activeP95: p95(activeSamples),
    energyDriftPct: toPctDelta(startEnergy, endEnergy),
    enstrophyDriftPct: toPctDelta(startEnstrophy, endEnstrophy),
    newtoniumTransitionsDelta: Math.max(0, newtoniumTransitionsEnd - newtoniumTransitionsStart),
    syncPolicySwitches: modeSwitches,
    stabilityAutoCorrectionTotalDelta:
      Math.max(
        0,
        Math.floor(toFinite(caseResult.endParams.runtimeStabilityAutoCorrectionTotalCount, 0)) -
          Math.floor(toFinite(caseResult.startParams.runtimeStabilityAutoCorrectionTotalCount, 0)),
      ) || 0,
    stabilityStepDelta:
      Math.max(
        1,
        Math.floor(toFinite(caseResult.endParams.runtimeCpuSteps, 0) + toFinite(caseResult.endParams.runtimeGpuSteps, 0)) -
          Math.floor(toFinite(caseResult.startParams.runtimeCpuSteps, 0) + toFinite(caseResult.startParams.runtimeGpuSteps, 0)),
      ) || 1,
    syncViolationDelta: caseResult.syncViolationDelta,
    fullReadbackDelta: caseResult.fullReadbackDelta,
    skippedReadbackDelta: caseResult.skippedReadbackDelta,
    hybridPlusProducedDelta:
      Math.max(
        0,
        Math.floor(toFinite(caseResult.endParams.runtimeHybridPlusProducedDeltaCount, 0)) -
          Math.floor(toFinite(caseResult.startParams.runtimeHybridPlusProducedDeltaCount, 0)),
      ) || 0,
    hybridPlusAppliedDelta:
      Math.max(
        0,
        Math.floor(toFinite(caseResult.endParams.runtimeHybridPlusAppliedDeltaCount, 0)) -
          Math.floor(toFinite(caseResult.startParams.runtimeHybridPlusAppliedDeltaCount, 0)),
      ) || 0,
    endBackend: String(caseResult.endParams.runtimeBackend ?? 'unknown'),
    endNewtoniumType: String(caseResult.endParams.runtimeNewtoniumType ?? 'none'),
    endNewtoniumConfidence: toFinite(caseResult.endParams.runtimeNewtoniumConfidence, 0),
  }
  const policySignals = collectRenderPolicySignals(caseResult.samples)
  summary.renderPolicyOverrideCount = policySignals.overrideTotal
  summary.renderPolicyOverrideCountByReason = policySignals.reasonCounts
  summary.renderPolicyDriftSeverityP95 = policySignals.driftSeverityP95
  summary.renderPolicyDriftSeverityAvg = policySignals.driftSeverityAvg
  summary.stabilityAutoCorrectionPer1kSteps =
    (Math.max(0, summary.stabilityAutoCorrectionTotalDelta) / Math.max(1, summary.stabilityStepDelta)) * 1000
  summary.stability = classifyStability(summary)
  return summary
}

function buildMarkdownTable(rows) {
  const header =
    '| Mode | N actual | Step median/p95 (ms) | Throughput med (pps) | Energy drift % | Enstrophy drift % | Sync Δ (viol/full/skip) | Newtonium transitions | Auto-corr /1k steps | Policy override (f/t/i) | Drift severity p95 | Stability |\n' +
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|'
  const body = rows.map(
    (row) =>
      `| ${row.mode} | ${row.actualParticles} | ${row.stepMedianMs.toFixed(2)}/${row.stepP95Ms.toFixed(2)} | ${Math.round(row.throughputMedianPps)} | ${row.energyDriftPct.toFixed(1)} | ${row.enstrophyDriftPct.toFixed(1)} | ${row.syncViolationDelta}/${row.fullReadbackDelta}/${row.skippedReadbackDelta} | ${row.newtoniumTransitionsDelta} | ${row.stabilityAutoCorrectionPer1kSteps.toFixed(2)} | ${row.renderPolicyOverrideCountByReason.fallback_storm}/${row.renderPolicyOverrideCountByReason.timeout_burst}/${row.renderPolicyOverrideCountByReason.invariant_guard} | ${row.renderPolicyDriftSeverityP95.toFixed(3)} | ${row.stability} |`,
  )
  return [header, ...body].join('\n')
}

function inferRecommendation(row) {
  if (row.stability === 'PASS') {
    return 'baseline is stable; use this mode as reference for regressions'
  }
  if (row.syncViolationDelta > 0 || row.fullReadbackDelta > row.skippedReadbackDelta) {
    return 'tune sync cadence and avoid strict full readback every frame'
  }
  if (Math.abs(row.energyDriftPct) > 25 || Math.abs(row.enstrophyDriftPct) > 30) {
    return 'tune dissipation/stretching and inspect cascade parameters'
  }
  if (row.stepP95Ms > 24) {
    return 'reduce expensive operators and decrease filament workload in this mode'
  }
  return 'inspect runtime traces for transient instability'
}

function modeToKey(mode) {
  return String(mode ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('+', '_plus')
    .replaceAll(/\s+/g, '_')
}

function resolveScenarioParticleCount(scenario) {
  const scenarioKey = modeToKey(scenario?.key ?? scenario?.title ?? '')
  if (scenarioKey !== 'cpu') {
    return PARTICLE_COUNT
  }
  if (Number.isFinite(LONGRUN_CPU_PARTICLE_COUNT_RAW) && LONGRUN_CPU_PARTICLE_COUNT_RAW > 0) {
    return Math.max(2000, Math.floor(LONGRUN_CPU_PARTICLE_COUNT_RAW))
  }
  if (LONGRUN_PROFILE === 'nightly') {
    // Nightly CPU at full particle count can exceed wall-clock limits on mid-tier laptops.
    // Keep CPU in coverage by default with a bounded nightly-friendly workload.
    return Math.max(2000, Math.min(PARTICLE_COUNT, 6000))
  }
  return PARTICLE_COUNT
}

function resolveScenarioTiming(scenario) {
  const scenarioKey = modeToKey(scenario?.key ?? scenario?.title ?? '')
  if (scenarioKey !== 'cpu') {
    return {
      warmupSec: WARMUP_SEC,
      durationSec: DURATION_SEC,
      sampleEveryMs: SAMPLE_EVERY_MS,
    }
  }
  if (LONGRUN_PROFILE !== 'nightly') {
    return {
      warmupSec: WARMUP_SEC,
      durationSec: DURATION_SEC,
      sampleEveryMs: SAMPLE_EVERY_MS,
    }
  }
  const warmupSec = Number.isFinite(LONGRUN_CPU_WARMUP_SEC_RAW)
    ? Math.max(1, LONGRUN_CPU_WARMUP_SEC_RAW)
    : Math.min(WARMUP_SEC, 2)
  const durationSec = Number.isFinite(LONGRUN_CPU_DURATION_SEC_RAW)
    ? Math.max(6, LONGRUN_CPU_DURATION_SEC_RAW)
    : Math.min(DURATION_SEC, 25)
  const sampleEveryMs = Number.isFinite(LONGRUN_CPU_SAMPLE_MS_RAW)
    ? Math.max(100, LONGRUN_CPU_SAMPLE_MS_RAW)
    : Math.max(500, SAMPLE_EVERY_MS)
  return {
    warmupSec,
    durationSec,
    sampleEveryMs,
  }
}

async function readJsonIfExists(path) {
  try {
    const text = await fs.readFile(path, 'utf8')
    return JSON.parse(text)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function compareWithBaseline(summaryRows, baseline) {
  if (!baseline || !Array.isArray(baseline.rows)) {
    return []
  }
  const baselineByMode = new Map(baseline.rows.map((row) => [modeToKey(row.mode), row]))
  const thresholdProfileOverrides = baseline.thresholdsProfiles?.[LONGRUN_PROFILE] ?? {}
  const thresholdHardwareOverrides =
    ACTIVE_LONGRUN_HARDWARE_CLASS !== 'unknown'
      ? baseline.thresholdsByHardwareClass?.[ACTIVE_LONGRUN_HARDWARE_CLASS] ?? {}
      : {}
  const thresholdHardwareProfileOverrides =
    ACTIVE_LONGRUN_HARDWARE_CLASS !== 'unknown'
      ? baseline.thresholdsByHardwareClassProfiles?.[LONGRUN_PROFILE]?.[ACTIVE_LONGRUN_HARDWARE_CLASS] ?? {}
      : {}
  const thresholdConfig = {
    ...DEFAULT_GATE_THRESHOLDS,
    ...getDefaultGateThresholdsByHardwareClass(ACTIVE_LONGRUN_HARDWARE_CLASS),
    ...(baseline.thresholds ?? {}),
    ...thresholdHardwareOverrides,
    ...thresholdProfileOverrides,
    ...thresholdHardwareProfileOverrides,
  }
  const thresholdsByMode = baseline.thresholdsByMode ?? {}
  const thresholdsByModeProfile = baseline.thresholdsByModeProfiles?.[LONGRUN_PROFILE] ?? {}
  const thresholdsByModeHardwareClassProfile =
    baseline.thresholdsByModeHardwareClassProfiles?.[LONGRUN_PROFILE]?.[ACTIVE_LONGRUN_HARDWARE_CLASS] ?? {}
  return summaryRows.map((row) => {
    const base = baselineByMode.get(modeToKey(row.mode))
    if (!base) {
      return {
        mode: row.mode,
        status: 'NO_BASELINE',
        message: 'no baseline row for mode',
      }
    }
    const modeKey = modeToKey(row.mode)
    const modeThresholds = {
      ...(thresholdsByMode[modeKey] ?? {}),
      ...(thresholdsByModeProfile[modeKey] ?? {}),
      ...(thresholdsByModeHardwareClassProfile[modeKey] ?? {}),
    }
    const stepLimitPct = Number(modeThresholds.stepP95RegressPct ?? thresholdConfig.stepP95RegressPct)
    const throughputLimitPct = Number(modeThresholds.throughputDropPct ?? thresholdConfig.throughputDropPct)
    const energyDriftAbsLimit = Number(modeThresholds.energyDriftAbsPct ?? thresholdConfig.energyDriftAbsPct)
    const enstrophyDriftAbsLimit = Number(
      modeThresholds.enstrophyDriftAbsPct ?? thresholdConfig.enstrophyDriftAbsPct,
    )
    const autoCorrectionPer1kStepsRegressLimit = Number(
      modeThresholds.autoCorrectionPer1kStepsRegressPct ?? thresholdConfig.autoCorrectionPer1kStepsRegressPct ?? 45,
    )
    const autoCorrectionPer1kStepsAbsMax = Number(
      modeThresholds.autoCorrectionPer1kStepsAbsMax ?? thresholdConfig.autoCorrectionPer1kStepsAbsMax ?? 35,
    )
    const driftSeverityP95RegressLimit = Number(
      modeThresholds.driftSeverityP95RegressPct ?? thresholdConfig.driftSeverityP95RegressPct ?? 35,
    )
    const driftSeverityP95AbsMax = Number(
      modeThresholds.driftSeverityP95AbsMax ?? thresholdConfig.driftSeverityP95AbsMax ?? 0.85,
    )
    const overrideFallbackStormCountMax = Number(
      modeThresholds.overrideFallbackStormCountMax ?? thresholdConfig.overrideFallbackStormCountMax ?? 6,
    )
    const overrideTimeoutBurstCountMax = Number(
      modeThresholds.overrideTimeoutBurstCountMax ?? thresholdConfig.overrideTimeoutBurstCountMax ?? 4,
    )
    const overrideInvariantGuardCountMax = Number(
      modeThresholds.overrideInvariantGuardCountMax ?? thresholdConfig.overrideInvariantGuardCountMax ?? 2,
    )
    const baseStepP95 = Math.max(1e-6, Number(base.stepP95Ms ?? 1))
    const baseThroughput = Math.max(1e-6, Number(base.throughputMedianPps ?? 1))
    const baseAutoCorrectionPer1kStepsRaw = Number(base.stabilityAutoCorrectionPer1kSteps)
    const hasBaseAutoCorrectionPer1kSteps = Number.isFinite(baseAutoCorrectionPer1kStepsRaw)
    const hasBaseAutoCorrectionForRegress =
      hasBaseAutoCorrectionPer1kSteps &&
      baseAutoCorrectionPer1kStepsRaw >= AUTOCORRECTION_REGRESS_BASELINE_FLOOR
    const baseAutoCorrectionPer1kSteps = Math.max(
      1e-6,
      AUTOCORRECTION_REGRESS_BASELINE_FLOOR,
      hasBaseAutoCorrectionPer1kSteps ? baseAutoCorrectionPer1kStepsRaw : row.stabilityAutoCorrectionPer1kSteps,
    )
    const baseDriftSeverityP95Raw = Number(base.renderPolicyDriftSeverityP95 ?? 0)
    const hasBaseDriftSeverityForRegress =
      Number.isFinite(baseDriftSeverityP95Raw) &&
      baseDriftSeverityP95Raw >= DRIFT_SEVERITY_REGRESS_BASELINE_FLOOR
    const baseDriftSeverityForRegress = Math.max(
      1e-6,
      DRIFT_SEVERITY_REGRESS_BASELINE_FLOOR,
      baseDriftSeverityP95Raw,
    )
    const driftSeverityP95RegressPct = hasBaseDriftSeverityForRegress
      ? ((row.renderPolicyDriftSeverityP95 - baseDriftSeverityP95Raw) / baseDriftSeverityForRegress) *
        100
      : 0
    const stepRegressPct = ((row.stepP95Ms - base.stepP95Ms) / baseStepP95) * 100
    const throughputDropPct = ((base.throughputMedianPps - row.throughputMedianPps) / baseThroughput) * 100
    const autoCorrectionPer1kStepsRegressPct = hasBaseAutoCorrectionForRegress
      ? ((row.stabilityAutoCorrectionPer1kSteps - Number(base.stabilityAutoCorrectionPer1kSteps ?? 0)) /
          baseAutoCorrectionPer1kSteps) *
        100
      : 0
    const stepFail = stepRegressPct > stepLimitPct
    const throughputFail = throughputDropPct > throughputLimitPct
    const energyFail = Math.abs(row.energyDriftPct) > energyDriftAbsLimit
    const enstrophyFail = Math.abs(row.enstrophyDriftPct) > enstrophyDriftAbsLimit
    const autoCorrectionPer1kStepsRegressFail =
      hasBaseAutoCorrectionForRegress &&
      row.stabilityAutoCorrectionPer1kSteps > baseAutoCorrectionPer1kStepsRaw &&
      autoCorrectionPer1kStepsRegressPct > autoCorrectionPer1kStepsRegressLimit
    const autoCorrectionPer1kStepsAbsFail =
      row.stabilityAutoCorrectionPer1kSteps > autoCorrectionPer1kStepsAbsMax
    const driftSeverityP95RegressFail =
      hasBaseDriftSeverityForRegress &&
      row.renderPolicyDriftSeverityP95 > baseDriftSeverityP95Raw &&
      driftSeverityP95RegressPct > driftSeverityP95RegressLimit
    const driftSeverityP95AbsFail = row.renderPolicyDriftSeverityP95 > driftSeverityP95AbsMax
    const overrideFallbackStormFail =
      Number(row.renderPolicyOverrideCountByReason?.fallback_storm ?? 0) > overrideFallbackStormCountMax
    const overrideTimeoutBurstFail =
      Number(row.renderPolicyOverrideCountByReason?.timeout_burst ?? 0) > overrideTimeoutBurstCountMax
    const overrideInvariantGuardFail =
      Number(row.renderPolicyOverrideCountByReason?.invariant_guard ?? 0) > overrideInvariantGuardCountMax
    const checks = {
      stepP95RegressPct: { value: stepRegressPct, limit: stepLimitPct, pass: !stepFail },
      throughputDropPct: { value: throughputDropPct, limit: throughputLimitPct, pass: !throughputFail },
      energyDriftAbsPct: { value: Math.abs(row.energyDriftPct), limit: energyDriftAbsLimit, pass: !energyFail },
      enstrophyDriftAbsPct: {
        value: Math.abs(row.enstrophyDriftPct),
        limit: enstrophyDriftAbsLimit,
        pass: !enstrophyFail,
      },
      autoCorrectionPer1kStepsRegressPct: {
        value: autoCorrectionPer1kStepsRegressPct,
        limit: autoCorrectionPer1kStepsRegressLimit,
        pass: !autoCorrectionPer1kStepsRegressFail,
      },
      autoCorrectionPer1kStepsAbsMax: {
        value: row.stabilityAutoCorrectionPer1kSteps,
        limit: autoCorrectionPer1kStepsAbsMax,
        pass: !autoCorrectionPer1kStepsAbsFail,
      },
      driftSeverityP95RegressPct: {
        value: driftSeverityP95RegressPct,
        limit: driftSeverityP95RegressLimit,
        pass: !driftSeverityP95RegressFail,
      },
      driftSeverityP95AbsMax: {
        value: row.renderPolicyDriftSeverityP95,
        limit: driftSeverityP95AbsMax,
        pass: !driftSeverityP95AbsFail,
      },
      overrideFallbackStormCountMax: {
        value: Number(row.renderPolicyOverrideCountByReason?.fallback_storm ?? 0),
        limit: overrideFallbackStormCountMax,
        pass: !overrideFallbackStormFail,
      },
      overrideTimeoutBurstCountMax: {
        value: Number(row.renderPolicyOverrideCountByReason?.timeout_burst ?? 0),
        limit: overrideTimeoutBurstCountMax,
        pass: !overrideTimeoutBurstFail,
      },
      overrideInvariantGuardCountMax: {
        value: Number(row.renderPolicyOverrideCountByReason?.invariant_guard ?? 0),
        limit: overrideInvariantGuardCountMax,
        pass: !overrideInvariantGuardFail,
      },
    }
    const failedChecks = Object.entries(checks)
      .filter(([, v]) => v.pass === false)
      .map(([k]) => k)
    return {
      mode: row.mode,
      status: failedChecks.length === 0 ? 'PASS' : 'FAIL',
      failedChecks,
      thresholds: {
        stepP95RegressPct: stepLimitPct,
        throughputDropPct: throughputLimitPct,
        energyDriftAbsPct: energyDriftAbsLimit,
        enstrophyDriftAbsPct: enstrophyDriftAbsLimit,
        autoCorrectionPer1kStepsRegressPct: autoCorrectionPer1kStepsRegressLimit,
        autoCorrectionPer1kStepsAbsMax,
        driftSeverityP95RegressPct: driftSeverityP95RegressLimit,
        driftSeverityP95AbsMax,
        overrideFallbackStormCountMax,
        overrideTimeoutBurstCountMax,
        overrideInvariantGuardCountMax,
      },
      checks,
    }
  })
}

function extractPolicyGateChecks(gateRow) {
  const policyCheckIds = [
    'driftSeverityP95RegressPct',
    'driftSeverityP95AbsMax',
    'overrideFallbackStormCountMax',
    'overrideTimeoutBurstCountMax',
    'overrideInvariantGuardCountMax',
  ]
  const checks = gateRow?.checks ?? {}
  return policyCheckIds
    .map((id) => ({ id, check: checks[id] }))
    .filter((entry) => entry.check && typeof entry.check === 'object')
}

function buildPolicyGateSummary(gateResults) {
  return gateResults.map((row) => {
    if (row?.status === 'NO_BASELINE') {
      return {
        mode: row.mode,
        verdict: 'WARN',
        failedChecks: [],
        note: 'no baseline',
      }
    }
    const policyEntries = extractPolicyGateChecks(row)
    const failedChecks = policyEntries.filter((entry) => entry.check?.pass === false).map((entry) => entry.id)
    return {
      mode: row.mode,
      verdict: failedChecks.length > 0 ? 'FAIL' : 'PASS',
      failedChecks,
      note: failedChecks.length > 0 ? 'policy checks failed' : 'policy checks pass',
    }
  })
}

const COUNT_GATE_IDS = new Set([
  'overrideFallbackStormCountMax',
  'overrideTimeoutBurstCountMax',
  'overrideInvariantGuardCountMax',
])

const UNIT_INTERVAL_GATE_IDS = new Set(['driftSeverityP95AbsMax'])

function suggestRetunedLimit(checkId, value, limit, headroomPct = 12) {
  const safeLimit = Number(limit)
  const safeValue = Number(value)
  if (!Number.isFinite(safeLimit) || !Number.isFinite(safeValue)) {
    return Number.NaN
  }
  const multiplier = 1 + Math.max(0, headroomPct) / 100
  if (COUNT_GATE_IDS.has(checkId)) {
    return Math.max(safeLimit, Math.ceil(Math.max(0, safeValue) * multiplier))
  }
  if (UNIT_INTERVAL_GATE_IDS.has(checkId)) {
    const expanded = Math.max(safeLimit, safeValue * multiplier)
    return Math.max(0, Math.min(1, Number(expanded.toFixed(3))))
  }
  const expanded = Math.max(safeLimit, safeValue * multiplier)
  return Number(expanded.toFixed(3))
}

function buildThresholdRetuningHints(gateResults, { headroomPct = 12, includeNearPass = false } = {}) {
  const hints = []
  const modePatches = {}
  const modeHardwareClassPatches = {}
  const hardwareClassPatch = {}
  for (const row of gateResults) {
    if (row?.status === 'NO_BASELINE') {
      continue
    }
    const modeKey = modeToKey(row?.mode ?? '')
    const checks = row?.checks ?? {}
    for (const [checkId, check] of Object.entries(checks)) {
      const value = Number(check?.value)
      const limit = Number(check?.limit)
      const pass = check?.pass === true
      if (!Number.isFinite(value) || !Number.isFinite(limit)) {
        continue
      }
      const ratio = limit > 0 ? value / limit : Number.POSITIVE_INFINITY
      const nearPass = pass && includeNearPass && ratio >= 0.9
      if (!nearPass && pass) {
        continue
      }
      const suggestedLimit = suggestRetunedLimit(checkId, value, limit, headroomPct)
      if (!Number.isFinite(suggestedLimit)) {
        continue
      }
      if (!modePatches[modeKey]) {
        modePatches[modeKey] = {}
      }
      modePatches[modeKey][checkId] = suggestedLimit
      if (!modeHardwareClassPatches[modeKey]) {
        modeHardwareClassPatches[modeKey] = {}
      }
      modeHardwareClassPatches[modeKey][checkId] = suggestedLimit
      hardwareClassPatch[checkId] = Math.max(
        Number(hardwareClassPatch[checkId] ?? Number.NEGATIVE_INFINITY),
        suggestedLimit,
      )
      hints.push({
        mode: row.mode,
        modeKey,
        checkId,
        value,
        currentLimit: limit,
        suggestedLimit,
        reason: pass ? 'near_pass' : 'fail',
      })
    }
  }
  return {
    profile: LONGRUN_PROFILE,
    hardwareClass: ACTIVE_LONGRUN_HARDWARE_CLASS,
    headroomPct,
    includeNearPass,
    hintCount: hints.length,
    modePatches,
    modeHardwareClassPatches,
    hardwareClassPatch,
    baselinePatchTemplate: {
      thresholdsByModeProfiles: {
        [LONGRUN_PROFILE]: modePatches,
      },
      thresholdsByHardwareClassProfiles: {
        [LONGRUN_PROFILE]: {
          [ACTIVE_LONGRUN_HARDWARE_CLASS]: hardwareClassPatch,
        },
      },
      thresholdsByModeHardwareClassProfiles: {
        [LONGRUN_PROFILE]: {
          [ACTIVE_LONGRUN_HARDWARE_CLASS]: modeHardwareClassPatches,
        },
      },
    },
    hints,
  }
}

function applyRetuningHintsToBaseline(baseline, retuningHints) {
  if (!baseline || typeof baseline !== 'object' || !retuningHints || typeof retuningHints !== 'object') {
    return {
      baseline,
      applied: false,
      appliedHintCount: 0,
      reason: 'no baseline or retuning hints',
    }
  }
  const profile = String(retuningHints.profile ?? LONGRUN_PROFILE)
  const hardwareClass = String(retuningHints.hardwareClass ?? ACTIVE_LONGRUN_HARDWARE_CLASS)
  const modePatches =
    retuningHints.modePatches && typeof retuningHints.modePatches === 'object' ? retuningHints.modePatches : {}
  const hardwareClassPatch =
    retuningHints.hardwareClassPatch && typeof retuningHints.hardwareClassPatch === 'object'
      ? retuningHints.hardwareClassPatch
      : {}
  const modeHardwareClassPatches =
    retuningHints.modeHardwareClassPatches && typeof retuningHints.modeHardwareClassPatches === 'object'
      ? retuningHints.modeHardwareClassPatches
      : {}

  const nextBaseline = {
    ...baseline,
    thresholdsByModeProfiles: { ...(baseline.thresholdsByModeProfiles ?? {}) },
    thresholdsByHardwareClassProfiles: { ...(baseline.thresholdsByHardwareClassProfiles ?? {}) },
    thresholdsByModeHardwareClassProfiles: { ...(baseline.thresholdsByModeHardwareClassProfiles ?? {}) },
  }
  nextBaseline.thresholdsByModeProfiles[profile] = {
    ...(nextBaseline.thresholdsByModeProfiles[profile] ?? {}),
  }
  for (const [modeKey, patch] of Object.entries(modePatches)) {
    nextBaseline.thresholdsByModeProfiles[profile][modeKey] = {
      ...(nextBaseline.thresholdsByModeProfiles[profile][modeKey] ?? {}),
      ...(patch ?? {}),
    }
  }

  nextBaseline.thresholdsByHardwareClassProfiles[profile] = {
    ...(nextBaseline.thresholdsByHardwareClassProfiles[profile] ?? {}),
  }
  nextBaseline.thresholdsByHardwareClassProfiles[profile][hardwareClass] = {
    ...(nextBaseline.thresholdsByHardwareClassProfiles[profile][hardwareClass] ?? {}),
    ...hardwareClassPatch,
  }

  nextBaseline.thresholdsByModeHardwareClassProfiles[profile] = {
    ...(nextBaseline.thresholdsByModeHardwareClassProfiles[profile] ?? {}),
  }
  const existingClassModes = nextBaseline.thresholdsByModeHardwareClassProfiles[profile][hardwareClass] ?? {}
  const mergedClassModes = { ...existingClassModes }
  for (const [modeKey, patch] of Object.entries(modeHardwareClassPatches)) {
    mergedClassModes[modeKey] = {
      ...(mergedClassModes[modeKey] ?? {}),
      ...(patch ?? {}),
    }
  }
  nextBaseline.thresholdsByModeHardwareClassProfiles[profile][hardwareClass] = mergedClassModes

  const appliedHintCount = Math.max(0, Math.floor(Number(retuningHints.hintCount ?? 0)))
  return {
    baseline: nextBaseline,
    applied: appliedHintCount > 0,
    appliedHintCount,
    reason: appliedHintCount > 0 ? 'applied' : 'no hints',
  }
}

async function writePolicyGateTrendSnapshot({ trendPath, generatedAt, profile, hardwareClass, policyGateSummary }) {
  const previous = (await readJsonIfExists(trendPath)) ?? { snapshots: [] }
  const snapshots = Array.isArray(previous.snapshots) ? previous.snapshots : []
  const verdictCounts = policyGateSummary.reduce(
    (acc, row) => {
      const verdict = String(row?.verdict ?? 'WARN')
      if (verdict === 'PASS' || verdict === 'FAIL' || verdict === 'WARN') {
        acc[verdict] += 1
      }
      return acc
    },
    { PASS: 0, WARN: 0, FAIL: 0 },
  )
  const nextEntry = {
    generatedAt,
    profile,
    hardwareClass,
    verdictCounts,
    byMode: policyGateSummary.map((row) => ({
      mode: row.mode,
      verdict: row.verdict,
      failedChecks: Array.isArray(row.failedChecks) ? row.failedChecks : [],
    })),
  }
  const nextSnapshots = [...snapshots, nextEntry].slice(-POLICY_GATE_TREND_MAX)
  const payload = {
    updatedAt: generatedAt,
    snapshots: nextSnapshots,
  }
  await fs.writeFile(trendPath, JSON.stringify(payload, null, 2))
  return payload
}

function buildAllProfilesThresholds(existingThresholdsProfiles = {}) {
  const output = { ...existingThresholdsProfiles }
  for (const [profileId, config] of Object.entries(PROFILE_CONFIGS)) {
    output[profileId] = {
      ...(config?.thresholds ?? {}),
      ...(existingThresholdsProfiles?.[profileId] ?? {}),
    }
  }
  return output
}

function buildAllProfilesThresholdsByMode(existingThresholdsByModeProfiles = {}, modeKeys = []) {
  const output = { ...existingThresholdsByModeProfiles }
  for (const [profileId, config] of Object.entries(PROFILE_CONFIGS)) {
    const existingProfileModes = existingThresholdsByModeProfiles?.[profileId] ?? {}
    const defaultsByMode = config?.thresholdsByMode ?? {}
    const mergedByMode = {}
    for (const modeKey of modeKeys) {
      mergedByMode[modeKey] = {
        ...(defaultsByMode?.[modeKey] ?? {}),
        ...(existingProfileModes?.[modeKey] ?? {}),
      }
    }
    output[profileId] = mergedByMode
  }
  return output
}

function buildAllProfilesThresholdsByHardwareClass(existingThresholdsByHardwareClassProfiles = {}) {
  const output = { ...existingThresholdsByHardwareClassProfiles }
  for (const [profileId] of Object.entries(PROFILE_CONFIGS)) {
    const existingProfileClasses = existingThresholdsByHardwareClassProfiles?.[profileId] ?? {}
    const defaultsByClass = HARDWARE_CLASS_THRESHOLD_PATCHES[profileId] ?? {}
    output[profileId] = {
      low: {
        ...(defaultsByClass.low ?? {}),
        ...(existingProfileClasses.low ?? {}),
      },
      entry_gpu: {
        ...(defaultsByClass.entry_gpu ?? {}),
        ...(existingProfileClasses.entry_gpu ?? {}),
      },
      mid: {
        ...(defaultsByClass.mid ?? {}),
        ...(existingProfileClasses.mid ?? {}),
      },
      high: {
        ...(defaultsByClass.high ?? {}),
        ...(existingProfileClasses.high ?? {}),
      },
    }
  }
  return output
}

function buildAllProfilesThresholdsByModeHardwareClass(
  existingThresholdsByModeHardwareClassProfiles = {},
  modeKeys = [],
) {
  const output = { ...existingThresholdsByModeHardwareClassProfiles }
  const classes = ['low', 'entry_gpu', 'mid', 'high']
  for (const [profileId, config] of Object.entries(PROFILE_CONFIGS)) {
    const existingProfileClasses = existingThresholdsByModeHardwareClassProfiles?.[profileId] ?? {}
    const defaultsByMode = config?.thresholdsByMode ?? {}
    const profileClasses = {}
    for (const classId of classes) {
      const existingModes = existingProfileClasses?.[classId] ?? {}
      const mergedModes = {}
      for (const modeKey of modeKeys) {
        mergedModes[modeKey] = {
          ...(defaultsByMode?.[modeKey] ?? {}),
          ...(existingModes?.[modeKey] ?? {}),
        }
      }
      for (const [modeKey, patch] of Object.entries(existingModes)) {
        if (!Object.prototype.hasOwnProperty.call(mergedModes, modeKey)) {
          mergedModes[modeKey] = {
            ...(defaultsByMode?.[modeKey] ?? {}),
            ...(patch ?? {}),
          }
        }
      }
      profileClasses[classId] = mergedModes
    }
    output[profileId] = profileClasses
  }
  return output
}

async function runAdaptiveMatrixWorkflow() {
  if (!RUN_ADAPTIVE_MATRIX) {
    return { executed: false, skipped: true, reason: 'LONGRUN_ADAPTIVE_MATRIX=false' }
  }
  const outputJsonPath = fileURLToPath(OUTPUT_JSON_URL)
  const outputMatrixJsonPath = path.join(MODULE_DIR, 'adaptive-baseline-matrix.json')
  const outputMatrixMdPath = path.join(MODULE_DIR, 'adaptive-baseline-matrix.md')
  const outputMatrixTrendPath = path.join(MODULE_DIR, 'adaptive-baseline-trend.json')
  const env = {
    ...process.env,
    ADAPTIVE_MATRIX_INPUT: outputJsonPath,
    ADAPTIVE_MATRIX_OUTPUT_JSON: outputMatrixJsonPath,
    ADAPTIVE_MATRIX_OUTPUT_MD: outputMatrixMdPath,
    ADAPTIVE_MATRIX_TREND_PATH: outputMatrixTrendPath,
  }
  if (ADAPTIVE_MATRIX_FAIL_ON_SCENARIO.length > 0) {
    env.ADAPTIVE_MATRIX_FAIL_ON_SCENARIO = ADAPTIVE_MATRIX_FAIL_ON_SCENARIO
    env.ADAPTIVE_MATRIX_MIN_PASS_RATIO = String(ADAPTIVE_MATRIX_MIN_PASS_RATIO)
  } else {
    delete env.ADAPTIVE_MATRIX_FAIL_ON_SCENARIO
  }

  await execFile(process.execPath, ['./adaptiveBaselineMatrix.mjs'], {
    cwd: MODULE_DIR,
    env,
  })
  const matrixPayload = await readJsonIfExists(outputMatrixJsonPath)
  return {
    executed: true,
    outputJsonPath: outputMatrixJsonPath,
    outputMdPath: outputMatrixMdPath,
    outputTrendPath: outputMatrixTrendPath,
    matrixGate: matrixPayload?.matrixGate ?? null,
    scenarioSummary: matrixPayload?.scenarioSummary ?? null,
  }
}

async function runPhysicalBaselineWorkflow() {
  if (!RUN_PHYSICAL_BASELINE) {
    return { executed: false, skipped: true, reason: 'LONGRUN_PHYSICAL_BASELINE=false' }
  }
  const outputJsonPath = path.join(MODULE_DIR, 'physical-realism-baseline.json')
  const outputMdPath = path.join(MODULE_DIR, 'physical-realism-baseline.md')
  const env = {
    ...process.env,
    PHYSICAL_BASELINE_OUTPUT_JSON: outputJsonPath,
    PHYSICAL_BASELINE_OUTPUT_MD: outputMdPath,
    PHYSICAL_BASELINE_FAIL_ON_GATE: PHYSICAL_BASELINE_FAIL_ON_GATE ? 'true' : 'false',
  }
  await execFile(process.execPath, ['./physicalRealismBaseline.mjs'], {
    cwd: MODULE_DIR,
    env,
  })
  const payload = await readJsonIfExists(outputJsonPath)
  return {
    executed: true,
    outputJsonPath,
    outputMdPath,
    gate: payload?.gate ?? null,
  }
}

async function runExtendedPhysicsMatrixWorkflow() {
  if (!RUN_EXTENDED_PHYSICS_MATRIX) {
    return { executed: false, skipped: true, reason: 'LONGRUN_EXTENDED_PHYSICS_MATRIX=false' }
  }
  const outputJsonPath = path.join(MODULE_DIR, 'extended-physics-matrix.json')
  const outputMdPath = path.join(MODULE_DIR, 'extended-physics-matrix.md')
  const env = {
    ...process.env,
    EXTENDED_PHYSICS_MATRIX_OUTPUT_JSON: outputJsonPath,
    EXTENDED_PHYSICS_MATRIX_OUTPUT_MD: outputMdPath,
    EXTENDED_PHYSICS_MATRIX_FAIL_ON_GATE: FAIL_ON_GATE ? 'true' : 'false',
  }
  await execFile(process.execPath, ['./extendedPhysicsMatrix.mjs'], {
    cwd: MODULE_DIR,
    env,
  })
  const payload = await readJsonIfExists(outputJsonPath)
  return {
    executed: true,
    outputJsonPath,
    outputMdPath,
    gate: payload?.gate ?? null,
  }
}

async function runHybridPlusSchedulerAuditWorkflow() {
  if (!RUN_HYBRIDPLUS_SCHEDULER_AUDIT) {
    return { executed: false, skipped: true, reason: 'LONGRUN_HYBRIDPLUS_SCHEDULER_AUDIT=false' }
  }
  const outputJsonPath = path.join(MODULE_DIR, 'hybridplus-scheduler-audit.json')
  const outputMdPath = path.join(MODULE_DIR, 'hybridplus-scheduler-audit.md')
  const env = {
    ...process.env,
    HYBRIDPLUS_SCHEDULER_OUTPUT_JSON: outputJsonPath,
    HYBRIDPLUS_SCHEDULER_OUTPUT_MD: outputMdPath,
    HYBRIDPLUS_SCHEDULER_FAIL_ON_GATE: FAIL_ON_GATE ? 'true' : 'false',
  }
  await execFile(process.execPath, ['./hybridPlusSchedulerAudit.mjs'], {
    cwd: MODULE_DIR,
    env,
  })
  const payload = await readJsonIfExists(outputJsonPath)
  return {
    executed: true,
    outputJsonPath,
    outputMdPath,
    gate: payload?.gate ?? null,
  }
}

async function runCase(page, scenario) {
  const scenarioParticleCount = resolveScenarioParticleCount(scenario)
  const scenarioTiming = resolveScenarioTiming(scenario)
  const casePromise = page.evaluate(
    async ({ scenarioInner, particleCountInner, warmupSecInner, durationSecInner, sampleEveryMsInner }) => {
      const api = window.__torusTestApi
      if (!api) {
        throw new Error('__torusTestApi is unavailable')
      }
      api.pulse('stop')
      api.setMode(scenarioInner.modePatch)
      api.setParams({
        uiLanguage: 'en',
        particleCount: particleCountInner,
        showVectors: false,
        showBoth: false,
        vectorDisplayMode: 'particles',
        energyDiagnosticsEnabled: true,
        structureDetectionEnabled: true,
        ...(scenarioInner.paramsPatch ?? {}),
      })
      api.resetParticles()
      await api.waitForMs(400)
      api.pulse('startTrain')
      await api.waitForMs(Math.max(0, Math.floor(warmupSecInner * 1000)))

      let health = api.getHealth?.() ?? {
        simulationAdvancing: false,
        hasParticles: false,
      }
      for (let healthAttempt = 0; healthAttempt < 10; healthAttempt += 1) {
        const timeNow = Number(health.simulationTime ?? 0) || 0
        if (health.simulationAdvancing && health.hasParticles && timeNow > 1e-4) {
          break
        }
        if (healthAttempt === 3 || healthAttempt === 6) {
          api.pulse('startTrain')
        }
        await api.waitForMs(250)
        health = api.getHealth?.() ?? {
          simulationAdvancing: false,
          hasParticles: false,
        }
      }
      if (
        !health.simulationAdvancing ||
        !health.hasParticles ||
        (Number(health.simulationTime ?? 0) || 0) <= 1e-4
      ) {
        api.pulse('stop')
        throw new Error(
          `Runtime health check failed for ${scenarioInner.title}: advancing=${String(
            health.simulationAdvancing,
          )}, hasParticles=${String(health.hasParticles)}, time=${Number(
            health.simulationTime ?? 0,
          ).toFixed(4)}, active=${Math.floor(Number(health.activeCount ?? 0))}`,
        )
      }
      const startDiag = api.getRuntimeDiagnostics()
      const startParams = api.getParams()
      const samples = []
      const iterations = Math.max(1, Math.floor((durationSecInner * 1000) / sampleEveryMsInner))
      for (let i = 0; i < iterations; i += 1) {
        await api.waitForMs(sampleEveryMsInner)
        samples.push({
          tMs: (i + 1) * sampleEveryMsInner,
          diag: api.getRuntimeDiagnostics(),
          params: api.getParams(),
        })
      }
      const endDiag = api.getRuntimeDiagnostics()
      const endParams = api.getParams()
      api.pulse('stop')

      return {
        mode: scenarioInner.title,
        requestedParticles: particleCountInner,
        samples,
        startDiag,
        endDiag,
        startParams,
        endParams,
        syncViolationDelta: Math.max(
          0,
          Math.floor((endParams.runtimeGpuSyncViolationCount ?? 0) - (startParams.runtimeGpuSyncViolationCount ?? 0)),
        ),
        fullReadbackDelta: Math.max(
          0,
          Math.floor((endParams.runtimeGpuFullReadbackCount ?? 0) - (startParams.runtimeGpuFullReadbackCount ?? 0)),
        ),
        skippedReadbackDelta: Math.max(
          0,
          Math.floor(
            (endParams.runtimeGpuSkippedReadbackCount ?? 0) - (startParams.runtimeGpuSkippedReadbackCount ?? 0),
          ),
        ),
      }
    },
    {
      scenarioInner: scenario,
      particleCountInner: scenarioParticleCount,
      warmupSecInner: scenarioTiming.warmupSec,
      durationSecInner: scenarioTiming.durationSec,
      sampleEveryMsInner: scenarioTiming.sampleEveryMs,
    },
  )
  const timeoutMs = Math.max(30_000, Math.floor(CASE_TIMEOUT_SEC * 1000))
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Case timeout for ${scenario.title} after ${Math.floor(timeoutMs / 1000)}s`))
    }, timeoutMs)
    // Keep explicit per-case timeout semantics without blocking clean process exit.
    if (timeoutId && typeof timeoutId.unref === 'function') {
      timeoutId.unref()
    }
  })
  try {
    return await Promise.race([casePromise, timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

async function launchBrowser(customExecutablePath) {
  const launchArgs = [
    '--ignore-gpu-blocklist',
    '--enable-unsafe-webgpu',
    '--use-angle=metal',
    ...(PLAYWRIGHT_HEADLESS ? ['--use-gl=swiftshader'] : []),
  ]
  const baseOptions = {
    headless: PLAYWRIGHT_HEADLESS,
    args: launchArgs,
    ...(customExecutablePath ? { executablePath: customExecutablePath } : {}),
  }

  if (PLAYWRIGHT_BROWSER_CHANNEL) {
    try {
      const browser = await chromium.launch({
        ...baseOptions,
        channel: PLAYWRIGHT_BROWSER_CHANNEL,
      })
      return {
        browser,
        launchInfo: {
          requestedChannel: PLAYWRIGHT_BROWSER_CHANNEL,
          resolvedChannel: PLAYWRIGHT_BROWSER_CHANNEL,
          fallbackUsed: false,
          fallbackReason: '',
        },
      }
    } catch (error) {
      console.warn(
        `[longrun] Failed to launch channel "${PLAYWRIGHT_BROWSER_CHANNEL}", fallback to bundled chromium: ${error.message}`,
      )
      const browser = await chromium.launch(baseOptions)
      return {
        browser,
        launchInfo: {
          requestedChannel: PLAYWRIGHT_BROWSER_CHANNEL,
          resolvedChannel: 'bundled-chromium',
          fallbackUsed: true,
          fallbackReason: String(error?.message ?? 'channel_launch_failed'),
        },
      }
    }
  }
  const browser = await chromium.launch(baseOptions)
  return {
    browser,
    launchInfo: {
      requestedChannel: PLAYWRIGHT_BROWSER_CHANNEL || 'bundled-chromium',
      resolvedChannel: 'bundled-chromium',
      fallbackUsed: false,
      fallbackReason: '',
    },
  }
}

async function detectHardwareClassFromPage(page) {
  return page.evaluate(async () => {
    const cpuThreads = Number.isFinite(Number(navigator?.hardwareConcurrency))
      ? Math.max(1, Math.floor(Number(navigator.hardwareConcurrency)))
      : 4
    const memoryGbRaw = Number(navigator?.deviceMemory)
    const memoryGb = Number.isFinite(memoryGbRaw) && memoryGbRaw > 0 ? memoryGbRaw : 8
    let hasWebGpu = false
    if (navigator?.gpu && typeof navigator.gpu.requestAdapter === 'function') {
      try {
        const adapter = await navigator.gpu.requestAdapter()
        hasWebGpu = Boolean(adapter)
      } catch {
        hasWebGpu = false
      }
    }
    let hardwareClass = 'low'
    if (hasWebGpu && memoryGb >= 16 && cpuThreads >= 8) {
      hardwareClass = 'high'
    } else if (hasWebGpu && memoryGb >= 8 && cpuThreads >= 6) {
      hardwareClass = 'mid'
    } else if (hasWebGpu && memoryGb >= 6 && cpuThreads >= 4) {
      hardwareClass = 'entry_gpu'
    }
    return {
      hardwareClass,
      cpuThreads,
      memoryGb,
      hasWebGpu,
      summary: `cpu:${cpuThreads},mem:${memoryGb}GB,webgpu:${hasWebGpu ? 'yes' : 'no'}`,
    }
  })
}

function isTransientExecutionContextError(error) {
  const message = String(error?.message ?? error ?? '')
  return (
    message.includes('Execution context was destroyed') ||
    message.includes('__torusTestApi is unavailable') ||
    message.includes('Target page, context or browser has been closed') ||
    message.includes('Most likely the page has been closed')
  )
}

async function ensureApiReady(page, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const apiReady = await page.evaluate(() => Boolean(window.__torusTestApi))
    if (apiReady) {
      return true
    }
    await sleep(250)
  }
  return false
}

async function recoverPageContext(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  const apiReady = await ensureApiReady(page, 40)
  if (!apiReady) {
    throw new Error(
      '__torusTestApi did not initialize in time after page context recovery. Ensure Vite dev server is running and browser has GPU/WebGL/WebGPU access.',
    )
  }
  await sleep(1200)
}

async function main() {
  const customExecutablePath =
    typeof process.env.PLAYWRIGHT_EXECUTABLE_PATH === 'string'
      ? process.env.PLAYWRIGHT_EXECUTABLE_PATH.trim()
      : ''
  const launch = await launchBrowser(customExecutablePath)
  const browser = launch.browser
  const launchInfo = launch.launchInfo ?? {
    requestedChannel: PLAYWRIGHT_BROWSER_CHANNEL || 'bundled-chromium',
    resolvedChannel: PLAYWRIGHT_BROWSER_CHANNEL || 'bundled-chromium',
    fallbackUsed: false,
    fallbackReason: '',
  }
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
    await context.addInitScript(() => {
      window.__torusDisableAutoCalibration = true
      localStorage.setItem('toroidalVortexParams', JSON.stringify({ uiLanguage: 'en' }))
    })
    const page = await context.newPage()
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })

    const apiReady = await ensureApiReady(page, 40)
    if (!apiReady) {
      throw new Error(
        '__torusTestApi did not initialize in time. Ensure Vite dev server is running and browser has GPU/WebGL/WebGPU access (try PLAYWRIGHT_HEADLESS=false and PLAYWRIGHT_BROWSER_CHANNEL=chrome).',
      )
    }
    await sleep(1200)
    let detectedHardware = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        detectedHardware = await detectHardwareClassFromPage(page)
        break
      } catch (error) {
        if (attempt < 2 && isTransientExecutionContextError(error)) {
          console.warn('[longrun] transient context loss during hardware detection; retrying after reload')
          await recoverPageContext(page)
          continue
        }
        throw error
      }
    }
    ACTIVE_LONGRUN_HARDWARE_CLASS =
      LONGRUN_HARDWARE_CLASS_OVERRIDE !== 'unknown'
        ? LONGRUN_HARDWARE_CLASS_OVERRIDE
        : normalizeHardwareClass(detectedHardware?.hardwareClass)
    console.log(
      `[longrun] hardware class: ${ACTIVE_LONGRUN_HARDWARE_CLASS} (source=${LONGRUN_HARDWARE_CLASS_OVERRIDE !== 'unknown' ? 'env' : 'auto'}, ${detectedHardware.summary})`,
    )

    const rawResults = []
    for (const scenario of ACTIVE_MODE_SCENARIOS) {
      let run
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          run = await runCase(page, scenario)
          break
        } catch (error) {
          if (attempt < 2 && isTransientExecutionContextError(error)) {
            console.warn(
              `[longrun] transient page context loss in ${scenario.title}; reloading context and retrying`,
            )
            await recoverPageContext(page)
            continue
          }
          throw error
        }
      }
      rawResults.push(run)
    }

    const summaryRows = rawResults.map(summarizeCase)
    const baseline = await readJsonIfExists(BASELINE_PATH)
    const gateResults = compareWithBaseline(summaryRows, baseline)
    const gateFailed = gateResults.some((row) => row.status === 'FAIL')
    const thresholdRetuningHints = baseline
      ? buildThresholdRetuningHints(gateResults, {
          headroomPct: RETUNE_HEADROOM_PCT,
          includeNearPass: RETUNE_INCLUDE_NEAR_PASS,
        })
      : null
    const retuningApplyResult =
      APPLY_RETUNING_HINTS && baseline && thresholdRetuningHints
        ? applyRetuningHintsToBaseline(baseline, thresholdRetuningHints)
        : {
            baseline,
            applied: false,
            appliedHintCount: 0,
            reason: APPLY_RETUNING_HINTS ? 'no baseline or hints' : 'disabled',
          }
    const effectiveBaseline = retuningApplyResult.baseline
    if (APPLY_RETUNING_HINTS && retuningApplyResult.applied && effectiveBaseline) {
      await fs.writeFile(BASELINE_PATH, JSON.stringify(effectiveBaseline, null, 2))
    }
    const policyGateSummary = buildPolicyGateSummary(gateResults)
    const generatedAt = new Date().toISOString()
    const policyGateTrend = await writePolicyGateTrendSnapshot({
      trendPath: POLICY_GATE_TREND_PATH,
      generatedAt,
      profile: LONGRUN_PROFILE,
      hardwareClass: ACTIVE_LONGRUN_HARDWARE_CLASS,
      policyGateSummary,
    })
    const recommendations = summaryRows.map((row) => ({
      mode: row.mode,
      stability: row.stability,
      recommendation: inferRecommendation(row),
    }))
    const renderPolicySummary = summaryRows.map((row) => ({
      mode: row.mode,
      overrideCountTotal: row.renderPolicyOverrideCount,
      overrideCountByReason: { ...row.renderPolicyOverrideCountByReason },
      driftSeverityP95: row.renderPolicyDriftSeverityP95,
      driftSeverityAvg: row.renderPolicyDriftSeverityAvg,
    }))
    const payload = {
      generatedAt,
      baseUrl: BASE_URL,
      config: {
        profile: LONGRUN_PROFILE,
        runnerMode: LONGRUN_RUNNER_MODE,
        hardwareClass: ACTIVE_LONGRUN_HARDWARE_CLASS,
        hardwareClassSource: LONGRUN_HARDWARE_CLASS_OVERRIDE !== 'unknown' ? 'env' : 'auto',
        particleCount: PARTICLE_COUNT,
        warmupSec: WARMUP_SEC,
        durationSec: DURATION_SEC,
        sampleEveryMs: SAMPLE_EVERY_MS,
        headless: PLAYWRIGHT_HEADLESS,
        browserChannelRequested: launchInfo.requestedChannel,
        browserChannelResolved: launchInfo.resolvedChannel,
        browserChannelFallbackUsed: launchInfo.fallbackUsed === true,
        browserChannelFallbackReason: launchInfo.fallbackReason || '',
        baselinePath: BASELINE_PATH,
        retuneHeadroomPct: RETUNE_HEADROOM_PCT,
        retuneIncludeNearPass: RETUNE_INCLUDE_NEAR_PASS,
        applyRetuningHints: APPLY_RETUNING_HINTS,
        scenarios: ACTIVE_MODE_SCENARIOS.map((s) => s.title),
        scenarioParticleCounts: ACTIVE_MODE_SCENARIOS.map((s) => ({
          mode: s.title,
          particleCount: resolveScenarioParticleCount(s),
          timing: resolveScenarioTiming(s),
        })),
      },
      summaryRows,
      renderPolicySummary,
      policyGateSummary,
      thresholdRetuningHints,
      retuningApplyResult: {
        enabled: APPLY_RETUNING_HINTS,
        applied: retuningApplyResult.applied,
        appliedHintCount: retuningApplyResult.appliedHintCount,
        reason: retuningApplyResult.reason,
      },
      policyGateTrend: {
        path: POLICY_GATE_TREND_PATH,
        snapshots: Array.isArray(policyGateTrend?.snapshots) ? policyGateTrend.snapshots.length : 0,
      },
      gateResults,
      gateFailed,
      recommendations,
      rawResults,
    }
    if (UPDATE_BASELINE) {
      const existingThresholdsByMode = effectiveBaseline?.thresholdsByMode ?? {}
      const existingThresholdsProfiles = effectiveBaseline?.thresholdsProfiles ?? {}
      const existingThresholdsByModeProfiles = effectiveBaseline?.thresholdsByModeProfiles ?? {}
      const existingThresholdsByHardwareClass = effectiveBaseline?.thresholdsByHardwareClass ?? {}
      const existingThresholdsByHardwareClassProfiles = effectiveBaseline?.thresholdsByHardwareClassProfiles ?? {}
      const existingThresholdsByModeHardwareClassProfiles = effectiveBaseline?.thresholdsByModeHardwareClassProfiles ?? {}
      const thresholdsByMode = {}
      for (const row of summaryRows) {
        const key = modeToKey(row.mode)
        thresholdsByMode[key] = {
          ...DEFAULT_GATE_THRESHOLDS_BY_MODE[key],
          ...(existingThresholdsByMode[key] ?? {}),
        }
      }
      const profileThresholds = {
        ...DEFAULT_GATE_THRESHOLDS,
        ...getDefaultGateThresholdsByHardwareClass(ACTIVE_LONGRUN_HARDWARE_CLASS),
        ...(existingThresholdsProfiles[LONGRUN_PROFILE] ?? {}),
      }
      const existingProfileThresholdsByMode = existingThresholdsByModeProfiles[LONGRUN_PROFILE] ?? {}
      const profileThresholdsByMode = {}
      for (const row of summaryRows) {
        const key = modeToKey(row.mode)
        profileThresholdsByMode[key] = {
          ...DEFAULT_GATE_THRESHOLDS_BY_MODE[key],
          ...(existingProfileThresholdsByMode[key] ?? {}),
        }
      }
      const allModeKeys = summaryRows.map((row) => modeToKey(row.mode))
      const autoThresholdsProfiles = buildAllProfilesThresholds(existingThresholdsProfiles)
      const autoThresholdsByModeProfiles = buildAllProfilesThresholdsByMode(
        existingThresholdsByModeProfiles,
        allModeKeys,
      )
      const autoThresholdsByHardwareClassProfiles = buildAllProfilesThresholdsByHardwareClass(
        existingThresholdsByHardwareClassProfiles,
      )
      const autoThresholdsByModeHardwareClassProfiles = buildAllProfilesThresholdsByModeHardwareClass(
        existingThresholdsByModeHardwareClassProfiles,
        allModeKeys,
      )
      autoThresholdsProfiles[LONGRUN_PROFILE] = {
        ...autoThresholdsProfiles[LONGRUN_PROFILE],
        ...profileThresholds,
      }
      autoThresholdsByModeProfiles[LONGRUN_PROFILE] = {
        ...autoThresholdsByModeProfiles[LONGRUN_PROFILE],
        ...profileThresholdsByMode,
      }
      const existingProfileModeHardwareClassThresholds =
        existingThresholdsByModeHardwareClassProfiles?.[LONGRUN_PROFILE]?.[ACTIVE_LONGRUN_HARDWARE_CLASS] ?? {}
      const profileThresholdsByModeHardwareClass = {}
      for (const row of summaryRows) {
        const key = modeToKey(row.mode)
        profileThresholdsByModeHardwareClass[key] = {
          ...DEFAULT_GATE_THRESHOLDS_BY_MODE[key],
          ...(existingProfileModeHardwareClassThresholds[key] ?? {}),
        }
      }
      const thresholdsByHardwareClass = {
        low: {
          ...(HARDWARE_CLASS_THRESHOLD_PATCHES[LONGRUN_PROFILE]?.low ?? {}),
          ...(existingThresholdsByHardwareClass.low ?? {}),
        },
        entry_gpu: {
          ...(HARDWARE_CLASS_THRESHOLD_PATCHES[LONGRUN_PROFILE]?.entry_gpu ?? {}),
          ...(existingThresholdsByHardwareClass.entry_gpu ?? {}),
        },
        mid: {
          ...(HARDWARE_CLASS_THRESHOLD_PATCHES[LONGRUN_PROFILE]?.mid ?? {}),
          ...(existingThresholdsByHardwareClass.mid ?? {}),
        },
        high: {
          ...(HARDWARE_CLASS_THRESHOLD_PATCHES[LONGRUN_PROFILE]?.high ?? {}),
          ...(existingThresholdsByHardwareClass.high ?? {}),
        },
      }
      autoThresholdsByHardwareClassProfiles[LONGRUN_PROFILE] = {
        ...autoThresholdsByHardwareClassProfiles[LONGRUN_PROFILE],
        ...(HARDWARE_CLASS_THRESHOLD_PATCHES[LONGRUN_PROFILE] ?? {}),
      }
      autoThresholdsByModeHardwareClassProfiles[LONGRUN_PROFILE] = {
        ...(autoThresholdsByModeHardwareClassProfiles[LONGRUN_PROFILE] ?? {}),
        [ACTIVE_LONGRUN_HARDWARE_CLASS]: {
          ...((autoThresholdsByModeHardwareClassProfiles[LONGRUN_PROFILE] ?? {})[ACTIVE_LONGRUN_HARDWARE_CLASS] ?? {}),
          ...profileThresholdsByModeHardwareClass,
        },
      }
      const baselinePayload = {
        generatedAt: payload.generatedAt,
        rows: summaryRows.map((row) => ({
          mode: row.mode,
          stepP95Ms: row.stepP95Ms,
          throughputMedianPps: row.throughputMedianPps,
          stabilityAutoCorrectionPer1kSteps: row.stabilityAutoCorrectionPer1kSteps,
          renderPolicyDriftSeverityP95: row.renderPolicyDriftSeverityP95,
          renderPolicyOverrideCountByReason: { ...row.renderPolicyOverrideCountByReason },
        })),
        thresholds: { ...DEFAULT_GATE_THRESHOLDS, ...(effectiveBaseline?.thresholds ?? {}) },
        thresholdsByMode,
        thresholdsByHardwareClass,
        thresholdsProfiles: autoThresholdsProfiles,
        thresholdsByModeProfiles: autoThresholdsByModeProfiles,
        thresholdsByHardwareClassProfiles: autoThresholdsByHardwareClassProfiles,
        thresholdsByModeHardwareClassProfiles: autoThresholdsByModeHardwareClassProfiles,
      }
      await fs.writeFile(BASELINE_PATH, JSON.stringify(baselinePayload, null, 2))
    }
    await fs.writeFile(OUTPUT_JSON_URL, JSON.stringify(payload, null, 2))

    const markdown = [
      '# Long-run stability benchmark suite',
      '',
      `Generated: ${payload.generatedAt}`,
      '',
      '## Main metrics',
      '',
      buildMarkdownTable(summaryRows),
      '',
      '## Recommendations',
      '',
      '| Mode | Stability | Recommendation |',
      '|---|---|---|',
      ...recommendations.map((row) => `| ${row.mode} | ${row.stability} | ${row.recommendation} |`),
      '',
      '## Baseline Gates',
      '',
      baseline
        ? '| Mode | Gate | Failed checks |'
        : 'Baseline not found. Run with `LONGRUN_UPDATE_BASELINE=true` to seed baseline.',
      baseline ? '|---|---|---|' : '',
      ...(baseline
        ? gateResults.map((row) => {
            const failed = Array.isArray(row.failedChecks) && row.failedChecks.length > 0
              ? row.failedChecks.join(', ')
              : '-'
            return `| ${row.mode} | ${row.status} | ${failed} |`
          })
        : []),
      '',
      '## Policy Gate Verdict',
      '',
      baseline ? '| Mode | Verdict | Failed policy checks | Note |' : 'Baseline not found. Policy verdict unavailable.',
      baseline ? '|---|---|---|---|' : '',
      ...(baseline
        ? policyGateSummary.map((row) => {
            const failed = Array.isArray(row.failedChecks) && row.failedChecks.length > 0
              ? row.failedChecks.join(', ')
              : '-'
            return `| ${row.mode} | ${row.verdict} | ${failed} | ${row.note} |`
          })
        : []),
      '',
      '## Policy Gates',
      '',
      baseline
        ? '| Mode | Policy gate | Value | Limit | Pass |'
        : 'Baseline not found. Policy gates require baseline thresholds.',
      baseline ? '|---|---|---:|---:|---|' : '',
      ...(baseline
        ? gateResults.flatMap((row) => {
            const entries = extractPolicyGateChecks(row)
            if (entries.length <= 0) {
              return [`| ${row.mode} | - | - | - | - |`]
            }
            return entries.map(
              (entry) =>
                `| ${row.mode} | ${entry.id} | ${Number(entry.check.value ?? 0).toFixed(3)} | ${Number(entry.check.limit ?? 0).toFixed(3)} | ${entry.check.pass ? 'PASS' : 'FAIL'} |`,
            )
          })
        : []),
      '',
      '## Threshold Retuning Hints (TT-017D)',
      '',
      baseline
        ? '| Mode | Check | Value | Current limit | Suggested limit | Reason |'
        : 'Baseline not found. Retuning hints unavailable.',
      baseline ? '|---|---|---:|---:|---:|---|' : '',
      ...(baseline
        ? (thresholdRetuningHints?.hints?.length ?? 0) > 0
          ? thresholdRetuningHints.hints.map(
              (entry) =>
                `| ${entry.mode} | ${entry.checkId} | ${Number(entry.value).toFixed(3)} | ${Number(entry.currentLimit).toFixed(3)} | ${Number(entry.suggestedLimit).toFixed(3)} | ${entry.reason} |`,
            )
          : ['| - | - | - | - | - | no retuning needed |']
        : []),
      '',
      baseline
        ? `Suggested patch paths: \`thresholdsByModeProfiles.${LONGRUN_PROFILE}.*\`, \`thresholdsByHardwareClassProfiles.${LONGRUN_PROFILE}.${ACTIVE_LONGRUN_HARDWARE_CLASS}\`, \`thresholdsByModeHardwareClassProfiles.${LONGRUN_PROFILE}.${ACTIVE_LONGRUN_HARDWARE_CLASS}.*\` (headroom: ${RETUNE_HEADROOM_PCT}%).`
        : '',
      baseline ? 'Patch template is emitted into `thresholdRetuningHints.baselinePatchTemplate` (JSON artifact).' : '',
      '',
      '## Retuning Auto-Apply',
      '',
      baseline
        ? `enabled=${APPLY_RETUNING_HINTS ? 'true' : 'false'}, applied=${retuningApplyResult.applied ? 'true' : 'false'}, hints=${retuningApplyResult.appliedHintCount}, reason=${retuningApplyResult.reason}`
        : 'Baseline not found. Auto-apply skipped.',
      '',
    ].join('\n')
    await fs.writeFile(OUTPUT_MD_URL, markdown)

    const adaptiveMatrixWorkflow = await runAdaptiveMatrixWorkflow()
    payload.adaptiveMatrixWorkflow = adaptiveMatrixWorkflow
    const physicalBaselineWorkflow = await runPhysicalBaselineWorkflow()
    payload.physicalBaselineWorkflow = physicalBaselineWorkflow
    const extendedPhysicsMatrixWorkflow = await runExtendedPhysicsMatrixWorkflow()
    payload.extendedPhysicsMatrixWorkflow = extendedPhysicsMatrixWorkflow
    const hybridPlusSchedulerAuditWorkflow = await runHybridPlusSchedulerAuditWorkflow()
    payload.hybridPlusSchedulerAuditWorkflow = hybridPlusSchedulerAuditWorkflow
    await fs.writeFile(OUTPUT_JSON_URL, JSON.stringify(payload, null, 2))

    console.table(
      summaryRows.map((row) => ({
        mode: row.mode,
        actualN: row.actualParticles,
        stepMedMs: Number(row.stepMedianMs.toFixed(2)),
        stepP95Ms: Number(row.stepP95Ms.toFixed(2)),
        throughputPps: Math.round(row.throughputMedianPps),
        energyDriftPct: Number(row.energyDriftPct.toFixed(1)),
        enstrophyDriftPct: Number(row.enstrophyDriftPct.toFixed(1)),
        autoCorrPer1k: Number(row.stabilityAutoCorrectionPer1kSteps.toFixed(2)),
        syncDelta: `${row.syncViolationDelta}/${row.fullReadbackDelta}/${row.skippedReadbackDelta}`,
        newtoniumTransitions: row.newtoniumTransitionsDelta,
        overrideTotal: row.renderPolicyOverrideCount,
        overrideReasons: `${row.renderPolicyOverrideCountByReason.fallback_storm}/${row.renderPolicyOverrideCountByReason.timeout_burst}/${row.renderPolicyOverrideCountByReason.invariant_guard}`,
        driftP95: Number(row.renderPolicyDriftSeverityP95.toFixed(3)),
        stability: row.stability,
      })),
    )
    if (baseline) {
      console.table(
        gateResults.map((row) => ({
          mode: row.mode,
          gate: row.status,
          failedChecks: Array.isArray(row.failedChecks) && row.failedChecks.length > 0
            ? row.failedChecks.join(',')
            : '-',
        })),
      )
      console.table(
        policyGateSummary.map((row) => ({
          mode: row.mode,
          policyVerdict: row.verdict,
          failedPolicyChecks:
            Array.isArray(row.failedChecks) && row.failedChecks.length > 0 ? row.failedChecks.join(',') : '-',
        })),
      )
      if (thresholdRetuningHints && Array.isArray(thresholdRetuningHints.hints) && thresholdRetuningHints.hints.length > 0) {
        console.table(
          thresholdRetuningHints.hints.map((entry) => ({
            mode: entry.mode,
            check: entry.checkId,
            value: Number(entry.value.toFixed(3)),
            currentLimit: Number(entry.currentLimit.toFixed(3)),
            suggestedLimit: Number(entry.suggestedLimit.toFixed(3)),
            reason: entry.reason,
          })),
        )
      }
    } else {
      console.log(
        '[longrun] Baseline file not found. Use LONGRUN_UPDATE_BASELINE=true to create one:',
        BASELINE_PATH,
      )
    }
    if (FAIL_ON_GATE && gateFailed) {
      throw new Error('Long-run gate failed versus baseline (see gateResults in output).')
    }
    if (adaptiveMatrixWorkflow?.matrixGate && adaptiveMatrixWorkflow.matrixGate.pass === false) {
      throw new Error(
        `Adaptive matrix gate failed (${adaptiveMatrixWorkflow.matrixGate.scenarioId}) ratio=${Number(
          adaptiveMatrixWorkflow.matrixGate.actualPassRatio ?? 0,
        ).toFixed(3)} < min=${Number(adaptiveMatrixWorkflow.matrixGate.minPassRatio ?? 1).toFixed(3)}`,
      )
    }
    if (
      PHYSICAL_BASELINE_FAIL_ON_GATE &&
      physicalBaselineWorkflow?.gate &&
      physicalBaselineWorkflow.gate.pass === false
    ) {
      throw new Error(
        `Physical baseline gate failed: ${(physicalBaselineWorkflow.gate.failedChecks ?? []).join(', ')}`,
      )
    }
    if (FAIL_ON_GATE && extendedPhysicsMatrixWorkflow?.gate && extendedPhysicsMatrixWorkflow.gate.pass === false) {
      throw new Error(
        `Extended physics matrix gate failed: ${(extendedPhysicsMatrixWorkflow.gate.failedChecks ?? []).join(', ')}`,
      )
    }
    if (FAIL_ON_GATE && hybridPlusSchedulerAuditWorkflow?.gate && hybridPlusSchedulerAuditWorkflow.gate.pass === false) {
      throw new Error(
        `Hybrid+ scheduler audit gate failed: ${(hybridPlusSchedulerAuditWorkflow.gate.failedChecks ?? []).join(', ')}`,
      )
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
