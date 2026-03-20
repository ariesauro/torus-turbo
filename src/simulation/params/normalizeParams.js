import {
  getRingResolutionMultiplier,
  normalizeRingResolutionToUi,
} from '../physics/runtime/ringResolution'
import { normalizeMultiEmitterConfig } from '../physics/emission/multiEmitter'

const VALID_EMISSION_MODES = new Set([
  'continuousJet',
  'particleStream',
  'vortexRing',
  'vortexKnot',
  'tube',
  'jetRollup',
])
const VALID_DYNAMICS_MODES = new Set(['scripted', 'fullPhysics', 'guidedPhysics'])
const VALID_PULSE_SHAPES = new Set(['rectangular', 'sin', 'gaussian'])
const VALID_VELOCITY_MODES = new Set(['exact', 'spatialGrid', 'fmm', 'auto'])
const VALID_VORTEX_REPRESENTATIONS = new Set(['particles', 'filaments', 'hybrid', 'tubes'])
const VALID_TUBE_VIEW_MODES = new Set(['particles', 'surface', 'spine_particles'])
const VALID_EXECUTION_MODES = new Set(['cpu', 'gpu', 'hybrid'])
const VALID_FILAMENT_INTEGRATORS = new Set(['euler', 'rk2', 'rk3'])
const VALID_PARTICLE_INTEGRATORS = new Set(['euler', 'rk2'])
const VALID_UI_LANGUAGES = new Set(['ru', 'en'])
const VALID_VECTOR_DISPLAY_MODES = new Set(['particles', 'vectors', 'both'])
const VALID_FAR_FIELD_METHODS = new Set(['treecode', 'fmm'])
const VALID_HYBRID_P2F_BACKENDS = new Set(['auto', 'cpu', 'gpu'])
const VALID_PERFORMANCE_PROFILE_IDS = new Set(['auto_balanced', 'quality', 'balanced', 'performance'])
const VALID_EMISSION_COUPLING_MODES = new Set([
  'free',
  'lockFormation',
  'lockPulseDuration',
  'lockJetSpeed',
])

function toFiniteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function normalizeDirection(direction) {
  const x = toFiniteNumber(direction?.x, 0)
  const y = toFiniteNumber(direction?.y, 0)
  const z = toFiniteNumber(direction?.z, 1)
  const length = Math.hypot(x, y, z)

  if (length <= 1e-8) {
    return { x: 0, y: 0, z: 1 }
  }

  return {
    x: x / length,
    y: y / length,
    z: z / length,
  }
}

function normalizePulseShape(params) {
  if (VALID_PULSE_SHAPES.has(params?.pulseShape)) {
    return params.pulseShape
  }

  if (params?.waveform === 'sine') {
    return 'sin'
  }

  return 'rectangular'
}

function normalizeEmissionMode(params) {
  return VALID_EMISSION_MODES.has(params?.emissionMode) ? params.emissionMode : 'continuousJet'
}

function normalizeEmissionCouplingMode(params) {
  return VALID_EMISSION_COUPLING_MODES.has(params?.emissionCouplingMode)
    ? params.emissionCouplingMode
    : 'free'
}

function normalizeDynamicsMode(params) {
  return VALID_DYNAMICS_MODES.has(params?.dynamicsMode) ? params.dynamicsMode : 'scripted'
}

function normalizeVelocityMode(params) {
  return VALID_VELOCITY_MODES.has(params?.velocityComputationMode)
    ? params.velocityComputationMode
    : 'exact'
}

function normalizeExecutionMode(params, dynamicsMode) {
  let nextMode = params?.executionMode
  if (!VALID_EXECUTION_MODES.has(nextMode)) {
    if (params?.physicsBackend === 'webgpu') {
      nextMode = params?.vortexRepresentation === 'hybrid' ? 'hybrid' : 'gpu'
    } else {
      nextMode = 'cpu'
    }
  }

  if (nextMode === 'hybrid' && dynamicsMode === 'scripted') {
    nextMode = params?.physicsBackend === 'cpu' ? 'cpu' : 'gpu'
  }

  return nextMode
}

function normalizeUiLanguage(params) {
  return VALID_UI_LANGUAGES.has(params?.uiLanguage) ? params.uiLanguage : 'ru'
}

function normalizeVectorDisplayMode(params) {
  if (VALID_VECTOR_DISPLAY_MODES.has(params?.vectorDisplayMode)) {
    return params.vectorDisplayMode
  }

  const showVectors = !!params?.showVectors
  const showBoth = !!params?.showBoth

  if (showBoth) {
    return 'both'
  }

  if (showVectors) {
    return 'vectors'
  }

  return 'particles'
}

function normalizeFarFieldMethod(params) {
  return VALID_FAR_FIELD_METHODS.has(params?.hybridPlusFarFieldMethod)
    ? params.hybridPlusFarFieldMethod
    : 'treecode'
}

function normalizeHybridParticleToFilamentBackend(params) {
  return VALID_HYBRID_P2F_BACKENDS.has(params?.hybridParticleToFilamentBackend)
    ? params.hybridParticleToFilamentBackend
    : 'auto'
}

function normalizePerformanceProfileId(params) {
  const value = typeof params?.performanceProfileId === 'string'
    ? params.performanceProfileId.trim().toLowerCase()
    : ''
  if (!value) {
    return 'auto_balanced'
  }
  // custom profiles are prefixed by "custom_".
  if (value.startsWith('custom_')) {
    return value
  }
  return VALID_PERFORMANCE_PROFILE_IDS.has(value) ? value : 'auto_balanced'
}

function normalizeFilamentIntegrator(params) {
  return VALID_FILAMENT_INTEGRATORS.has(params?.filamentIntegrator)
    ? params.filamentIntegrator
    : 'rk2'
}

function normalizeParticleIntegrator(params) {
  return VALID_PARTICLE_INTEGRATORS.has(params?.particleIntegrator)
    ? params.particleIntegrator
    : 'euler'
}

function normalizeTubeViewMode(params) {
  return VALID_TUBE_VIEW_MODES.has(params?.tubeViewMode) ? params.tubeViewMode : 'spine_particles'
}

function normalizeVortexRepresentation(params, dynamicsMode, executionMode) {
  const nextRepresentation = VALID_VORTEX_REPRESENTATIONS.has(params?.vortexRepresentation)
    ? params.vortexRepresentation
    : 'particles'

  if (dynamicsMode === 'scripted') {
    return 'particles'
  }

  if (executionMode === 'gpu') {
    return 'particles'
  }

  if (executionMode === 'hybrid') {
    return 'hybrid'
  }

  return nextRepresentation
}

function clampFinite(value, min, max, fallback) {
  const v = toFiniteNumber(value, fallback)
  return Math.max(min, Math.min(max, v))
}

