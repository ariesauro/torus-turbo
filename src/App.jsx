import { useEffect, useMemo, useRef, useState } from 'react'
import { installRuntimeTestApi } from './dev/runtimeTestApi'
import { runHardwareAutoCalibration } from './simulation/performance/hardwareCalibration'
import { detectGpuPhysicsSupport } from './simulation/physics/vpm/gpuSupport'
import { useSimulationStore } from './state/simulationStore'
import VortexScene from './scene/VortexScene'
import ControlPanel from './ui/ControlPanel'

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function describeExecutionMode(params) {
  const isHybrid = params.executionMode === 'hybrid' && params.vortexRepresentation === 'hybrid'
  if (isHybrid && params.hybridPlusEnabled === true) {
    return 'Hybrid+'
  }
  if (isHybrid) {
    return 'Hybrid'
  }
  if (params.executionMode === 'gpu') {
    return 'GPU'
  }
  return 'CPU'
}

function buildStartupProbeCandidates(baseParams, gpuAvailable) {
  const preferredPatch = {
    executionMode: baseParams.executionMode === 'hybrid' ? 'hybrid' : baseParams.executionMode === 'gpu' ? 'gpu' : 'cpu',
    vortexRepresentation:
      baseParams.executionMode === 'hybrid' || baseParams.vortexRepresentation === 'hybrid'
        ? 'hybrid'
        : 'particles',
    dynamicsMode:
      baseParams.executionMode === 'hybrid' || baseParams.vortexRepresentation === 'hybrid'
        ? 'fullPhysics'
        : baseParams.dynamicsMode ?? 'guidedPhysics',
    hybridPlusEnabled:
      baseParams.executionMode === 'hybrid' && baseParams.vortexRepresentation === 'hybrid'
        ? baseParams.hybridPlusEnabled === true
        : false,
    hybridFilamentToParticleBatchingEnabled:
      baseParams.executionMode === 'hybrid' || baseParams.vortexRepresentation === 'hybrid',
  }
  const candidates = [
    {
      key: 'preferred',
      label: `Preferred (${describeExecutionMode(preferredPatch)})`,
      patch: preferredPatch,
      requireGpu: preferredPatch.executionMode !== 'cpu',
    },
    {
      key: 'gpu_safe',
      label: 'GPU fallback',
      patch: {
        executionMode: 'gpu',
        vortexRepresentation: 'particles',
        dynamicsMode: 'guidedPhysics',
        hybridPlusEnabled: false,
      },
      requireGpu: true,
    },
    {
      key: 'cpu_safe',
      label: 'CPU fallback',
      patch: {
        executionMode: 'cpu',
        vortexRepresentation: 'particles',
        dynamicsMode: 'guidedPhysics',
        hybridPlusEnabled: false,
      },
      requireGpu: false,
    },
  ]
  return candidates.filter((candidate, index, array) => {
    if (candidate.requireGpu && !gpuAvailable) {
      return false
    }
    const signature = JSON.stringify(candidate.patch)
    return array.findIndex((item) => JSON.stringify(item.patch) === signature) === index
  })
}

