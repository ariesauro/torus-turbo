import { useSimulationStore } from '../../state/simulationStore'
import {
  createCustomProfileFromParams,
  detectHardwareProfile,
  loadCustomPerformanceProfiles,
  saveCustomPerformanceProfiles,
} from './hardwareProfiles'

const AUTO_CALIBRATION_FIRST_RUN_KEY = 'torusTurboFirstRunCalibrationV1'
const AUTO_CALIBRATION_BASELINES_KEY = 'torusTurboHardwareBaselinesV1'

let inFlightCalibration = null

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
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

function fingerprintFromHardware(detection) {
  return [
    String(detection?.hardwareClass ?? 'unknown'),
    String(detection?.cpuThreads ?? 'na'),
    String(detection?.memoryGb ?? 'na'),
    String(detection?.gpuLabel ?? 'none'),
  ].join('|')
}

function loadBaselines() {
  if (typeof window === 'undefined') {
    return []
  }
  try {
    const raw = window.localStorage.getItem(AUTO_CALIBRATION_BASELINES_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveBaselines(baselines) {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(AUTO_CALIBRATION_BASELINES_KEY, JSON.stringify(baselines))
}

function selectProfileIdByWinner(winnerKey, hardwareClass) {
  if (winnerKey === 'hybrid_plus') return 'quality'
  if (winnerKey === 'hybrid') return hardwareClass === 'high' ? 'quality' : 'auto_balanced'
  if (winnerKey === 'gpu') return hardwareClass === 'low' ? 'performance' : 'balanced'
  return 'performance'
}

function createScenarioDefinitions() {
  return [
    {
      key: 'cpu',
      label: 'CPU',
      patch: {
        executionMode: 'cpu',
        vortexRepresentation: 'particles',
        dynamicsMode: 'guidedPhysics',
        hybridPlusEnabled: false,
        gpuAutoQualityGuardEnabled: false,
      },
    },
    {
      key: 'gpu',
      label: 'GPU',
      patch: {
        executionMode: 'gpu',
        vortexRepresentation: 'particles',
        dynamicsMode: 'guidedPhysics',
        hybridPlusEnabled: false,
        gpuAutoQualityGuardEnabled: true,
      },
    },
    {
      key: 'hybrid',
      label: 'Hybrid',
      patch: {
        executionMode: 'hybrid',
        vortexRepresentation: 'hybrid',
        dynamicsMode: 'fullPhysics',
        hybridPlusEnabled: false,
        hybridFilamentToParticleBatchingEnabled: true,
      },
    },
    {
      key: 'hybrid_plus',
      label: 'Hybrid+',
      patch: {
        executionMode: 'hybrid',
        vortexRepresentation: 'hybrid',
        dynamicsMode: 'fullPhysics',
        hybridPlusEnabled: true,
        hybridFilamentToParticleBatchingEnabled: true,
      },
    },
  ]
}

async function runScenarioBenchmark(store, scenario, options) {
  const { warmupMs, samples, sampleIntervalMs, particleCount } = options
  store.setParams({
    ...scenario.patch,
    particleCount,
    performanceCalibrationStage: `run_${scenario.key}`,
  })
  store.resetScene()
  store.startPulseTrain()
  await sleep(warmupMs)

  const stepValues = []
  const activeValues = []
  const backendValues = []
  for (let i = 0; i < samples; i += 1) {
    await sleep(sampleIntervalMs)
    const params = useSimulationStore.getState().params
    stepValues.push(Number(params.runtimeGpuStepMs ?? 0) || 0)
    activeValues.push(
      Math.max(
        Number(params.runtimeGpuDiagActiveCount ?? 0) || 0,
        Number(params.particleCount ?? 0) || 0,
      ),
    )
    backendValues.push(String(params.runtimeBackend ?? 'unknown'))
    store.setParams({
      performanceCalibrationProgress: (options.baseProgress + ((i + 1) / samples) * options.progressSpan),
    })
  }
  store.stopPulseTrain()

  const stepMedianMs = median(stepValues.filter((value) => value > 0))
  const stepP95Ms = p95(stepValues.filter((value) => value > 0))
  const activeMedian = median(activeValues.filter((value) => value > 0))
  const throughput = stepMedianMs > 1e-6 ? activeMedian / (stepMedianMs / 1000) : 0
  const backendMatchRatio =
    backendValues.length > 0
      ? backendValues.filter((value) => value.includes(scenario.patch.executionMode === 'hybrid' ? 'hybrid' : scenario.patch.executionMode)).length /
        backendValues.length
      : 0
  const score = throughput * 0.7 + (backendMatchRatio * 1000) - stepP95Ms * 10
  return {
    key: scenario.key,
    label: scenario.label,
    stepMedianMs,
    stepP95Ms,
    throughput,
    activeMedian,
    backendMatchRatio,
    score,
  }
}

export async function runHardwareAutoCalibration({
  force = false,
  source = 'manual',
} = {}) {
  if (typeof window === 'undefined') {
    return null
  }
  if (inFlightCalibration) {
    return inFlightCalibration
  }
  inFlightCalibration = (async () => {
    const store = useSimulationStore.getState()
    const baselineParams = { ...store.params }
    store.setParams({
      performanceCalibrationInProgress: true,
      performanceCalibrationProgress: 0,
      performanceCalibrationStage: 'detect_hardware',
      performanceCalibrationLastSummary: '',
    })
    try {
      const detection = await detectHardwareProfile()
      const hardwareFingerprint = fingerprintFromHardware(detection)
      const firstRunDone = window.localStorage.getItem(AUTO_CALIBRATION_FIRST_RUN_KEY) === 'true'
      const baselines = loadBaselines()
      const existingBaseline = baselines.find((item) => item.hardwareFingerprint === hardwareFingerprint) ?? null
      if (!force && firstRunDone && existingBaseline) {
        store.setParams({
          performanceHardwareClass: detection.hardwareClass,
          performanceHardwareSummary: detection.summary,
          performanceCalibrationInProgress: false,
          performanceCalibrationProgress: 1,
          performanceCalibrationStage: 'idle',
          performanceCalibrationLastRunAt: existingBaseline.generatedAt ?? '',
          performanceCalibrationLastSummary: existingBaseline.summary ?? '',
          performanceCalibrationBestBackend: existingBaseline.bestBackend ?? 'none',
          performanceCalibrationBestProfileId: existingBaseline.profileId ?? '',
        })
        return existingBaseline
      }

      const scenarios = createScenarioDefinitions()
      const options = {
        warmupMs: 1200,
        samples: 6,
        sampleIntervalMs: 350,
        particleCount: Math.max(4000, Math.min(18000, Number(baselineParams.particleCount ?? 12000))),
      }
      const results = []
      for (let i = 0; i < scenarios.length; i += 1) {
        const scenario = scenarios[i]
        const baseProgress = 0.08 + i * 0.2
        const progressSpan = 0.18
        const benchmark = await runScenarioBenchmark(store, scenario, {
          ...options,
          baseProgress,
          progressSpan,
        })
        results.push(benchmark)
      }

      const sorted = [...results].sort((a, b) => b.score - a.score)
      const winner = sorted[0] ?? null
      const profileId = selectProfileIdByWinner(winner?.key ?? 'cpu', detection.hardwareClass)
      let appliedProfileId = profileId
      if (winner) {
        const profileName = `HW ${detection.hardwareClass} ${winner.label}`
        const customProfile = createCustomProfileFromParams(profileName, {
          ...baselineParams,
          ...(scenarios.find((scenario) => scenario.key === winner.key)?.patch ?? {}),
          particleCount: options.particleCount,
        })
        if (customProfile) {
          const currentCustomProfiles = loadCustomPerformanceProfiles()
          const nextCustomProfiles = [
            ...currentCustomProfiles.filter((profile) => profile.id !== customProfile.id),
            customProfile,
          ]
          saveCustomPerformanceProfiles(nextCustomProfiles)
          appliedProfileId = customProfile.id
        }
      }

      store.setParams({
        ...baselineParams,
        performanceHardwareClass: detection.hardwareClass,
        performanceHardwareSummary: detection.summary,
        performanceProfileId: appliedProfileId,
        performanceAutoProfileEnabled: true,
        performanceCalibrationProgress: 0.95,
      })
      store.resetScene()

      const summary = winner
        ? `${winner.label}: stepP95=${winner.stepP95Ms.toFixed(1)}ms throughput=${Math.round(winner.throughput)}`
        : 'no winner'
      const baselineRecord = {
        source,
        generatedAt: new Date().toISOString(),
        hardwareFingerprint,
        hardwareSummary: detection.summary,
        hardwareClass: detection.hardwareClass,
        bestBackend: winner?.label ?? 'none',
        profileId: appliedProfileId,
        summary,
        results,
      }
      const nextBaselines = [
        ...baselines.filter((item) => item.hardwareFingerprint !== hardwareFingerprint),
        baselineRecord,
      ]
      saveBaselines(nextBaselines)
      window.localStorage.setItem(AUTO_CALIBRATION_FIRST_RUN_KEY, 'true')
      store.setParams({
        performanceCalibrationInProgress: false,
        performanceCalibrationProgress: 1,
        performanceCalibrationStage: 'done',
        performanceCalibrationLastRunAt: baselineRecord.generatedAt,
        performanceCalibrationLastSummary: summary,
        performanceCalibrationBestBackend: winner?.label ?? 'none',
        performanceCalibrationBestProfileId: appliedProfileId,
      })
      return baselineRecord
    } catch (error) {
      store.setParams({
        performanceCalibrationInProgress: false,
        performanceCalibrationProgress: 0,
        performanceCalibrationStage: 'error',
        performanceCalibrationLastSummary: String(error?.message ?? error ?? 'calibration_error'),
      })
      return null
    } finally {
      inFlightCalibration = null
    }
  })()
  return inFlightCalibration
}