function normalizeColor(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

function buildNozzle(params) {
  const radius = Math.max(
    0.01,
    toFiniteNumber(params?.nozzleRadius, toFiniteNumber(params?.nozzle?.radius, 1.5)),
  )
  const position = {
    z: toFiniteNumber(
      params?.nozzleZ,
      toFiniteNumber(
        params?.nozzleX,
        toFiniteNumber(params?.nozzle?.position?.z, 0),
      ),
    ),
    x: toFiniteNumber(params?.nozzle?.position?.x, 0),
    y: toFiniteNumber(params?.nozzle?.position?.y, 0),
  }

  return {
    radius,
    position,
    direction: normalizeDirection(params?.nozzle?.direction),
  }
}

function normalizeRuntimeOverlayStructures(params) {
  const list = Array.isArray(params?.runtimeOverlayStructures) ? params.runtimeOverlayStructures : []
  return list.slice(0, 24).map((item) => ({
    class: typeof item?.class === 'string' ? item.class : 'cluster',
    confidence: clampFinite(item?.confidence, 0, 1, 0),
    center: {
      x: toFiniteNumber(item?.center?.x, 0),
      y: toFiniteNumber(item?.center?.y, 0),
      z: toFiniteNumber(item?.center?.z, 0),
    },
    radius: clampFinite(item?.radius, 1e-4, 1000, 0.1),
    count: Math.max(0, Math.floor(clampFinite(item?.count, 0, 1e9, 0))),
    elongation: clampFinite(item?.elongation, 0, 1, 0),
    planarity: clampFinite(item?.planarity, 0, 1, 0),
  }))
}

function normalizeRuntimeTopologyEventLog(params) {
  const list = Array.isArray(params?.runtimeTopologyEventLog) ? params.runtimeTopologyEventLog : []
  return list.slice(-240).map((item) => ({
    eventId: Math.max(0, Math.floor(clampFinite(item?.eventId, 0, 1e9, 0))),
    frame: Math.max(0, Math.floor(clampFinite(item?.frame, 0, 1e9, 0))),
    eventType: typeof item?.eventType === 'string' ? item.eventType : 'vortex_birth',
    subjectIds: Array.isArray(item?.subjectIds) ? item.subjectIds.slice(0, 8).map((id) => String(id)) : [],
    parentIds: Array.isArray(item?.parentIds) ? item.parentIds.slice(0, 8).map((id) => String(id)) : [],
    childIds: Array.isArray(item?.childIds) ? item.childIds.slice(0, 8).map((id) => String(id)) : [],
    confidence: clampFinite(item?.confidence, 0, 1, 0),
    deltaEnergy: clampFinite(item?.deltaEnergy, -1e6, 1e6, 0),
    deltaCirculation: clampFinite(item?.deltaCirculation, -1e6, 1e6, 0),
  }))
}

function normalizeRuntimeTopologyGraphNodes(params) {
  const list = Array.isArray(params?.runtimeTopologyGraphNodes) ? params.runtimeTopologyGraphNodes : []
  return list.slice(-128).map((item) => ({
    id: String(item?.id ?? ''),
    type: typeof item?.type === 'string' ? item.type : 'cluster',
    ageSteps: Math.max(0, Math.floor(clampFinite(item?.ageSteps, 0, 1e9, 0))),
    energy: clampFinite(item?.energy, 0, 1, 0),
    circulation: clampFinite(item?.circulation, 0, 1, 0),
    radius: clampFinite(item?.radius, 1e-4, 1e6, 0.1),
    velocity: clampFinite(item?.velocity, 0, 1e6, 0),
    lifetimeSec: clampFinite(item?.lifetimeSec, 0, 1e9, 0),
    creationFrame: Math.max(0, Math.floor(clampFinite(item?.creationFrame, 0, 1e9, 0))),
    parents: Array.isArray(item?.parents) ? item.parents.slice(0, 8).map((id) => String(id)) : [],
    children: Array.isArray(item?.children) ? item.children.slice(0, 8).map((id) => String(id)) : [],
  }))
}

function normalizeRuntimeTopologyGraphEdges(params) {
  const list = Array.isArray(params?.runtimeTopologyGraphEdges) ? params.runtimeTopologyGraphEdges : []
  return list.slice(-240).map((item) => ({
    from: String(item?.from ?? ''),
    to: String(item?.to ?? ''),
    eventType: typeof item?.eventType === 'string' ? item.eventType : 'vortex_merge',
    frame: Math.max(0, Math.floor(clampFinite(item?.frame, 0, 1e9, 0))),
  }))
}

function getLegacyWaveform(pulseShape) {
  return pulseShape === 'sin' ? 'sine' : 'square'
}

export function normalizeSimulationParams(params = {}) {
  const nozzle = buildNozzle(params)
  const multiEmitter = normalizeMultiEmitterConfig(params)
  const pulseShape = normalizePulseShape(params)
  const dynamicsMode = normalizeDynamicsMode(params)
  const executionMode = normalizeExecutionMode(params, dynamicsMode)
  const vortexRepresentation = normalizeVortexRepresentation(params, dynamicsMode, executionMode)
  const showFilaments =
    vortexRepresentation === 'filaments' ||
    vortexRepresentation === 'hybrid' ||
    vortexRepresentation === 'tubes'
      ? true
      : !!params?.showFilaments
  const vectorDisplayMode = normalizeVectorDisplayMode(params)
  const physicsBackend = executionMode === 'cpu' ? 'cpu' : 'webgpu'

  return {
    ...params,
    particleCount: Math.max(500, Math.floor(clampFinite(params?.particleCount, 500, 50000, 12000))),
    performanceProfileId: normalizePerformanceProfileId(params),
    performanceAutoProfileEnabled: params?.performanceAutoProfileEnabled !== false,
    performanceHardwareClass:
      typeof params?.performanceHardwareClass === 'string' ? params.performanceHardwareClass : 'unknown',
    performanceHardwareSummary:
      typeof params?.performanceHardwareSummary === 'string' ? params.performanceHardwareSummary : '',
    performanceSheetWorkloadBudget: clampFinite(params?.performanceSheetWorkloadBudget, 0, 1, 0.35),
    performanceMaxSheetPanels: Math.max(
      100,
      Math.floor(clampFinite(params?.performanceMaxSheetPanels, 100, 10000, 900)),
    ),
    performanceRepresentationSwitchCooldown: Math.max(
      4,
      Math.floor(clampFinite(params?.performanceRepresentationSwitchCooldown, 4, 120, 12)),
    ),
    performanceCalibrationInProgress: params?.performanceCalibrationInProgress === true,
    performanceCalibrationProgress: clampFinite(params?.performanceCalibrationProgress, 0, 1, 0),
    performanceCalibrationStage:
      typeof params?.performanceCalibrationStage === 'string'
        ? params.performanceCalibrationStage
        : 'idle',
    performanceCalibrationLastRunAt:
      typeof params?.performanceCalibrationLastRunAt === 'string'
        ? params.performanceCalibrationLastRunAt
        : '',
    performanceCalibrationLastSummary:
      typeof params?.performanceCalibrationLastSummary === 'string'
        ? params.performanceCalibrationLastSummary
        : '',
    performanceCalibrationBestBackend:
      typeof params?.performanceCalibrationBestBackend === 'string'
        ? params.performanceCalibrationBestBackend
        : 'none',
    performanceCalibrationBestProfileId:
      typeof params?.performanceCalibrationBestProfileId === 'string'
        ? params.performanceCalibrationBestProfileId
        : '',
    runtimeStabilityLevel:
      params?.runtimeStabilityLevel === 'warn' || params?.runtimeStabilityLevel === 'critical'
        ? params.runtimeStabilityLevel
        : 'ok',
    runtimeStabilityWarnings: Array.isArray(params?.runtimeStabilityWarnings)
      ? params.runtimeStabilityWarnings
          .filter((item) => typeof item === 'string')
          .slice(0, 32)
      : [],
    runtimeStabilityCorrections: Array.isArray(params?.runtimeStabilityCorrections)
      ? params.runtimeStabilityCorrections
          .filter((item) => typeof item === 'string')
          .slice(0, 32)
      : [],
    runtimeStabilityEnergyErrorPct: clampFinite(params?.runtimeStabilityEnergyErrorPct, -1e6, 1e6, 0),
    runtimeStabilityCirculationErrorPct: clampFinite(params?.runtimeStabilityCirculationErrorPct, -1e6, 1e6, 0),
    runtimeStabilityVelocityDivergence: clampFinite(params?.runtimeStabilityVelocityDivergence, 0, 1e9, 0),
    runtimeStabilitySuggestedDtScale: clampFinite(params?.runtimeStabilitySuggestedDtScale, 0.05, 1, 1),
    runtimeStabilityAutoCorrectionLastAction:
      typeof params?.runtimeStabilityAutoCorrectionLastAction === 'string'
        ? params.runtimeStabilityAutoCorrectionLastAction
        : 'none',
    runtimeStabilityAutoCorrectionCooldown: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeStabilityAutoCorrectionCooldown, 0, 100000, 0)),
    ),
    runtimeStabilityAutoCorrectionTimeline: Array.isArray(params?.runtimeStabilityAutoCorrectionTimeline)
      ? params.runtimeStabilityAutoCorrectionTimeline
          .filter((item) => typeof item === 'string')
          .slice(-32)
      : [],
    runtimeStabilityAutoCorrectionTotalCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeStabilityAutoCorrectionTotalCount, 0, 1e9, 0)),
    ),
    runtimeStabilityAutoCorrectionTimeScaleCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeStabilityAutoCorrectionTimeScaleCount, 0, 1e9, 0)),
    ),
    runtimeStabilityAutoCorrectionSpawnRateCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeStabilityAutoCorrectionSpawnRateCount, 0, 1e9, 0)),
    ),
    runtimeStabilityAutoCorrectionRemeshRefineCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeStabilityAutoCorrectionRemeshRefineCount, 0, 1e9, 0)),
    ),
    runtimeStabilityAutoCorrectionRemeshCoarsenCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeStabilityAutoCorrectionRemeshCoarsenCount, 0, 1e9, 0)),
    ),
    runtimeStabilityAutoCorrectionSaturationCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeStabilityAutoCorrectionSaturationCount, 0, 1e9, 0)),
    ),
    runtimeStabilityAutoCorrectionWindowPer1k: clampFinite(
      params?.runtimeStabilityAutoCorrectionWindowPer1k,
      0,
      1e6,
      0,
    ),
    runtimeStabilityAdaptiveDriftSeverity: clampFinite(
      params?.runtimeStabilityAdaptiveDriftSeverity,
      0,
      1,
      0,
    ),
    runtimeStabilityAdaptiveDriftScale: clampFinite(
      params?.runtimeStabilityAdaptiveDriftScale,
      0,
      1,
      0,
    ),
    runtimeStabilityAdaptiveDriftStreak: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeStabilityAdaptiveDriftStreak, 0, 1e9, 0)),
    ),
    vizShowVorticityField: params?.vizShowVorticityField === true,
    vizShowQCriterion: params?.vizShowQCriterion === true,
    vizShowVelocityField: params?.vizShowVelocityField === true,
    vizShowStreamlines: params?.vizShowStreamlines === true,
    vizShowPathlines: params?.vizShowPathlines === true,
    vizShowDetectionOverlay: params?.vizShowDetectionOverlay === true,
    vizShowTopologyOverlay: params?.vizShowTopologyOverlay === true,
    vizShowEnergyOverlay: params?.vizShowEnergyOverlay === true,
    vizScientificMode: params?.vizScientificMode === true,
    vizExportScale: clampFinite(params?.vizExportScale, 0.5, 4, 1),
    vizOverlayMinConfidence: clampFinite(params?.vizOverlayMinConfidence, 0, 1, 0.25),
    vizOverlayShowLabels: params?.vizOverlayShowLabels === true,
    vizOverlayLabelMaxCount: Math.max(
      1,
      Math.floor(clampFinite(params?.vizOverlayLabelMaxCount, 1, 24, 8)),
    ),
    vizOverlayLabelMaxDistance: clampFinite(params?.vizOverlayLabelMaxDistance, 2, 60, 12),
    physicalViscosityEnabled: params?.physicalViscosityEnabled === true,
    physicalViscosityNu: clampFinite(params?.physicalViscosityNu, 0, 1, 0.0001),
    physicalPseEnabled: params?.physicalPseEnabled === true,
    physicalStretchingEnabled: params?.physicalStretchingEnabled === true,
    physicalStretchingStrength: clampFinite(params?.physicalStretchingStrength, 0, 10, 1),
    physicalBoundaryEnabled: params?.physicalBoundaryEnabled === true,
    physicalBoundaryMode:
      params?.physicalBoundaryMode === 'spheres' || params?.physicalBoundaryMode === 'meshes'
        ? params.physicalBoundaryMode
        : 'planes',
    physicalIntegrationOrderProfile:
      params?.physicalIntegrationOrderProfile === 'boundary_first' ||
      params?.physicalIntegrationOrderProfile === 'diffusion_first'
        ? params.physicalIntegrationOrderProfile
        : 'canonical',
    physicalNoSlipEnabled: params?.physicalNoSlipEnabled === true,
    physicalImageVorticesEnabled: params?.physicalImageVorticesEnabled === true,
    physicalWakeEnabled: params?.physicalWakeEnabled === true,
    runtimePhysicalStepOrder:
      typeof params?.runtimePhysicalStepOrder === 'string'
        ? params.runtimePhysicalStepOrder
        : 'velocity_computation',
    runtimePhysicalIntegrationOrderProfile:
      typeof params?.runtimePhysicalIntegrationOrderProfile === 'string'
        ? params.runtimePhysicalIntegrationOrderProfile
        : 'canonical',
    runtimePhysicalWarnings: Array.isArray(params?.runtimePhysicalWarnings)
      ? params.runtimePhysicalWarnings
          .filter((item) => typeof item === 'string')
          .slice(0, 32)
      : [],
    runtimePhysicalViscosityApplied: params?.runtimePhysicalViscosityApplied === true,
    runtimePhysicalStretchingApplied: params?.runtimePhysicalStretchingApplied === true,
    runtimePhysicalBoundaryApplied: params?.runtimePhysicalBoundaryApplied === true,
    runtimePhysicalWakeApplied: params?.runtimePhysicalWakeApplied === true,
    runtimeDetectedFilamentCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeDetectedFilamentCount, 0, 1e9, 0)),
    ),
    runtimeDetectedRingCount: Math.max(0, Math.floor(clampFinite(params?.runtimeDetectedRingCount, 0, 1e9, 0))),
    runtimeDetectedTubeCount: Math.max(0, Math.floor(clampFinite(params?.runtimeDetectedTubeCount, 0, 1e9, 0))),
    runtimeDetectedSheetCount: Math.max(0, Math.floor(clampFinite(params?.runtimeDetectedSheetCount, 0, 1e9, 0))),
    runtimeDetectedClusterCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeDetectedClusterCount, 0, 1e9, 0)),
    ),
    runtimeDetectionConfidence: clampFinite(params?.runtimeDetectionConfidence, 0, 1, 0),
    runtimeDetectionConfidenceRaw: clampFinite(params?.runtimeDetectionConfidenceRaw, 0, 1, 0),
    runtimeDetectionSheetSurfaceCoherence: clampFinite(params?.runtimeDetectionSheetSurfaceCoherence, 0, 1, 0),
    runtimeDetectionSheetCurvatureAnisotropy: clampFinite(
      params?.runtimeDetectionSheetCurvatureAnisotropy,
      0,
      1,
      0,
    ),
    runtimeDetectionClassConfidenceFilament: clampFinite(
      params?.runtimeDetectionClassConfidenceFilament,
      0,
      1,
      0,
    ),
    runtimeDetectionClassConfidenceRing: clampFinite(params?.runtimeDetectionClassConfidenceRing, 0, 1, 0),
    runtimeDetectionClassConfidenceTube: clampFinite(params?.runtimeDetectionClassConfidenceTube, 0, 1, 0),
    runtimeDetectionClassConfidenceSheet: clampFinite(params?.runtimeDetectionClassConfidenceSheet, 0, 1, 0),
    runtimeSolverMode: (() => {
      const mode = String(params?.runtimeSolverMode ?? 'inactive')
      return mode === 'exact' || mode === 'spatialGrid' || mode === 'fmm' || mode === 'inactive'
        ? mode
        : 'inactive'
    })(),
    runtimeSolverModeRequested: (() => {
      const mode = String(params?.runtimeSolverModeRequested ?? 'exact')
      return mode === 'exact' || mode === 'spatialGrid' || mode === 'fmm' || mode === 'auto'
        ? mode
        : 'exact'
    })(),
    runtimeSolverParticleCount: Math.max(0, Math.floor(clampFinite(params?.runtimeSolverParticleCount, 0, 1e9, 0))),
    runtimeSolverFmmTheta: clampFinite(params?.runtimeSolverFmmTheta, 0.2, 1.2, 0.65),
    runtimeSolverFmmLeafSize: Math.max(4, Math.floor(clampFinite(params?.runtimeSolverFmmLeafSize, 4, 64, 16))),
    runtimeSolverUseBiotSavart: params?.runtimeSolverUseBiotSavart === true,
    runtimeSolverVpmEnabled: params?.runtimeSolverVpmEnabled === true,
    runtimeSolverAutoCurrentMode: (() => {
      const mode = String(params?.runtimeSolverAutoCurrentMode ?? 'exact')
      return mode === 'exact' || mode === 'spatialGrid' || mode === 'fmm' || mode === 'inactive'
        ? mode
        : 'exact'
    })(),
    runtimeSolverAutoCandidateMode: (() => {
      const mode = String(params?.runtimeSolverAutoCandidateMode ?? 'exact')
      return mode === 'exact' || mode === 'spatialGrid' || mode === 'fmm' || mode === 'inactive'
        ? mode
        : 'exact'
    })(),
    runtimeSolverAutoPendingSteps: Math.max(0, Math.floor(clampFinite(params?.runtimeSolverAutoPendingSteps, 0, 1e6, 0))),
    runtimeSolverAutoCooldownSteps: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeSolverAutoCooldownSteps, 0, 1e6, 0)),
    ),
    runtimeSolverAutoSwitchCount: Math.max(0, Math.floor(clampFinite(params?.runtimeSolverAutoSwitchCount, 0, 1e9, 0))),
    runtimeSolverAutoLastSwitchReason:
      typeof params?.runtimeSolverAutoLastSwitchReason === 'string'
        ? params.runtimeSolverAutoLastSwitchReason.slice(0, 120)
        : 'none',
    runtimeTransitionState: (() => {
      const state = String(params?.runtimeTransitionState ?? 'idle')
      return state === 'candidate' ||
        state === 'pending_confirm' ||
        state === 'committed' ||
        state === 'rejected'
        ? state
        : 'idle'
    })(),
    runtimeTransitionCandidateType:
      typeof params?.runtimeTransitionCandidateType === 'string'
        ? params.runtimeTransitionCandidateType
        : 'none',
    runtimeTransitionPendingFrames: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeTransitionPendingFrames, 0, 1e9, 0)),
    ),
    runtimeTransitionCandidates: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeTransitionCandidates, 0, 1e9, 0)),
    ),
    runtimeTransitionCommitted: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeTransitionCommitted, 0, 1e9, 0)),
    ),
    runtimeTransitionRejected: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeTransitionRejected, 0, 1e9, 0)),
    ),
    runtimeTransitionGammaDriftPct: clampFinite(params?.runtimeTransitionGammaDriftPct, 0, 1e9, 0),
    runtimeTransitionImpulseDriftPct: clampFinite(params?.runtimeTransitionImpulseDriftPct, 0, 1e9, 0),
    runtimeTransitionEnergyDriftPct: clampFinite(params?.runtimeTransitionEnergyDriftPct, 0, 1e9, 0),
    runtimeTransitionGateConfidenceOk: params?.runtimeTransitionGateConfidenceOk === true,
    runtimeTransitionGateInvariantOk: params?.runtimeTransitionGateInvariantOk === true,
    runtimeTransitionGateHysteresisOk: params?.runtimeTransitionGateHysteresisOk === true,
    runtimeTransitionGateReason:
      typeof params?.runtimeTransitionGateReason === 'string'
        ? params.runtimeTransitionGateReason
        : 'none',
    runtimeTransitionEnterFrames: Math.max(
      1,
      Math.floor(clampFinite(params?.runtimeTransitionEnterFrames, 1, 200, 3)),
    ),
    runtimeTransitionConfidenceEnterMin: clampFinite(params?.runtimeTransitionConfidenceEnterMin, 0, 1, 0.56),
    runtimeTransitionConfidenceExitMin: clampFinite(params?.runtimeTransitionConfidenceExitMin, 0, 1, 0.44),
    runtimeRingValidationVersion: (() => {
      const version = String(params?.runtimeRingValidationVersion ?? 'tt023b.ring_validation.v1')
      return version.length > 80 ? 'tt023b.ring_validation.v1' : version
    })(),
    runtimeRingValidationValid: params?.runtimeRingValidationValid !== false,
    runtimeRingValidationVerdict: (() => {
      const verdict = String(params?.runtimeRingValidationVerdict ?? 'pass')
      return verdict === 'pass' || verdict === 'warn' || verdict === 'fail' ? verdict : 'pass'
    })(),
    runtimeRingValidationAcceptanceScore: clampFinite(params?.runtimeRingValidationAcceptanceScore, 0, 1, 0),
    runtimeRingValidationGatePassCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeRingValidationGatePassCount, 0, 16, 0)),
    ),
    runtimeRingValidationGateTotal: Math.max(
      1,
      Math.floor(clampFinite(params?.runtimeRingValidationGateTotal, 1, 16, 4)),
    ),
    runtimeRingValidationTransitionCommitRatio: clampFinite(
      params?.runtimeRingValidationTransitionCommitRatio,
      0,
      1,
      0,
    ),
    runtimeRingValidationProfile: (() => {
      const profile = String(params?.runtimeRingValidationProfile ?? 'classic')
      return profile === 'classic' || profile === 'natural_modulated' ? profile : 'classic'
    })(),
    runtimeRingValidationModifierStrength: clampFinite(
      params?.runtimeRingValidationModifierStrength,
      0,
      1,
      0,
    ),
    runtimeRingExternalValidationEligible: params?.runtimeRingExternalValidationEligible !== false,
    runtimeRingExternalValidationEligibilityReason: (() => {
      const reason = String(params?.runtimeRingExternalValidationEligibilityReason ?? 'eligible')
      return reason.length > 120 ? 'eligible' : reason
    })(),
    runtimeJetRegimeVersion: (() => {
      const version = String(params?.runtimeJetRegimeVersion ?? 'tt024b.jet_regime.v1')
      return version.length > 80 ? 'tt024b.jet_regime.v1' : version
    })(),
    runtimeJetRegimeValid: params?.runtimeJetRegimeValid !== false,
    runtimeJetRegimeVerdict: (() => {
      const verdict = String(params?.runtimeJetRegimeVerdict ?? 'pass')
      return verdict === 'pass' || verdict === 'warn' || verdict === 'fail' ? verdict : 'pass'
    })(),
    runtimeJetRegimeType: (() => {
      const type = String(params?.runtimeJetRegimeType ?? 'ring_train')
      return type === 'shear_layer' || type === 'ring_train' || type === 'interaction' || type === 'turbulent_wake'
        ? type
        : 'ring_train'
    })(),
    runtimeJetRegimeAcceptanceScore: clampFinite(params?.runtimeJetRegimeAcceptanceScore, 0, 1, 0),
    runtimeJetRegimeGatePassCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeJetRegimeGatePassCount, 0, 16, 0)),
    ),
    runtimeJetRegimeGateTotal: Math.max(
      1,
      Math.floor(clampFinite(params?.runtimeJetRegimeGateTotal, 1, 16, 4)),
    ),
    runtimeJetRegimeProfile: (() => {
      const profile = String(params?.runtimeJetRegimeProfile ?? 'classic')
      return profile === 'classic' || profile === 'natural_modulated' ? profile : 'classic'
    })(),
    runtimeJetRegimeModifierStrength: clampFinite(
      params?.runtimeJetRegimeModifierStrength,
      0,
      1,
      0,
    ),
    runtimeJetExternalValidationEligible: params?.runtimeJetExternalValidationEligible !== false,
    runtimeJetExternalValidationEligibilityReason: (() => {
      const reason = String(params?.runtimeJetExternalValidationEligibilityReason ?? 'eligible')
      return reason.length > 120 ? 'eligible' : reason
    })(),
    runtimeJetRegimeReProxy: clampFinite(params?.runtimeJetRegimeReProxy, 0, 1, 0),
    runtimeJetRegimeStProxy: clampFinite(params?.runtimeJetRegimeStProxy, 0, 1, 0),
    runtimeJetRegimeLdProxy: clampFinite(params?.runtimeJetRegimeLdProxy, 0, 1, 0),
    runtimeJetRegimeRingDominance: clampFinite(params?.runtimeJetRegimeRingDominance, 0, 1, 0),
    runtimeJetRegimeWakeIndex: clampFinite(params?.runtimeJetRegimeWakeIndex, 0, 1, 0),
    runtimeJetRollupClosureScore: clampFinite(params?.runtimeJetRollupClosureScore, 0, 1, 0),
    runtimeJetRollupClosureState: (() => {
      const state = String(params?.runtimeJetRollupClosureState ?? 'idle')
      return state === 'closed' || state === 'forming' || state === 'unstable' ? state : 'idle'
    })(),
    runtimeJetRollupAutoTuneLastAction:
      typeof params?.runtimeJetRollupAutoTuneLastAction === 'string'
        ? params.runtimeJetRollupAutoTuneLastAction.slice(0, 120)
        : 'none',
    runtimeJetRollupAutoTuneStepInterval: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeJetRollupAutoTuneStepInterval, 0, 1e6, 0)),
    ),
    runtimeDetectorFusionVersion: (() => {
      const version = String(params?.runtimeDetectorFusionVersion ?? 'tt025b.detector_fusion.v1')
      return version.length > 80 ? 'tt025b.detector_fusion.v1' : version
    })(),
    runtimeDetectorFusionValid: params?.runtimeDetectorFusionValid !== false,
    runtimeDetectorFusionVerdict: (() => {
      const verdict = String(params?.runtimeDetectorFusionVerdict ?? 'pass')
      return verdict === 'pass' || verdict === 'warn' || verdict === 'fail' ? verdict : 'pass'
    })(),
    runtimeDetectorFusionProfile: (() => {
      const profile = String(params?.runtimeDetectorFusionProfile ?? 'classic')
      return profile === 'classic' || profile === 'natural_modulated' ? profile : 'classic'
    })(),
    runtimeDetectorFusionModifierStrength: clampFinite(
      params?.runtimeDetectorFusionModifierStrength,
      0,
      1,
      0,
    ),
    runtimeDetectorExternalValidationEligible: params?.runtimeDetectorExternalValidationEligible !== false,
    runtimeDetectorExternalValidationEligibilityReason: (() => {
      const reason = String(params?.runtimeDetectorExternalValidationEligibilityReason ?? 'eligible')
      return reason.length > 120 ? 'eligible' : reason
    })(),
    runtimeDetectorFusionAcceptanceScore: clampFinite(params?.runtimeDetectorFusionAcceptanceScore, 0, 1, 0),
    runtimeDetectorFusionGatePassCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeDetectorFusionGatePassCount, 0, 16, 0)),
    ),
    runtimeDetectorFusionGateTotal: Math.max(
      1,
      Math.floor(clampFinite(params?.runtimeDetectorFusionGateTotal, 1, 16, 5)),
    ),
    runtimeDetectorFusionWeightedScore: clampFinite(params?.runtimeDetectorFusionWeightedScore, 0, 1, 0),
    runtimeTopologyVersion: (() => {
      const version = String(params?.runtimeTopologyVersion ?? 'tt028b.topology_tracking.v1')
      return version.length > 80 ? 'tt028b.topology_tracking.v1' : version
    })(),
    runtimeTopologyValid: params?.runtimeTopologyValid !== false,
    runtimeTopologyProfile: (() => {
      const profile = String(params?.runtimeTopologyProfile ?? 'classic')
      return profile === 'classic' || profile === 'natural_modulated' ? profile : 'classic'
    })(),
    runtimeTopologyModifierStrength: clampFinite(params?.runtimeTopologyModifierStrength, 0, 1, 0),
    runtimeTopologyExternalValidationEligible: params?.runtimeTopologyExternalValidationEligible !== false,
    runtimeTopologyExternalValidationEligibilityReason: (() => {
      const reason = String(params?.runtimeTopologyExternalValidationEligibilityReason ?? 'eligible')
      return reason.length > 120 ? 'eligible' : reason
    })(),
    runtimeTopologyFrameSerial: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeTopologyFrameSerial, 0, 1e9, 0)),
    ),
    runtimeTopologyEventCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeTopologyEventCount, 0, 1e9, 0)),
    ),
    runtimeTopologyNodeCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeTopologyNodeCount, 0, 1e9, 0)),
    ),
    runtimeTopologyEdgeCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeTopologyEdgeCount, 0, 1e9, 0)),
    ),
    runtimeTopologyBirthCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeTopologyBirthCount, 0, 1e9, 0)),
    ),
    runtimeTopologyDecayCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeTopologyDecayCount, 0, 1e9, 0)),
    ),
    runtimeTopologyMergeCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeTopologyMergeCount, 0, 1e9, 0)),
    ),
    runtimeTopologySplitCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeTopologySplitCount, 0, 1e9, 0)),
    ),
    runtimeTopologyReconnectionCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeTopologyReconnectionCount, 0, 1e9, 0)),
    ),
    runtimeTopologyLatestEventType:
      typeof params?.runtimeTopologyLatestEventType === 'string'
        ? params.runtimeTopologyLatestEventType
        : 'none',
    runtimeTopologyLatestEventConfidence: clampFinite(params?.runtimeTopologyLatestEventConfidence, 0, 1, 0),
    runtimeTopologyLatestEventFrame: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeTopologyLatestEventFrame, 0, 1e9, 0)),
    ),
    runtimeTopologyEventLog: normalizeRuntimeTopologyEventLog(params),
    runtimeTopologyGraphNodes: normalizeRuntimeTopologyGraphNodes(params),
    runtimeTopologyGraphEdges: normalizeRuntimeTopologyGraphEdges(params),
    runtimeRenderPolicyMode:
      params?.runtimeRenderPolicyMode === 'filaments' ||
      params?.runtimeRenderPolicyMode === 'hybrid' ||
      params?.runtimeRenderPolicyMode === 'tubes'
        ? params.runtimeRenderPolicyMode
        : 'particles',
    runtimeRenderLodTier:
      params?.runtimeRenderLodTier === 'far' || params?.runtimeRenderLodTier === 'mid'
        ? params.runtimeRenderLodTier
        : 'near',
    runtimeRenderParticleLayerVisible: params?.runtimeRenderParticleLayerVisible !== false,
    runtimeRenderFilamentLayerVisible: params?.runtimeRenderFilamentLayerVisible !== false,
    runtimeRenderSheetLayerVisible: params?.runtimeRenderSheetLayerVisible === true,
    runtimeRenderDiagnosticsConfidence: clampFinite(params?.runtimeRenderDiagnosticsConfidence, 0, 1, 0),
    runtimeRenderDiagnosticsUncertainty: clampFinite(
      params?.runtimeRenderDiagnosticsUncertainty,
      0,
      1,
      1,
    ),
    runtimeRenderUncertaintyDetectorGap: clampFinite(
      params?.runtimeRenderUncertaintyDetectorGap,
      0,
      1,
      1,
    ),
    runtimeRenderUncertaintyFallback: clampFinite(params?.runtimeRenderUncertaintyFallback, 0, 1, 0),
    runtimeRenderUncertaintyTopologyVolatility: clampFinite(
      params?.runtimeRenderUncertaintyTopologyVolatility,
      0,
      1,
      1,
    ),
    runtimeRenderSheetPanelCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeRenderSheetPanelCount, 0, 100000, 0)),
    ),
    runtimeRenderSheetCoverage: clampFinite(params?.runtimeRenderSheetCoverage, 0, 1, 0),
    runtimeRenderSheetReadiness: clampFinite(params?.runtimeRenderSheetReadiness, 0, 1, 0),
    runtimeRenderSheetQuadratureOrder: Math.max(
      1,
      Math.floor(clampFinite(params?.runtimeRenderSheetQuadratureOrder, 1, 8, 1)),
    ),
    runtimeRenderSheetDesingularizationEpsilon: clampFinite(
      params?.runtimeRenderSheetDesingularizationEpsilon,
      1e-5,
      10,
      0.01,
    ),
    runtimeRenderSheetProfileId: (() => {
      const profileId = String(params?.runtimeRenderSheetProfileId ?? 'sheet_profile_balanced')
      return /^sheet_profile_[a-z0-9_]+$/.test(profileId) ? profileId : 'sheet_profile_balanced'
    })(),
    runtimeRenderSheetQuadratureProfile: (() => {
      const profile = String(params?.runtimeRenderSheetQuadratureProfile ?? 'gauss_legendre_1x2')
      return /^gauss_legendre_[1-4]x[2-4]$/.test(profile) ? profile : 'gauss_legendre_1x2'
    })(),
    runtimeRenderSheetMeshSeed: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeRenderSheetMeshSeed, 0, 4294967295, 0)),
    ),
    runtimeRenderSheetMeshTopology: (() => {
      const topology = String(params?.runtimeRenderSheetMeshTopology ?? 'tri_fan')
      return topology === 'tri_fan' || topology === 'mixed_patch' || topology === 'quad_patch'
        ? topology
        : 'tri_fan'
    })(),
    runtimeRenderSheetMeshPatchCount: Math.max(
      1,
      Math.floor(clampFinite(params?.runtimeRenderSheetMeshPatchCount, 1, 4096, 1)),
    ),
    runtimeRenderSheetPanelAspectP95: clampFinite(params?.runtimeRenderSheetPanelAspectP95, 1, 20, 1),
    runtimeRenderSheetQualityGatePassCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeRenderSheetQualityGatePassCount, 0, 16, 0)),
    ),
    runtimeRenderSheetQualityGateTotal: Math.max(
      1,
      Math.floor(clampFinite(params?.runtimeRenderSheetQualityGateTotal, 1, 16, 4)),
    ),
    runtimeRenderSheetQualityVerdict: (() => {
      const verdict = String(params?.runtimeRenderSheetQualityVerdict ?? 'warn')
      return verdict === 'pass' || verdict === 'warn' || verdict === 'fail' ? verdict : 'warn'
    })(),
    runtimeRenderSheetQualityPenalty: clampFinite(params?.runtimeRenderSheetQualityPenalty, 0, 1, 0.5),
    runtimeRenderSheetMeshDeterministic: params?.runtimeRenderSheetMeshDeterministic !== false,
    runtimeRenderSheetMeshLayoutDigest: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeRenderSheetMeshLayoutDigest, 0, 4294967295, 0)),
    ),
    runtimeRenderSheetMeshPatchMinPanels: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeRenderSheetMeshPatchMinPanels, 0, 100000, 0)),
    ),
    runtimeRenderSheetMeshPatchMaxPanels: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeRenderSheetMeshPatchMaxPanels, 0, 100000, 0)),
    ),
    runtimeRenderSheetMeshPatchImbalance: clampFinite(params?.runtimeRenderSheetMeshPatchImbalance, 0, 20, 0),
    runtimeRenderSheetMeshContractVersion: (() => {
      const version = String(params?.runtimeRenderSheetMeshContractVersion ?? 'tt021b.panel_mesh.v1')
      return version.length > 80 ? 'tt021b.panel_mesh.v1' : version
    })(),
    runtimeRenderSheetMeshContractValid: params?.runtimeRenderSheetMeshContractValid !== false,
    runtimeRenderSheetMeshContractIssueCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeRenderSheetMeshContractIssueCount, 0, 32, 0)),
    ),
    runtimeRenderSheetMeshContractGatePassCount: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeRenderSheetMeshContractGatePassCount, 0, 16, 4)),
    ),
    runtimeRenderSheetMeshContractGateTotal: Math.max(
      1,
      Math.floor(clampFinite(params?.runtimeRenderSheetMeshContractGateTotal, 1, 16, 4)),
    ),
    runtimeRenderSheetMeshContractVerdict: (() => {
      const verdict = String(params?.runtimeRenderSheetMeshContractVerdict ?? 'pass')
      return verdict === 'pass' || verdict === 'warn' || verdict === 'fail' ? verdict : 'pass'
    })(),
    runtimeRenderSheetMeshContractPenalty: clampFinite(
      params?.runtimeRenderSheetMeshContractPenalty,
      0,
      1,
      0,
    ),
    runtimeRenderSheetMeshPatchAreaMean: clampFinite(params?.runtimeRenderSheetMeshPatchAreaMean, 1e-8, 1000, 0.01),
    runtimeRenderSheetMeshPatchAreaCv: clampFinite(params?.runtimeRenderSheetMeshPatchAreaCv, 0, 4, 0),
    runtimeRenderSheetMeshEdgeLengthRatioP95: clampFinite(
      params?.runtimeRenderSheetMeshEdgeLengthRatioP95,
      1,
      40,
      1,
    ),
    runtimeRenderSheetMeshCurvatureProxyP95: clampFinite(
      params?.runtimeRenderSheetMeshCurvatureProxyP95,
      1,
      80,
      1,
    ),
    runtimeRenderSheetCouplingVersion: (() => {
      const version = String(params?.runtimeRenderSheetCouplingVersion ?? 'tt021c.sheet_coupling.v1')
      return version.length > 80 ? 'tt021c.sheet_coupling.v1' : version
    })(),
    runtimeRenderSheetCouplingValid: params?.runtimeRenderSheetCouplingValid !== false,
    runtimeRenderSheetCouplingVerdict: (() => {
      const verdict = String(params?.runtimeRenderSheetCouplingVerdict ?? 'pass')
      return verdict === 'pass' || verdict === 'warn' || verdict === 'fail' ? verdict : 'pass'
    })(),
    runtimeRenderSheetCouplingPenalty: clampFinite(params?.runtimeRenderSheetCouplingPenalty, 0, 1, 0),
    runtimeRenderSheetCouplingAmerState: (() => {
      const state = String(params?.runtimeRenderSheetCouplingAmerState ?? 'pass')
      return state === 'pass' || state === 'warn' || state === 'fail' ? state : 'pass'
    })(),
    runtimeRenderSheetCouplingAmerTransferBudget: clampFinite(
      params?.runtimeRenderSheetCouplingAmerTransferBudget,
      0,
      1,
      0.5,
    ),
    runtimeRenderSheetCouplingAmerInvariantDriftCapPct: clampFinite(
      params?.runtimeRenderSheetCouplingAmerInvariantDriftCapPct,
      0,
      100,
      4,
    ),
    runtimeRenderSheetCouplingFilamentState: (() => {
      const state = String(params?.runtimeRenderSheetCouplingFilamentState ?? 'pass')
      return state === 'pass' || state === 'warn' || state === 'fail' ? state : 'pass'
    })(),
    runtimeRenderSheetCouplingFilamentNodeTransferCap: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeRenderSheetCouplingFilamentNodeTransferCap, 0, 100000, 64)),
    ),
    runtimeRenderSheetCouplingFilamentLoad: clampFinite(params?.runtimeRenderSheetCouplingFilamentLoad, 0, 100, 0),
    runtimeRenderSheetRollupStabilityGuard:
      String(params?.runtimeRenderSheetRollupStabilityGuard ?? 'clear') === 'engaged' ? 'engaged' : 'clear',
    runtimeRenderSheetPlaceholder: params?.runtimeRenderSheetPlaceholder !== false,
    runtimeRenderScoreParticles: clampFinite(params?.runtimeRenderScoreParticles, 0, 1, 0),
    runtimeRenderScoreFilaments: clampFinite(params?.runtimeRenderScoreFilaments, 0, 1, 0),
    runtimeRenderScoreSheets: clampFinite(params?.runtimeRenderScoreSheets, 0, 1, 0),
    runtimeRenderScoreCurrent: clampFinite(params?.runtimeRenderScoreCurrent, 0, 1, 0),
    runtimeRenderScoreMargin: clampFinite(params?.runtimeRenderScoreMargin, 0, 1, 0),
    runtimeRenderScoreBestMode:
      params?.runtimeRenderScoreBestMode === 'filaments' || params?.runtimeRenderScoreBestMode === 'sheets'
        ? params.runtimeRenderScoreBestMode
        : 'particles',
    runtimeRenderHysteresisHoldSteps: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeRenderHysteresisHoldSteps, 0, 600, 0)),
    ),
    runtimeRenderHysteresisRemaining: Math.max(
      0,
      Math.floor(clampFinite(params?.runtimeRenderHysteresisRemaining, 0, 600, 0)),
    ),
    runtimeRenderOverrideReason:
      params?.runtimeRenderOverrideReason === 'fallback_storm' ||
      params?.runtimeRenderOverrideReason === 'timeout_burst' ||
      params?.runtimeRenderOverrideReason === 'invariant_guard'
        ? params.runtimeRenderOverrideReason
        : 'none',
    runtimeRenderHealthFallbackRate: clampFinite(params?.runtimeRenderHealthFallbackRate, 0, 1, 0),
    runtimeRenderHealthTimeoutRate: clampFinite(params?.runtimeRenderHealthTimeoutRate, 0, 1, 0),
    runtimeRenderHealthDriftSeverity: clampFinite(params?.runtimeRenderHealthDriftSeverity, 0, 1, 0),
    runtimeOverlayConfidenceComposite: clampFinite(params?.runtimeOverlayConfidenceComposite, 0, 1, 0),
    runtimeOverlayUncertaintyComposite: clampFinite(params?.runtimeOverlayUncertaintyComposite, 0, 1, 1),
    runtimeOverlayUncertaintyDetector: clampFinite(params?.runtimeOverlayUncertaintyDetector, 0, 1, 1),
    runtimeOverlayUncertaintyTopology: clampFinite(params?.runtimeOverlayUncertaintyTopology, 0, 1, 1),
    runtimeOverlayUncertaintyRender: clampFinite(params?.runtimeOverlayUncertaintyRender, 0, 1, 1),
    runtimeOverlayStructures: normalizeRuntimeOverlayStructures(params),
    emissionMode: normalizeEmissionMode(params),
    emissionCouplingMode: normalizeEmissionCouplingMode(params),
    dynamicsMode,
    nozzleRadius: nozzle.radius,
    nozzleZ: nozzle.position.z,
    nozzleX: nozzle.position.z,
    nozzle,
    multiEmitterPresetEnabled: multiEmitter.enabled,
    multiEmitterCount: multiEmitter.count,
    multiEmitterSelectedIndex: multiEmitter.selectedIndex,
    multiEmitterRotateByMouse: params?.multiEmitterRotateByMouse === true,
    multiEmitters: multiEmitter.emitters,
    pulseShape,
    waveform: getLegacyWaveform(pulseShape),
    ringResolution: normalizeRingResolutionToUi(params?.ringResolution),
    ringResolutionMultiplier: getRingResolutionMultiplier(params),
    vectorDisplayMode,
    executionMode,
    physicsBackend,
    velocityComputationMode: normalizeVelocityMode(params),
    velocityAutoExactMaxParticles: Math.max(
      1000,
      Math.floor(clampFinite(params?.velocityAutoExactMaxParticles, 1000, 200000, 12000)),
    ),
    velocityAutoSpatialMaxParticles: Math.max(
      2000,
      Math.floor(clampFinite(params?.velocityAutoSpatialMaxParticles, 2000, 500000, 80000)),
    ),
    velocityAutoHysteresisParticles: Math.max(
      200,
      Math.floor(clampFinite(params?.velocityAutoHysteresisParticles, 200, 200000, 4000)),
    ),
    velocityAutoSwitchEnterSteps: Math.max(
      1,
      Math.floor(clampFinite(params?.velocityAutoSwitchEnterSteps, 1, 120, 3)),
    ),
    velocityAutoSwitchCooldownSteps: Math.max(
      0,
      Math.floor(clampFinite(params?.velocityAutoSwitchCooldownSteps, 0, 360, 18)),
    ),
    cellSizeMultiplier: clampFinite(params?.cellSizeMultiplier, 1, 10, 4),
    neighborCellRange: Math.max(1, Math.floor(clampFinite(params?.neighborCellRange, 1, 3, 1))),
    aggregationDistance: Math.max(1, Math.floor(clampFinite(params?.aggregationDistance, 1, 5, 2))),
    fmmTheta: clampFinite(params?.fmmTheta ?? params?.hybridPlusBarnesHutTheta, 0.2, 1.2, 0.65),
    fmmLeafSize: Math.max(4, Math.floor(clampFinite(params?.fmmLeafSize ?? 16, 4, 64, 16))),
    fmmSoftening: clampFinite(params?.fmmSoftening ?? 0.02, 1e-5, 2, 0.02),
    vortexRepresentation,
    tubeRadius: clampFinite(params?.tubeRadius, 0.005, 2, 0.12),
    tubeLayers: Math.max(1, Math.floor(clampFinite(params?.tubeLayers, 1, 8, 3))),
    tubeParticlesPerRing: Math.max(
      6,
      Math.floor(clampFinite(params?.tubeParticlesPerRing, 6, 128, 24)),
    ),
    tubeCoreSigma: clampFinite(params?.tubeCoreSigma, 0.001, 1, 0.04),
    tubeReprojectCadenceSteps: Math.max(
      1,
      Math.floor(clampFinite(params?.tubeReprojectCadenceSteps, 1, 64, 5)),
    ),
    tubeReprojectThreshold: clampFinite(params?.tubeReprojectThreshold, 0, 2, 0.35),
    tubeViewMode: normalizeTubeViewMode(params),
    filamentNodeCount: Math.max(8, Math.floor(clampFinite(params?.filamentNodeCount, 8, 2048, 96))),
    filamentCoreRadius: clampFinite(params?.filamentCoreRadius, 0.001, 2, 0.08),
    maxFilamentNodes: Math.max(32, Math.floor(clampFinite(params?.maxFilamentNodes, 32, 2000, 2000))),
    maxSegmentLength: clampFinite(params?.maxSegmentLength, 0.01, 10, 0.25),
    minSegmentLength: clampFinite(params?.minSegmentLength, 0.005, 10, 0.08),
    reconnectEnabled: params?.reconnectEnabled !== false,
    reconnectionThreshold: clampFinite(params?.reconnectionThreshold, 0, 60, 0.004),
    reconnectDistanceThreshold: clampFinite(
      params?.reconnectDistanceThreshold ?? params?.reconnectionThreshold,
      0,
      60,
      0.004,
    ),
    reconnectAngleThresholdDeg: clampFinite(params?.reconnectAngleThresholdDeg, 0, 180, 12),
    reconnectInterFilamentEnabled: params?.reconnectInterFilamentEnabled !== false,
    reconnectMultipleEnabled: params?.reconnectMultipleEnabled !== false,
    reconnectMaxPerStep: Math.max(1, Math.floor(clampFinite(params?.reconnectMaxPerStep, 1, 32, 4))),
    reconnectVortexAnnihilationEnabled: params?.reconnectVortexAnnihilationEnabled !== false,
    reconnectAnnihilationCirculationThreshold: clampFinite(
      params?.reconnectAnnihilationCirculationThreshold,
      0,
      2,
      0.02,
    ),
    filamentReconnectCooldownSteps: Math.max(
      0,
      Math.floor(clampFinite(params?.filamentReconnectCooldownSteps, 0, 256, 8)),
    ),
    filamentSmoothing: clampFinite(params?.filamentSmoothing, 0, 1, 0.04),
    filamentCurvatureSmoothingGain: clampFinite(
      params?.filamentCurvatureSmoothingGain,
      0,
      4,
      0.8,
    ),
    filamentCurvatureSmoothingClamp: clampFinite(
      params?.filamentCurvatureSmoothingClamp,
      0,
      1,
      0.25,
    ),
    filamentKelvinWaveEnabled: params?.filamentKelvinWaveEnabled === true,
    filamentRegularizationCurvatureStrength: clampFinite(
      params?.filamentRegularizationCurvatureStrength,
      0,
      4,
      0.7,
    ),
    filamentRegularizationCurvatureClamp: clampFinite(
      params?.filamentRegularizationCurvatureClamp,
      0.01,
      0.5,
      0.24,
    ),
    filamentCenterLockEnabled: params?.filamentCenterLockEnabled === true,
    filamentCenterLockGain: clampFinite(params?.filamentCenterLockGain, 0, 1, 0.08),
    filamentCenterLockMaxShiftRatio: clampFinite(
      params?.filamentCenterLockMaxShiftRatio,
      0.01,
      2,
      0.15,
    ),
    filamentIntegrator: normalizeFilamentIntegrator(params),
    particleIntegrator: normalizeParticleIntegrator(params),
    filamentCirculationDriftWarnPercent: clampFinite(
      params?.filamentCirculationDriftWarnPercent,
      0,
      100,
      0.5,
    ),
    filamentLiaStrength: clampFinite(params?.filamentLiaStrength, 0, 4, 1),
    filamentLiaClampRatio: clampFinite(params?.filamentLiaClampRatio, 0.05, 2, 0.65),
    filamentVelocityScale: clampFinite(params?.filamentVelocityScale, 0.05, 3, 1.2),
    filamentMultiFilamentVelocityFactor: clampFinite(
      params?.filamentMultiFilamentVelocityFactor,
      0.2,
      4,
      1,
    ),
    filamentCflSafety: clampFinite(params?.filamentCflSafety, 0.05, 1.0, 0.3),
    filamentMaxSubsteps: Math.max(
      2,
      Math.floor(clampFinite(params?.filamentMaxSubsteps, 2, 24, 10)),
    ),
    filamentCouplingSubsteps: params?.filamentCouplingSubsteps !== false,
    hybridCouplingEnabled: params?.hybridCouplingEnabled !== false,
    hybridParticleToFilamentBackend: normalizeHybridParticleToFilamentBackend(params),
    hybridFilamentToParticleBatchingEnabled:
      params?.hybridFilamentToParticleBatchingEnabled !== false,
    hybridParticleToFilamentStrength: clampFinite(
      params?.hybridParticleToFilamentStrength,
      0,
      3,
      0.35,
    ),
    hybridFilamentToParticleStrength: clampFinite(
      params?.hybridFilamentToParticleStrength,
      0,
      3,
      0.35,
    ),
    hybridParticleToFilamentClampRatio: clampFinite(
      params?.hybridParticleToFilamentClampRatio,
      0,
      1,
      0.35,
    ),
    hybridFilamentToParticleClampRatio: clampFinite(
      params?.hybridFilamentToParticleClampRatio,
      0,
      1,
      0.35,
    ),
    hybridCouplingAutoBalance: params?.hybridCouplingAutoBalance !== false,
    hybridCouplingBalanceGain: clampFinite(params?.hybridCouplingBalanceGain, 0, 2, 0.45),
    hybridQueryAwareReadbackInterval: Math.max(
      1,
      Math.floor(clampFinite(params?.hybridQueryAwareReadbackInterval, 1, 16, 6)),
    ),
    filamentOffsetX: clampFinite(params?.filamentOffsetX, -10, 10, 0),
    filamentAdaptMaxIterations: Math.max(
      4,
      Math.floor(clampFinite(params?.filamentAdaptMaxIterations, 4, 256, 48)),
    ),
    showFilaments,
    showNozzle: params?.showNozzle === true,
    emitterHousingEnabled: params?.emitterHousingEnabled !== false,
    emitterHousingStyle:
      params?.emitterHousingStyle === 'blackHole' ? 'blackHole' : 'woodBox',
    showVectors: vectorDisplayMode !== 'particles',
    showBoth: vectorDisplayMode === 'both',
    arrowOpacity: clampFinite(params?.arrowOpacity, 0, 1, 1),
    showFilamentNodes: !!params?.showFilamentNodes,
    showCirculation: !!params?.showCirculation,
    showFilamentVelocityVectors: !!params?.showFilamentVelocityVectors,
    showFilamentTangents: !!params?.showFilamentTangents,
    showTubeParticles: params?.showTubeParticles !== false,
    showTubeSurface: params?.showTubeSurface === true,
    showTubeSpine: params?.showTubeSpine !== false,
    showAxisLabels: params?.showAxisLabels !== false,
    axisThickness: clampFinite(params?.axisThickness, 0.005, 0.3, 0.04),
    axisOpacity: clampFinite(params?.axisOpacity, 0, 1, 1),
    particleColor: normalizeColor(params?.particleColor, '#ffffff'),
    showGrid: !!params?.showGrid,
    showCellCenters: !!params?.showCellCenters,
    showNeighborCells: !!params?.showNeighborCells,
    autoCoreRadius: !!params?.autoCoreRadius,
    coreRadiusSigma: clampFinite(params?.coreRadiusSigma, 0.005, 1, 0.2),
    sigmaRatio: clampFinite(params?.sigmaRatio, 0.01, 0.5, 0.08),
    maxSigmaRatio: clampFinite(params?.maxSigmaRatio, 0.1, 1.0, 0.25),
    vorticityConfinementStrength: clampFinite(params?.vorticityConfinementStrength, -2, 2, 0.08),
    guidedStrength: clampFinite(params?.guidedStrength, 0, 1, 0.2),
    hybridPlusEnabled: params?.hybridPlusEnabled === true,
    hybridPlusCpuBaseAssistBackend:
      params?.hybridPlusCpuBaseAssistBackend === 'gpu' ? 'gpu' : 'cpu',
    hybridPlusAssistBudgetMs: clampFinite(params?.hybridPlusAssistBudgetMs, 0.1, 12, 2),
    hybridPlusAssistCadenceSteps: Math.max(
      1,
      Math.floor(clampFinite(params?.hybridPlusAssistCadenceSteps, 1, 32, 1)),
    ),
    hybridPlusAssistAdaptiveCadenceEnabled: params?.hybridPlusAssistAdaptiveCadenceEnabled !== false,
    hybridPlusAssistAdaptiveMaxCadenceSteps: Math.max(
      1,
      Math.floor(clampFinite(params?.hybridPlusAssistAdaptiveMaxCadenceSteps, 1, 64, 8)),
    ),
    hybridPlusAssistOverBudgetTolerancePct: clampFinite(
      params?.hybridPlusAssistOverBudgetTolerancePct,
      0,
      200,
      15,
    ),
    hybridPlusAssistIdleDeltaThreshold: Math.max(
      0,
      Math.floor(clampFinite(params?.hybridPlusAssistIdleDeltaThreshold, 0, 4096, 12)),
    ),
    hybridPlusTopologyCorrectionEnabled: params?.hybridPlusTopologyCorrectionEnabled !== false,
    hybridPlusTopologyThreshold: clampFinite(params?.hybridPlusTopologyThreshold, 0.01, 4, 0.18),
    hybridPlusTopologyStrength: clampFinite(params?.hybridPlusTopologyStrength, 0, 1, 0.25),
    hybridPlusTopologyMaxDelta: clampFinite(params?.hybridPlusTopologyMaxDelta, 0.001, 4, 0.12),
    hybridPlusTopologyMaxDeltas: Math.max(
      8,
      Math.floor(clampFinite(params?.hybridPlusTopologyMaxDeltas, 8, 4096, 512)),
    ),
    hybridPlusBarnesHutEnabled: params?.hybridPlusBarnesHutEnabled === true,
    hybridPlusBarnesHutAuto: params?.hybridPlusBarnesHutAuto !== false,
    hybridPlusFarFieldMethod: normalizeFarFieldMethod(params),
    hybridPlusBarnesHutAutoParticleThreshold: Math.max(
      64,
      Math.floor(clampFinite(params?.hybridPlusBarnesHutAutoParticleThreshold, 64, 50000, 1200)),
    ),
    hybridPlusBarnesHutAutoStepMsThreshold: clampFinite(
      params?.hybridPlusBarnesHutAutoStepMsThreshold,
      1,
      100,
      10,
    ),
    hybridPlusBarnesHutTheta: clampFinite(params?.hybridPlusBarnesHutTheta, 0.2, 1.2, 0.65),
    hybridPlusBarnesHutLeafSize: Math.max(
      4,
      Math.floor(clampFinite(params?.hybridPlusBarnesHutLeafSize, 4, 64, 16)),
    ),
    hybridPlusBarnesHutStrength: clampFinite(params?.hybridPlusBarnesHutStrength, 0, 1, 0.18),
    hybridPlusBarnesHutMaxDelta: clampFinite(params?.hybridPlusBarnesHutMaxDelta, 0.001, 3, 0.08),
    hybridPlusBarnesHutMaxDeltas: Math.max(
      8,
      Math.floor(clampFinite(params?.hybridPlusBarnesHutMaxDeltas, 8, 4096, 512)),
    ),
    hybridPlusBarnesHutSoftening: clampFinite(params?.hybridPlusBarnesHutSoftening, 1e-5, 2, 0.02),
    hybridPlusBarnesHutMinSpeed: clampFinite(params?.hybridPlusBarnesHutMinSpeed, 0, 2, 0.01),
    conserveCirculation: params?.conserveCirculation !== false,
    debugStability: !!params?.debugStability,
    uiLanguage: normalizeUiLanguage(params),

    cascadeEnabled: params?.cascadeEnabled === true,
    cascadeThreshold: clampFinite(params?.cascadeThreshold, 0, 1e6, 50),
    cascadeSplitFactor: Math.max(2, Math.min(4, Math.floor(clampFinite(params?.cascadeSplitFactor, 2, 4, 2)))),
    cascadeInterval: Math.max(1, Math.floor(clampFinite(params?.cascadeInterval, 1, 60, 5))),
    cascadeGridResolution: Math.max(8, Math.min(64, Math.floor(clampFinite(params?.cascadeGridResolution, 8, 64, 24)))),
    cascadeCellSizeMultiplier: clampFinite(params?.cascadeCellSizeMultiplier, 2, 20, 6),

    filamentCurvatureThreshold: clampFinite(params?.filamentCurvatureThreshold, 0.1, 100, 2),
    filamentStrainThreshold: clampFinite(params?.filamentStrainThreshold, 0.01, 100, 1),
    filamentInstabilityStrength: clampFinite(params?.filamentInstabilityStrength, 0, 1, 0),
    structureDetectionEnabled: params?.structureDetectionEnabled !== false,
    structureDetectionCellSize: clampFinite(params?.structureDetectionCellSize, 0.05, 2.5, 0.45),
    structureDetectionMinClusterSize: Math.max(
      4,
      Math.floor(clampFinite(params?.structureDetectionMinClusterSize, 4, 256, 16)),
    ),
    structureDetectionMaxSamples: Math.max(
      256,
      Math.floor(clampFinite(params?.structureDetectionMaxSamples, 256, 200000, 5000)),
    ),
    structureDetectionAutoCalibrate: params?.structureDetectionAutoCalibrate !== false,
    structureDetectionConfidenceTarget: clampFinite(
      params?.structureDetectionConfidenceTarget,
      0.3,
      0.95,
      0.62,
    ),
    structureDetectionEmaAlpha: clampFinite(params?.structureDetectionEmaAlpha, 0.05, 0.8, 0.2),
    structureDetectionFilamentElongationMin: clampFinite(
      params?.structureDetectionFilamentElongationMin,
      0.45,
      0.95,
      0.7,
    ),
    structureDetectionRingRadiusStdRatioMax: clampFinite(
      params?.structureDetectionRingRadiusStdRatioMax,
      0.08,
      0.6,
      0.28,
    ),
    structureDetectionTubeRadiusStdRatioMax: clampFinite(
      params?.structureDetectionTubeRadiusStdRatioMax,
      0.05,
      0.5,
      0.18,
    ),
    newtoniumTrackingEmaAlpha: clampFinite(params?.newtoniumTrackingEmaAlpha, 0.05, 0.8, 0.2),
    newtoniumTransitionEnterFrames: Math.max(
      1,
      Math.floor(clampFinite(params?.newtoniumTransitionEnterFrames, 1, 120, 3)),
    ),
    newtoniumTransitionConfidenceEnterMin: clampFinite(
      params?.newtoniumTransitionConfidenceEnterMin,
      0,
      1,
      0.56,
    ),
    newtoniumTransitionConfidenceExitMin: clampFinite(
      params?.newtoniumTransitionConfidenceExitMin,
      0,
      1,
      0.44,
    ),
    newtoniumTransitionGammaDriftMaxPct: clampFinite(
      params?.newtoniumTransitionGammaDriftMaxPct,
      0.1,
      200,
      8,
    ),
    newtoniumTransitionImpulseDriftMaxPct: clampFinite(
      params?.newtoniumTransitionImpulseDriftMaxPct,
      0.1,
      200,
      12,
    ),
    newtoniumTransitionEnergyDriftMaxPct: clampFinite(
      params?.newtoniumTransitionEnergyDriftMaxPct,
      0.1,
      200,
      10,
    ),
    energyDiagnosticsEnabled: params?.energyDiagnosticsEnabled !== false,
    energyDiagnosticsMaxSamples: Math.max(
      512,
      Math.floor(clampFinite(params?.energyDiagnosticsMaxSamples, 512, 250000, 8000)),
    ),
    energyDiagnosticsBinCount: Math.max(
      4,
      Math.min(8, Math.floor(clampFinite(params?.energyDiagnosticsBinCount, 4, 8, 8))),
    ),
    energyDiagnosticsMaxSpeedForBins: clampFinite(
      params?.energyDiagnosticsMaxSpeedForBins,
      0.5,
      30,
      8,
    ),
    energyDiagnosticsMaxVorticityForProxy: clampFinite(
      params?.energyDiagnosticsMaxVorticityForProxy,
      0.5,
      100,
      12,
    ),
    jetRollupPulseInterval: clampFinite(params?.jetRollupPulseInterval, 0, 60, 0.25),
    jetRollupPulseStrength: clampFinite(params?.jetRollupPulseStrength, 0, 3, 1),
    jetRollupNoiseAmplitude: clampFinite(params?.jetRollupNoiseAmplitude, 0, 2, 0.05),
    jetRollupEdgeVorticity: clampFinite(params?.jetRollupEdgeVorticity, 0, 2, 0.2),
    jetRollupStrokeLength: clampFinite(params?.jetRollupStrokeLength, 0, 30, 0),
    jetRollupEdgeThreshold: clampFinite(params?.jetRollupEdgeThreshold, 0.4, 0.98, 0.7),
    jetRollupAutoTuneEnabled: params?.jetRollupAutoTuneEnabled !== false,

    particleColorByCascadeLevel: !!params?.particleColorByCascadeLevel,
    filamentColorByCurvature: !!params?.filamentColorByCurvature,
    filamentColorByStrainRate: !!params?.filamentColorByStrainRate,
  }
}

export function cloneSimulationParams(params = {}) {
  const normalized = normalizeSimulationParams(params)

  return {
    ...normalized,
    camera: normalized.camera ? { ...normalized.camera } : undefined,
    nozzle: {
      radius: normalized.nozzle.radius,
      position: { ...normalized.nozzle.position },
      direction: { ...normalized.nozzle.direction },
    },
    multiEmitters: Array.isArray(normalized.multiEmitters)
      ? normalized.multiEmitters.map((emitter) => ({
          ...emitter,
        }))
      : [],
  }
}