async function runStartupBackendCheck(setSplashState) {
  const store = useSimulationStore.getState()
  const baselineParams = { ...store.params }

  setSplashState({
    inProgress: true,
    progress: 0.08,
    stage: 'Detecting backend capabilities...',
    detail: '',
    error: '',
    gpuDetected: null,
  })
  const gpuAvailable = await detectGpuPhysicsSupport().catch(() => false)
  setSplashState((prev) => ({ ...prev, gpuDetected: gpuAvailable }))
  const candidates = buildStartupProbeCandidates(baselineParams, gpuAvailable)
  let winner = null
  let lastFailureDetail = ''

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i]
    const progressBase = 0.15 + (i / Math.max(1, candidates.length)) * 0.7
    setSplashState({
      inProgress: true,
      progress: progressBase,
      stage: `Checking ${candidate.label}...`,
      detail: '',
      error: '',
    })
    store.setParams({
      ...baselineParams,
      ...candidate.patch,
      runtimeBackendError: '',
    })
    store.resetScene()
    store.startPulseTrain()
    await sleep(420)
    const startParams = useSimulationStore.getState().params
    const startTime = Number(startParams.runtimeSimulationTime ?? 0) || 0
    const startSteps =
      (Number(startParams.runtimeCpuSteps ?? 0) || 0) + (Number(startParams.runtimeGpuSteps ?? 0) || 0)
    await sleep(860)
    const endParams = useSimulationStore.getState().params
    const endTime = Number(endParams.runtimeSimulationTime ?? 0) || 0
    const endSteps =
      (Number(endParams.runtimeCpuSteps ?? 0) || 0) + (Number(endParams.runtimeGpuSteps ?? 0) || 0)
    const activeCount = Math.max(
      Number(endParams.runtimeGpuDiagActiveCount ?? 0) || 0,
      Number(endParams.particleCount ?? 0) || 0,
    )
    const simulationAdvancing = endTime > startTime + 1e-3 || endSteps > startSteps + 0.5
    const backendError = String(endParams.runtimeBackendError ?? '').trim()
    if (simulationAdvancing && activeCount > 0 && backendError.length === 0) {
      winner = candidate
      break
    }
    lastFailureDetail = `advancing=${String(simulationAdvancing)}, active=${Math.floor(activeCount)}, error=${
      backendError || 'none'
    }`
    store.stopPulseTrain()
    await sleep(120)
  }

  const fallbackCandidate = candidates.find((item) => item.key === 'cpu_safe') ?? candidates[candidates.length - 1]
  const selected = winner ?? fallbackCandidate
  store.setParams({
    ...baselineParams,
    ...(selected?.patch ?? {}),
    runtimeBackendReason:
      winner == null && selected?.key === 'cpu_safe' ? 'startup_backend_probe_fallback_cpu' : baselineParams.runtimeBackendReason,
  })
  store.resetScene()
  store.stopPulseTrain()
  await sleep(200)

  setSplashState({
    inProgress: false,
    progress: 1,
    stage: winner ? 'Backend check complete' : 'Backend fallback selected',
    detail: winner
      ? `Active mode: ${winner.label}`
      : `Fallback: ${selected?.label ?? 'CPU'} (${lastFailureDetail || 'startup probe failed'})`,
    error: '',
  })
}

const SPLASH_MIN_DURATION_MS = 4000
const SPLASH_FADE_MS = 500

