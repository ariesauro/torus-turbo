import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { resetParticles } from '../simulation/physics/resetParticles'
import { getNozzle } from '../simulation/physics/emission/shared'
import {
  buildEmitterParams,
  getConfiguredEmitters,
  MAX_MULTI_EMITTERS,
  normalizeMultiEmitterConfig,
} from '../simulation/physics/emission/multiEmitter'
import { detectGpuPhysicsSupport } from '../simulation/physics/vpm/gpuSupport'
import { WebGPUHashGridParticleComputeManager } from '../simulation/physics/webgpu/hashGridParticleComputeManager'
import { createFrameScheduler, beginFrame } from '../simulation/runtime/frameScheduler'
import { stepSimulationRuntime } from '../simulation/runtime/simulationRuntime'
import { normalizeSimulationParams } from '../simulation/params/normalizeParams'
import { useSimulationStore } from '../state/simulationStore'
import {
  createAxisLabelSprite,
  createAxisMesh,
  updateAxisGuide,
  updateAxisMesh,
  updateCircleLine,
} from './helpers/axisHelpers'
import {
  createParticleTexture,
  createParticleView,
  removeAllViews,
  removeExtraViews,
} from './helpers/particleViewHelpers'
import { resolveParticleRenderSource } from './helpers/particleRenderSourceHelpers'
import { renderParticleViewsFromGpuSnapshot } from './helpers/gpuParticleRenderAdapter'
import {
  disposeGroupChildren,
  getClosestParticleIndexToCameraCenter,
  updateDebugGrid,
} from './helpers/spatialDebugHelpers'
import { buildRenderRepresentationPolicy } from './helpers/renderRepresentationPolicy'
import {
  createGridDebugState,
  disposeGridDebug,
  rebuildRuntimeFilaments,
  rebuildRuntimeParticles,
  resetGridDebugState,
} from './helpers/runtimeHelpers'
import {
  createFilamentView,
  removeExtraFilamentViews,
  removeFilamentViews,
  updateFilamentView,
} from './helpers/filamentViewHelpers'
import {
  createTubeView,
  removeExtraTubeViews,
  removeTubeViews,
  updateTubeView,
} from './helpers/tubeViewHelpers'
import { createFilamentRing } from '../simulation/filaments/createFilamentRing'
import { installRuntimeTestApi } from '../dev/runtimeTestApi'

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function computeQCriterionProxy(vorticityMagnitude, speedMagnitude, interactionRadius) {
  const omega2 = vorticityMagnitude * vorticityMagnitude
  const radius = Math.max(0.05, Number(interactionRadius ?? 0.5))
  const strainProxy = speedMagnitude / radius
  const strain2 = strainProxy * strainProxy
  return 0.5 * (omega2 - strain2)
}

function formatNumber(value, digits = 3) {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(digits) : 'n/a'
}

function resolveRendererPixelRatio(params) {
  const scientificMode = params?.vizScientificMode === true
  const exportScale = Number(params?.vizExportScale ?? 1)
  const safeScale = Number.isFinite(exportScale) ? Math.max(1, Math.min(4, exportScale)) : 1
  return scientificMode ? safeScale : 1
}

function getOverlayColorByClass(kind) {
  if (kind === 'tube') return 0x22d3ee
  if (kind === 'ring') return 0xf59e0b
  if (kind === 'filament') return 0xa78bfa
  if (kind === 'sheet') return 0x60a5fa
  return 0x34d399
}

function createOverlayMaterial(color) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.2,
    wireframe: true,
    depthWrite: false,
  })
}

function overlayColorHexToCss(colorHex) {
  return `#${(colorHex >>> 0).toString(16).padStart(6, '0')}`
}

function buildStructureLabelTexture(text, colorHex) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(2, 6, 23, 0.75)'
  ctx.fillRect(0, 8, canvas.width, 48)
  ctx.strokeStyle = `${overlayColorHexToCss(colorHex)}cc`
  ctx.lineWidth = 2
  ctx.strokeRect(1, 9, canvas.width - 2, 46)
  ctx.fillStyle = overlayColorHexToCss(colorHex)
  ctx.font = 'bold 24px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function updateEmitterHousingFrontHoleMask(runtime, holeDiameter, boxHeight, enabled) {
  const canvas = runtime.emitterHousingFrontMaskCanvas
  const ctx = runtime.emitterHousingFrontMaskContext
  const texture = runtime.emitterHousingFrontMaskTexture
  if (!canvas || !ctx || !(texture instanceof THREE.Texture)) {
    return
  }
  const size = Math.min(canvas.width, canvas.height)
  const safeBoxHeight = Math.max(1e-6, Number(boxHeight) || 0)
  const radius = Math.max(0, Number(holeDiameter) * 0.5)
  const radiusPx = Math.max(0, Math.min(size * 0.49, (radius / safeBoxHeight) * size))

  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  if (enabled && radiusPx > 0) {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.arc(canvas.width * 0.5, canvas.height * 0.5, radiusPx, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
  texture.needsUpdate = true
}

function updateStructureLabelSprite(view, text, colorHex) {
  const nextText = String(text ?? '').trim()
  if (view.labelText === nextText && view.labelColorHex === colorHex) {
    return
  }
  view.labelText = nextText
  view.labelColorHex = colorHex
  const nextTexture = buildStructureLabelTexture(nextText, colorHex)
  if (!(nextTexture instanceof THREE.Texture)) {
    return
  }
  const material = view.labelSprite.material
  if (material.map) {
    material.map.dispose()
  }
  material.map = nextTexture
  material.needsUpdate = true
}

function createStructureOverlayView(group) {
  const root = new THREE.Group()
  const clusterMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 14), createOverlayMaterial(0x34d399))
  const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.22, 12, 24), createOverlayMaterial(0xf59e0b))
  const tubeMesh = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), createOverlayMaterial(0x22d3ee))
  const sheetMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.08, 20, 1, true),
    createOverlayMaterial(0x60a5fa),
  )
  const filamentMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 2, 10, 1, true),
    createOverlayMaterial(0xa78bfa),
  )
  clusterMesh.visible = false
  ringMesh.visible = false
  tubeMesh.visible = false
  sheetMesh.visible = false
  filamentMesh.visible = false
  const labelSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: true }),
  )
  labelSprite.visible = false
  labelSprite.scale.set(0.9, 0.24, 1)
  root.visible = false
  root.add(clusterMesh)
  root.add(ringMesh)
  root.add(tubeMesh)
  root.add(sheetMesh)
  root.add(filamentMesh)
  root.add(labelSprite)
  group.add(root)
  return {
    root,
    clusterMesh,
    ringMesh,
    tubeMesh,
    sheetMesh,
    filamentMesh,
    labelSprite,
    labelText: '',
    labelColorHex: 0x34d399,
  }
}

function removeStructureOverlayViews(group, views) {
  const disposeMesh = (mesh) => {
    mesh.geometry.dispose()
    mesh.material.dispose()
  }
  const disposeLabelSprite = (sprite) => {
    if (!(sprite?.material instanceof THREE.SpriteMaterial)) return
    if (sprite.material.map) {
      sprite.material.map.dispose()
    }
    sprite.material.dispose()
  }
  for (let i = 0; i < views.length; i += 1) {
    const view = views[i]
    group.remove(view.root)
    disposeMesh(view.clusterMesh)
    disposeMesh(view.ringMesh)
    disposeMesh(view.tubeMesh)
    disposeMesh(view.sheetMesh)
    disposeMesh(view.filamentMesh)
    disposeLabelSprite(view.labelSprite)
  }
  views.length = 0
}

function removeExtraStructureOverlayViews(group, views, targetLength) {
  const disposeMesh = (mesh) => {
    mesh.geometry.dispose()
    mesh.material.dispose()
  }
  const disposeLabelSprite = (sprite) => {
    if (!(sprite?.material instanceof THREE.SpriteMaterial)) return
    if (sprite.material.map) {
      sprite.material.map.dispose()
    }
    sprite.material.dispose()
  }
  while (views.length > targetLength) {
    const view = views.pop()
    group.remove(view.root)
    disposeMesh(view.clusterMesh)
    disposeMesh(view.ringMesh)
    disposeMesh(view.tubeMesh)
    disposeMesh(view.sheetMesh)
    disposeMesh(view.filamentMesh)
    disposeLabelSprite(view.labelSprite)
  }
}