function App() {
  const fallbackRuntimeRef = useRef(null)
  const [nativeRenderActive, setNativeRenderActive] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.__TAURI__) return
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('native_backend_info')
        .then((info) => {
          if (info?.compute_type === 'GpuNative') {
            setNativeRenderActive(true)
          }
        })
        .catch(() => {})
    })
  }, [])

  const startupCheckEnabled = useMemo(() => {
    if (import.meta.env.DEV) {
      return false
    }
    if (typeof window === 'undefined') {
      return false
    }
    return window.__torusDisableStartupBackendCheck !== true
  }, [])
  const [startupSplash, setStartupSplash] = useState({
    inProgress: startupCheckEnabled,
    progress: startupCheckEnabled ? 0.02 : 1,
    stage: startupCheckEnabled ? 'Preparing runtime...' : 'ready',
    detail: '',
    error: '',
    gpuDetected: null,
  })
  const [minTimerDone, setMinTimerDone] = useState(!startupCheckEnabled)
  const [fadingOut, setFadingOut] = useState(false)
  const [splashVisible, setSplashVisible] = useState(false)

  useEffect(() => {
    if (!startupCheckEnabled) return
    requestAnimationFrame(() => setSplashVisible(true))
    const timer = window.setTimeout(() => setMinTimerDone(true), SPLASH_MIN_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [startupCheckEnabled])

  const backendDone = !startupSplash.inProgress
  const readyToHide = backendDone && minTimerDone

  useEffect(() => {
    if (!readyToHide || fadingOut) return
    setFadingOut(true)
    const timer = window.setTimeout(() => setSplashVisible(false), SPLASH_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [readyToHide, fadingOut])

  useEffect(() => {
    const dispose = installRuntimeTestApi(fallbackRuntimeRef)
    return () => dispose()
  }, [])

  useEffect(() => {
    if (!startupCheckEnabled) {
      return
    }
    if (typeof window === 'undefined') {
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        await runStartupBackendCheck((next) => {
          if (cancelled) return
          if (typeof next === 'function') {
            setStartupSplash(next)
          } else {
            setStartupSplash(next)
          }
        })
      } catch (error) {
        if (!cancelled) {
          setStartupSplash({
            inProgress: false,
            progress: 1,
            stage: 'Startup check failed',
            detail: '',
            error: String(error?.message ?? error ?? 'startup_backend_check_failed'),
            gpuDetected: null,
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [startupCheckEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    if (startupCheckEnabled && startupSplash.inProgress) {
      return
    }
    if (window.__torusDisableAutoCalibration === true) {
      return
    }
    if (window.__torusAutoCalibrationBootScheduled === true) {
      return
    }
    window.__torusAutoCalibrationBootScheduled = true
    window.setTimeout(() => {
      void runHardwareAutoCalibration({ source: 'startup' })
    }, 1200)
  }, [startupCheckEnabled, startupSplash.inProgress])

  const showSplash = startupCheckEnabled && splashVisible

  const backendLabel = startupSplash.gpuDetected === true
    ? 'JS CPU + WebGPU'
    : startupSplash.gpuDetected === false
      ? 'JS CPU'
      : ''

  return (
    <main className="flex h-screen w-screen text-slate-100" style={{ background: nativeRenderActive ? 'transparent' : '#000' }}>
      <div className="relative flex-1">
        {!nativeRenderActive && (
          <div className={`absolute inset-0${showSplash ? ' pointer-events-none opacity-0' : ''}`}>
            <VortexScene />
          </div>
        )}
        {!showSplash ? <ControlPanel /> : null}
        {showSplash ? (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center"
            style={{
              background: '#0c0d1e',
              opacity: fadingOut ? 0 : (splashVisible ? 1 : 0),
              transition: `opacity ${fadingOut ? SPLASH_FADE_MS : 600}ms ${fadingOut ? 'ease-in' : 'ease-out'}`,
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <p
                style={{
                  fontSize: 42,
                  fontWeight: 800,
                  letterSpacing: 6,
                  color: '#fff',
                  textTransform: 'uppercase',
                  textShadow: '0 0 40px rgba(99,102,241,0.25), 0 0 80px rgba(99,102,241,0.08)',
                }}
              >
                TORUS TURBO
              </p>
              {backendLabel ? (
                <p
                  style={{
                    fontSize: 16,
                    fontWeight: 500,
                    letterSpacing: 8,
                    color: '#6366F1',
                    textTransform: 'uppercase',
                    marginTop: 10,
                    opacity: 0.9,
                  }}
                >
                  {backendLabel}
                </p>
              ) : null}
              <p style={{ fontSize: 11, letterSpacing: 3, color: '#6e72a0', marginTop: 6, opacity: 0.6 }}>
                {startupSplash.stage}
              </p>
              {startupSplash.error ? (
                <p style={{ fontSize: 11, color: '#fb7185', marginTop: 6 }}>{startupSplash.error}</p>
              ) : null}
              <div
                style={{
                  marginTop: 28,
                  width: 240,
                  height: 3,
                  background: 'rgba(99,102,241,0.12)',
                  borderRadius: 2,
                  overflow: 'hidden',
                  marginLeft: 'auto',
                  marginRight: 'auto',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.max(0, Math.min(100, startupSplash.progress * 100)).toFixed(1)}%`,
                    background: 'linear-gradient(90deg, #6366F1, #818cf8)',
                    borderRadius: 2,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}

export default App