export default function VortexScene() {
  const mountRef = useRef(null)

  const params = useSimulationStore((state) => state.params)
  const resetToken = useSimulationStore((state) => state.resetToken)
  const loadToken = useSimulationStore((state) => state.loadToken)
  const pulseCommandId = useSimulationStore((state) => state.pulseCommandId)
  const pulseCommandType = useSimulationStore((state) => state.pulseCommandType)
  const setCameraState = useSimulationStore((state) => state.setCameraState)
  const setParam = useSimulationStore((state) => state.setParam)

  const runtimeRef = useRef(null)
  const idRef = useRef(1)
  const paramsRef = useRef(params)

  const resetVectorHistories = (runtime) => {
    runtime.simulationState.gpuCurveHistoryById = new Map()
    runtime.simulationState.gpuCurveHistoryDispatchSerial = -1
    for (let i = 0; i < runtime.particles.length; i += 1) {
      const particle = runtime.particles[i]
      particle.history = [{ x: particle.x ?? 0, y: particle.y ?? 0, z: particle.z ?? 0 }]
    }
  }

  const patchEmitterConfig = (currentParams, emitterIndex, patch) => {
    const nextEmitters = Array.isArray(currentParams.multiEmitters)
      ? currentParams.multiEmitters.map((entry) => ({ ...(entry ?? {}) }))
      : []
    while (nextEmitters.length < MAX_MULTI_EMITTERS) {
      nextEmitters.push({})
    }
    nextEmitters[emitterIndex] = {
      ...(nextEmitters[emitterIndex] ?? {}),
      ...patch,
    }
    return nextEmitters
  }

  useEffect(() => {
    paramsRef.current = params
  }, [params])

  useEffect(() => {
    const mountElement = mountRef.current
    if (!mountElement) {
      return undefined
    }

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x000000)

    let isDisposed = false
    detectGpuPhysicsSupport().then(async (gpuAvailable) => {
      if (isDisposed) {
        return
      }
      if (paramsRef.current.gpuAvailable !== gpuAvailable) {
        setParam('gpuAvailable', gpuAvailable)
      }
      if (gpuAvailable) {
        try {
          runtime.webgpuManager = await WebGPUHashGridParticleComputeManager.create()
          runtime.webgpuManager.replaceSnapshot(runtime.particles)
        } catch (error) {
          if (!isDisposed) {
            setParam('runtimeBackend', 'gpu_error')
            setParam('runtimeBackendReason', 'webgpu_init_failed')
            setParam(
              'runtimeBackendError',
              error instanceof Error ? error.message : 'Failed to initialize GPU device',
            )
          }
          return
        }
      }
      if (paramsRef.current.physicsBackend === 'webgpu' && !gpuAvailable) {
        setParam('runtimeBackend', 'gpu_error')
        setParam('runtimeBackendReason', 'webgpu_unavailable')
        setParam('runtimeBackendError', 'GPU backend is unavailable')
      }
    })

    const initialWidth = mountElement.clientWidth || window.innerWidth
    const initialHeight = mountElement.clientHeight || window.innerHeight
    const camera = new THREE.PerspectiveCamera(75, initialWidth / initialHeight, 0.1, 1000)

    camera.position.set(
      paramsRef.current.camera.px,
      paramsRef.current.camera.py,
      paramsRef.current.camera.pz,
    )

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    let currentRendererPixelRatio = resolveRendererPixelRatio(paramsRef.current)
    renderer.setPixelRatio(currentRendererPixelRatio)
    renderer.setSize(initialWidth, initialHeight)
    mountElement.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(
      paramsRef.current.camera.tx,
      paramsRef.current.camera.ty,
      paramsRef.current.camera.tz,
    )
    controls.update()

    const group = new THREE.Group()
    scene.add(group)
    const positiveAxisMeshes = [
      createAxisMesh(0xaa5555),
      createAxisMesh(0x66aa66),
      createAxisMesh(0x5555ff),
    ]
    const negativeAxisMeshes = [
      createAxisMesh(0xaa5555),
      createAxisMesh(0x66aa66),
      createAxisMesh(0x5555ff),
    ]
    positiveAxisMeshes.forEach((mesh) => {
      mesh.visible = paramsRef.current.showAxes
      scene.add(mesh)
    })
    negativeAxisMeshes.forEach((mesh) => {
      mesh.visible = paramsRef.current.showAxes && paramsRef.current.showNegativeAxes
      scene.add(mesh)
    })
    const axisLabels = [
      createAxisLabelSprite('X', '#ff5555', new THREE.Vector3(8.7, 0, 0)),
      createAxisLabelSprite('Y', '#66ff66', new THREE.Vector3(0, 8.7, 0)),
      createAxisLabelSprite('Z', '#5599ff', new THREE.Vector3(0, 0, 8.7)),
    ]
    axisLabels.forEach((label) => {
      label.visible = paramsRef.current.showAxes && paramsRef.current.showAxisLabels
      scene.add(label)
    })
    const negativeAxisLabels = [
      createAxisLabelSprite('-X', '#ff5555', new THREE.Vector3(-8.7, 0, 0)),
      createAxisLabelSprite('-Y', '#66ff66', new THREE.Vector3(0, -8.7, 0)),
      createAxisLabelSprite('-Z', '#5599ff', new THREE.Vector3(0, 0, -8.7)),
    ]
    negativeAxisLabels.forEach((label) => {
      label.visible =
        paramsRef.current.showAxes &&
        paramsRef.current.showNegativeAxes &&
        paramsRef.current.showAxisLabels
      scene.add(label)
    })

  const nozzleGeometry = new THREE.SphereGeometry(0.12, 12, 12)
  const nozzleMaterial = new THREE.MeshBasicMaterial({ color: 0x44ffdd })
  const nozzleMarker = new THREE.Mesh(nozzleGeometry, nozzleMaterial)
  const initNozzlePos = paramsRef.current.nozzle?.position ?? {}
  nozzleMarker.position.set(
    initNozzlePos.x ?? 0,
    initNozzlePos.y ?? 0,
    initNozzlePos.z ?? paramsRef.current.nozzleZ ?? 0,
  )
  nozzleMarker.visible = paramsRef.current.showNozzle
  scene.add(nozzleMarker)
  const emitterHousingTextureLoader = new THREE.TextureLoader()
  const emitterHousingTextures = {
    right: emitterHousingTextureLoader.load('/textures/emitter-housing/right.png'),
    left: emitterHousingTextureLoader.load('/textures/emitter-housing/left.png'),
    top: emitterHousingTextureLoader.load('/textures/emitter-housing/top.png'),
    bottom: emitterHousingTextureLoader.load('/textures/emitter-housing/bottom.png'),
    front: emitterHousingTextureLoader.load('/textures/emitter-housing/front.png'),
    back: emitterHousingTextureLoader.load('/textures/emitter-housing/back.png'),
  }
  const emitterHousingMaterials = [
    new THREE.MeshBasicMaterial({ map: emitterHousingTextures.right, transparent: true, opacity: 0.98 }), // +X
    new THREE.MeshBasicMaterial({ map: emitterHousingTextures.left, transparent: true, opacity: 0.98 }), // -X
    new THREE.MeshBasicMaterial({ map: emitterHousingTextures.top, transparent: true, opacity: 0.98 }), // +Y
    new THREE.MeshBasicMaterial({ map: emitterHousingTextures.bottom, transparent: true, opacity: 0.98 }), // -Y
    new THREE.MeshBasicMaterial({ map: emitterHousingTextures.front, transparent: true, opacity: 0.98 }), // +Z
    new THREE.MeshBasicMaterial({ map: emitterHousingTextures.back, transparent: true, opacity: 0.98 }), // -Z
  ]
  const emitterHousingFrontMaskCanvas = document.createElement('canvas')
  emitterHousingFrontMaskCanvas.width = 512
  emitterHousingFrontMaskCanvas.height = 512
  const emitterHousingFrontMaskContext = emitterHousingFrontMaskCanvas.getContext('2d')
  const emitterHousingFrontMaskTexture = new THREE.CanvasTexture(emitterHousingFrontMaskCanvas)
  if (emitterHousingFrontMaskContext) {
    emitterHousingFrontMaskContext.fillStyle = '#ffffff'
    emitterHousingFrontMaskContext.fillRect(
      0,
      0,
      emitterHousingFrontMaskCanvas.width,
      emitterHousingFrontMaskCanvas.height,
    )
    emitterHousingFrontMaskTexture.needsUpdate = true
  }
  const emitterHousingFrontMaterial = emitterHousingMaterials[4]
  emitterHousingFrontMaterial.alphaMap = emitterHousingFrontMaskTexture
  emitterHousingFrontMaterial.alphaTest = 0.5
  emitterHousingFrontMaterial.transparent = true
  emitterHousingFrontMaterial.needsUpdate = true
  const emitterHousingGroup = new THREE.Group()
  const emitterHousingBox = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    emitterHousingMaterials,
  )
  const emitterHousingTunnel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x050505,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
    }),
  )
  emitterHousingTunnel.rotation.x = Math.PI / 2
  emitterHousingGroup.add(emitterHousingBox)
  emitterHousingGroup.add(emitterHousingTunnel)
  emitterHousingGroup.visible = false
  scene.add(emitterHousingGroup)
  const nozzleRimLine = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x44ffdd }),
  )
  nozzleRimLine.visible = paramsRef.current.showNozzle
  scene.add(nozzleRimLine)
  const shearLayerLine = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xffaa33 }),
  )
  shearLayerLine.visible = paramsRef.current.showShearLayer
  scene.add(shearLayerLine)
  const vortexAxisLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xff6699 }),
  )
  vortexAxisLine.visible = paramsRef.current.showVortexRingAxis || paramsRef.current.showNozzle
  scene.add(vortexAxisLine)
  const multiEmitterSphereGeometry = new THREE.SphereGeometry(0.09, 12, 12)
  const multiEmitterViews = new Array(MAX_MULTI_EMITTERS)
  for (let i = 0; i < MAX_MULTI_EMITTERS; i += 1) {
    const sphere = new THREE.Mesh(
      multiEmitterSphereGeometry,
      new THREE.MeshBasicMaterial({ color: i === 0 ? 0x44ffdd : i === 1 ? 0xffcc44 : 0xff6699 }),
    )
    const axis = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: i === 0 ? 0x44ffdd : i === 1 ? 0xffcc44 : 0xff6699 }),
    )
    sphere.visible = false
    axis.visible = false
    scene.add(sphere)
    scene.add(axis)
    multiEmitterViews[i] = { sphere, axis }
  }

  const gridDebug = createGridDebugState()

    const texture = createParticleTexture()
    const particleMaterial = new THREE.PointsMaterial({
      size: paramsRef.current.particleSize,
      map: texture,
      transparent: true,
      opacity: paramsRef.current.opacity,
      color: paramsRef.current.particleColor ?? '#ffffff',
      depthWrite: false,
    })

  const scheduler = createFrameScheduler()
  const simulationState = {
    particles: [],
    filaments: [],
    pulseState: {
      mode: 'off',
      time: 0,
      singleElapsed: 0,
      singlePulseConsumed: false,
      burstEmissionRemaining: 0,
      pulseActive: false,
      pulseTimer: 0,
      emittedSlugLength: 0,
      trailingJetActive: false,
      multiSinglePulseSchedule: null,
      multiSinglePulseElapsed: 0,
      jetRollupClock: 0,
    },
    scheduler,
    runtimeStatus: {
      backend: null,
      reason: null,
      error: null,
      gpuDispatchPending: false,
    },
    simulationTime: 0,
    cpuSteps: 0,
    gpuSteps: 0,
    publishedStats: {
      simulationTime: -1,
      cpuSteps: -1,
      gpuSteps: -1,
      gpuDispatchPending: null,
      gpuDiagnosticsDispatchSerial: -1,
      particleRenderPolicy: '',
      particleRenderBackend: '',
      particleRenderFallbackReason: '',
      renderPolicyMode: '',
      renderLodTier: '',
      renderParticleLayerVisible: null,
      renderFilamentLayerVisible: null,
      renderSheetLayerVisible: null,
      renderDiagnosticsConfidence: Number.NaN,
      renderDiagnosticsUncertainty: Number.NaN,
      renderUncertaintyDetectorGap: Number.NaN,
      renderUncertaintyFallback: Number.NaN,
      renderUncertaintyTopologyVolatility: Number.NaN,
      renderSheetPanelCount: -1,
      renderSheetCoverage: Number.NaN,
      renderSheetReadiness: Number.NaN,
      renderSheetQuadratureOrder: -1,
      renderSheetDesingularizationEpsilon: Number.NaN,
      renderSheetProfileId: '',
      renderSheetQuadratureProfile: '',
      renderSheetMeshSeed: -1,
      renderSheetMeshTopology: '',
      renderSheetMeshPatchCount: -1,
      renderSheetPanelAspectP95: Number.NaN,
      renderSheetQualityGatePassCount: -1,
      renderSheetQualityGateTotal: -1,
      renderSheetQualityVerdict: '',
      renderSheetQualityPenalty: Number.NaN,
      renderSheetMeshDeterministic: null,
      renderSheetMeshLayoutDigest: -1,
      renderSheetMeshPatchMinPanels: -1,
      renderSheetMeshPatchMaxPanels: -1,
      renderSheetMeshPatchImbalance: Number.NaN,
      renderSheetMeshContractVersion: '',
      renderSheetMeshContractValid: null,
      renderSheetMeshContractIssueCount: -1,
      renderSheetMeshContractGatePassCount: -1,
      renderSheetMeshContractGateTotal: -1,
      renderSheetMeshContractVerdict: '',
      renderSheetMeshContractPenalty: Number.NaN,
      renderSheetMeshPatchAreaMean: Number.NaN,
      renderSheetMeshPatchAreaCv: Number.NaN,
      renderSheetMeshEdgeLengthRatioP95: Number.NaN,
      renderSheetMeshCurvatureProxyP95: Number.NaN,
      renderSheetCouplingVersion: '',
      renderSheetCouplingValid: null,
      renderSheetCouplingVerdict: '',
      renderSheetCouplingPenalty: Number.NaN,
      renderSheetCouplingAmerState: '',
      renderSheetCouplingAmerTransferBudget: Number.NaN,
      renderSheetCouplingAmerInvariantDriftCapPct: Number.NaN,
      renderSheetCouplingFilamentState: '',
      renderSheetCouplingFilamentNodeTransferCap: -1,
      renderSheetCouplingFilamentLoad: Number.NaN,
      renderSheetRollupStabilityGuard: '',
      renderSheetPlaceholder: null,
    },
    particleRenderSource: {
      policy: 'cpu_backend',
      requested: 'cpu',
      active: 'cpu',
      gpuPrepared: false,
      descriptor: null,
      reason: 'cpu_backend',
    },
    vectorGuardFrames: 0,
    vectorPulseCooldownFrames: 0,
    pulseGpuSyncRequested: false,
    minGpuRenderDispatchSerial: 0,
    gpuCurveHistoryById: new Map(),
    gpuCurveHistoryDispatchSerial: -1,
    hybridRuntimeStats: {
      particleDt: 0,
      filamentDt: 0,
      particleSpeed: 0,
      filamentSpeed: 0,
    },
    gpuOverflowProtection: {
      criticalStreak: 0,
      active: false,
      actionCooldownSteps: 0,
      lastAction: 'none',
      lastPublished: null,
    },
    gpuSyncContract: {
      policy: 'unavailable',
      reason: 'manager_unavailable',
      violationCount: 0,
      lastReadbackReason: 'none',
      lastObservedDispatchSerial: -1,
    },
    gpuQualityGuard: {
      active: false,
      applyActive: false,
      level: 'off',
      compatibility: 'disabled_user_off',
      guidedScale: 1,
      stretchingScale: 1,
      highStepStreak: 0,
      lowStepStreak: 0,
      lastAction: 'none',
      lastPublished: null,
    },
    stepSerial: 0,
    hybridPlusState: null,
    hybridPlusOperatorRegistry: null,
    filamentSolverContext: null,
    hybridCouplingContext: null,
    hybridConsistencyState: {
      initialTotalCirculation: Number.NaN,
      lastTotalCirculation: 0,
      lastParticleCenter: null,
      lastFilamentCenter: null,
    },
    structureDetectionState: null,
    newtoniumTrackingState: null,
    vortexTubes: [],
    vortexTubeIdRef: { current: 1 },
    pendingFilamentSpawns: [],
    webgpuManager: null,
  }
  const runtime = {
    scene,
    camera,
    renderer,
    controls,
    group,
    texture,
    particleMaterial,
    simulationState,
    particleViews: [],
    filamentViews: [],
    tubeViews: [],
    structureOverlayViews: [],
    speedVector: new THREE.Vector3(),
    fastColor: new THREE.Color(paramsRef.current.colorFast),
    slowColor: new THREE.Color(paramsRef.current.colorSlow),
    mixedColor: new THREE.Color(),
    positiveAxisMeshes,
    negativeAxisMeshes,
    axisLabels,
    negativeAxisLabels,
    nozzleMarker,
    emitterHousingGroup,
    emitterHousingBox,
    emitterHousingTunnel,
    emitterHousingFrontMaskCanvas,
    emitterHousingFrontMaskContext,
    emitterHousingFrontMaskTexture,
    nozzleRimLine,
    shearLayerLine,
    vortexAxisLine,
    multiEmitterViews,
    multiEmitterRotateDrag: null,
    gridDebug,
    nozzleForwardVector: new THREE.Vector3(0, 0, 1),
    nozzleDirectionVector: new THREE.Vector3(0, 0, 1),
    upVector: new THREE.Vector3(0, 1, 0),
    tangentVector: new THREE.Vector3(),
    axisLength: -1,
    rafId: 0,
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
  }
    Object.defineProperties(runtime, {
      particles: {
        get() {
          return simulationState.particles
        },
        set(value) {
          simulationState.particles = value
        },
      },
      filaments: {
        get() {
          return simulationState.filaments
        },
        set(value) {
          simulationState.filaments = value
        },
      },
      pulseState: {
        get() {
          return simulationState.pulseState
        },
        set(value) {
          simulationState.pulseState = value
        },
      },
      runtimeStatus: {
        get() {
          return simulationState.runtimeStatus
        },
        set(value) {
          simulationState.runtimeStatus = value
        },
      },
      simulationTime: {
        get() {
          return simulationState.simulationTime
        },
        set(value) {
          simulationState.simulationTime = value
        },
      },
      cpuSteps: {
        get() {
          return simulationState.cpuSteps
        },
        set(value) {
          simulationState.cpuSteps = value
        },
      },
      gpuSteps: {
        get() {
          return simulationState.gpuSteps
        },
        set(value) {
          simulationState.gpuSteps = value
        },
      },
      publishedStats: {
        get() {
          return simulationState.publishedStats
        },
        set(value) {
          simulationState.publishedStats = value
        },
      },
      webgpuManager: {
        get() {
          return simulationState.webgpuManager
        },
        set(value) {
          simulationState.webgpuManager = value
        },
      },
      fixedStep: {
        get() {
          return scheduler.fixedStep
        },
        set(value) {
          scheduler.fixedStep = value
        },
      },
      accumulator: {
        get() {
          return scheduler.accumulator
        },
        set(value) {
          scheduler.accumulator = value
        },
      },
      lastFrameTime: {
        get() {
          return scheduler.lastFrameTime
        },
        set(value) {
          scheduler.lastFrameTime = value
        },
      },
    })

    runtimeRef.current = runtime
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      window.__torusRuntime = runtime
    }
    const disposeRuntimeTestApi = installRuntimeTestApi(runtimeRef)

    const rebuildParticles = () =>
      rebuildRuntimeParticles({
        runtime,
        params: paramsRef.current,
        idRef,
        resetParticles,
        createParticleView,
        removeAllViews,
      })

    const rebuildFilaments = () =>
      rebuildRuntimeFilaments({
        runtime,
        params: paramsRef.current,
        removeFilamentViews,
      })

    rebuildParticles()
    rebuildFilaments()

    const onResize = () => {
      const width = mountElement.clientWidth || window.innerWidth
      const height = mountElement.clientHeight || window.innerHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }

    const onControlsChange = () => {
      setCameraState({
        px: camera.position.x,
        py: camera.position.y,
        pz: camera.position.z,
        tx: controls.target.x,
        ty: controls.target.y,
        tz: controls.target.z,
      })
    }

    const onPointerSelectParticle = (event) => {
      if (!runtimeRef.current) {
        return
      }

      if (runtime.multiEmitterRotateDrag) {
        return
      }

      const rect = renderer.domElement.getBoundingClientRect()
      runtime.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      runtime.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
      runtime.raycaster.params.Points.threshold = Math.max(paramsRef.current.particleSize, 0.15)
      runtime.raycaster.setFromCamera(runtime.pointer, camera)

      const pointMeshes = runtime.particleViews.map((view) => view.mesh)
      const intersections = runtime.raycaster.intersectObjects(pointMeshes, false)
      if (intersections.length === 0) {
        runtime.gridDebug.selectedParticleIndex = getClosestParticleIndexToCameraCenter(
          camera,
          runtime.particles,
        )
        return
      }

      const hitObject = intersections[0].object
      const selectedIndex = runtime.particleViews.findIndex((view) => view.mesh === hitObject)
      if (selectedIndex >= 0) {
        runtime.gridDebug.selectedParticleIndex = selectedIndex
      }
    }

    const getEmitterHitIndex = (event) => {
      const rect = renderer.domElement.getBoundingClientRect()
      runtime.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      runtime.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
      runtime.raycaster.setFromCamera(runtime.pointer, camera)
      const emitterObjects = runtime.multiEmitterViews
        .map((view) => view.sphere)
        .filter((mesh) => mesh.visible)
      if (emitterObjects.length === 0) {
        return -1
      }
      const hits = runtime.raycaster.intersectObjects(emitterObjects, false)
      if (hits.length === 0) {
        return -1
      }
      return runtime.multiEmitterViews.findIndex((view) => view.sphere === hits[0].object)
    }

    const onPointerDown = (event) => {
      const currentParams = paramsRef.current
      if (currentParams.multiEmitterPresetEnabled !== true || currentParams.multiEmitterRotateByMouse !== true) {
        return
      }
      const emitterIndex = getEmitterHitIndex(event)
      if (emitterIndex < 0) {
        return
      }
      event.preventDefault()
      runtime.multiEmitterRotateDrag = {
        index: emitterIndex,
        lastX: event.clientX,
        lastY: event.clientY,
      }
      setParam('multiEmitterSelectedIndex', emitterIndex)
      runtime.controls.enabled = false
    }

    const onPointerMove = (event) => {
      const dragState = runtime.multiEmitterRotateDrag
      if (!dragState) {
        return
      }
      event.preventDefault()
      const dx = event.clientX - dragState.lastX
      const dy = event.clientY - dragState.lastY
      if (Math.abs(dx) <= 0 && Math.abs(dy) <= 0) {
        return
      }
      dragState.lastX = event.clientX
      dragState.lastY = event.clientY
      const currentParams = paramsRef.current
      const normalized = normalizeMultiEmitterConfig(currentParams)
      const source = normalized.emitters[dragState.index] ?? {}
      const nextEmitters = patchEmitterConfig(currentParams, dragState.index, {
        yawDeg: (source.yawDeg ?? 0) + dx * 0.35,
        pitchDeg: Math.max(-89, Math.min(89, (source.pitchDeg ?? 0) - dy * 0.35)),
      })
      useSimulationStore.getState().setParams({
        multiEmitters: nextEmitters,
        multiEmitterSelectedIndex: dragState.index,
      })
    }

    const onPointerUp = () => {
      if (!runtime.multiEmitterRotateDrag) {
        return
      }
      runtime.multiEmitterRotateDrag = null
      runtime.controls.enabled = true
    }

    controls.addEventListener('change', onControlsChange)
    window.addEventListener('resize', onResize)
    renderer.domElement.addEventListener('click', onPointerSelectParticle)
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)

  const animate = () => {
    runtime.rafId = window.requestAnimationFrame(animate)
    const currentParams = paramsRef.current
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    beginFrame(runtime.simulationState.scheduler, now)
    runtime.frameCount = (runtime.frameCount || 0) + 1

      const lodTier = String(currentParams.runtimeRenderLodTier ?? 'near')
      const lodSizeScale = lodTier === 'far' ? 0.5 : lodTier === 'mid' ? 0.75 : 1
      const lodOpacityScale = lodTier === 'far' ? 0.6 : lodTier === 'mid' ? 0.8 : 1
      runtime.particleMaterial.size = currentParams.particleSize * lodSizeScale
      runtime.particleMaterial.opacity = currentParams.opacity * lodOpacityScale
      runtime.particleMaterial.color.set(currentParams.particleColor ?? '#ffffff')
      runtime.particleMaterial.vertexColors = currentParams.particleColorByCascadeLevel === true

      runtime.fastColor.set(currentParams.colorFast)
      runtime.slowColor.set(currentParams.colorSlow)
      const axisLength = currentParams.infiniteAxes ? 10000 : 8
      if (runtime.axisLength !== axisLength) {
        runtime.axisLength = axisLength
      }
      updateAxisMesh(runtime.positiveAxisMeshes[0], 'x', axisLength, false, currentParams.axisThickness)
      updateAxisMesh(runtime.positiveAxisMeshes[1], 'y', axisLength, false, currentParams.axisThickness)
      updateAxisMesh(runtime.positiveAxisMeshes[2], 'z', axisLength, false, currentParams.axisThickness)
      updateAxisMesh(runtime.negativeAxisMeshes[0], 'x', axisLength, true, currentParams.axisThickness)
      updateAxisMesh(runtime.negativeAxisMeshes[1], 'y', axisLength, true, currentParams.axisThickness)
      updateAxisMesh(runtime.negativeAxisMeshes[2], 'z', axisLength, true, currentParams.axisThickness)

      runtime.positiveAxisMeshes.forEach((mesh) => {
        mesh.visible = currentParams.showAxes
        mesh.material.opacity = currentParams.axisOpacity ?? 1
        mesh.material.needsUpdate = true
      })
      runtime.negativeAxisMeshes.forEach((mesh) => {
        mesh.visible = currentParams.showAxes && currentParams.showNegativeAxes
        mesh.material.opacity = currentParams.axisOpacity ?? 1
        mesh.material.needsUpdate = true
      })
      runtime.axisLabels.forEach((label) => {
        label.visible = currentParams.showAxes && currentParams.showAxisLabels
        label.material.opacity = currentParams.axisOpacity ?? 1
        label.material.needsUpdate = true
      })
      runtime.negativeAxisLabels.forEach((label) => {
        label.visible =
          currentParams.showAxes &&
          currentParams.showNegativeAxes &&
          currentParams.showAxisLabels
        label.material.opacity = currentParams.axisOpacity ?? 1
        label.material.needsUpdate = true
      })
  const nozzle = getNozzle(currentParams)
  const multiEmitter = normalizeMultiEmitterConfig(currentParams)
  const isMultiEmitterActive = multiEmitter.enabled && multiEmitter.count > 1
  const emitterHousingVisible =
    !isMultiEmitterActive &&
    currentParams.showNozzle &&
    currentParams.emitterHousingEnabled !== false
  const woodBoxOnlyVisible =
    emitterHousingVisible && currentParams.emitterHousingStyle !== 'blackHole'
  runtime.nozzleMarker.visible =
    !isMultiEmitterActive && currentParams.showNozzle && !woodBoxOnlyVisible
  runtime.nozzleMarker.position.set(nozzle.position.x, nozzle.position.y, nozzle.position.z)
  runtime.emitterHousingGroup.visible = emitterHousingVisible
  if (emitterHousingVisible) {
    const nozzleDiameter = Math.max(nozzle.radius * 2, 0.02)
    const boxHeight = Math.max(nozzleDiameter * 2.15, 0.05)
    const boxWidth = boxHeight
    const boxDepth = Math.max(boxHeight * (1024 / 819), 0.06)
    const woodStyle = currentParams.emitterHousingStyle !== 'blackHole'
    const housingAnchorShift = woodStyle ? boxDepth * 0.5 : 0
    const holeDiameter = boxHeight / 1.666
    runtime.nozzleDirectionVector
      .set(nozzle.direction.x, nozzle.direction.y, nozzle.direction.z)
      .normalize()
    runtime.emitterHousingGroup.position.set(
      nozzle.position.x - runtime.nozzleDirectionVector.x * housingAnchorShift,
      nozzle.position.y - runtime.nozzleDirectionVector.y * housingAnchorShift,
      nozzle.position.z - runtime.nozzleDirectionVector.z * housingAnchorShift,
    )
    runtime.emitterHousingGroup.quaternion.setFromUnitVectors(
      runtime.nozzleForwardVector,
      runtime.nozzleDirectionVector,
    )
    runtime.emitterHousingBox.scale.set(boxWidth, boxHeight, boxDepth)
    runtime.emitterHousingBox.visible = woodStyle
    updateEmitterHousingFrontHoleMask(runtime, holeDiameter, boxHeight, woodStyle)
    const tunnelFrontInset = Math.max(boxDepth * 0.02, 0.002)
    const tunnelBackInset = Math.max(boxDepth * 0.14, 0.01)
    const tunnelStartZ = boxDepth * 0.5 - tunnelFrontInset
    const tunnelEndZ = -boxDepth * 0.5 + tunnelBackInset
    const tunnelDepth = Math.max(tunnelStartZ - tunnelEndZ, boxDepth * 0.4)
    runtime.emitterHousingTunnel.scale.set(holeDiameter, tunnelDepth, holeDiameter)
    runtime.emitterHousingTunnel.position.set(0, 0, (tunnelStartZ + tunnelEndZ) * 0.5)
    runtime.emitterHousingTunnel.visible = woodStyle
  }
  updateCircleLine(runtime.nozzleRimLine, nozzle, nozzle.radius)
  updateCircleLine(runtime.shearLayerLine, nozzle, nozzle.radius, nozzle.radius * 0.05)
  updateAxisGuide(runtime.vortexAxisLine, nozzle, nozzle.radius * 6)
  runtime.nozzleRimLine.visible =
    !isMultiEmitterActive && currentParams.showNozzle && !woodBoxOnlyVisible
  runtime.shearLayerLine.visible =
    !isMultiEmitterActive &&
    !woodBoxOnlyVisible &&
    currentParams.showShearLayer &&
    (currentParams.emissionMode === 'vortexRing' || currentParams.emissionMode === 'jetRollup')
  runtime.vortexAxisLine.visible =
    !isMultiEmitterActive &&
    !woodBoxOnlyVisible &&
    (currentParams.showVortexRingAxis || currentParams.showNozzle)
  const configuredEmitters = getConfiguredEmitters(currentParams, { includeDisabled: true })
  for (let emitterIndex = 0; emitterIndex < runtime.multiEmitterViews.length; emitterIndex += 1) {
    const view = runtime.multiEmitterViews[emitterIndex]
    const emitter = configuredEmitters.find((entry) => entry.index === emitterIndex)
    const inRange = emitterIndex < multiEmitter.count
    const visible =
      isMultiEmitterActive &&
      inRange &&
      emitter &&
      emitter.visible === true
    view.sphere.visible = Boolean(visible)
    view.axis.visible = Boolean(visible)
    if (!visible) {
      continue
    }
    const markerColor = emitterIndex === multiEmitter.selectedIndex ? 0xffffff : 0x66ccff
    view.sphere.material.color.setHex(markerColor)
    view.axis.material.color.setHex(markerColor)
    view.sphere.position.set(
      emitter.nozzle.position.x,
      emitter.nozzle.position.y,
      emitter.nozzle.position.z,
    )
    updateAxisGuide(view.axis, emitter.nozzle, emitter.nozzle.radius * 6)
  }

  if (
    currentParams.velocityComputationMode === 'spatialGrid' &&
    (currentParams.showGrid || currentParams.showCellCenters || currentParams.showNeighborCells)
  ) {
    const shouldUpdate = (runtime.frameCount % runtime.gridDebug.updateInterval) === 0
    if (shouldUpdate || !runtime.gridDebug.lastUpdateFrame) {
      updateDebugGrid(group, runtime.particles, currentParams, runtime.gridDebug, camera)
      runtime.gridDebug.lastUpdateFrame = runtime.frameCount
    }
  }

  const pendingFilamentSpawns = runtime.simulationState.pendingFilamentSpawns ?? []
  if (pendingFilamentSpawns.length > 0) {
    const stepDt =
      runtime.simulationState.scheduler.fixedStep * Math.max(currentParams.timeScale ?? 1, 0)
    const remainingQueue = []
    for (let i = 0; i < pendingFilamentSpawns.length; i += 1) {
      const item = pendingFilamentSpawns[i]
      const remainingSec = (item.remainingSec ?? 0) - stepDt
      if (remainingSec <= 1e-6) {
        const filament = createFilamentRing(item.params, idRef.current, {
          mode: item.params.emissionMode,
          jetVelocity: item.params.jetSpeed ?? 0,
          axialDt:
            runtime.simulationState.scheduler.fixedStep *
            Math.max(item.params.timeScale ?? 1, 0),
          totalCirculation: item.params.gamma ?? 1,
        })
        const offsetX = item.params.filamentOffsetX ?? 0
        if (Math.abs(offsetX) > 1e-8) {
          for (let nodeIndex = 0; nodeIndex < filament.nodes.length; nodeIndex += 1) {
            filament.nodes[nodeIndex].position.x += offsetX
          }
        }
        runtime.filaments.push(filament)
        idRef.current += 1
      } else {
        remainingQueue.push({ ...item, remainingSec })
      }
    }
    runtime.simulationState.pendingFilamentSpawns = remainingQueue
  }

      stepSimulationRuntime(runtime, normalizeSimulationParams(currentParams), idRef)
      runtime.simulationState.particleRenderSource = resolveParticleRenderSource(
        currentParams,
        runtime.runtimeStatus,
        runtime.webgpuManager,
      )
      if (runtime.simulationState.vectorPulseCooldownFrames > 0) {
        runtime.simulationState.vectorPulseCooldownFrames -= 1
      }
      const renderedFromGpu =
        runtime.simulationState.particleRenderSource.active === 'gpu_prepared' &&
        currentParams.vizShowVorticityField !== true &&
        currentParams.vizShowVelocityField !== true &&
        currentParams.vizShowQCriterion !== true &&
        currentParams.vizShowPathlines !== true &&
        currentParams.vizShowStreamlines !== true &&
        renderParticleViewsFromGpuSnapshot({
          runtime,
          currentParams,
          group,
          particleMaterial,
          createParticleView,
          removeExtraViews,
        })
      const conservativeCpuRender =
        runtime.simulationState.particleRenderSource.active === 'cpu_conservative'
      const transientCpuFallbackForGpu =
        currentParams.physicsBackend === 'webgpu' && !renderedFromGpu && !conservativeCpuRender
      const suppressVectorsByPulse = runtime.simulationState.vectorPulseCooldownFrames > 0
      const suppressVectorsByGuard = (runtime.simulationState.vectorGuardFrames ?? 0) > 0
      const disableFallbackVectorsForGpuBackend =
        currentParams.physicsBackend === 'webgpu' && !renderedFromGpu && !conservativeCpuRender
      const renderPolicy = runtime.simulationState.particleRenderSource.policy ?? 'cpu_backend'
      const renderBackend = renderedFromGpu ? 'gpu' : 'cpu_fallback'
      const renderFallbackReason = renderedFromGpu
        ? 'gpu_snapshot'
        : runtime.simulationState.particleRenderSource.reason &&
            runtime.simulationState.particleRenderSource.active === 'cpu_conservative'
          ? runtime.simulationState.particleRenderSource.reason
        : runtime.simulationState.particleRenderSource.requested !== 'gpu'
          ? 'cpu_backend'
          : suppressVectorsByGuard
            ? 'pulse_vector_guard'
            : suppressVectorsByPulse
              ? 'pulse_vector_cooldown'
          : disableFallbackVectorsForGpuBackend
            ? 'cpu_fallback_no_vectors'
            : transientCpuFallbackForGpu
              ? 'gpu_snapshot_pending'
              : runtime.simulationState.particleRenderSource.active !== 'gpu_prepared'
                ? 'gpu_not_prepared'
                : 'snapshot_unavailable'
      const representationPolicy = buildRenderRepresentationPolicy(currentParams)
      if (
        runtime.publishedStats.particleRenderPolicy !== renderPolicy ||
        runtime.publishedStats.particleRenderBackend !== renderBackend ||
        runtime.publishedStats.particleRenderFallbackReason !== renderFallbackReason ||
        runtime.publishedStats.renderPolicyMode !== representationPolicy.mode ||
        runtime.publishedStats.renderLodTier !== representationPolicy.lodTier ||
        runtime.publishedStats.renderParticleLayerVisible !== representationPolicy.layers.particles.visible ||
        runtime.publishedStats.renderFilamentLayerVisible !== representationPolicy.layers.filaments.visible ||
        runtime.publishedStats.renderSheetLayerVisible !== representationPolicy.layers.sheets.visible ||
        runtime.publishedStats.renderDiagnosticsConfidence !== representationPolicy.diagnostics.confidence ||
        runtime.publishedStats.renderDiagnosticsUncertainty !== representationPolicy.diagnostics.uncertainty ||
        runtime.publishedStats.renderUncertaintyDetectorGap !== representationPolicy.diagnostics.components.detectorGap ||
        runtime.publishedStats.renderUncertaintyFallback !== representationPolicy.diagnostics.components.renderFallback ||
        runtime.publishedStats.renderUncertaintyTopologyVolatility !==
          representationPolicy.diagnostics.components.topologyVolatility ||
        runtime.publishedStats.renderSheetPanelCount !==
          representationPolicy.diagnostics.sheetDiscretization.panelCount ||
        runtime.publishedStats.renderSheetCoverage !==
          representationPolicy.diagnostics.sheetDiscretization.coverage ||
        runtime.publishedStats.renderSheetReadiness !==
          representationPolicy.diagnostics.sheetDiscretization.readiness ||
        runtime.publishedStats.renderSheetQuadratureOrder !==
          representationPolicy.diagnostics.sheetDiscretization.quadratureOrder ||
        runtime.publishedStats.renderSheetDesingularizationEpsilon !==
          representationPolicy.diagnostics.sheetDiscretization.desingularizationEpsilon ||
        runtime.publishedStats.renderSheetProfileId !== representationPolicy.diagnostics.sheetDiscretization.profileId ||
        runtime.publishedStats.renderSheetQuadratureProfile !==
          representationPolicy.diagnostics.sheetDiscretization.quadratureProfile ||
        runtime.publishedStats.renderSheetMeshSeed !==
          representationPolicy.diagnostics.sheetDiscretization.meshSeed ||
        runtime.publishedStats.renderSheetMeshTopology !==
          representationPolicy.diagnostics.sheetDiscretization.topology ||
        runtime.publishedStats.renderSheetMeshPatchCount !==
          representationPolicy.diagnostics.sheetDiscretization.patchCount ||
        runtime.publishedStats.renderSheetPanelAspectP95 !==
          representationPolicy.diagnostics.sheetDiscretization.panelAspectP95 ||
        runtime.publishedStats.renderSheetQualityGatePassCount !==
          representationPolicy.diagnostics.sheetDiscretization.qualityGatePassCount ||
        runtime.publishedStats.renderSheetQualityGateTotal !==
          representationPolicy.diagnostics.sheetDiscretization.qualityGateTotal ||
        runtime.publishedStats.renderSheetQualityVerdict !==
          representationPolicy.diagnostics.sheetDiscretization.qualityVerdict ||
        runtime.publishedStats.renderSheetQualityPenalty !==
          representationPolicy.diagnostics.sheetDiscretization.qualityPenalty ||
        runtime.publishedStats.renderSheetMeshDeterministic !==
          representationPolicy.diagnostics.sheetDiscretization.meshLayout.deterministic ||
        runtime.publishedStats.renderSheetMeshLayoutDigest !==
          representationPolicy.diagnostics.sheetDiscretization.meshLayout.layoutDigest ||
        runtime.publishedStats.renderSheetMeshPatchMinPanels !==
          representationPolicy.diagnostics.sheetDiscretization.meshLayout.patchPanelMin ||
        runtime.publishedStats.renderSheetMeshPatchMaxPanels !==
          representationPolicy.diagnostics.sheetDiscretization.meshLayout.patchPanelMax ||
        runtime.publishedStats.renderSheetMeshPatchImbalance !==
          representationPolicy.diagnostics.sheetDiscretization.meshLayout.patchPanelImbalance ||
        runtime.publishedStats.renderSheetMeshContractVersion !==
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.version ||
        runtime.publishedStats.renderSheetMeshContractValid !==
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.valid ||
        runtime.publishedStats.renderSheetMeshContractIssueCount !==
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.issueCount ||
        runtime.publishedStats.renderSheetMeshContractGatePassCount !==
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.gatePassCount ||
        runtime.publishedStats.renderSheetMeshContractGateTotal !==
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.gateTotal ||
        runtime.publishedStats.renderSheetMeshContractVerdict !==
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.verdict ||
        runtime.publishedStats.renderSheetMeshContractPenalty !==
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.penalty ||
        runtime.publishedStats.renderSheetMeshPatchAreaMean !==
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.envelope.patchAreaMean ||
        runtime.publishedStats.renderSheetMeshPatchAreaCv !==
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.envelope.patchAreaCv ||
        runtime.publishedStats.renderSheetMeshEdgeLengthRatioP95 !==
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.envelope.edgeLengthRatioP95 ||
        runtime.publishedStats.renderSheetMeshCurvatureProxyP95 !==
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.envelope.curvatureProxyP95 ||
        runtime.publishedStats.renderSheetCouplingVersion !==
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.version ||
        runtime.publishedStats.renderSheetCouplingValid !==
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.valid ||
        runtime.publishedStats.renderSheetCouplingVerdict !==
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.verdict ||
        runtime.publishedStats.renderSheetCouplingPenalty !==
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.penalty ||
        runtime.publishedStats.renderSheetCouplingAmerState !==
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.amer.state ||
        runtime.publishedStats.renderSheetCouplingAmerTransferBudget !==
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.amer.transferBudget ||
        runtime.publishedStats.renderSheetCouplingAmerInvariantDriftCapPct !==
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.amer.invariantDriftCapPct ||
        runtime.publishedStats.renderSheetCouplingFilamentState !==
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.filament.state ||
        runtime.publishedStats.renderSheetCouplingFilamentNodeTransferCap !==
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.filament.nodeTransferCap ||
        runtime.publishedStats.renderSheetCouplingFilamentLoad !==
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.filament.load ||
        runtime.publishedStats.renderSheetRollupStabilityGuard !==
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.rollupStabilityGuard ||
        runtime.publishedStats.renderSheetPlaceholder !== representationPolicy.layers.sheets.placeholder
      ) {
        runtime.publishedStats.particleRenderPolicy = renderPolicy
        runtime.publishedStats.particleRenderBackend = renderBackend
        runtime.publishedStats.particleRenderFallbackReason = renderFallbackReason
        runtime.publishedStats.renderPolicyMode = representationPolicy.mode
        runtime.publishedStats.renderLodTier = representationPolicy.lodTier
        runtime.publishedStats.renderParticleLayerVisible = representationPolicy.layers.particles.visible
        runtime.publishedStats.renderFilamentLayerVisible = representationPolicy.layers.filaments.visible
        runtime.publishedStats.renderSheetLayerVisible = representationPolicy.layers.sheets.visible
        runtime.publishedStats.renderDiagnosticsConfidence = representationPolicy.diagnostics.confidence
        runtime.publishedStats.renderDiagnosticsUncertainty = representationPolicy.diagnostics.uncertainty
        runtime.publishedStats.renderUncertaintyDetectorGap =
          representationPolicy.diagnostics.components.detectorGap
        runtime.publishedStats.renderUncertaintyFallback =
          representationPolicy.diagnostics.components.renderFallback
        runtime.publishedStats.renderUncertaintyTopologyVolatility =
          representationPolicy.diagnostics.components.topologyVolatility
        runtime.publishedStats.renderSheetPanelCount =
          representationPolicy.diagnostics.sheetDiscretization.panelCount
        runtime.publishedStats.renderSheetCoverage =
          representationPolicy.diagnostics.sheetDiscretization.coverage
        runtime.publishedStats.renderSheetReadiness =
          representationPolicy.diagnostics.sheetDiscretization.readiness
        runtime.publishedStats.renderSheetQuadratureOrder =
          representationPolicy.diagnostics.sheetDiscretization.quadratureOrder
        runtime.publishedStats.renderSheetDesingularizationEpsilon =
          representationPolicy.diagnostics.sheetDiscretization.desingularizationEpsilon
        runtime.publishedStats.renderSheetProfileId = representationPolicy.diagnostics.sheetDiscretization.profileId
        runtime.publishedStats.renderSheetQuadratureProfile =
          representationPolicy.diagnostics.sheetDiscretization.quadratureProfile
        runtime.publishedStats.renderSheetMeshSeed = representationPolicy.diagnostics.sheetDiscretization.meshSeed
        runtime.publishedStats.renderSheetMeshTopology = representationPolicy.diagnostics.sheetDiscretization.topology
        runtime.publishedStats.renderSheetMeshPatchCount =
          representationPolicy.diagnostics.sheetDiscretization.patchCount
        runtime.publishedStats.renderSheetPanelAspectP95 =
          representationPolicy.diagnostics.sheetDiscretization.panelAspectP95
        runtime.publishedStats.renderSheetQualityGatePassCount =
          representationPolicy.diagnostics.sheetDiscretization.qualityGatePassCount
        runtime.publishedStats.renderSheetQualityGateTotal =
          representationPolicy.diagnostics.sheetDiscretization.qualityGateTotal
        runtime.publishedStats.renderSheetQualityVerdict =
          representationPolicy.diagnostics.sheetDiscretization.qualityVerdict
        runtime.publishedStats.renderSheetQualityPenalty =
          representationPolicy.diagnostics.sheetDiscretization.qualityPenalty
        runtime.publishedStats.renderSheetMeshDeterministic =
          representationPolicy.diagnostics.sheetDiscretization.meshLayout.deterministic
        runtime.publishedStats.renderSheetMeshLayoutDigest =
          representationPolicy.diagnostics.sheetDiscretization.meshLayout.layoutDigest
        runtime.publishedStats.renderSheetMeshPatchMinPanels =
          representationPolicy.diagnostics.sheetDiscretization.meshLayout.patchPanelMin
        runtime.publishedStats.renderSheetMeshPatchMaxPanels =
          representationPolicy.diagnostics.sheetDiscretization.meshLayout.patchPanelMax
        runtime.publishedStats.renderSheetMeshPatchImbalance =
          representationPolicy.diagnostics.sheetDiscretization.meshLayout.patchPanelImbalance
        runtime.publishedStats.renderSheetMeshContractVersion =
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.version
        runtime.publishedStats.renderSheetMeshContractValid =
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.valid
        runtime.publishedStats.renderSheetMeshContractIssueCount =
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.issueCount
        runtime.publishedStats.renderSheetMeshContractGatePassCount =
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.gatePassCount
        runtime.publishedStats.renderSheetMeshContractGateTotal =
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.gateTotal
        runtime.publishedStats.renderSheetMeshContractVerdict =
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.verdict
        runtime.publishedStats.renderSheetMeshContractPenalty =
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.penalty
        runtime.publishedStats.renderSheetMeshPatchAreaMean =
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.envelope.patchAreaMean
        runtime.publishedStats.renderSheetMeshPatchAreaCv =
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.envelope.patchAreaCv
        runtime.publishedStats.renderSheetMeshEdgeLengthRatioP95 =
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.envelope.edgeLengthRatioP95
        runtime.publishedStats.renderSheetMeshCurvatureProxyP95 =
          representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.envelope.curvatureProxyP95
        runtime.publishedStats.renderSheetCouplingVersion =
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.version
        runtime.publishedStats.renderSheetCouplingValid =
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.valid
        runtime.publishedStats.renderSheetCouplingVerdict =
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.verdict
        runtime.publishedStats.renderSheetCouplingPenalty =
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.penalty
        runtime.publishedStats.renderSheetCouplingAmerState =
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.amer.state
        runtime.publishedStats.renderSheetCouplingAmerTransferBudget =
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.amer.transferBudget
        runtime.publishedStats.renderSheetCouplingAmerInvariantDriftCapPct =
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.amer.invariantDriftCapPct
        runtime.publishedStats.renderSheetCouplingFilamentState =
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.filament.state
        runtime.publishedStats.renderSheetCouplingFilamentNodeTransferCap =
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.filament.nodeTransferCap
        runtime.publishedStats.renderSheetCouplingFilamentLoad =
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.filament.load
        runtime.publishedStats.renderSheetRollupStabilityGuard =
          representationPolicy.diagnostics.sheetDiscretization.couplingContracts.rollupStabilityGuard
        runtime.publishedStats.renderSheetPlaceholder = representationPolicy.layers.sheets.placeholder
        runtime.publishedStats.renderScoreParticles = representationPolicy.scores.particles
        runtime.publishedStats.renderScoreFilaments = representationPolicy.scores.filaments
        runtime.publishedStats.renderScoreSheets = representationPolicy.scores.sheets
        runtime.publishedStats.renderScoreCurrent = representationPolicy.scores.current
        runtime.publishedStats.renderScoreMargin = representationPolicy.scores.margin
        runtime.publishedStats.renderScoreBestMode = representationPolicy.scores.bestMode
        runtime.publishedStats.renderHysteresisHoldSteps = representationPolicy.hysteresis.holdStepsMin
        runtime.publishedStats.renderHysteresisRemaining = representationPolicy.hysteresis.remaining
        runtime.publishedStats.renderOverrideReason = representationPolicy.overrideReason ?? 'none'
        runtime.publishedStats.renderHealthFallbackRate = representationPolicy.health.fallbackRate
        runtime.publishedStats.renderHealthTimeoutRate = representationPolicy.health.timeoutRate
        runtime.publishedStats.renderHealthDriftSeverity = representationPolicy.health.driftSeverity
        useSimulationStore.getState().setParams({
          runtimeParticleRenderPolicy: renderPolicy,
          runtimeParticleRenderBackend: renderBackend,
          runtimeParticleRenderFallbackReason: renderFallbackReason,
          runtimeRenderPolicyMode: representationPolicy.mode,
          runtimeRenderLodTier: representationPolicy.lodTier,
          runtimeRenderParticleLayerVisible: representationPolicy.layers.particles.visible,
          runtimeRenderFilamentLayerVisible: representationPolicy.layers.filaments.visible,
          runtimeRenderSheetLayerVisible: representationPolicy.layers.sheets.visible,
          runtimeRenderDiagnosticsConfidence: representationPolicy.diagnostics.confidence,
          runtimeRenderDiagnosticsUncertainty: representationPolicy.diagnostics.uncertainty,
          runtimeRenderUncertaintyDetectorGap: representationPolicy.diagnostics.components.detectorGap,
          runtimeRenderUncertaintyFallback: representationPolicy.diagnostics.components.renderFallback,
          runtimeRenderUncertaintyTopologyVolatility:
            representationPolicy.diagnostics.components.topologyVolatility,
          runtimeRenderSheetPanelCount: representationPolicy.diagnostics.sheetDiscretization.panelCount,
          runtimeRenderSheetCoverage: representationPolicy.diagnostics.sheetDiscretization.coverage,
          runtimeRenderSheetReadiness: representationPolicy.diagnostics.sheetDiscretization.readiness,
          runtimeRenderSheetQuadratureOrder:
            representationPolicy.diagnostics.sheetDiscretization.quadratureOrder,
          runtimeRenderSheetDesingularizationEpsilon:
            representationPolicy.diagnostics.sheetDiscretization.desingularizationEpsilon,
          runtimeRenderSheetProfileId: representationPolicy.diagnostics.sheetDiscretization.profileId,
          runtimeRenderSheetQuadratureProfile:
            representationPolicy.diagnostics.sheetDiscretization.quadratureProfile,
          runtimeRenderSheetMeshSeed: representationPolicy.diagnostics.sheetDiscretization.meshSeed,
          runtimeRenderSheetMeshTopology: representationPolicy.diagnostics.sheetDiscretization.topology,
          runtimeRenderSheetMeshPatchCount: representationPolicy.diagnostics.sheetDiscretization.patchCount,
          runtimeRenderSheetPanelAspectP95: representationPolicy.diagnostics.sheetDiscretization.panelAspectP95,
          runtimeRenderSheetQualityGatePassCount:
            representationPolicy.diagnostics.sheetDiscretization.qualityGatePassCount,
          runtimeRenderSheetQualityGateTotal:
            representationPolicy.diagnostics.sheetDiscretization.qualityGateTotal,
          runtimeRenderSheetQualityVerdict: representationPolicy.diagnostics.sheetDiscretization.qualityVerdict,
          runtimeRenderSheetQualityPenalty: representationPolicy.diagnostics.sheetDiscretization.qualityPenalty,
          runtimeRenderSheetMeshDeterministic:
            representationPolicy.diagnostics.sheetDiscretization.meshLayout.deterministic,
          runtimeRenderSheetMeshLayoutDigest:
            representationPolicy.diagnostics.sheetDiscretization.meshLayout.layoutDigest,
          runtimeRenderSheetMeshPatchMinPanels:
            representationPolicy.diagnostics.sheetDiscretization.meshLayout.patchPanelMin,
          runtimeRenderSheetMeshPatchMaxPanels:
            representationPolicy.diagnostics.sheetDiscretization.meshLayout.patchPanelMax,
          runtimeRenderSheetMeshPatchImbalance:
            representationPolicy.diagnostics.sheetDiscretization.meshLayout.patchPanelImbalance,
          runtimeRenderSheetMeshContractVersion:
            representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.version,
          runtimeRenderSheetMeshContractValid:
            representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.valid,
          runtimeRenderSheetMeshContractIssueCount:
            representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.issueCount,
          runtimeRenderSheetMeshContractGatePassCount:
            representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.gatePassCount,
          runtimeRenderSheetMeshContractGateTotal:
            representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.gateTotal,
          runtimeRenderSheetMeshContractVerdict:
            representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.verdict,
          runtimeRenderSheetMeshContractPenalty:
            representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.penalty,
          runtimeRenderSheetMeshPatchAreaMean:
            representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.envelope.patchAreaMean,
          runtimeRenderSheetMeshPatchAreaCv:
            representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.envelope.patchAreaCv,
          runtimeRenderSheetMeshEdgeLengthRatioP95:
            representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.envelope.edgeLengthRatioP95,
          runtimeRenderSheetMeshCurvatureProxyP95:
            representationPolicy.diagnostics.sheetDiscretization.meshBuilderContract.envelope.curvatureProxyP95,
          runtimeRenderSheetCouplingVersion:
            representationPolicy.diagnostics.sheetDiscretization.couplingContracts.version,
          runtimeRenderSheetCouplingValid:
            representationPolicy.diagnostics.sheetDiscretization.couplingContracts.valid,
          runtimeRenderSheetCouplingVerdict:
            representationPolicy.diagnostics.sheetDiscretization.couplingContracts.verdict,
          runtimeRenderSheetCouplingPenalty:
            representationPolicy.diagnostics.sheetDiscretization.couplingContracts.penalty,
          runtimeRenderSheetCouplingAmerState:
            representationPolicy.diagnostics.sheetDiscretization.couplingContracts.amer.state,
          runtimeRenderSheetCouplingAmerTransferBudget:
            representationPolicy.diagnostics.sheetDiscretization.couplingContracts.amer.transferBudget,
          runtimeRenderSheetCouplingAmerInvariantDriftCapPct:
            representationPolicy.diagnostics.sheetDiscretization.couplingContracts.amer.invariantDriftCapPct,
          runtimeRenderSheetCouplingFilamentState:
            representationPolicy.diagnostics.sheetDiscretization.couplingContracts.filament.state,
          runtimeRenderSheetCouplingFilamentNodeTransferCap:
            representationPolicy.diagnostics.sheetDiscretization.couplingContracts.filament.nodeTransferCap,
          runtimeRenderSheetCouplingFilamentLoad:
            representationPolicy.diagnostics.sheetDiscretization.couplingContracts.filament.load,
          runtimeRenderSheetRollupStabilityGuard:
            representationPolicy.diagnostics.sheetDiscretization.couplingContracts.rollupStabilityGuard,
          runtimeRenderSheetPlaceholder: representationPolicy.layers.sheets.placeholder,
          runtimeRenderScoreParticles: representationPolicy.scores.particles,
          runtimeRenderScoreFilaments: representationPolicy.scores.filaments,
          runtimeRenderScoreSheets: representationPolicy.scores.sheets,
          runtimeRenderScoreCurrent: representationPolicy.scores.current,
          runtimeRenderScoreMargin: representationPolicy.scores.margin,
          runtimeRenderScoreBestMode: representationPolicy.scores.bestMode,
          runtimeRenderHysteresisHoldSteps: representationPolicy.hysteresis.holdStepsMin,
          runtimeRenderHysteresisRemaining: representationPolicy.hysteresis.remaining,
          runtimeRenderOverrideReason: representationPolicy.overrideReason ?? 'none',
          runtimeRenderHealthFallbackRate: representationPolicy.health.fallbackRate,
          runtimeRenderHealthTimeoutRate: representationPolicy.health.timeoutRate,
          runtimeRenderHealthDriftSeverity: representationPolicy.health.driftSeverity,
        })
      }

      if (!renderedFromGpu) {
        while (runtime.particleViews.length < runtime.particles.length) {
          const idx = runtime.particleViews.length
          const view = createParticleView(
            group,
            particleMaterial,
            runtime.particles[idx],
            currentParams.arrowHead,
          )
          runtime.particleViews.push(view)
        }
        removeExtraViews(group, runtime.particleViews, runtime.particles.length)
      }

      while (runtime.filamentViews.length < runtime.filaments.length) {
        runtime.filamentViews.push(createFilamentView(group))
      }
      removeExtraFilamentViews(group, runtime.filamentViews, runtime.filaments.length)
      const showTubeSpineByMode =
        currentParams.vortexRepresentation !== 'tubes' ||
        currentParams.tubeViewMode === 'spine_particles'
      for (let i = 0; i < runtime.filaments.length; i += 1) {
        updateFilamentView(runtime.filamentViews[i], runtime.filaments[i], {
          ...currentParams,
          showFilaments:
            representationPolicy.layers.filaments.visible !== true
              ? false
              : currentParams.vortexRepresentation === 'tubes'
              ? currentParams.showTubeSpine !== false && showTubeSpineByMode
              : currentParams.showFilaments,
        })
      }

      const runtimeTubes =
        currentParams.vortexRepresentation === 'tubes'
          ? runtime.simulationState.vortexTubes ?? []
          : []
      while (runtime.tubeViews.length < runtimeTubes.length) {
        runtime.tubeViews.push(createTubeView(group))
      }
      removeExtraTubeViews(group, runtime.tubeViews, runtimeTubes.length)
      for (let i = 0; i < runtimeTubes.length; i += 1) {
        const spineNodeCount = runtime.filaments.find(
          (filament) => filament.id === runtimeTubes[i].spineFilamentId,
        )?.nodes?.length
        updateTubeView(runtime.tubeViews[i], runtimeTubes[i], currentParams, spineNodeCount ?? 0)
      }
      const overlayFeatures = Array.isArray(currentParams.runtimeOverlayStructures)
        ? currentParams.runtimeOverlayStructures
        : []
      const showDetectedStructureOverlay =
        currentParams.vizScientificMode === true && currentParams.vizShowDetectionOverlay === true
      const showScientificSheetLayer = representationPolicy.layers.sheets.visible === true
      const minOverlayConfidence = clamp01(currentParams.vizOverlayMinConfidence ?? 0.25)
      const showOverlayLabels = currentParams.vizOverlayShowLabels === true
      const overlayLabelMaxCount = Math.max(1, Math.floor(Number(currentParams.vizOverlayLabelMaxCount ?? 8) || 8))
      const overlayLabelMaxDistance = Math.max(2, Number(currentParams.vizOverlayLabelMaxDistance ?? 12) || 12)
      let shownLabels = 0
      while (runtime.structureOverlayViews.length < overlayFeatures.length) {
        runtime.structureOverlayViews.push(createStructureOverlayView(group))
      }
      removeExtraStructureOverlayViews(group, runtime.structureOverlayViews, overlayFeatures.length)
      for (let i = 0; i < overlayFeatures.length; i += 1) {
        const feature = overlayFeatures[i] ?? {}
        const view = runtime.structureOverlayViews[i]
        const radius = Math.max(0.03, Number(feature.radius ?? 0.1) || 0.1)
        const confidence = clamp01(feature.confidence ?? 0)
        const kind = String(feature.class ?? 'cluster')
        view.root.position.set(
          Number(feature.center?.x ?? 0) || 0,
          Number(feature.center?.y ?? 0) || 0,
          Number(feature.center?.z ?? 0) || 0,
        )
        const activeMesh =
          kind === 'ring'
            ? view.ringMesh
            : kind === 'tube'
              ? view.tubeMesh
              : kind === 'sheet'
                ? view.sheetMesh
              : kind === 'filament'
                ? view.filamentMesh
                : view.clusterMesh
        view.clusterMesh.visible = false
        view.ringMesh.visible = false
        view.tubeMesh.visible = false
        view.sheetMesh.visible = false
        view.filamentMesh.visible = false
        activeMesh.visible = true
        activeMesh.material.color.setHex(getOverlayColorByClass(kind))
        activeMesh.material.opacity =
          kind === 'sheet' && showScientificSheetLayer
            ? 0.2 + confidence * 0.45
            : 0.1 + confidence * 0.35
        if (activeMesh === view.ringMesh) {
          activeMesh.scale.set(radius, radius, Math.max(0.15, radius * 0.35))
        } else if (activeMesh === view.sheetMesh) {
          activeMesh.scale.set(radius * 1.45, Math.max(0.04, radius * 0.08), radius * 1.45)
        } else if (activeMesh === view.filamentMesh) {
          activeMesh.scale.set(Math.max(0.05, radius * 0.45), Math.max(0.2, radius * 2.1), Math.max(0.05, radius * 0.45))
        } else {
          activeMesh.scale.set(radius, radius, radius)
        }
        const featureVisible =
          confidence >= minOverlayConfidence &&
          (showDetectedStructureOverlay || (showScientificSheetLayer && kind === 'sheet'))
        view.root.visible = featureVisible
        const classLabel =
          kind === 'ring' ? 'ring' : kind === 'tube' ? 'tube' : kind === 'sheet' ? 'sht' : kind === 'filament' ? 'fil' : 'clu'
        updateStructureLabelSprite(view, `${classLabel} ${(confidence * 100).toFixed(0)}%`, getOverlayColorByClass(kind))
        view.labelSprite.position.set(0, radius * 1.35 + 0.05, 0)
        const labelScale = Math.max(0.5, Math.min(1.8, radius * 0.55))
        view.labelSprite.scale.set(0.9 * labelScale, 0.24 * labelScale, 1)
        const dx = (Number(feature.center?.x ?? 0) || 0) - camera.position.x
        const dy = (Number(feature.center?.y ?? 0) || 0) - camera.position.y
        const dz = (Number(feature.center?.z ?? 0) || 0) - camera.position.z
        const cameraDistance = Math.hypot(dx, dy, dz)
        const canShowLabel =
          featureVisible &&
          showDetectedStructureOverlay &&
          showOverlayLabels &&
          cameraDistance <= overlayLabelMaxDistance &&
          shownLabels < overlayLabelMaxCount
        view.labelSprite.visible = canShowLabel
        if (canShowLabel) {
          shownLabels += 1
        }
      }
      if (!renderedFromGpu) {
        for (let i = 0; i < runtime.particles.length; i += 1) {
          const particle = runtime.particles[i]
          const view = runtime.particleViews[i]

        const freshVectorWindow = Math.max(
          Math.max(runtime.fixedStep, 1e-4) * 3,
          (currentParams.pulseDuration ?? 0) * 0.5,
        )
        const isFreshSpawn = (particle.age ?? 0) <= freshVectorWindow
        const renderVx = isFreshSpawn
          ? (particle.injectVx ?? particle.vx ?? 0)
          : Number.isFinite(particle.flowVx) && Math.abs(particle.flowVx) > 1e-8
            ? particle.flowVx
            : 0
        const renderVy = isFreshSpawn
          ? (particle.injectVy ?? particle.vy ?? 0)
          : Number.isFinite(particle.flowVy) && Math.abs(particle.flowVy) > 1e-8
            ? particle.flowVy
            : 0
        const renderVz = isFreshSpawn
          ? (particle.injectVz ?? particle.vz ?? 0)
          : Number.isFinite(particle.flowVz) && Math.abs(particle.flowVz) > 1e-8
            ? particle.flowVz
            : 0

        runtime.speedVector.set(renderVx, renderVy, renderVz)
        const speed = runtime.speedVector.length()
        const speedForRender = Math.min(speed, Math.max(currentParams.maxVelocity ?? 1, 1) * 2)
        const vorticityMagnitude = particle.vorticity
          ? Math.sqrt(
              particle.vorticity.x * particle.vorticity.x +
                particle.vorticity.y * particle.vorticity.y +
                particle.vorticity.z * particle.vorticity.z,
            )
          : 0
        const colorByVorticity = currentParams.debugVorticity === true || currentParams.vizShowVorticityField === true
        const colorByQCriterion = currentParams.vizShowQCriterion === true
        const qCriterionProxy = computeQCriterionProxy(
          vorticityMagnitude,
          speedForRender,
          currentParams.interactionRadius,
        )
        const colorMetric = colorByQCriterion ? qCriterionProxy : colorByVorticity ? vorticityMagnitude : speedForRender

        if (speed > 0) {
          runtime.speedVector.normalize()
        }

        const position = view.mesh.geometry.attributes.position.array
        position[0] = particle.x
        position[1] = particle.y
        position[2] = particle.z
        view.mesh.geometry.attributes.position.needsUpdate = true

        if (currentParams.particleColorByCascadeLevel === true) {
          let colorAttr = view.mesh.geometry.attributes.color
          if (!colorAttr) {
            colorAttr = new THREE.BufferAttribute(new Float32Array(3), 3)
            view.mesh.geometry.setAttribute('color', colorAttr)
          }
          const level = particle.cascadeLevel ?? 0
          const t = Math.min(level / 4, 1)
          runtime.mixedColor.copy(runtime.slowColor).lerp(runtime.fastColor, t)
          colorAttr.array[0] = runtime.mixedColor.r
          colorAttr.array[1] = runtime.mixedColor.g
          colorAttr.array[2] = runtime.mixedColor.b
          colorAttr.needsUpdate = true
        }

        const colorScale = colorByQCriterion ? 0.15 : colorByVorticity ? 0.2 : 20
        let t = colorByQCriterion
          ? clamp01(0.5 + colorMetric * colorScale)
          : clamp01(colorMetric * colorScale)
        if (currentParams.invertColors) {
          t = 1 - t
        }

        runtime.mixedColor.copy(runtime.slowColor).lerp(runtime.fastColor, t)

        view.arrow.position.set(particle.x, particle.y, particle.z)
        view.arrow.setDirection(runtime.speedVector)
        const vizScale =
          currentParams.vizScientificMode === true
            ? Math.max(0.5, Number(currentParams.vizExportScale ?? 1) || 1)
            : 1
        const vectorLength = Math.min(Math.max(speedForRender * currentParams.arrowScale * vizScale, 0.02), 360)
        view.arrow.setLength(
          vectorLength,
          currentParams.arrowHead,
          currentParams.arrowHead * 0.5,
        )
        view.arrow.line.material.color.copy(runtime.mixedColor)
        view.arrow.cone.material.color.copy(runtime.mixedColor)
        const arrowOpacity = Math.min(Math.max(currentParams.arrowOpacity ?? 1, 0), 1)
        view.arrow.line.material.opacity = arrowOpacity
        view.arrow.line.material.transparent = arrowOpacity < 1
        view.arrow.cone.material.opacity = arrowOpacity
        view.arrow.cone.material.transparent = arrowOpacity < 1

        const vectorDisplayMode = (() => {
          if (
            currentParams.vizShowVelocityField === true ||
            currentParams.vizShowStreamlines === true ||
            currentParams.vizShowPathlines === true
          ) {
            return 'both'
          }
          if (currentParams.vectorDisplayMode === 'vectors') {
            return 'vectors'
          }
          if (currentParams.vectorDisplayMode === 'both') {
            return 'both'
          }
          if (currentParams.vectorDisplayMode === 'particles') {
            return 'particles'
          }
          if (currentParams.showBoth) {
            return 'both'
          }
          if (currentParams.showVectors) {
            return 'vectors'
          }
          return 'particles'
        })()
        const showVector = vectorDisplayMode === 'vectors' || vectorDisplayMode === 'both'
        const useCurved =
          currentParams.vizShowPathlines === true
            ? true
            : currentParams.vizShowStreamlines === true
              ? false
              : currentParams.curvedVectors

        if (useCurved) {
          const historyPoints = Array.isArray(particle.history) ? particle.history : []
          const points = historyPoints.map(
            (point) => new THREE.Vector3(point.x, point.y, point.z),
          )

          if (points.length < 2) {
            points.push(new THREE.Vector3(particle.x, particle.y, particle.z))
          }

          const tension = Math.min(Math.max(currentParams.curveStrength, 0), 1)
          const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', tension)
          const samples = Math.max(4, Math.floor(currentParams.curveSamples))
          const sampledPoints = curve.getPoints(samples)

          view.curveLine.geometry.setFromPoints(sampledPoints)
          view.curveLine.material.color.copy(runtime.mixedColor)
          view.curveLine.material.opacity = arrowOpacity
          view.curveLine.material.transparent = arrowOpacity < 1

          const headLength = Math.max(0.01, currentParams.arrowHead)
          const endPoint = sampledPoints[sampledPoints.length - 1]
          runtime.tangentVector.copy(curve.getTangent(1))
          if (runtime.tangentVector.lengthSq() > 0) {
            runtime.tangentVector.normalize()
          } else {
            runtime.tangentVector.copy(runtime.speedVector)
          }
          if (runtime.tangentVector.lengthSq() <= 1e-10) {
            runtime.tangentVector.set(0, 0, 1)
          }

          view.curveCone.scale.set(headLength * 0.5, headLength, headLength * 0.5)
          view.curveCone.position
            .copy(endPoint)
            .addScaledVector(runtime.tangentVector, -headLength * 0.5)
          view.curveCone.quaternion.setFromUnitVectors(
            runtime.upVector,
            runtime.tangentVector,
          )
          view.curveCone.material.color.copy(runtime.mixedColor)
          view.curveCone.material.opacity = arrowOpacity
          view.curveCone.material.transparent = arrowOpacity < 1
        }

        const allowVectorsInFallback =
          !disableFallbackVectorsForGpuBackend &&
          !transientCpuFallbackForGpu &&
          !suppressVectorsByPulse &&
          !suppressVectorsByGuard
        view.arrow.visible = allowVectorsInFallback && showVector && !useCurved
        view.curveLine.visible = allowVectorsInFallback && showVector && useCurved
        view.curveCone.visible = allowVectorsInFallback && showVector && useCurved
        const particleRepresentationVisible =
          representationPolicy.layers.particles.visible === true
          view.mesh.visible =
            particleRepresentationVisible && vectorDisplayMode !== 'vectors'
        }
      }

      controls.update()
      const nextRendererPixelRatio = resolveRendererPixelRatio(currentParams)
      if (Math.abs(nextRendererPixelRatio - currentRendererPixelRatio) > 1e-3) {
        currentRendererPixelRatio = nextRendererPixelRatio
        renderer.setPixelRatio(currentRendererPixelRatio)
        const width = mountElement.clientWidth || window.innerWidth
        const height = mountElement.clientHeight || window.innerHeight
        renderer.setSize(width, height)
      }
      renderer.render(scene, camera)
    }

    animate()

    return () => {
      isDisposed = true
      if (window.__torusRuntime === runtime) {
        delete window.__torusRuntime
      }
      disposeRuntimeTestApi()
      window.cancelAnimationFrame(runtime.rafId)
      controls.removeEventListener('change', onControlsChange)
      window.removeEventListener('resize', onResize)
      renderer.domElement.removeEventListener('click', onPointerSelectParticle)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)

      removeAllViews(group, runtime.particleViews)
      removeFilamentViews(group, runtime.filamentViews)
      removeTubeViews(group, runtime.tubeViews)
      removeStructureOverlayViews(group, runtime.structureOverlayViews)
      particleMaterial.dispose()
      texture.dispose()
      runtime.axisLabels.forEach((label) => {
        label.material.map.dispose()
        label.material.dispose()
      })
      runtime.negativeAxisLabels.forEach((label) => {
        label.material.map.dispose()
        label.material.dispose()
      })
      runtime.positiveAxisMeshes.forEach((mesh) => {
        mesh.geometry.dispose()
        mesh.material.dispose()
      })
      runtime.negativeAxisMeshes.forEach((mesh) => {
        mesh.geometry.dispose()
        mesh.material.dispose()
      })
  runtime.nozzleRimLine.geometry.dispose()
  runtime.nozzleRimLine.material.dispose()
  runtime.shearLayerLine.geometry.dispose()
  runtime.shearLayerLine.material.dispose()
  runtime.vortexAxisLine.geometry.dispose()
  runtime.vortexAxisLine.material.dispose()
  runtime.emitterHousingBox.geometry.dispose()
  if (Array.isArray(runtime.emitterHousingBox.material)) {
    runtime.emitterHousingBox.material.forEach((material) => material.dispose())
  } else {
    runtime.emitterHousingBox.material.dispose()
  }
  runtime.emitterHousingTunnel.geometry.dispose()
  runtime.emitterHousingTunnel.material.dispose()
  runtime.emitterHousingFrontMaskTexture.dispose()
  Object.values(emitterHousingTextures).forEach((texture) => texture.dispose())
  runtime.multiEmitterViews.forEach((view) => {
    view.axis.geometry.dispose()
    view.axis.material.dispose()
    view.sphere.material.dispose()
  })
  disposeGridDebug(runtime.gridDebug, disposeGroupChildren)
  runtime.webgpuManager?.destroy()
      nozzleGeometry.dispose()
      nozzleMaterial.dispose()
      multiEmitterSphereGeometry.dispose()
      renderer.dispose()

      if (mountElement.contains(renderer.domElement)) {
        mountElement.removeChild(renderer.domElement)
      }
    }
  }, [setCameraState, setParam])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) {
      return
    }

    const nextCamera = paramsRef.current.camera
    runtime.camera.position.set(nextCamera.px, nextCamera.py, nextCamera.pz)
    runtime.controls.target.set(nextCamera.tx, nextCamera.ty, nextCamera.tz)
    runtime.controls.update()
  }, [loadToken, paramsRef])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) {
      return
    }

  const currentParams = paramsRef.current
  rebuildRuntimeParticles({
    runtime,
    params: currentParams,
    idRef,
    resetParticles,
    createParticleView,
    removeAllViews,
  })
  rebuildRuntimeFilaments({
    runtime,
    params: currentParams,
    removeFilamentViews,
  })
  runtime.simulationState.scheduler.accumulator = 0
  runtime.simulationState.scheduler.lastFrameTime =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  runtime.simulationTime = 0
  runtime.cpuSteps = 0
  runtime.gpuSteps = 0
  runtime.publishedStats.simulationTime = -1
  runtime.publishedStats.cpuSteps = -1
  runtime.publishedStats.gpuSteps = -1
  runtime.publishedStats.gpuDispatchPending = null
  runtime.publishedStats.gpuDiagnosticsDispatchSerial = -1
  runtime.publishedStats.particleRenderPolicy = ''
  runtime.publishedStats.particleRenderBackend = ''
  runtime.publishedStats.particleRenderFallbackReason = ''
  runtime.publishedStats.renderPolicyMode = ''
  runtime.publishedStats.renderLodTier = ''
  runtime.publishedStats.renderParticleLayerVisible = null
  runtime.publishedStats.renderFilamentLayerVisible = null
  runtime.publishedStats.renderSheetLayerVisible = null
  runtime.publishedStats.renderDiagnosticsConfidence = Number.NaN
  runtime.publishedStats.renderDiagnosticsUncertainty = Number.NaN
  runtime.publishedStats.renderUncertaintyDetectorGap = Number.NaN
  runtime.publishedStats.renderUncertaintyFallback = Number.NaN
  runtime.publishedStats.renderUncertaintyTopologyVolatility = Number.NaN
  runtime.simulationState.hybridRuntimeStats = {
    particleDt: 0,
    filamentDt: 0,
    particleSpeed: 0,
    filamentSpeed: 0,
  }
  runtime.simulationState.gpuCurveHistoryById = new Map()
  runtime.simulationState.gpuCurveHistoryDispatchSerial = -1
  runtime.simulationState.vectorGuardFrames = 0
  runtime.simulationState.vectorPulseCooldownFrames = 0
  runtime.simulationState.pulseGpuSyncRequested = false
  runtime.simulationState.minGpuRenderDispatchSerial = 0
  runtime.simulationState.stepSerial = 0
  runtime.simulationState.gpuOverflowProtection = {
    criticalStreak: 0,
    active: false,
    actionCooldownSteps: 0,
    lastAction: 'none',
    lastPublished: null,
  }
  runtime.simulationState.gpuSyncContract = {
    policy: 'unavailable',
    reason: 'manager_unavailable',
    violationCount: 0,
    lastReadbackReason: 'none',
    lastObservedDispatchSerial: -1,
  }
  runtime.simulationState.gpuQualityGuard = {
    active: false,
    applyActive: false,
    level: 'off',
    compatibility: 'disabled_user_off',
    guidedScale: 1,
    stretchingScale: 1,
    highStepStreak: 0,
    lowStepStreak: 0,
    lastAction: 'none',
    lastPublished: null,
  }
  runtime.simulationState.filamentSolverContext = null
  runtime.simulationState.hybridCouplingContext = null
  runtime.simulationState.vortexTubes = []
  runtime.simulationState.vortexTubeIdRef = { current: 1 }
  runtime.simulationState.hybridConsistencyState = {
    initialTotalCirculation: Number.NaN,
    lastTotalCirculation: 0,
    lastParticleCenter: null,
    lastFilamentCenter: null,
  }
  runtime.simulationState.structureDetectionState = null
  runtime.simulationState.newtoniumTrackingState = null
  useSimulationStore.getState().setParams({
    runtimeSimulationTime: 0,
    runtimeCpuSteps: 0,
    runtimeGpuSteps: 0,
    runtimeGpuDispatchPending: false,
    runtimeHybridFilamentToParticleBackend: 'cpu_pointwise',
    runtimeHybridFilamentToParticleBatchingEnabled: false,
    runtimeDetectedFilamentCount: 0,
    runtimeDetectedRingCount: 0,
    runtimeDetectedTubeCount: 0,
    runtimeDetectedSheetCount: 0,
    runtimeDetectedClusterCount: 0,
    runtimeDetectionConfidence: 0,
    runtimeDetectionConfidenceRaw: 0,
    runtimeDetectionSheetSurfaceCoherence: 0,
    runtimeDetectionSheetCurvatureAnisotropy: 0,
    runtimeDetectionClassConfidenceFilament: 0,
    runtimeDetectionClassConfidenceRing: 0,
    runtimeDetectionClassConfidenceTube: 0,
    runtimeDetectionClassConfidenceSheet: 0,
    runtimeDetectionSampleCount: 0,
    runtimeDetectionMs: 0,
    runtimeDetectionEffectiveMinClusterSize: 0,
    runtimeDetectionEffectiveFilamentElongationMin: 0,
    runtimeDetectionEffectiveRingRadiusStdRatioMax: 0,
    runtimeDetectionEffectiveTubeRadiusStdRatioMax: 0,
    runtimeOverlayConfidenceComposite: 0,
    runtimeOverlayUncertaintyComposite: 1,
    runtimeOverlayUncertaintyDetector: 1,
    runtimeOverlayUncertaintyTopology: 1,
    runtimeOverlayUncertaintyRender: 1,
    runtimeNewtoniumType: 'none',
    runtimeNewtoniumConfidenceRaw: 0,
    runtimeNewtoniumConfidence: 0,
    runtimeNewtoniumStableStreak: 0,
    runtimeNewtoniumTransitions: 0,
    runtimeNewtoniumFrameSerial: 0,
    runtimeTransitionState: 'idle',
    runtimeTransitionCandidateType: 'none',
    runtimeTransitionPendingFrames: 0,
    runtimeTransitionCandidates: 0,
    runtimeTransitionCommitted: 0,
    runtimeTransitionRejected: 0,
    runtimeTransitionGammaDriftPct: 0,
    runtimeTransitionImpulseDriftPct: 0,
    runtimeTransitionEnergyDriftPct: 0,
    runtimeTransitionGateConfidenceOk: true,
    runtimeTransitionGateInvariantOk: true,
    runtimeTransitionGateHysteresisOk: false,
    runtimeTransitionGateReason: 'none',
    runtimeTransitionEnterFrames: 3,
    runtimeTransitionConfidenceEnterMin: 0.56,
    runtimeTransitionConfidenceExitMin: 0.44,
    runtimeRingValidationVersion: 'tt023b.ring_validation.v1',
    runtimeRingValidationValid: true,
    runtimeRingValidationVerdict: 'pass',
    runtimeRingValidationAcceptanceScore: 0,
    runtimeRingValidationGatePassCount: 0,
    runtimeRingValidationGateTotal: 4,
    runtimeRingValidationTransitionCommitRatio: 0,
    runtimeRingValidationProfile: 'classic',
    runtimeRingValidationModifierStrength: 0,
    runtimeRingExternalValidationEligible: true,
    runtimeRingExternalValidationEligibilityReason: 'eligible',
    runtimeJetRegimeVersion: 'tt024b.jet_regime.v1',
    runtimeJetRegimeValid: true,
    runtimeJetRegimeVerdict: 'pass',
    runtimeJetRegimeType: 'ring_train',
    runtimeJetRegimeAcceptanceScore: 0,
    runtimeJetRegimeGatePassCount: 0,
    runtimeJetRegimeGateTotal: 4,
    runtimeJetRegimeProfile: 'classic',
    runtimeJetRegimeModifierStrength: 0,
    runtimeJetExternalValidationEligible: true,
    runtimeJetExternalValidationEligibilityReason: 'eligible',
    runtimeJetRegimeReProxy: 0,
    runtimeJetRegimeStProxy: 0,
    runtimeJetRegimeLdProxy: 0,
    runtimeJetRegimeRingDominance: 0,
    runtimeJetRegimeWakeIndex: 0,
    runtimeDetectorFusionVersion: 'tt025b.detector_fusion.v1',
    runtimeDetectorFusionValid: true,
    runtimeDetectorFusionVerdict: 'pass',
    runtimeDetectorFusionProfile: 'classic',
    runtimeDetectorFusionModifierStrength: 0,
    runtimeDetectorExternalValidationEligible: true,
    runtimeDetectorExternalValidationEligibilityReason: 'eligible',
    runtimeDetectorFusionAcceptanceScore: 0,
    runtimeDetectorFusionGatePassCount: 0,
    runtimeDetectorFusionGateTotal: 5,
    runtimeDetectorFusionWeightedScore: 0,
    runtimeTopologyVersion: 'tt028b.topology_tracking.v1',
    runtimeTopologyValid: true,
    runtimeTopologyProfile: 'classic',
    runtimeTopologyModifierStrength: 0,
    runtimeTopologyExternalValidationEligible: true,
    runtimeTopologyExternalValidationEligibilityReason: 'eligible',
    runtimeTopologyFrameSerial: 0,
    runtimeTopologyEventCount: 0,
    runtimeTopologyNodeCount: 0,
    runtimeTopologyEdgeCount: 0,
    runtimeTopologyBirthCount: 0,
    runtimeTopologyDecayCount: 0,
    runtimeTopologyMergeCount: 0,
    runtimeTopologySplitCount: 0,
    runtimeTopologyReconnectionCount: 0,
    runtimeTopologyLatestEventType: 'none',
    runtimeTopologyLatestEventConfidence: 0,
    runtimeTopologyLatestEventFrame: 0,
    runtimeTopologyEventLog: [],
    runtimeTopologyGraphNodes: [],
    runtimeTopologyGraphEdges: [],
    runtimeEnergySampleCount: 0,
    runtimeEnergyProxy: 0,
    runtimeEnstrophyProxy: 0,
    runtimeEnergyMaxSpeed: 0,
    runtimeEnergyMaxVorticity: 0,
    runtimeEnergyBin0: 0,
    runtimeEnergyBin1: 0,
    runtimeEnergyBin2: 0,
    runtimeEnergyBin3: 0,
    runtimeEnergyBin4: 0,
    runtimeEnergyBin5: 0,
    runtimeEnergyBin6: 0,
    runtimeEnergyBin7: 0,
    runtimeHybridPlusActive: false,
    runtimeHybridPlusReason: 'disabled',
    runtimeTubeCount: 0,
    runtimeTubeParticleCount: 0,
    runtimeTubeProjectedCount: 0,
    runtimeTubeAverageRadius: 0,
    runtimeTubeStepMs: 0,
    runtimeTubeSpeedAvg: 0,
    runtimeTubeSpeedMax: 0,
    runtimeTubeFilamentContributionAvg: 0,
    runtimeTubeVpmContributionAvg: 0,
    runtimeTubeSelfContributionAvg: 0,
    runtimeHybridPlusBaseBackend: 'cpu',
    runtimeHybridPlusAssistBackend: 'gpu',
    runtimeHybridPlusSyncMode: 'none',
    runtimeHybridPlusOperatorCount: 0,
    runtimeHybridPlusAssistCostMs: 0,
    runtimeHybridPlusProducedDeltaCount: 0,
    runtimeHybridPlusAppliedDeltaCount: 0,
    runtimeHybridPlusRejectedDeltaCount: 0,
    runtimeHybridPlusTopologyProducedCount: 0,
    runtimeHybridPlusBarnesHutProducedCount: 0,
    runtimeHybridPlusTopologyCostMs: 0,
    runtimeHybridPlusBarnesHutCostMs: 0,
    runtimeHybridPlusApplyCostMs: 0,
    runtimeSyncEpoch: 0,
    runtimeSyncStaleDrops: 0,
    runtimeSyncResyncCount: 0,
    runtimeGpuFullReadbackCount: 0,
    runtimeGpuSkippedReadbackCount: 0,
    runtimeGpuDiagOverflowCount: 0,
    runtimeGpuDiagCollisionCount: 0,
    runtimeGpuDiagCollisionRatio: 0,
    runtimeGpuDiagHashLoadFactor: 0,
    runtimeGpuDiagDispatchCount: 0,
    runtimeGpuDiagGridBuildCount: 0,
    runtimeGpuDiagOccupiedBucketCount: 0,
    runtimeGpuDiagHashTableSize: 0,
    runtimeGpuDiagAdaptiveHashTableSize: 0,
    runtimeGpuDiagBucketCapacity: 0,
    runtimeGpuDiagAdaptiveBucketCapacity: 0,
    runtimeGpuDiagOverflowCooldown: 0,
    runtimeGpuDiagLowPressureStreak: 0,
    runtimeGpuDiagAdaptiveEventType: 'none',
    runtimeGpuDiagAdaptiveEventReason: 'none',
    runtimeGpuDiagAdaptiveEventDispatchSerial: -1,
    runtimeGpuCouplingQuerySerial: 0,
    runtimeGpuCouplingQueryPointCount: 0,
    runtimeGpuCouplingQueryBackend: 'none',
    runtimeGpuCouplingQueryReason: 'none',
    runtimeGpuCouplingQueryMs: 0,
    runtimeGpuSyncPolicy: 'unavailable',
    runtimeGpuSyncReason: 'manager_unavailable',
    runtimeGpuSyncViolationCount: 0,
    runtimeGpuSyncLastReadbackReason: 'none',
    runtimeGpuOverflowCriticalStreak: 0,
    runtimeGpuOverflowCriticalActive: false,
    runtimeGpuOverflowProtectionCooldown: 0,
    runtimeGpuOverflowProtectionLastAction: 'none',
    runtimeGpuQualityGuardActive: false,
    runtimeGpuQualityGuardApplyActive: false,
    runtimeGpuQualityGuardLevel: 'off',
    runtimeGpuQualityGuardCompatibility: 'disabled_user_off',
    runtimeGpuQualityGuardGuidedScale: 1,
    runtimeGpuQualityGuardStretchingScale: 1,
    runtimeGpuQualityGuardHighStepStreak: 0,
    runtimeGpuQualityGuardLowStepStreak: 0,
    runtimeGpuQualityGuardLastAction: 'none',
    runtimeGpuDiagSampleCount: 0,
    runtimeGpuDiagActiveCount: 0,
    runtimeGpuDiagAvgSpeed: 0,
    runtimeGpuDiagMaxSpeed: 0,
    runtimeGpuDiagAvgVorticity: 0,
    runtimeGpuDiagMaxVorticity: 0,
    runtimeGpuDiagAvgCoreRadius: 0,
    runtimeParticleRenderPolicy: 'cpu_backend',
    runtimeParticleRenderBackend: 'cpu_fallback',
    runtimeParticleRenderFallbackReason: 'cpu_backend',
    runtimeRenderPolicyMode: 'particles',
    runtimeRenderLodTier: 'near',
    runtimeRenderParticleLayerVisible: true,
    runtimeRenderFilamentLayerVisible: true,
    runtimeRenderSheetLayerVisible: false,
    runtimeRenderDiagnosticsConfidence: 0,
    runtimeRenderDiagnosticsUncertainty: 1,
    runtimeRenderUncertaintyDetectorGap: 1,
    runtimeRenderUncertaintyFallback: 0,
    runtimeRenderUncertaintyTopologyVolatility: 1,
    runtimeRenderSheetPanelCount: 0,
    runtimeRenderSheetCoverage: 0,
    runtimeRenderSheetReadiness: 0,
    runtimeRenderSheetQuadratureOrder: 1,
    runtimeRenderSheetDesingularizationEpsilon: 0.01,
    runtimeRenderSheetProfileId: 'sheet_profile_balanced',
    runtimeRenderSheetQuadratureProfile: 'gauss_legendre_1x2',
    runtimeRenderSheetMeshSeed: 0,
    runtimeRenderSheetMeshTopology: 'tri_fan',
    runtimeRenderSheetMeshPatchCount: 1,
    runtimeRenderSheetPanelAspectP95: 1,
    runtimeRenderSheetQualityGatePassCount: 0,
    runtimeRenderSheetQualityGateTotal: 4,
    runtimeRenderSheetQualityVerdict: 'warn',
    runtimeRenderSheetQualityPenalty: 0.5,
    runtimeRenderSheetMeshDeterministic: true,
    runtimeRenderSheetMeshLayoutDigest: 0,
    runtimeRenderSheetMeshPatchMinPanels: 0,
    runtimeRenderSheetMeshPatchMaxPanels: 0,
    runtimeRenderSheetMeshPatchImbalance: 0,
    runtimeRenderSheetMeshContractVersion: 'tt021b.panel_mesh.v1',
    runtimeRenderSheetMeshContractValid: true,
    runtimeRenderSheetMeshContractIssueCount: 0,
    runtimeRenderSheetMeshContractGatePassCount: 4,
    runtimeRenderSheetMeshContractGateTotal: 4,
    runtimeRenderSheetMeshContractVerdict: 'pass',
    runtimeRenderSheetMeshContractPenalty: 0,
    runtimeRenderSheetMeshPatchAreaMean: 0.01,
    runtimeRenderSheetMeshPatchAreaCv: 0,
    runtimeRenderSheetMeshEdgeLengthRatioP95: 1,
    runtimeRenderSheetMeshCurvatureProxyP95: 1,
    runtimeRenderSheetCouplingVersion: 'tt021c.sheet_coupling.v1',
    runtimeRenderSheetCouplingValid: true,
    runtimeRenderSheetCouplingVerdict: 'pass',
    runtimeRenderSheetCouplingPenalty: 0,
    runtimeRenderSheetCouplingAmerState: 'pass',
    runtimeRenderSheetCouplingAmerTransferBudget: 0.5,
    runtimeRenderSheetCouplingAmerInvariantDriftCapPct: 4,
    runtimeRenderSheetCouplingFilamentState: 'pass',
    runtimeRenderSheetCouplingFilamentNodeTransferCap: 64,
    runtimeRenderSheetCouplingFilamentLoad: 0,
    runtimeRenderSheetRollupStabilityGuard: 'clear',
    runtimeRenderSheetPlaceholder: true,
    runtimeRenderScoreParticles: 0,
    runtimeRenderScoreFilaments: 0,
    runtimeRenderScoreSheets: 0,
    runtimeRenderScoreCurrent: 0,
    runtimeRenderScoreMargin: 0,
    runtimeRenderScoreBestMode: 'particles',
    runtimeRenderHysteresisHoldSteps: 0,
    runtimeRenderHysteresisRemaining: 0,
    runtimeRenderOverrideReason: 'none',
    runtimeRenderHealthFallbackRate: 0,
    runtimeRenderHealthTimeoutRate: 0,
    runtimeRenderHealthDriftSeverity: 0,
    runtimeOverlayStructures: [],
  })
  useSimulationStore.getState().setStabilityStats({
    hybridParticleCirculation: 0,
    hybridFilamentCirculation: 0,
    hybridTotalCirculation: 0,
    hybridCirculationBaseline: 0,
    hybridCirculationDriftPercent: 0,
    hybridParticleCount: 0,
    hybridFilamentCount: 0,
  })
  resetGridDebugState(runtime.gridDebug, disposeGroupChildren)
  }, [
    params.particleCount,
    params.vortexRepresentation,
    params.filamentNodeCount,
    params.filamentCoreRadius,
    params.maxFilamentNodes,
    params.maxSegmentLength,
    params.minSegmentLength,
    params.reconnectionThreshold,
    params.filamentSmoothing,
    params.emissionMode,
    params.dynamicsMode,
    params.nozzleRadius,
    params.nozzleZ,
    params.gamma,
    resetToken,
    loadToken,
    paramsRef,
  ])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) {
      return
    }

    const shouldSpawnFilamentRing =
      (paramsRef.current.emissionMode === 'vortexRing' ||
        paramsRef.current.emissionMode === 'vortexKnot' ||
        paramsRef.current.emissionMode === 'tube') &&
      paramsRef.current.dynamicsMode !== 'scripted' &&
      paramsRef.current.vortexRepresentation !== 'particles'

    const spawnFilamentForParams = (emitterParams) => {
      const filament = createFilamentRing(emitterParams, idRef.current, {
        mode: emitterParams.emissionMode,
        jetVelocity: emitterParams.jetSpeed ?? 0,
        axialDt:
          runtime.simulationState.scheduler.fixedStep *
          Math.max(emitterParams.timeScale ?? 1, 0),
        totalCirculation: emitterParams.gamma ?? 1,
      })
      const offsetX = emitterParams.filamentOffsetX ?? 0
      if (Math.abs(offsetX) > 1e-8) {
        for (let i = 0; i < filament.nodes.length; i += 1) {
          const node = filament.nodes[i]
          node.position.x += offsetX
        }
      }
      runtime.filaments.push(filament)
      idRef.current += 1
    }

    const spawnFilamentRing = ({ withDelay = false } = {}) => {
      if (!shouldSpawnFilamentRing) {
        return
      }
      const emitters = getConfiguredEmitters(paramsRef.current)
      for (let emitterIndex = 0; emitterIndex < emitters.length; emitterIndex += 1) {
        const emitterParams = buildEmitterParams(paramsRef.current, emitters[emitterIndex])
        if (withDelay && (emitters[emitterIndex].delaySec ?? 0) > 1e-6) {
          runtime.simulationState.pendingFilamentSpawns.push({
            remainingSec: emitters[emitterIndex].delaySec ?? 0,
            params: emitterParams,
          })
          continue
        }
        spawnFilamentForParams(emitterParams)
      }
    }

    if (pulseCommandType === 'single') {
      runtime.simulationState.vectorGuardFrames = Math.max(
        runtime.simulationState.vectorGuardFrames ?? 0,
        3,
      )
      runtime.simulationState.vectorPulseCooldownFrames = 3
      runtime.simulationState.pulseGpuSyncRequested = true
      resetVectorHistories(runtime)
      spawnFilamentRing({ withDelay: true })
      runtime.pulseState.mode = 'single'
      runtime.pulseState.time = 0
      runtime.pulseState.singleElapsed = 0
      runtime.pulseState.singlePulseConsumed = false
      runtime.pulseState.burstEmissionRemaining = 0
      runtime.pulseState.pulseActive = false
      runtime.pulseState.pulseTimer = 0
      runtime.pulseState.emittedSlugLength = 0
      runtime.pulseState.trailingJetActive = false
      runtime.pulseState.multiSinglePulseSchedule = null
      runtime.pulseState.multiSinglePulseElapsed = 0
      runtime.pulseState.jetRollupClock = 0
      runtime.simulationState.pendingFilamentSpawns = []
      return
    }

    if (pulseCommandType === 'singleBurst') {
      runtime.simulationState.vectorGuardFrames = Math.max(
        runtime.simulationState.vectorGuardFrames ?? 0,
        3,
      )
      runtime.simulationState.vectorPulseCooldownFrames = 3
      runtime.simulationState.pulseGpuSyncRequested = true
      resetVectorHistories(runtime)
      spawnFilamentRing({ withDelay: false })
      runtime.pulseState.mode = 'single'
      runtime.pulseState.time = 0
      runtime.pulseState.singleElapsed = 0
      runtime.pulseState.singlePulseConsumed = false
      runtime.pulseState.burstEmissionRemaining = Math.max(
        0,
        (paramsRef.current.particleCount ?? 0) - runtime.particles.length,
      )
      runtime.pulseState.pulseActive = false
      runtime.pulseState.pulseTimer = 0
      runtime.pulseState.emittedSlugLength = 0
      runtime.pulseState.trailingJetActive = false
      runtime.pulseState.multiSinglePulseSchedule = null
      runtime.pulseState.multiSinglePulseElapsed = 0
      runtime.pulseState.jetRollupClock = 0
      runtime.simulationState.pendingFilamentSpawns = []
      return
    }

    if (pulseCommandType === 'startTrain') {
      runtime.simulationState.vectorGuardFrames = Math.max(
        runtime.simulationState.vectorGuardFrames ?? 0,
        3,
      )
      runtime.simulationState.vectorPulseCooldownFrames = 3
      runtime.simulationState.pulseGpuSyncRequested = true
      resetVectorHistories(runtime)
      spawnFilamentRing({ withDelay: false })
      runtime.pulseState.mode = 'train'
      runtime.pulseState.time = 0
      runtime.pulseState.singleElapsed = 0
      runtime.pulseState.singlePulseConsumed = false
      runtime.pulseState.burstEmissionRemaining = 0
      runtime.pulseState.pulseActive = false
      runtime.pulseState.pulseTimer = 0
      runtime.pulseState.emittedSlugLength = 0
      runtime.pulseState.trailingJetActive = false
      runtime.pulseState.multiSinglePulseSchedule = null
      runtime.pulseState.multiSinglePulseElapsed = 0
      runtime.pulseState.jetRollupClock = 0
      runtime.simulationState.pendingFilamentSpawns = []
      return
    }

    runtime.pulseState.mode = 'off'
    runtime.pulseState.time = 0
    runtime.pulseState.singleElapsed = 0
    runtime.pulseState.singlePulseConsumed = false
    runtime.pulseState.burstEmissionRemaining = 0
    runtime.pulseState.pulseActive = false
    runtime.pulseState.pulseTimer = 0
    runtime.pulseState.emittedSlugLength = 0
    runtime.pulseState.trailingJetActive = false
    runtime.pulseState.multiSinglePulseSchedule = null
    runtime.pulseState.multiSinglePulseElapsed = 0
    runtime.pulseState.jetRollupClock = 0
    runtime.simulationState.pendingFilamentSpawns = []
  }, [pulseCommandId, pulseCommandType])

  const showOverlay =
    params.vizScientificMode === true &&
    (params.vizShowDetectionOverlay === true ||
      params.vizShowTopologyOverlay === true ||
      params.vizShowEnergyOverlay === true)

  return (
    <div className="relative h-full w-full">
      <div ref={mountRef} className="h-full w-full" />
      {showOverlay ? (
        <div className="pointer-events-none absolute left-3 top-3 max-w-[420px] rounded border border-cyan-500/40 bg-slate-950/80 px-3 py-2 text-[11px] text-cyan-100 shadow-lg backdrop-blur-sm">
          <p className="font-semibold text-cyan-200">Scientific Overlay</p>
          {params.vizShowDetectionOverlay === true ? (
            <p>
              det: filament={Math.floor(Number(params.runtimeDetectedFilamentCount ?? 0))}, ring=
              {Math.floor(Number(params.runtimeDetectedRingCount ?? 0))}, tube=
              {Math.floor(Number(params.runtimeDetectedTubeCount ?? 0))}, sheet=
              {Math.floor(Number(params.runtimeDetectedSheetCount ?? 0))}, cluster=
              {Math.floor(Number(params.runtimeDetectedClusterCount ?? 0))}, conf=
              {formatNumber(params.runtimeDetectionConfidence ?? 0, 3)}
            </p>
          ) : null}
          {params.vizShowTopologyOverlay === true ? (
            <p>
              topology: type={String(params.runtimeNewtoniumType ?? 'none')}, conf=
              {formatNumber(params.runtimeNewtoniumConfidence ?? 0, 3)}, transitions=
              {Math.floor(Number(params.runtimeNewtoniumTransitions ?? 0))}, events=
              {Math.floor(Number(params.runtimeTopologyEventCount ?? 0))}, latest=
              {String(params.runtimeTopologyLatestEventType ?? 'none')}
            </p>
          ) : null}
          {params.vizShowEnergyOverlay === true ? (
            <p>
              energy: E={formatNumber(params.runtimeEnergyProxy ?? 0, 4)}, En=
              {formatNumber(params.runtimeEnstrophyProxy ?? 0, 4)}, samples=
              {Math.floor(Number(params.runtimeEnergySampleCount ?? 0))}, stepOrder=
              {String(params.runtimePhysicalStepOrder ?? 'velocity_computation')}
            </p>
          ) : null}
          <p>
            render: mode={String(params.runtimeRenderPolicyMode ?? 'particles')}, lod=
            {String(params.runtimeRenderLodTier ?? 'near')}, conf=
            {formatNumber(params.runtimeRenderDiagnosticsConfidence ?? 0, 3)}, unc=
            {formatNumber(params.runtimeRenderDiagnosticsUncertainty ?? 1, 3)}
          </p>
          <p>
            unc_breakdown: det={formatNumber(params.runtimeRenderUncertaintyDetectorGap ?? 1, 3)}, fallback=
            {formatNumber(params.runtimeRenderUncertaintyFallback ?? 0, 3)}, topo=
            {formatNumber(params.runtimeRenderUncertaintyTopologyVolatility ?? 1, 3)}
          </p>
          <p>
            score(p/f/s)=
            {formatNumber(params.runtimeRenderScoreParticles ?? 0, 3)}/
            {formatNumber(params.runtimeRenderScoreFilaments ?? 0, 3)}/
            {formatNumber(params.runtimeRenderScoreSheets ?? 0, 3)}, current=
            {formatNumber(params.runtimeRenderScoreCurrent ?? 0, 3)}, margin=
            {formatNumber(params.runtimeRenderScoreMargin ?? 0, 3)}
          </p>
          <p>
            overlay_conf_unc: {formatNumber(params.runtimeOverlayConfidenceComposite ?? 0, 3)} /{' '}
            {formatNumber(params.runtimeOverlayUncertaintyComposite ?? 1, 3)}
          </p>
        </div>
      ) : null}
    </div>
  )
}
