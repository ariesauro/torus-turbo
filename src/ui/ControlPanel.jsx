import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getFormationNumber,
} from '../simulation/physics/emission/shared'
import {
  getEffectiveRingResolution,
  getRingResolutionMultiplier,
  normalizeRingResolutionToUi,
} from '../simulation/physics/runtime/ringResolution'
import {
  MAX_MULTI_EMITTERS,
  normalizeMultiEmitterConfig,
} from '../simulation/physics/emission/multiEmitter'
import {
  BUILTIN_PERFORMANCE_PROFILES,
  createCustomProfileFromParams,
  detectHardwareProfile,
  getBuiltinPerformanceProfile,
  getRepresentationPolicyPatchForHardwareClass,
  loadCustomPerformanceProfiles,
  saveCustomPerformanceProfiles,
} from '../simulation/performance/hardwareProfiles'
import { runHardwareAutoCalibration } from '../simulation/performance/hardwareCalibration'
import {
  buildAdaptiveAcceptanceMatrixReport,
  buildExperimentArtifactPayload,
  buildLabArtifactFileName,
  buildExperimentSummaryRows,
  buildExperimentSummaryCsv,
} from '../simulation/lab/labArtifacts'
import {
  appendLabArtifactIndex,
  appendLabRunHistory,
  loadLabArtifactIndex,
  loadLabExperiments,
  loadLabRunHistory,
  upsertLabExperiment,
} from '../simulation/lab/labStorage'
import { validateExperimentContract } from '../simulation/lab/experimentSchema'
import {
  applyLabExperimentOverrides,
  createLabPresetById,
  getLabPresetOptions,
  runLabExperimentInRuntime,
} from '../simulation/lab/runtimeLabRunner'
import { getScalePresetById, getScalePresetOptions } from '../simulation/scaling/nondimensionalScaling'
import {
  buildScientificSnapshotBundle,
  buildScientificExportValidationReport,
  buildScientificFfmpegTranscodePlan,
  buildScientificSnapshotSequenceManifest,
} from '../simulation/visualization/scientificSnapshot'
import { buildTopologyEventsCsv } from '../simulation/structures/topologyTracking'
import { useSimulationStore } from '../state/simulationStore'
import { DisclosureSection, InlineDisclosure } from './controls/disclosure'
import { CheckboxField, ColorField, HintTooltip, RangeField, SelectField } from './controls/fields'
import { CONTROL_PANEL_MESSAGES, getMessage } from './i18n/controlPanelMessages'
import {
  getExecutionOptionsForMode,
  getExecutionRestrictionHintKeys,
  getRepresentationOptionsForMode,
  getRepresentationRestrictionHintKey,
} from './modeConstraints'
import { buildRuntimeDiagnosticsViewModel } from './runtimeDiagnosticsViewModel'
import { buildStabilityViewModel } from './stabilityViewModel'
import AboutModal from './AboutModal'
import FpsCounter from './FpsCounter'

function isTextEntryTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName.toLowerCase()
  if (tagName === 'textarea' || target.isContentEditable) {
    return true
  }
  if (tagName !== 'input') {
    return false
  }
  const input = /** @type {HTMLInputElement} */ (target)
  const type = (input.type || 'text').toLowerCase()
  // Keep typing-friendly behavior for text-like inputs only.
  return (
    type === 'text' ||
    type === 'search' ||
    type === 'url' ||
    type === 'email' ||
    type === 'password' ||
    type === 'tel' ||
    type === 'number'
  )
}

function formatLabValidationErrors(errors = []) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return ''
  }
  const clipped = errors
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0)
    .slice(0, 4)
  if (clipped.length === 0) {
    return ''
  }
  return clipped.join(' | ')
}

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return 0
  }
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

export default function ControlPanel() {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [showCollapsedHandle, setShowCollapsedHandle] = useState(false)
  const [importError, setImportError] = useState('')
  const [customPerformanceProfiles, setCustomPerformanceProfiles] = useState([])
  const [hardwareDetectBusy, setHardwareDetectBusy] = useState(false)
  const [showFilamentEmergencyControls, setShowFilamentEmergencyControls] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [panelOpacity, setPanelOpacity] = useState(92)
  const [showFps, setShowFps] = useState(false)
  const [labRunBusy, setLabRunBusy] = useState(false)
  const [labRunProgress, setLabRunProgress] = useState(0)
  const [labRunStatus, setLabRunStatus] = useState('')
  const [labRunError, setLabRunError] = useState('')
  const [labRunResult, setLabRunResult] = useState(null)
  const [labPresetId, setLabPresetId] = useState('vortex_ring_collision')
  const [labMaxRuns, setLabMaxRuns] = useState(4)
  const [labWarmupSec, setLabWarmupSec] = useState(1.5)
  const [labDurationSec, setLabDurationSec] = useState(8)
  const [labSampleMs, setLabSampleMs] = useState(300)
  const [labSweepMin, setLabSweepMin] = useState('')
  const [labSweepMax, setLabSweepMax] = useState('')
  const [labScaleEnabled, setLabScaleEnabled] = useState(false)
  const [labScaleApplyRuntime, setLabScaleApplyRuntime] = useState(false)
  const [labScalePresetId, setLabScalePresetId] = useState('custom')
  const [labScaleClass, setLabScaleClass] = useState('lab')
  const [labScaleRe, setLabScaleRe] = useState(4500)
  const [labScaleSt, setLabScaleSt] = useState(0.22)
  const [labExperimentName, setLabExperimentName] = useState('Lab Experiment')
  const [labSavedExperiments, setLabSavedExperiments] = useState([])
  const [labSavedExperimentId, setLabSavedExperimentId] = useState('')
  const [labRunHistory, setLabRunHistory] = useState([])
  const [labArtifactIndex, setLabArtifactIndex] = useState([])
  const [vizExportStatus, setVizExportStatus] = useState('')
  const [vizPhotoBurstCount, setVizPhotoBurstCount] = useState(6)
  const [vizPhotoBurstBusy, setVizPhotoBurstBusy] = useState(false)
  const [vizMp4FrameCount, setVizMp4FrameCount] = useState(24)
  const [vizMp4Fps, setVizMp4Fps] = useState(30)
  const [vizMp4CaptureBusy, setVizMp4CaptureBusy] = useState(false)
  const [vizTimeline, setVizTimeline] = useState([])
  const [labSelectedHistoryId, setLabSelectedHistoryId] = useState('')
  const [labCompareHistoryId, setLabCompareHistoryId] = useState('')
  const [labInspectRunIndex, setLabInspectRunIndex] = useState(0)
  const [labUseJsonEditor, setLabUseJsonEditor] = useState(false)
  const [labExperimentJson, setLabExperimentJson] = useState('')
  const [labExperimentJsonError, setLabExperimentJsonError] = useState('')
  const jsonInputRef = useRef(null)
  const autoProfileInitDoneRef = useRef(false)
  const vizLastCaptureSecRef = useRef(-1)
  const params = useSimulationStore((state) => state.params)
  const setParam = useSimulationStore((state) => state.setParam)
  const setParams = useSimulationStore((state) => state.setParams)
  const resetScene = useSimulationStore((state) => state.resetScene)
  const singlePulse = useSimulationStore((state) => state.singlePulse)
  const startPulseTrain = useSimulationStore((state) => state.startPulseTrain)
  const stopPulseTrain = useSimulationStore((state) => state.stopPulseTrain)
  const saveCurrentConfig = useSimulationStore((state) => state.saveCurrentConfig)
  const loadSavedConfig = useSimulationStore((state) => state.loadSavedConfig)
  const exportSceneToJson = useSimulationStore((state) => state.exportSceneToJson)
  const importSceneFromJson = useSimulationStore((state) => state.importSceneFromJson)
  const resetParamsToDefault = useSimulationStore((state) => state.resetParamsToDefault)
  const applyNaturalPreset = useSimulationStore((state) => state.applyNaturalPreset)
  const stabilityStats = useSimulationStore((state) => state.stabilityStats)
  const filamentStats = useSimulationStore((state) => state.filamentStats)
  const isScriptedMode = params.dynamicsMode === 'scripted'
  const isClassicPhysicsMode = params.dynamicsMode === 'fullPhysics'
  const isNaturalMode = params.dynamicsMode === 'guidedPhysics'
  const isPhysicsMode = isClassicPhysicsMode || isNaturalMode
  const uiLanguage = params.uiLanguage === 'en' ? 'en' : 'ru'
  const t = (key) => getMessage(CONTROL_PANEL_MESSAGES, key, uiLanguage)
  const withNaturalBadge = (label) => (
    <span className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      <span className="inline-flex items-center rounded border border-cyan-500/70 bg-cyan-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
        {t('natural_modifier_badge')}
      </span>
    </span>
  )
  const labPresetOptions = getLabPresetOptions().map((option) => ({
    value: option.value,
    label: t(`lab_preset_option_${option.value}`),
  }))
  const scalePresetOptions = getScalePresetOptions().map((option) => ({
    value: option.value,
    label: option.value === 'custom' ? t('lab_scale_preset_custom') : option.label,
  }))
  const physicalBoundaryModeOptions = [
    { value: 'planes', label: t('runtime_physical_boundary_mode_planes') },
    { value: 'spheres', label: t('runtime_physical_boundary_mode_spheres') },
    { value: 'meshes', label: t('runtime_physical_boundary_mode_meshes') },
  ]
  const physicalIntegrationOrderOptions = [
    { value: 'canonical', label: t('runtime_physical_integration_canonical') },
    { value: 'boundary_first', label: t('runtime_physical_integration_boundary_first') },
    { value: 'diffusion_first', label: t('runtime_physical_integration_diffusion_first') },
  ]
  const executionOptions = getExecutionOptionsForMode(params.dynamicsMode, t)
  const representationOptions = getRepresentationOptionsForMode(
    params.dynamicsMode,
    params.executionMode,
    t,
  )
  const representationRestrictionHintKey = getRepresentationRestrictionHintKey(
    params.dynamicsMode,
    params.executionMode,
  )
  const executionRestrictionHintKeys = getExecutionRestrictionHintKeys(params.dynamicsMode)
  const runtimeDiagnosticsViewModel = buildRuntimeDiagnosticsViewModel(params, t)
  const stabilityViewModel = buildStabilityViewModel(stabilityStats)
  const {
    runtimeBackendLabel,
    runtimeParticleRenderBackendLabel,
    runtimeParticleRenderPolicyLabel,
    runtimeParticleRenderFallbackReasonLabel,
    runtimeRenderPolicyModeLabel,
    runtimeRenderLodTierLabel,
    runtimeTransitionStateLabel,
    runtimeTransitionCandidateType,
    runtimeTransitionPendingFrames,
    runtimeTransitionCandidates,
    runtimeTransitionCommitted,
    runtimeTransitionRejected,
    runtimeTransitionGammaDriftPct,
    runtimeTransitionImpulseDriftPct,
    runtimeTransitionEnergyDriftPct,
    runtimeTransitionGateConfidenceOk,
    runtimeTransitionGateInvariantOk,
    runtimeTransitionGateHysteresisOk,
    runtimeTransitionGateReason,
    runtimeTransitionEnterFrames,
    runtimeTransitionConfidenceEnterMin,
    runtimeTransitionConfidenceExitMin,
    runtimeRingValidationVersion,
    runtimeRingValidationValid,
    runtimeRingValidationVerdictLabel,
    runtimeRingValidationAcceptanceScore,
    runtimeRingValidationGatePassCount,
    runtimeRingValidationGateTotal,
    runtimeRingValidationTransitionCommitRatio,
    runtimeJetRegimeVersion,
    runtimeJetRegimeValid,
    runtimeJetRegimeVerdictLabel,
    runtimeJetRegimeType,
    runtimeJetRegimeAcceptanceScore,
    runtimeJetRegimeGatePassCount,
    runtimeJetRegimeGateTotal,
    runtimeJetRegimeReProxy,
    runtimeJetRegimeStProxy,
    runtimeJetRegimeLdProxy,
    runtimeJetRegimeRingDominance,
    runtimeJetRegimeWakeIndex,
    runtimeDetectedSheetCount,
    runtimeDetectionSheetSurfaceCoherence,
    runtimeDetectionSheetCurvatureAnisotropy,
    runtimeDetectionClassConfidenceFilament,
    runtimeDetectionClassConfidenceRing,
    runtimeDetectionClassConfidenceTube,
    runtimeDetectionClassConfidenceSheet,
    runtimeDetectorFusionVersion,
    runtimeDetectorFusionValid,
    runtimeDetectorFusionVerdictLabel,
    runtimeDetectorFusionAcceptanceScore,
    runtimeDetectorFusionGatePassCount,
    runtimeDetectorFusionGateTotal,
    runtimeDetectorFusionWeightedScore,
    runtimeTopologyVersion,
    runtimeTopologyValid,
    runtimeTopologyFrameSerial,
    runtimeTopologyEventCount,
    runtimeTopologyNodeCount,
    runtimeTopologyEdgeCount,
    runtimeTopologyBirthCount,
    runtimeTopologyDecayCount,
    runtimeTopologyMergeCount,
    runtimeTopologySplitCount,
    runtimeTopologyReconnectionCount,
    runtimeTopologyLatestEventType,
    runtimeTopologyLatestEventConfidence,
    runtimeTopologyLatestEventFrame,
    runtimeRenderScoreParticles,
    runtimeRenderScoreFilaments,
    runtimeRenderScoreSheets,
    runtimeRenderScoreCurrent,
    runtimeRenderScoreMargin,
    runtimeRenderScoreBestModeLabel,
    runtimeRenderHysteresisHoldSteps,
    runtimeRenderHysteresisRemaining,
    runtimeRenderOverrideReasonLabel,
    runtimeRenderHealthFallbackRate,
    runtimeRenderHealthTimeoutRate,
    runtimeRenderHealthDriftSeverity,
    runtimeRenderDiagnosticsConfidence,
    runtimeRenderDiagnosticsUncertainty,
    runtimeRenderUncertaintyDetectorGap,
    runtimeRenderUncertaintyFallback,
    runtimeRenderUncertaintyTopologyVolatility,
    runtimeRenderSheetPanelCount,
    runtimeRenderSheetCoverage,
    runtimeRenderSheetReadiness,
    runtimeRenderSheetQuadratureOrder,
    runtimeRenderSheetDesingularizationEpsilon,
    runtimeRenderSheetProfileId,
    runtimeRenderSheetQuadratureProfile,
    runtimeRenderSheetMeshSeed,
    runtimeRenderSheetMeshTopology,
    runtimeRenderSheetMeshPatchCount,
    runtimeRenderSheetPanelAspectP95,
    runtimeRenderSheetQualityGatePassCount,
    runtimeRenderSheetQualityGateTotal,
    runtimeRenderSheetQualityPenalty,
    runtimeRenderSheetQualityVerdictLabel,
    runtimeRenderSheetMeshDeterministic,
    runtimeRenderSheetMeshLayoutDigest,
    runtimeRenderSheetMeshPatchMinPanels,
    runtimeRenderSheetMeshPatchMaxPanels,
    runtimeRenderSheetMeshPatchImbalance,
    runtimeRenderSheetMeshContractVersion,
    runtimeRenderSheetMeshContractValid,
    runtimeRenderSheetMeshContractIssueCount,
    runtimeRenderSheetMeshContractGatePassCount,
    runtimeRenderSheetMeshContractGateTotal,
    runtimeRenderSheetMeshContractVerdictLabel,
    runtimeRenderSheetMeshContractPenalty,
    runtimeRenderSheetMeshPatchAreaMean,
    runtimeRenderSheetMeshPatchAreaCv,
    runtimeRenderSheetMeshEdgeLengthRatioP95,
    runtimeRenderSheetMeshCurvatureProxyP95,
    runtimeRenderSheetCouplingVersion,
    runtimeRenderSheetCouplingValid,
    runtimeRenderSheetCouplingVerdictLabel,
    runtimeRenderSheetCouplingPenalty,
    runtimeRenderSheetCouplingAmerStateLabel,
    runtimeRenderSheetCouplingAmerTransferBudget,
    runtimeRenderSheetCouplingAmerInvariantDriftCapPct,
    runtimeRenderSheetCouplingFilamentStateLabel,
    runtimeRenderSheetCouplingFilamentNodeTransferCap,
    runtimeRenderSheetCouplingFilamentLoad,
    runtimeRenderSheetRollupStabilityGuardLabel,
    runtimeRenderSheetPlaceholder,
    runtimeOverlayConfidenceComposite,
    runtimeOverlayUncertaintyComposite,
    runtimeOverlayUncertaintyDetector,
    runtimeOverlayUncertaintyTopology,
    runtimeOverlayUncertaintyRender,
    runtimeGpuSyncPolicyLabel,
    runtimeGpuSyncReasonLabel,
    runtimeGpuSyncViolationCount,
    runtimeGpuSyncLastReadbackReasonLabel,
    particlesBackendLabel,
    filamentsBackendLabel,
    activePipelineLabel,
    currentDynamicsModeLabel,
    currentExecutionModeLabel,
    currentRepresentationLabel,
    runtimeGpuFullReadbackCount,
    runtimeGpuSkippedReadbackCount,
    runtimeGpuReadbackFullRatioPercent,
    runtimeGpuReadbackRatioTone,
    runtimeGpuReadbackStatus,
    runtimeGpuOverflowCount,
    runtimeGpuCollisionCount,
    runtimeGpuCollisionRatioPercent,
    runtimeGpuHashLoadFactorPercent,
    runtimeGpuDispatchCount,
    runtimeGpuGridBuildCount,
    runtimeGpuOccupiedBucketCount,
    runtimeGpuHashTableSize,
    runtimeGpuAdaptiveHashTableSize,
    runtimeGpuBucketCapacity,
    runtimeGpuAdaptiveBucketCapacity,
    runtimeGpuOverflowCooldown,
    runtimeGpuLowPressureStreak,
    runtimeGpuAdaptiveEventDispatchSerial,
    runtimeGpuOverflowCriticalStreak,
    runtimeGpuOverflowProtectionActive,
    runtimeGpuOverflowProtectionCooldown,
    runtimeGpuOverflowProtectionLastActionLabel,
    runtimeGpuQualityGuardActive,
    runtimeGpuQualityGuardApplyActive,
    runtimeGpuQualityGuardLevelLabel,
    runtimeGpuQualityGuardCompatibilityLabel,
    runtimeGpuQualityGuardGuidedScale,
    runtimeGpuQualityGuardStretchingScale,
    runtimeGpuQualityGuardHighStepStreak,
    runtimeGpuQualityGuardLowStepStreak,
    runtimeGpuQualityGuardLastActionLabel,
    runtimeGpuAdaptiveEventTypeLabel,
    runtimeGpuAdaptiveEventReasonLabel,
    runtimeGpuOverflowTone,
    runtimeTotalSteps,
    runtimeStabilityAutoCorrectionPer1kSteps,
    runtimeStabilityAutoCorrectionPressureTone,
    runtimeStabilityAutoCorrectionPressureLabel,
  } = runtimeDiagnosticsViewModel
  const gpuAutoQualityGuardMode =
    params.gpuAutoQualityGuardMode === 'moderate' ? 'moderate' : 'minimal'
  const gpuAutoQualityGuardScope =
    params.gpuAutoQualityGuardScope === 'monitor_only' ? 'monitor_only' : 'apply_supported_only'
  const {
    sigmaMonitorTone,
    circulationDriftTone,
    sigmaOverRText,
    totalCirculationText,
    circulationDriftPercentText,
    particleCountText,
    avgSigmaText,
    tiltProxyDegText,
    ringCoherenceText,
    ringMajorMeasuredText,
    ringMinorMeasuredText,
    hybridParticleCirculationText,
    hybridFilamentCirculationText,
    hybridTotalCirculationText,
    hybridCirculationDriftPercentText,
    hybridParticleCountText,
    hybridFilamentCountText,
    hybridCenterOffsetText,
    hybridAxialOffsetText,
    hybridParticleCenterStepText,
    hybridFilamentCenterStepText,
    hybridRadiusOffsetText,
    hybridFilamentRadiusDriftPercentText,
    hybridFilamentMeanRadiusText,
    hybridFilamentArcLengthText,
    hybridFilamentArcLengthDriftPercentText,
  } = stabilityViewModel
  const stabilityActionLabelByKey = {
    none: t('gpu_overflow_action_none'),
    reduce_time_scale: t('runtime_stability_action_reduce_time_scale'),
    reduce_spawn_rate_stability: t('runtime_stability_action_reduce_spawn_rate'),
    increase_spawn_rate_stability: t('runtime_stability_action_increase_spawn_rate'),
    filament_remesh_refine: t('runtime_stability_action_remesh_refine'),
    filament_remesh_coarsen: t('runtime_stability_action_remesh_coarsen'),
    reduce_guided_strength_stability: t('runtime_stability_action_reduce_guided_strength'),
    reduce_stretching_strength_stability: t('runtime_stability_action_reduce_stretching_strength'),
    reduce_vorticity_confinement_stability: t(
      'runtime_stability_action_reduce_vorticity_confinement',
    ),
    autocorrection_saturation_guard: t('runtime_stability_action_saturation_guard'),
  }
  const runtimeStabilityLastActionKey = String(
    params.runtimeStabilityAutoCorrectionLastAction ?? 'none',
  )
  const runtimeStabilityLastActionLabel =
    stabilityActionLabelByKey[runtimeStabilityLastActionKey] ?? runtimeStabilityLastActionKey
  const runtimeStabilityAutoCorrectionTimeline = Array.isArray(
    params.runtimeStabilityAutoCorrectionTimeline,
  )
    ? params.runtimeStabilityAutoCorrectionTimeline
        .slice(-6)
        .reverse()
        .map((entry) => {
          const value = String(entry)
          const separatorIndex = value.indexOf(':')
          if (separatorIndex <= 0) {
            return value
          }
          const step = value.slice(0, separatorIndex)
          const actionKey = value.slice(separatorIndex + 1)
          const actionLabel = stabilityActionLabelByKey[actionKey] ?? actionKey
          return `#${step} ${actionLabel}`
        })
    : []
  const activeFallbackChips = []
  if (params.filamentCenterLockEnabled === true) {
    activeFallbackChips.push({
      label: t('fallback_item_filament_center_lock'),
      toneClass: 'bg-amber-500/20 text-amber-200',
    })
  }
  if ((params.runtimeStabilityAutoCorrectionLastAction ?? 'none') !== 'none') {
    activeFallbackChips.push({
      label: t('fallback_item_stability_autocorrection'),
      toneClass: 'bg-cyan-500/20 text-cyan-200',
    })
  }
  if (params.runtimeGpuQualityGuardActive === true) {
    activeFallbackChips.push({
      label: t('fallback_item_gpu_quality_guard'),
      toneClass: 'bg-amber-500/20 text-amber-200',
    })
  }
  if (params.runtimeGpuOverflowCriticalActive === true) {
    activeFallbackChips.push({
      label: t('fallback_item_gpu_overflow_protection'),
      toneClass: 'bg-rose-500/20 text-rose-200',
    })
  }
  if (params.runtimeParticleRenderBackend === 'cpu') {
    activeFallbackChips.push({
      label: t('fallback_item_cpu_render_fallback'),
      toneClass: 'bg-rose-500/20 text-rose-200',
    })
  }
  const hasActiveFallbacks = activeFallbackChips.length > 0
  const formationNumber = getFormationNumber(params)
  const emissionCouplingMode = params.emissionCouplingMode ?? 'free'
  const lockPulseDuration = emissionCouplingMode === 'lockPulseDuration'
  const lockJetSpeed = emissionCouplingMode === 'lockJetSpeed'
  const lockFormation = emissionCouplingMode === 'lockFormation'
  const uiRingResolution = normalizeRingResolutionToUi(params.ringResolution)
  const ringResolutionMultiplier = getRingResolutionMultiplier(params)
  const effectiveRingResolution = getEffectiveRingResolution(params)
  const isRingBasedEmission =
    params.emissionMode === 'vortexRing' ||
    params.emissionMode === 'vortexKnot' ||
    params.emissionMode === 'tube'
  const isJetRollupEmission = params.emissionMode === 'jetRollup'
  const hybridMismatch =
    params.executionMode === 'hybrid' &&
    (params.vortexRepresentation !== 'hybrid' ||
      params.dynamicsMode === 'scripted')
  const naturalHybridFilamentMode =
    isNaturalMode &&
    params.executionMode === 'hybrid' &&
    params.vortexRepresentation === 'hybrid'
  const vectorDisplayMode =
    params.vectorDisplayMode === 'vectors' || params.vectorDisplayMode === 'both'
      ? params.vectorDisplayMode
      : params.vectorDisplayMode === 'particles'
        ? 'particles'
        : params.showBoth
          ? 'both'
          : params.showVectors
            ? 'vectors'
            : 'particles'
  const allPerformanceProfiles = [
    ...BUILTIN_PERFORMANCE_PROFILES.map((profile) => ({
      id: profile.id,
      label: t(profile.labelKey),
      description: t(profile.descriptionKey),
      paramsPatch: profile.paramsPatch,
      custom: false,
    })),
    ...customPerformanceProfiles.map((profile) => ({
      id: profile.id,
      label: `${profile.name} (${t('perf_profile_custom')})`,
      description: t('perf_profile_custom_desc'),
      paramsPatch: profile.paramsPatch,
      custom: true,
    })),
  ]
  const selectedPerformanceProfileId =
    typeof params.performanceProfileId === 'string' ? params.performanceProfileId : 'auto_balanced'
  const selectedPerformanceProfile =
    allPerformanceProfiles.find((profile) => profile.id === selectedPerformanceProfileId) ?? null
  const filamentEmergencyControlsVisible =
    showFilamentEmergencyControls || params.filamentCenterLockEnabled === true
  const fallbackParamTolerance = 1e-6
  const filamentFallbackDeviationReasons = []
  const isFilamentVelocityScaleDefault =
    Math.abs((params.filamentVelocityScale ?? 0.05) - 0.05) <= fallbackParamTolerance
  if (!isFilamentVelocityScaleDefault) {
    filamentFallbackDeviationReasons.push(t('filament_fallback_reason_velocity_scale'))
  }
  const isFilamentMultiVelocityFactorDefault =
    Math.abs((params.filamentMultiFilamentVelocityFactor ?? 1) - 1) <= fallbackParamTolerance
  if (!isFilamentMultiVelocityFactorDefault) {
    filamentFallbackDeviationReasons.push(t('filament_fallback_reason_multi_velocity'))
  }
  const isFilamentCenterLockGainDefault =
    Math.abs((params.filamentCenterLockGain ?? 0.08) - 0.08) <= fallbackParamTolerance
  if (!isFilamentCenterLockGainDefault) {
    filamentFallbackDeviationReasons.push(t('filament_fallback_reason_lock_gain'))
  }
  const isFilamentCenterLockMaxShiftDefault =
    Math.abs((params.filamentCenterLockMaxShiftRatio ?? 0.15) - 0.15) <= fallbackParamTolerance
  if (!isFilamentCenterLockMaxShiftDefault) {
    filamentFallbackDeviationReasons.push(t('filament_fallback_reason_lock_shift'))
  }
  const filamentFallbackModeActive =
    params.filamentCenterLockEnabled === true || filamentFallbackDeviationReasons.length > 0
  const hardwareClassKey = `performance_hardware_class_${params.performanceHardwareClass ?? 'unknown'}`
  const clampJetSpeed = (value) => Math.max(0.05, Math.min(60, Number.isFinite(value) ? value : 3))
  const clampPulseDuration = (value) =>
    Math.max(0.05, Math.min(60, Number.isFinite(value) ? value : 0.05))
  const nozzleDiameter = Math.max((params.nozzleRadius ?? 0.5) * 2, 1e-4)
  const nozzlePosition = {
    x: params.nozzle?.position?.x ?? 0,
    y: params.nozzle?.position?.y ?? 0,
    z: params.nozzle?.position?.z ?? params.nozzleZ ?? params.nozzleX ?? 0,
  }
  const currentSlugLength = Math.max(params.jetSpeed ?? 0, 0) * Math.max(params.pulseDuration ?? 0, 0)
  const resolveNozzleAxis = (direction) => {
    const x = Number(direction?.x ?? 0) || 0
    const y = Number(direction?.y ?? 0) || 0
    const z = Number(direction?.z ?? 1) || 1
    const ax = Math.abs(x)
    const ay = Math.abs(y)
    const az = Math.abs(z)
    if (ax >= ay && ax >= az) return x >= 0 ? '+x' : '-x'
    if (ay >= ax && ay >= az) return y >= 0 ? '+y' : '-y'
    return z >= 0 ? '+z' : '-z'
  }
  const axisToDirection = (axis) => {
    switch (axis) {
      case '+x':
        return { x: 1, y: 0, z: 0 }
      case '-x':
        return { x: -1, y: 0, z: 0 }
      case '+y':
        return { x: 0, y: 1, z: 0 }
      case '-y':
        return { x: 0, y: -1, z: 0 }
      case '-z':
        return { x: 0, y: 0, z: -1 }
      case '+z':
      default:
        return { x: 0, y: 0, z: 1 }
    }
  }
  const nozzleAxis = resolveNozzleAxis(params.nozzle?.direction)
  const setNozzlePosition = (patch) => {
    setParam('nozzle', {
      ...(params.nozzle ?? {}),
      position: { ...nozzlePosition, ...patch },
    })
  }
  const handleNozzleAxisChange = (axis) => {
    const currentNozzle = params.nozzle ?? {}
    const currentRadius = currentNozzle.radius ?? params.nozzleRadius ?? 0.5
    const dir = axisToDirection(axis)
    const offset = -3 * currentRadius
    const newPosition = {
      x: dir.x !== 0 ? dir.x * offset : 0,
      y: dir.y !== 0 ? dir.y * offset : 0,
      z: dir.z !== 0 ? dir.z * offset : 0,
    }
    setParam('nozzle', {
      ...currentNozzle,
      radius: currentRadius,
      position: newPosition,
      direction: dir,
    })
  }
  const configuredStrokeLength = Math.max(params.jetRollupStrokeLength ?? 0, 0)
  const effectiveStrokeLength =
    configuredStrokeLength > 1e-8
      ? Math.min(configuredStrokeLength, currentSlugLength)
      : currentSlugLength
  const effectiveFormationNumber = effectiveStrokeLength / nozzleDiameter
  const jetRollupEnvelopeStatus =
    effectiveFormationNumber <= 3.6
      ? t('jet_rollup_envelope_within')
      : effectiveFormationNumber <= 4
        ? t('jet_rollup_envelope_near_limit')
        : t('jet_rollup_envelope_overdriven')
  const jetRollupGuardClassName =
    effectiveFormationNumber <= 3.6
      ? 'border-blue-500/40 bg-blue-900/20 text-blue-200'
      : effectiveFormationNumber <= 4
        ? 'border-amber-500/40 bg-amber-900/20 text-amber-200'
        : 'border-rose-500/40 bg-rose-900/20 text-rose-200'
  const multiEmitter = normalizeMultiEmitterConfig(params)
  const updateMultiEmitterAt = (index, patch) => {
    const next = Array.isArray(params.multiEmitters)
      ? params.multiEmitters.map((item) => ({ ...(item ?? {}) }))
      : []
    while (next.length < MAX_MULTI_EMITTERS) {
      next.push({})
    }
    next[index] = {
      ...(next[index] ?? {}),
      ...patch,
    }
    setParam('multiEmitters', next)
  }

  const handleJetSpeedChange = (value) => {
    if (lockJetSpeed) {
      return
    }
    const nextJetSpeed = clampJetSpeed(value)
    if (lockFormation) {
      const nextPulseDuration = clampPulseDuration(currentSlugLength / Math.max(nextJetSpeed, 1e-4))
      setParams({ jetSpeed: nextJetSpeed, pulseDuration: nextPulseDuration })
      return
    }
    setParam('jetSpeed', nextJetSpeed)
  }

  const handlePulseDurationChange = (value) => {
    if (lockPulseDuration) {
      return
    }
    const nextPulseDuration = clampPulseDuration(value)
    if (lockFormation) {
      const nextJetSpeed = clampJetSpeed(currentSlugLength / Math.max(nextPulseDuration, 1e-4))
      setParams({ pulseDuration: nextPulseDuration, jetSpeed: nextJetSpeed })
      return
    }
    setParam('pulseDuration', nextPulseDuration)
  }

  const handleResetScene = useCallback(() => {
    resetScene()
  }, [resetScene])

  const handleResetParamsToDefault = () => {
    if (window.confirm(t('restore_all_default_parameters'))) {
      resetParamsToDefault()
      setImportError('')
    }
  }

  const applyPerformanceProfile = useCallback(
    (profileId, { keepAuto = false } = {}) => {
      const builtin = getBuiltinPerformanceProfile(profileId)
      const custom = customPerformanceProfiles.find((profile) => profile.id === profileId) ?? null
      const profilePatch = builtin?.paramsPatch ?? custom?.paramsPatch ?? null
      if (!profilePatch) {
        return
      }
      setParams({
        ...profilePatch,
        performanceProfileId: profileId,
        performanceAutoProfileEnabled: keepAuto ? params.performanceAutoProfileEnabled === true : false,
      })
      setImportError('')
    },
    [customPerformanceProfiles, params.performanceAutoProfileEnabled, setParams],
  )

  const runHardwareDetection = useCallback(async () => {
    setHardwareDetectBusy(true)
    try {
      const detection = await detectHardwareProfile()
      const patch = {
        performanceHardwareClass: detection.hardwareClass,
        performanceHardwareSummary: detection.summary,
        ...(detection.representationPolicyPatch ??
          getRepresentationPolicyPatchForHardwareClass(detection.hardwareClass)),
      }
      if (params.performanceAutoProfileEnabled === true) {
        const recommended = getBuiltinPerformanceProfile(detection.recommendedProfileId)
        setParams({
          ...patch,
          ...(recommended?.paramsPatch ?? {}),
          performanceProfileId: detection.recommendedProfileId,
        })
      } else {
        setParams(patch)
      }
    } finally {
      setHardwareDetectBusy(false)
    }
  }, [params.performanceAutoProfileEnabled, setParams])

  const applyRecommendedHardwareProfile = useCallback(async () => {
    setHardwareDetectBusy(true)
    try {
      const detection = await detectHardwareProfile()
      const recommended = getBuiltinPerformanceProfile(detection.recommendedProfileId)
      setParams({
        performanceHardwareClass: detection.hardwareClass,
        performanceHardwareSummary: detection.summary,
        ...(detection.representationPolicyPatch ??
          getRepresentationPolicyPatchForHardwareClass(detection.hardwareClass)),
        ...(recommended?.paramsPatch ?? {}),
        performanceProfileId: detection.recommendedProfileId,
        performanceAutoProfileEnabled: false,
      })
    } finally {
      setHardwareDetectBusy(false)
    }
  }, [setParams])

  const handleSaveCustomPerformanceProfile = () => {
    const defaultName = `${t('perf_profile_custom')} ${customPerformanceProfiles.length + 1}`
    const name = window.prompt(t('perf_profile_custom_prompt'), defaultName)
    if (!name) {
      return
    }
    const next = createCustomProfileFromParams(name, params)
    if (!next) {
      return
    }
    const withoutSameId = customPerformanceProfiles.filter((profile) => profile.id !== next.id)
    const merged = [...withoutSameId, next]
    setCustomPerformanceProfiles(merged)
    saveCustomPerformanceProfiles(merged)
    setParams({
      performanceProfileId: next.id,
      performanceAutoProfileEnabled: false,
    })
  }

  const handleCloneSelectedPerformanceProfile = () => {
    if (!selectedPerformanceProfile) {
      return
    }
    const defaultName = `${selectedPerformanceProfile.label} copy`
    const name = window.prompt(t('perf_profile_custom_prompt'), defaultName)
    if (!name) {
      return
    }
    const profilePatch = selectedPerformanceProfile.paramsPatch ?? null
    if (!profilePatch) {
      return
    }
    const next = createCustomProfileFromParams(name, {
      ...params,
      ...profilePatch,
    })
    if (!next) {
      return
    }
    const withoutSameId = customPerformanceProfiles.filter((profile) => profile.id !== next.id)
    const merged = [...withoutSameId, next]
    setCustomPerformanceProfiles(merged)
    saveCustomPerformanceProfiles(merged)
    setParams({
      performanceProfileId: next.id,
      performanceAutoProfileEnabled: false,
    })
  }

  const handleRerunHardwareCalibration = async () => {
    setHardwareDetectBusy(true)
    try {
      await runHardwareAutoCalibration({ force: true, source: 'manual' })
      setCustomPerformanceProfiles(loadCustomPerformanceProfiles())
    } finally {
      setHardwareDetectBusy(false)
    }
  }

  useEffect(() => {
    setCustomPerformanceProfiles(loadCustomPerformanceProfiles())
  }, [])

  useEffect(() => {
    if (autoProfileInitDoneRef.current) {
      return
    }
    autoProfileInitDoneRef.current = true
    void runHardwareDetection()
  }, [runHardwareDetection])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (isTextEntryTarget(event.target)) {
        return
      }

      const isSpace = event.code === 'Space' || event.key === ' '
      const isBackspace = event.code === 'Backspace' || event.key === 'Backspace'
      const resetByBackspaceCombo =
        isBackspace && (event.metaKey || event.ctrlKey) && !event.altKey
      const resetByFallback = isSpace && event.shiftKey && !event.metaKey && !event.ctrlKey

      if (resetByBackspaceCombo || resetByFallback) {
        event.preventDefault()
        handleResetScene()
        return
      }

      const singlePulseBySpace =
        isSpace && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
      if (singlePulseBySpace) {
        event.preventDefault()
        if (document.activeElement instanceof HTMLElement && !isTextEntryTarget(document.activeElement)) {
          // Avoid "space activates focused control" after panel interactions.
          document.activeElement.blur()
        }
        singlePulse()
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [singlePulse, handleResetScene])

  useEffect(() => {
    const captureEnabled =
      params.vizScientificMode === true &&
      (params.vizShowDetectionOverlay === true ||
        params.vizShowTopologyOverlay === true ||
        params.vizShowEnergyOverlay === true)
    if (!captureEnabled) {
      return
    }
    const tSec = Number(params.runtimeSimulationTime ?? 0) || 0
    if (tSec <= vizLastCaptureSecRef.current + 0.4) {
      return
    }
    vizLastCaptureSecRef.current = tSec
    const entry = {
      tSec,
      detectorConfidence: Number(params.runtimeDetectionConfidence ?? 0) || 0,
      newtoniumConfidence: Number(params.runtimeNewtoniumConfidence ?? 0) || 0,
      newtoniumTransitions: Math.floor(Number(params.runtimeNewtoniumTransitions ?? 0)),
      renderConfidence: Number(params.runtimeRenderDiagnosticsConfidence ?? 0) || 0,
      renderUncertainty: Number(params.runtimeRenderDiagnosticsUncertainty ?? 1) || 0,
      uncertaintyDetectorGap: Number(params.runtimeRenderUncertaintyDetectorGap ?? 1) || 0,
      uncertaintyRenderFallback: Number(params.runtimeRenderUncertaintyFallback ?? 0) || 0,
      uncertaintyTopologyVolatility: Number(params.runtimeRenderUncertaintyTopologyVolatility ?? 1) || 0,
      overlayConfidence: Number(params.runtimeOverlayConfidenceComposite ?? 0) || 0,
      overlayUncertainty: Number(params.runtimeOverlayUncertaintyComposite ?? 1) || 0,
      overlayUncertaintyDetector: Number(params.runtimeOverlayUncertaintyDetector ?? 1) || 0,
      overlayUncertaintyTopology: Number(params.runtimeOverlayUncertaintyTopology ?? 1) || 0,
      overlayUncertaintyRender: Number(params.runtimeOverlayUncertaintyRender ?? 1) || 0,
      energyProxy: Number(params.runtimeEnergyProxy ?? 0) || 0,
      enstrophyProxy: Number(params.runtimeEnstrophyProxy ?? 0) || 0,
      detectedFilaments: Math.floor(Number(params.runtimeDetectedFilamentCount ?? 0)),
      detectedRings: Math.floor(Number(params.runtimeDetectedRingCount ?? 0)),
      detectedTubes: Math.floor(Number(params.runtimeDetectedTubeCount ?? 0)),
      detectedClusters: Math.floor(Number(params.runtimeDetectedClusterCount ?? 0)),
    }
    setVizTimeline((prev) => {
      const next = [...prev, entry]
      return next.slice(-240)
    })
  }, [
    params.runtimeDetectedClusterCount,
    params.runtimeDetectedFilamentCount,
    params.runtimeDetectedRingCount,
    params.runtimeDetectedTubeCount,
    params.runtimeDetectionConfidence,
    params.runtimeEnergyProxy,
    params.runtimeEnstrophyProxy,
    params.runtimeNewtoniumConfidence,
    params.runtimeNewtoniumTransitions,
    params.runtimeRenderDiagnosticsConfidence,
    params.runtimeRenderDiagnosticsUncertainty,
    params.runtimeRenderUncertaintyDetectorGap,
    params.runtimeRenderUncertaintyFallback,
    params.runtimeRenderUncertaintyTopologyVolatility,
    params.runtimeOverlayConfidenceComposite,
    params.runtimeOverlayUncertaintyComposite,
    params.runtimeOverlayUncertaintyDetector,
    params.runtimeOverlayUncertaintyTopology,
    params.runtimeOverlayUncertaintyRender,
    params.runtimeSimulationTime,
    params.vizScientificMode,
    params.vizShowDetectionOverlay,
    params.vizShowEnergyOverlay,
    params.vizShowTopologyOverlay,
  ])

  const handleExportJson = async () => {
    const payload = exportSceneToJson()
    const json = JSON.stringify(payload, null, 2)
    const now = new Date()
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate(),
    ).padStart(2, '0')}`
    const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(
      2,
      '0',
    )}${String(now.getSeconds()).padStart(2, '0')}`
    const defaultName = `torus-scene-${date}-${time}.json`

    if (typeof window !== 'undefined' && window.__TAURI__) {
      try {
        const { save } = await import('@tauri-apps/plugin-dialog')
        const { writeTextFile } = await import('@tauri-apps/plugin-fs')
        const path = await save({
          filters: [{ name: 'JSON', extensions: ['json'] }],
          defaultPath: defaultName,
        })
        if (path) await writeTextFile(path, json)
      } catch (err) {
        console.error('Tauri export failed:', err)
      }
      return
    }

    if (typeof window !== 'undefined' && window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: defaultName,
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
        })
        const writable = await handle.createWritable()
        await writable.write(json)
        await writable.close()
      } catch (err) {
        if (err?.name !== 'AbortError') console.error('Save file dialog failed:', err)
      }
      return
    }

    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = defaultName
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadText = async ({
    text,
    defaultName,
    mimeType,
    tauriExtensions,
  }) => {
    if (typeof window !== 'undefined' && window.__TAURI__) {
      try {
        const { save } = await import('@tauri-apps/plugin-dialog')
        const { writeTextFile } = await import('@tauri-apps/plugin-fs')
        const path = await save({
          filters: [{ name: defaultName.split('.').pop()?.toUpperCase() ?? 'FILE', extensions: tauriExtensions }],
          defaultPath: defaultName,
        })
        if (path) await writeTextFile(path, text)
      } catch (err) {
        console.error('Tauri export failed:', err)
      }
      return
    }

    if (typeof window !== 'undefined' && window.showSaveFilePicker) {
      try {
        const extension = tauriExtensions[0] ?? 'txt'
        const handle = await window.showSaveFilePicker({
          suggestedName: defaultName,
          types: [{ description: extension.toUpperCase(), accept: { [mimeType]: [`.${extension}`] } }],
        })
        const writable = await handle.createWritable()
        await writable.write(text)
        await writable.close()
      } catch (err) {
        if (err?.name !== 'AbortError') console.error('Save file dialog failed:', err)
      }
      return
    }

    const blob = new Blob([text], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = defaultName
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadBlob = async ({ blob, defaultName }) => {
    if (!(blob instanceof Blob)) {
      return
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = defaultName
    link.click()
    URL.revokeObjectURL(url)
  }

  const waitForFramePair = useCallback(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      }),
    [],
  )

  const captureScientificPngBlob = useCallback(async () => {
    const canvas = document.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement)) {
      setVizExportStatus(t('viz_export_status_canvas_missing'))
      return null
    }
    const now = new Date()
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(
      2,
      '0',
    )}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(
      now.getSeconds(),
    ).padStart(2, '0')}`
    const blob = await new Promise((resolve) => {
      canvas.toBlob((value) => resolve(value), 'image/png')
    })
    if (!(blob instanceof Blob)) {
      setVizExportStatus(t('viz_export_status_canvas_missing'))
      return null
    }
    return { blob, ts }
  }, [t])

  const computePhotoFrameScore = useCallback((runtimeParams) => {
    const p = runtimeParams && typeof runtimeParams === 'object' ? runtimeParams : {}
    const confidence = clamp01(Number(p.runtimeRenderDiagnosticsConfidence ?? 0))
    const certainty = 1 - clamp01(Number(p.runtimeRenderDiagnosticsUncertainty ?? 1))
    const overlayStructuresCount = Array.isArray(p.runtimeOverlayStructures)
      ? p.runtimeOverlayStructures.length
      : Math.max(
          0,
          Math.floor(
            Number(p.runtimeDetectedRingCount ?? 0) +
              Number(p.runtimeDetectedTubeCount ?? 0) +
              Number(p.runtimeDetectedFilamentCount ?? 0),
          ),
        )
    const structureRichness = clamp01(overlayStructuresCount / 14)
    const score = confidence * 0.5 + certainty * 0.3 + structureRichness * 0.2
    return {
      score,
      confidence,
      certainty,
      structureRichness,
      overlayStructuresCount,
    }
  }, [])

  const handleExportScientificPng = useCallback(async () => {
    const captured = await captureScientificPngBlob()
    if (!captured) {
      return
    }
    await handleDownloadBlob({
      blob: captured.blob,
      defaultName: `torus-scientific-snapshot-${captured.ts}.png`,
    })
    setVizExportStatus(t('viz_export_status_ready'))
  }, [captureScientificPngBlob, t])

  const handleApplyPhotoFramePreset = useCallback(() => {
    const qualityExplorer = getBuiltinPerformanceProfile('quality_explorer')
    stopPulseTrain()
    setParams({
      ...(qualityExplorer?.paramsPatch ?? {}),
      performanceProfileId: qualityExplorer?.id ?? 'quality_explorer',
      performanceAutoProfileEnabled: false,
      vizScientificMode: true,
      vizShowDetectionOverlay: true,
      vizShowTopologyOverlay: true,
      vizShowEnergyOverlay: true,
      vizOverlayShowLabels: true,
      vizOverlayLabelMaxCount: Math.max(12, Math.floor(Number(params.vizOverlayLabelMaxCount ?? 8))),
      vizOverlayLabelMaxDistance: Math.max(18, Number(params.vizOverlayLabelMaxDistance ?? 12) || 12),
      vizOverlayMinConfidence: Math.max(0.1, Number(params.vizOverlayMinConfidence ?? 0.25) || 0.25),
      vizExportScale: Math.max(2, Number(params.vizExportScale ?? 1) || 1),
    })
    setVizExportStatus(t('viz_photo_preset_status_ready'))
  }, [params.vizExportScale, params.vizOverlayLabelMaxCount, params.vizOverlayLabelMaxDistance, params.vizOverlayMinConfidence, setParams, stopPulseTrain, t])

  const handleSingleStepPhotoExport = useCallback(async () => {
    stopPulseTrain()
    setParams({
      vizScientificMode: true,
      vizExportScale: Math.max(2, Number(params.vizExportScale ?? 1) || 1),
    })
    singlePulse()
    await waitForFramePair()
    await handleExportScientificPng()
    setVizExportStatus(t('viz_photo_export_status_done'))
  }, [handleExportScientificPng, params.vizExportScale, setParams, singlePulse, stopPulseTrain, t, waitForFramePair])

  const handleBurstPhotoBestExport = useCallback(async () => {
    const burstCount = Math.max(2, Math.min(24, Math.floor(Number(vizPhotoBurstCount) || 6)))
    setVizPhotoBurstBusy(true)
    try {
      stopPulseTrain()
      setParams({
        vizScientificMode: true,
        vizExportScale: Math.max(2, Number(params.vizExportScale ?? 1) || 1),
      })
      let bestFrame = null
      for (let i = 0; i < burstCount; i += 1) {
        singlePulse()
        await waitForFramePair()
        const captured = await captureScientificPngBlob()
        if (!captured) {
          return
        }
        const runtimeParams = useSimulationStore.getState().params
        const diagnostics = computePhotoFrameScore(runtimeParams)
        if (!bestFrame || diagnostics.score > bestFrame.score) {
          bestFrame = {
            ...captured,
            ...diagnostics,
            frameIndex: i + 1,
          }
        }
        setVizExportStatus(
          `${t('viz_photo_burst_progress')} ${i + 1}/${burstCount} • ${t('viz_photo_burst_best_score')}: ${(bestFrame?.score ?? 0).toFixed(3)}`,
        )
      }
      if (!bestFrame) {
        return
      }
      await handleDownloadBlob({
        blob: bestFrame.blob,
        defaultName: `torus-photo-burst-best-${bestFrame.ts}-f${String(bestFrame.frameIndex).padStart(2, '0')}.png`,
      })
      setVizExportStatus(
        `${t('viz_photo_burst_status_done')} #${bestFrame.frameIndex}/${burstCount}; ${t('viz_photo_burst_best_score')}: ${bestFrame.score.toFixed(3)}; ${t('viz_photo_burst_structures')}: ${bestFrame.overlayStructuresCount}`,
      )
    } finally {
      setVizPhotoBurstBusy(false)
    }
  }, [
    captureScientificPngBlob,
    computePhotoFrameScore,
    params.vizExportScale,
    setParams,
    singlePulse,
    stopPulseTrain,
    t,
    vizPhotoBurstCount,
    waitForFramePair,
  ])

  const buildScientificValidationSnapshot = useCallback(
    (timestamp = new Date()) => {
      const now = timestamp instanceof Date ? timestamp : new Date(timestamp)
      const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(
        2,
        '0',
      )}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(
        now.getSeconds(),
      ).padStart(2, '0')}`
      const sequenceManifest = buildScientificSnapshotSequenceManifest({
        timestamp: now,
        baseName: `torus-scientific-sequence-${ts}`,
        timeline: vizTimeline,
        imageFrameStepSec: 0.5,
      })
      const snapshotBundle = buildScientificSnapshotBundle({
        timestamp: now,
        camera: params.camera,
        params,
        stabilityStats,
        filamentStats,
        expectedImageFileName: `${sequenceManifest.baseName}-frame-0000.png`,
        timeline: vizTimeline,
      })
      const ffmpegPlan = buildScientificFfmpegTranscodePlan({
        sequenceManifest,
        fps: 30,
        outputFileName: `torus-scientific-sequence-${ts}.mp4`,
      })
      const validationReport = buildScientificExportValidationReport({
        snapshotBundle,
        sequenceManifest,
        ffmpegPlan,
      })
      return {
        ts,
        snapshotBundle,
        sequenceManifest,
        ffmpegPlan,
        validationReport,
      }
    },
    [filamentStats, params, stabilityStats, vizTimeline],
  )

  const getValidationFailureStatus = useCallback(
    (report) => {
      const checks = Array.isArray(report?.checks) ? report.checks : []
      const failedChecks = Array.isArray(report?.failedChecks) ? report.failedChecks : []
      const formatCheckValue = (value) => {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          return String(value)
        }
        if (value === null) {
          return 'null'
        }
        if (value === undefined) {
          return 'undefined'
        }
        try {
          return JSON.stringify(value)
        } catch {
          return String(value)
        }
      }
      const detailParts = failedChecks.slice(0, 3).map((checkId) => {
        const check = checks.find((entry) => entry?.id === checkId)
        if (!check) {
          return String(checkId)
        }
        const actual = formatCheckValue(check.value)
        const expected = formatCheckValue(check.expected)
        return `${String(check.id)} (got ${actual}, expected ${expected})`
      })
      if (failedChecks.length > 3) {
        detailParts.push(`+${failedChecks.length - 3} more`)
      }
      const fixHintByCheckId = {
        bundle_schema_id: t('viz_export_fix_snapshot_rebuild'),
        manifest_schema_id: t('viz_export_fix_sequence_manifest_rebuild'),
        ffmpeg_schema_id: t('viz_export_fix_ffmpeg_plan_regenerate'),
        bundle_render_policy_block: t('viz_export_fix_snapshot_rebuild'),
        bundle_overlay_diagnostics_block: t('viz_export_fix_snapshot_rebuild'),
        bundle_overlay_structures_block: t('viz_export_fix_snapshot_rebuild'),
        visualization_overlay_label_policy_block: t('viz_export_fix_overlay_label_policy'),
        visualization_overlay_min_confidence_range: t('viz_export_fix_overlay_min_confidence'),
        visualization_overlay_label_enabled_boolean: t('viz_export_fix_overlay_label_toggle'),
        visualization_overlay_label_max_count_bounds: t('viz_export_fix_overlay_label_max_count'),
        visualization_overlay_label_max_distance_bounds: t('viz_export_fix_overlay_label_max_distance'),
        runtime_overlay_structures_bounded: t('viz_export_fix_overlay_structures_bounded'),
        manifest_frame_count: t('viz_export_fix_sequence_manifest_rebuild'),
        manifest_frame_names_unique: t('viz_export_fix_sequence_manifest_rebuild'),
        ffmpeg_expected_frame_count: t('viz_export_fix_sequence_manifest_rebuild'),
        ffmpeg_concat_line_count: t('viz_export_fix_ffmpeg_plan_regenerate'),
        ffmpeg_output_extension: t('viz_export_fix_ffmpeg_output_extension'),
      }
      const docRefByCheckId = {
        bundle_schema_id: t('viz_export_docs_visualization_contract'),
        manifest_schema_id: t('viz_export_docs_visualization_contract'),
        ffmpeg_schema_id: t('viz_export_docs_visualization_contract'),
        manifest_frame_count: t('viz_export_docs_visualization_contract'),
        manifest_frame_names_unique: t('viz_export_docs_visualization_contract'),
        ffmpeg_expected_frame_count: t('viz_export_docs_visualization_contract'),
        ffmpeg_concat_line_count: t('viz_export_docs_visualization_contract'),
        ffmpeg_output_extension: t('viz_export_docs_visualization_contract'),
        bundle_render_policy_block: t('viz_export_docs_rendering_strategy_runtime_policy'),
        bundle_overlay_diagnostics_block: t('viz_export_docs_rendering_strategy_runtime_policy'),
        bundle_overlay_structures_block: t('viz_export_docs_visualization_overlay_policy'),
        visualization_overlay_label_policy_block: t('viz_export_docs_visualization_overlay_policy'),
        visualization_overlay_min_confidence_range: t('viz_export_docs_visualization_overlay_policy'),
        visualization_overlay_label_enabled_boolean: t('viz_export_docs_visualization_overlay_policy'),
        visualization_overlay_label_max_count_bounds: t('viz_export_docs_visualization_overlay_policy'),
        visualization_overlay_label_max_distance_bounds: t('viz_export_docs_visualization_overlay_policy'),
        runtime_overlay_structures_bounded: t('viz_export_docs_visualization_overlay_policy'),
      }
      const fixHintPriorityByCheckId = {
        manifest_frame_count: 0,
        manifest_frame_names_unique: 0,
        ffmpeg_expected_frame_count: 0,
        ffmpeg_concat_line_count: 0,
        ffmpeg_output_extension: 0,
        manifest_schema_id: 1,
        ffmpeg_schema_id: 1,
        bundle_schema_id: 1,
        bundle_render_policy_block: 1,
        bundle_overlay_diagnostics_block: 1,
        bundle_overlay_structures_block: 1,
        visualization_overlay_label_policy_block: 2,
        visualization_overlay_min_confidence_range: 2,
        visualization_overlay_label_enabled_boolean: 2,
        visualization_overlay_label_max_count_bounds: 2,
        visualization_overlay_label_max_distance_bounds: 2,
        runtime_overlay_structures_bounded: 3,
      }
      const specTopicByCheckId = {
        bundle_schema_id: 'export_contract',
        manifest_schema_id: 'export_contract',
        ffmpeg_schema_id: 'ffmpeg_contract',
        manifest_frame_count: 'ffmpeg_contract',
        manifest_frame_names_unique: 'ffmpeg_contract',
        ffmpeg_expected_frame_count: 'ffmpeg_contract',
        ffmpeg_concat_line_count: 'ffmpeg_contract',
        ffmpeg_output_extension: 'ffmpeg_contract',
        bundle_render_policy_block: 'runtime_policy',
        bundle_overlay_diagnostics_block: 'runtime_policy',
        bundle_overlay_structures_block: 'overlay_policy',
        visualization_overlay_label_policy_block: 'overlay_policy',
        visualization_overlay_min_confidence_range: 'overlay_policy',
        visualization_overlay_label_enabled_boolean: 'overlay_policy',
        visualization_overlay_label_max_count_bounds: 'overlay_policy',
        visualization_overlay_label_max_distance_bounds: 'overlay_policy',
        runtime_overlay_structures_bounded: 'overlay_policy',
      }
      const orderedFailedChecks = [...failedChecks].sort((left, right) => {
        const leftPriority = fixHintPriorityByCheckId[String(left)] ?? 99
        const rightPriority = fixHintPriorityByCheckId[String(right)] ?? 99
        if (leftPriority === rightPriority) {
          return String(left).localeCompare(String(right))
        }
        return leftPriority - rightPriority
      })
      const recommendedSpecTopic = orderedFailedChecks
        .map((checkId) => specTopicByCheckId[String(checkId)] ?? '')
        .find((topic) => typeof topic === 'string' && topic.length > 0)
      if (recommendedSpecTopic) {
        setVizSpecViewerTopic(recommendedSpecTopic)
      }
      const allFixHints = []
      for (const checkId of orderedFailedChecks) {
        const hint = fixHintByCheckId[String(checkId)] ?? ''
        if (!hint || allFixHints.includes(hint)) {
          continue
        }
        allFixHints.push(hint)
      }
      const fixHints = allFixHints.slice(0, 3)
      const unresolvedHintCount = Math.max(0, allFixHints.length - fixHints.length)
      const failedLabel = detailParts.length > 0 ? detailParts.join('; ') : 'unknown'
      const allDocRefs = []
      for (const checkId of orderedFailedChecks) {
        const docRef = docRefByCheckId[String(checkId)] ?? ''
        if (!docRef || allDocRefs.includes(docRef)) {
          continue
        }
        allDocRefs.push(docRef)
      }
      const docRefs = allDocRefs.slice(0, 2)
      const unresolvedDocRefCount = Math.max(0, allDocRefs.length - docRefs.length)
      const baseLabel = `${t('viz_export_status_validation_failed')}: ${failedLabel}`
      const fixLabel = unresolvedHintCount > 0 ? `${fixHints.join('; ')}; +${unresolvedHintCount} more` : fixHints.join('; ')
      const docsLabel = unresolvedDocRefCount > 0 ? `${docRefs.join('; ')}; +${unresolvedDocRefCount} more` : docRefs.join('; ')
      if (fixHints.length <= 0 && docRefs.length <= 0) {
        return baseLabel
      }
      if (fixHints.length <= 0) {
        return `${baseLabel}. ${t('viz_export_docs_prefix')}: ${docsLabel}`
      }
      if (docRefs.length <= 0) {
        return `${baseLabel}. ${t('viz_export_fix_prefix')}: ${fixLabel}`
      }
      return `${baseLabel}. ${t('viz_export_fix_prefix')}: ${fixLabel}. ${t('viz_export_docs_prefix')}: ${docsLabel}`
    },
    [t],
  )


  const handleExportScientificMetadata = useCallback(async () => {
    const validationSnapshot = buildScientificValidationSnapshot(new Date())
    if (validationSnapshot.validationReport?.pass !== true) {
      setVizExportStatus(getValidationFailureStatus(validationSnapshot.validationReport))
      return
    }
    const now = new Date()
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(
      2,
      '0',
    )}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(
      now.getSeconds(),
    ).padStart(2, '0')}`
    const payload = {
      version: 1,
      type: 'torus-vortex-scientific-snapshot',
      generatedAt: now.toISOString(),
      camera: params.camera,
      visualization: {
        scientificMode: params.vizScientificMode === true,
        showVorticityField: params.vizShowVorticityField === true,
        showQCriterion: params.vizShowQCriterion === true,
        showVelocityField: params.vizShowVelocityField === true,
        showStreamlines: params.vizShowStreamlines === true,
        showPathlines: params.vizShowPathlines === true,
        showDetectionOverlay: params.vizShowDetectionOverlay === true,
        showTopologyOverlay: params.vizShowTopologyOverlay === true,
        showEnergyOverlay: params.vizShowEnergyOverlay === true,
        exportScale: Number(params.vizExportScale ?? 1) || 1,
        overlayMinConfidence: Number(params.vizOverlayMinConfidence ?? 0.25) || 0.25,
        overlayLabelPolicy: {
          enabled: params.vizOverlayShowLabels === true,
          maxCount: Math.floor(Number(params.vizOverlayLabelMaxCount ?? 8) || 8),
          maxDistance: Number(params.vizOverlayLabelMaxDistance ?? 12) || 12,
        },
      },
      runtime: {
        backend: params.runtimeBackend ?? 'unknown',
        runtimeSimulationTime: Number(params.runtimeSimulationTime ?? 0) || 0,
        detectedFilamentCount: Math.floor(Number(params.runtimeDetectedFilamentCount ?? 0)),
        detectedRingCount: Math.floor(Number(params.runtimeDetectedRingCount ?? 0)),
        detectedTubeCount: Math.floor(Number(params.runtimeDetectedTubeCount ?? 0)),
        detectedClusterCount: Math.floor(Number(params.runtimeDetectedClusterCount ?? 0)),
        detectionConfidence: Number(params.runtimeDetectionConfidence ?? 0) || 0,
        newtoniumType: params.runtimeNewtoniumType ?? 'none',
        newtoniumConfidence: Number(params.runtimeNewtoniumConfidence ?? 0) || 0,
        newtoniumTransitions: Math.floor(Number(params.runtimeNewtoniumTransitions ?? 0)),
        energyProxy: Number(params.runtimeEnergyProxy ?? 0) || 0,
        enstrophyProxy: Number(params.runtimeEnstrophyProxy ?? 0) || 0,
        physicalStepOrder: params.runtimePhysicalStepOrder ?? 'velocity_computation',
        renderPolicy: {
          mode: params.runtimeRenderPolicyMode ?? 'particles',
          lodTier: params.runtimeRenderLodTier ?? 'near',
          scores: {
            particles: Number(params.runtimeRenderScoreParticles ?? 0) || 0,
            filaments: Number(params.runtimeRenderScoreFilaments ?? 0) || 0,
            sheets: Number(params.runtimeRenderScoreSheets ?? 0) || 0,
            current: Number(params.runtimeRenderScoreCurrent ?? 0) || 0,
            margin: Number(params.runtimeRenderScoreMargin ?? 0) || 0,
            bestMode: params.runtimeRenderScoreBestMode ?? 'particles',
          },
          hysteresis: {
            holdSteps: Math.floor(Number(params.runtimeRenderHysteresisHoldSteps ?? 0)),
            remaining: Math.floor(Number(params.runtimeRenderHysteresisRemaining ?? 0)),
          },
          overrideReason: params.runtimeRenderOverrideReason ?? 'none',
          health: {
            fallbackRate: Number(params.runtimeRenderHealthFallbackRate ?? 0) || 0,
            timeoutRate: Number(params.runtimeRenderHealthTimeoutRate ?? 0) || 0,
            driftSeverity: Number(params.runtimeRenderHealthDriftSeverity ?? 0) || 0,
          },
          hardwareBudget: {
            sheetWorkloadBudget: Number(params.performanceSheetWorkloadBudget ?? 0.35) || 0,
            maxSheetPanels: Math.floor(Number(params.performanceMaxSheetPanels ?? 900) || 900),
            representationSwitchCooldown: Math.floor(
              Number(params.performanceRepresentationSwitchCooldown ?? 12) || 12,
            ),
          },
          confidence: Number(params.runtimeRenderDiagnosticsConfidence ?? 0) || 0,
          uncertainty: Number(params.runtimeRenderDiagnosticsUncertainty ?? 1) || 0,
          uncertaintyComponents: {
            detectorGap: Number(params.runtimeRenderUncertaintyDetectorGap ?? 1) || 0,
            fallback: Number(params.runtimeRenderUncertaintyFallback ?? 0) || 0,
            topologyVolatility: Number(params.runtimeRenderUncertaintyTopologyVolatility ?? 1) || 0,
          },
        },
        overlayDiagnostics: {
          confidenceComposite: Number(params.runtimeOverlayConfidenceComposite ?? 0) || 0,
          uncertaintyComposite: Number(params.runtimeOverlayUncertaintyComposite ?? 1) || 0,
          uncertaintyComponents: {
            detector: Number(params.runtimeOverlayUncertaintyDetector ?? 1) || 0,
            topology: Number(params.runtimeOverlayUncertaintyTopology ?? 1) || 0,
            render: Number(params.runtimeOverlayUncertaintyRender ?? 1) || 0,
          },
        },
        overlayStructures: Array.isArray(params.runtimeOverlayStructures)
          ? params.runtimeOverlayStructures.slice(0, 24)
          : [],
        topologyTracking: {
          version: params.runtimeTopologyVersion ?? 'tt028b.topology_tracking.v1',
          valid: params.runtimeTopologyValid !== false,
          profile: String(params.runtimeTopologyProfile ?? 'classic'),
          modifierStrength: Number(params.runtimeTopologyModifierStrength ?? 0) || 0,
          externalValidationEligible: params.runtimeTopologyExternalValidationEligible !== false,
          externalValidationEligibilityReason: String(
            params.runtimeTopologyExternalValidationEligibilityReason ?? 'eligible',
          ),
          frameSerial: Math.floor(Number(params.runtimeTopologyFrameSerial ?? 0) || 0),
          eventCount: Math.floor(Number(params.runtimeTopologyEventCount ?? 0) || 0),
          nodeCount: Math.floor(Number(params.runtimeTopologyNodeCount ?? 0) || 0),
          edgeCount: Math.floor(Number(params.runtimeTopologyEdgeCount ?? 0) || 0),
          latestEventType: String(params.runtimeTopologyLatestEventType ?? 'none'),
          latestEventConfidence: Number(params.runtimeTopologyLatestEventConfidence ?? 0) || 0,
          latestEventFrame: Math.floor(Number(params.runtimeTopologyLatestEventFrame ?? 0) || 0),
        },
      },
      stability: stabilityStats,
      filaments: filamentStats,
      timeline: vizTimeline,
    }
    await handleDownloadText({
      text: JSON.stringify(payload, null, 2),
      defaultName: `torus-scientific-snapshot-${ts}.json`,
      mimeType: 'application/json',
      tauriExtensions: ['json'],
    })
    setVizExportStatus(t('viz_export_status_ready'))
  }, [
    buildScientificValidationSnapshot,
    filamentStats,
    getValidationFailureStatus,
    handleDownloadText,
    params,
    stabilityStats,
    t,
    vizTimeline,
  ])

  const handleExportScientificBundle = useCallback(async () => {
    const validationSnapshot = buildScientificValidationSnapshot(new Date())
    if (validationSnapshot.validationReport?.pass !== true) {
      setVizExportStatus(getValidationFailureStatus(validationSnapshot.validationReport))
      return
    }
    const now = new Date()
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(
      2,
      '0',
    )}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(
      now.getSeconds(),
    ).padStart(2, '0')}`
    const imageFileName = `torus-scientific-snapshot-${ts}.png`
    const bundle = buildScientificSnapshotBundle({
      timestamp: now,
      camera: params.camera,
      params,
      stabilityStats,
      filamentStats,
      expectedImageFileName: imageFileName,
      timeline: vizTimeline,
    })
    await handleDownloadText({
      text: JSON.stringify(bundle, null, 2),
      defaultName: `torus-scientific-snapshot-bundle-${ts}.json`,
      mimeType: 'application/json',
      tauriExtensions: ['json'],
    })
    setVizExportStatus(t('viz_export_status_ready'))
  }, [
    buildScientificValidationSnapshot,
    filamentStats,
    getValidationFailureStatus,
    handleDownloadText,
    params,
    stabilityStats,
    t,
    vizTimeline,
  ])

  const handleExportScientificSequenceManifest = useCallback(async () => {
    const validationSnapshot = buildScientificValidationSnapshot(new Date())
    if (validationSnapshot.validationReport?.pass !== true) {
      setVizExportStatus(getValidationFailureStatus(validationSnapshot.validationReport))
      return
    }
    const now = new Date()
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(
      2,
      '0',
    )}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(
      now.getSeconds(),
    ).padStart(2, '0')}`
    const manifest = buildScientificSnapshotSequenceManifest({
      timestamp: now,
      baseName: `torus-scientific-sequence-${ts}`,
      timeline: vizTimeline,
      imageFrameStepSec: 0.5,
    })
    await handleDownloadText({
      text: JSON.stringify(manifest, null, 2),
      defaultName: `torus-scientific-sequence-manifest-${ts}.json`,
      mimeType: 'application/json',
      tauriExtensions: ['json'],
    })
    setVizExportStatus(t('viz_export_status_ready'))
  }, [buildScientificValidationSnapshot, getValidationFailureStatus, handleDownloadText, t, vizTimeline])

  const handleExportScientificFfmpegPlan = useCallback(async () => {
    const validationSnapshot = buildScientificValidationSnapshot(new Date())
    if (validationSnapshot.validationReport?.pass !== true) {
      setVizExportStatus(getValidationFailureStatus(validationSnapshot.validationReport))
      return
    }
    const { ts, snapshotBundle, sequenceManifest, ffmpegPlan: plan, validationReport } = validationSnapshot
    await handleDownloadText({
      text: JSON.stringify(
        {
          snapshotBundle,
          sequenceManifest,
          ffmpegPlan: plan,
          validationReport,
        },
        null,
        2,
      ),
      defaultName: `torus-scientific-ffmpeg-plan-${ts}.json`,
      mimeType: 'application/json',
      tauriExtensions: ['json'],
    })
    if (plan.concatFileContent.length > 0) {
      await handleDownloadText({
        text: plan.concatFileContent,
        defaultName: `torus-scientific-frames-${ts}.txt`,
        mimeType: 'text/plain',
        tauriExtensions: ['txt'],
      })
    }
    await handleDownloadText({
      text: JSON.stringify(validationReport, null, 2),
      defaultName: `torus-scientific-export-validation-${ts}.json`,
      mimeType: 'application/json',
      tauriExtensions: ['json'],
    })
    setVizExportStatus(t('viz_export_status_ready'))
  }, [buildScientificValidationSnapshot, getValidationFailureStatus, handleDownloadText, t])

  const handleExportTopologyEventLogJson = useCallback(async () => {
    const now = new Date()
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(
      2,
      '0',
    )}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(
      now.getSeconds(),
    ).padStart(2, '0')}`
    const payload = {
      schemaVersion: 1,
      schemaId: 'torus.topology.events.v1',
      generatedAt: now.toISOString(),
      topology: {
        version: params.runtimeTopologyVersion ?? 'tt028b.topology_tracking.v1',
        valid: params.runtimeTopologyValid !== false,
        profile: String(params.runtimeTopologyProfile ?? 'classic'),
        modifierStrength: Number(params.runtimeTopologyModifierStrength ?? 0) || 0,
        externalValidationEligible: params.runtimeTopologyExternalValidationEligible !== false,
        externalValidationEligibilityReason: String(
          params.runtimeTopologyExternalValidationEligibilityReason ?? 'eligible',
        ),
        frameSerial: Math.floor(Number(params.runtimeTopologyFrameSerial ?? 0) || 0),
        eventCount: Math.floor(Number(params.runtimeTopologyEventCount ?? 0) || 0),
        nodeCount: Math.floor(Number(params.runtimeTopologyNodeCount ?? 0) || 0),
        edgeCount: Math.floor(Number(params.runtimeTopologyEdgeCount ?? 0) || 0),
        counters: {
          birth: Math.floor(Number(params.runtimeTopologyBirthCount ?? 0) || 0),
          decay: Math.floor(Number(params.runtimeTopologyDecayCount ?? 0) || 0),
          merge: Math.floor(Number(params.runtimeTopologyMergeCount ?? 0) || 0),
          split: Math.floor(Number(params.runtimeTopologySplitCount ?? 0) || 0),
          reconnection: Math.floor(Number(params.runtimeTopologyReconnectionCount ?? 0) || 0),
        },
        latestEvent: {
          eventType: String(params.runtimeTopologyLatestEventType ?? 'none'),
          confidence: Number(params.runtimeTopologyLatestEventConfidence ?? 0) || 0,
          frame: Math.floor(Number(params.runtimeTopologyLatestEventFrame ?? 0) || 0),
        },
        eventLog: Array.isArray(params.runtimeTopologyEventLog) ? params.runtimeTopologyEventLog.slice(-240) : [],
        graph: {
          nodes: Array.isArray(params.runtimeTopologyGraphNodes) ? params.runtimeTopologyGraphNodes.slice(-128) : [],
          edges: Array.isArray(params.runtimeTopologyGraphEdges) ? params.runtimeTopologyGraphEdges.slice(-240) : [],
        },
      },
    }
    await handleDownloadText({
      text: JSON.stringify(payload, null, 2),
      defaultName: `torus-topology-events-${ts}.json`,
      mimeType: 'application/json',
      tauriExtensions: ['json'],
    })
  }, [handleDownloadText, params])

  const handleExportTopologyEventLogCsv = useCallback(async () => {
    const now = new Date()
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(
      2,
      '0',
    )}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(
      now.getSeconds(),
    ).padStart(2, '0')}`
    const csv = buildTopologyEventsCsv(params.runtimeTopologyEventLog)
    await handleDownloadText({
      text: csv,
      defaultName: `torus-topology-events-${ts}.csv`,
      mimeType: 'text/csv',
      tauriExtensions: ['csv'],
    })
  }, [handleDownloadText, params.runtimeTopologyEventLog])

  const handleAutoCaptureScientificMp4Package = useCallback(async () => {
    const frameCount = Math.max(4, Math.min(240, Math.floor(Number(vizMp4FrameCount) || 24)))
    const fps = Math.max(12, Math.min(60, Math.floor(Number(vizMp4Fps) || 30)))
    const frameStepSec = 1 / fps
    setVizMp4CaptureBusy(true)
    try {
      stopPulseTrain()
      setParams({
        vizScientificMode: true,
        vizShowDetectionOverlay: true,
        vizShowTopologyOverlay: true,
        vizShowEnergyOverlay: true,
        vizOverlayShowLabels: true,
      })
      const capturedFrames = []
      const timelinePoints = []
      for (let i = 0; i < frameCount; i += 1) {
        singlePulse()
        await waitForFramePair()
        const captured = await captureScientificPngBlob()
        if (!captured) {
          return
        }
        capturedFrames.push(captured)
        const p = useSimulationStore.getState().params
        timelinePoints.push({
          tSec: i * frameStepSec,
          detectorConfidence: Number(p.runtimeDetectionConfidence ?? 0) || 0,
          newtoniumConfidence: Number(p.runtimeNewtoniumConfidence ?? 0) || 0,
          newtoniumTransitions: Math.floor(Number(p.runtimeNewtoniumTransitions ?? 0) || 0),
          renderConfidence: Number(p.runtimeRenderDiagnosticsConfidence ?? 0) || 0,
          renderUncertainty: Number(p.runtimeRenderDiagnosticsUncertainty ?? 1) || 0,
          uncertaintyDetectorGap: Number(p.runtimeRenderUncertaintyDetectorGap ?? 1) || 0,
          uncertaintyRenderFallback: Number(p.runtimeRenderUncertaintyFallback ?? 0) || 0,
          uncertaintyTopologyVolatility: Number(p.runtimeRenderUncertaintyTopologyVolatility ?? 1) || 0,
          overlayConfidence: Number(p.runtimeOverlayConfidenceComposite ?? 0) || 0,
          overlayUncertainty: Number(p.runtimeOverlayUncertaintyComposite ?? 1) || 0,
          overlayUncertaintyDetector: Number(p.runtimeOverlayUncertaintyDetector ?? 1) || 0,
          overlayUncertaintyTopology: Number(p.runtimeOverlayUncertaintyTopology ?? 1) || 0,
          overlayUncertaintyRender: Number(p.runtimeOverlayUncertaintyRender ?? 1) || 0,
          energyProxy: Number(p.runtimeEnergyProxy ?? 0) || 0,
          enstrophyProxy: Number(p.runtimeEnstrophyProxy ?? 0) || 0,
          detectedFilaments: Math.floor(Number(p.runtimeDetectedFilamentCount ?? 0) || 0),
          detectedRings: Math.floor(Number(p.runtimeDetectedRingCount ?? 0) || 0),
          detectedTubes: Math.floor(Number(p.runtimeDetectedTubeCount ?? 0) || 0),
          detectedClusters: Math.floor(Number(p.runtimeDetectedClusterCount ?? 0) || 0),
        })
        setVizExportStatus(`${t('viz_mp4_capture_progress')} ${i + 1}/${frameCount}`)
      }
      const now = new Date()
      const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(
        2,
        '0',
      )}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(
        now.getSeconds(),
      ).padStart(2, '0')}`
      const baseName = `torus-scientific-auto-mp4-${ts}`
      const sequenceManifest = buildScientificSnapshotSequenceManifest({
        timestamp: now,
        baseName,
        timeline: timelinePoints,
        imageFrameStepSec: frameStepSec,
      })
      const framesToExport = Math.min(capturedFrames.length, sequenceManifest.frames.length)
      for (let i = 0; i < framesToExport; i += 1) {
        await handleDownloadBlob({
          blob: capturedFrames[i].blob,
          defaultName: sequenceManifest.frames[i].fileName,
        })
      }
      const snapshotBundle = buildScientificSnapshotBundle({
        timestamp: now,
        camera: params.camera,
        params,
        stabilityStats,
        filamentStats,
        expectedImageFileName: sequenceManifest.frames[0]?.fileName ?? `${baseName}-frame-0000.png`,
        timeline: timelinePoints,
      })
      const ffmpegPlan = buildScientificFfmpegTranscodePlan({
        sequenceManifest,
        fps,
        outputFileName: `${baseName}.mp4`,
      })
      const validationReport = buildScientificExportValidationReport({
        snapshotBundle,
        sequenceManifest,
        ffmpegPlan,
      })
      await handleDownloadText({
        text: JSON.stringify(snapshotBundle, null, 2),
        defaultName: `${baseName}-bundle.json`,
        mimeType: 'application/json',
        tauriExtensions: ['json'],
      })
      await handleDownloadText({
        text: JSON.stringify(sequenceManifest, null, 2),
        defaultName: `${baseName}-sequence-manifest.json`,
        mimeType: 'application/json',
        tauriExtensions: ['json'],
      })
      await handleDownloadText({
        text: JSON.stringify(ffmpegPlan, null, 2),
        defaultName: `${baseName}-ffmpeg-plan.json`,
        mimeType: 'application/json',
        tauriExtensions: ['json'],
      })
      await handleDownloadText({
        text: ffmpegPlan.concatFileContent,
        defaultName: `${baseName}-frames.txt`,
        mimeType: 'text/plain',
        tauriExtensions: ['txt'],
      })
      await handleDownloadText({
        text: JSON.stringify(validationReport, null, 2),
        defaultName: `${baseName}-validation.json`,
        mimeType: 'application/json',
        tauriExtensions: ['json'],
      })
      setVizExportStatus(`${t('viz_mp4_capture_status_done')} ${framesToExport}/${frameCount}`)
    } finally {
      setVizMp4CaptureBusy(false)
    }
  }, [
    captureScientificPngBlob,
    filamentStats,
    handleDownloadBlob,
    handleDownloadText,
    params,
    setParams,
    singlePulse,
    stabilityStats,
    stopPulseTrain,
    t,
    vizMp4Fps,
    vizMp4FrameCount,
    waitForFramePair,
  ])

  const handleClearVizTimeline = useCallback(() => {
    vizLastCaptureSecRef.current = -1
    setVizTimeline([])
    setVizExportStatus('')
  }, [])

  useEffect(() => {
    setLabSavedExperiments(loadLabExperiments())
    const history = loadLabRunHistory()
    const artifacts = loadLabArtifactIndex()
    setLabRunHistory(history)
    setLabArtifactIndex(artifacts)
    setLabSelectedHistoryId(String(history[0]?.id ?? ''))
    setLabCompareHistoryId(String(history[1]?.id ?? history[0]?.id ?? ''))
  }, [])

  const buildCurrentLabExperiment = useCallback(() => {
    const preset = createLabPresetById(labPresetId)
    const experiment = applyLabExperimentOverrides(preset, {
      maxRuns: labMaxRuns,
      warmupSec: labWarmupSec,
      durationSec: labDurationSec,
      sampleEveryMs: labSampleMs,
      sweepMin: labSweepMin,
      sweepMax: labSweepMax,
      scaleEnabled: labScaleEnabled,
      scaleApplyToRuntime: labScaleApplyRuntime,
      scalePresetId: labScalePresetId,
      scaleClass: labScaleClass,
      scaleTargetReynolds: labScaleRe,
      scaleTargetStrouhal: labScaleSt,
    })
    return {
      ...experiment,
      title: String(labExperimentName || experiment.title || '').trim() || experiment.title,
    }
  }, [
    labDurationSec,
    labExperimentName,
    labMaxRuns,
    labPresetId,
    labSampleMs,
    labScaleApplyRuntime,
    labScalePresetId,
    labScaleClass,
    labScaleEnabled,
    labScaleRe,
    labScaleSt,
    labSweepMax,
    labSweepMin,
    labWarmupSec,
  ])

  const resolveLabExperiment = useCallback(() => {
    if (!labUseJsonEditor || String(labExperimentJson).trim().length === 0) {
      setLabExperimentJsonError('')
      return buildCurrentLabExperiment()
    }
    try {
      const parsed = JSON.parse(labExperimentJson)
      const validation = validateExperimentContract(parsed)
      if (!validation.valid) {
        const message = formatLabValidationErrors(validation.errors)
        setLabExperimentJsonError(message.length > 0 ? message : t('lab_json_error_unknown'))
        return null
      }
      setLabExperimentJsonError('')
      return validation.normalized
    } catch (error) {
      const errorText = error instanceof Error ? error.message : t('lab_json_invalid')
      setLabExperimentJsonError(`${t('lab_json_invalid')}: ${errorText}`)
      return null
    }
  }, [buildCurrentLabExperiment, labExperimentJson, labUseJsonEditor, t])

  const handleRunLabPreset = useCallback(async () => {
    if (labRunBusy) {
      return
    }
    setLabRunBusy(true)
    setLabRunProgress(0)
    setLabRunError('')
    setLabRunStatus(t('lab_status_preparing'))
    try {
      const experiment = resolveLabExperiment()
      if (!experiment) {
        setLabRunStatus(t('lab_status_error'))
        return
      }
      const result = await runLabExperimentInRuntime({
        experiment,
        onProgress: (progress) => {
          const total = Math.max(1, Math.floor(Number(progress?.total ?? 1)))
          const completed = Math.max(0, Math.floor(Number(progress?.completed ?? 0)))
          const failed = Math.max(0, Math.floor(Number(progress?.failed ?? 0)))
          setLabRunProgress(Math.min(1, Math.max(0, (completed + failed) / total)))
          setLabRunStatus(
            `${t('lab_status_running')} ${completed + failed}/${total} (${t('lab_failed_short')}: ${failed})`,
          )
        },
      })
      if (result?.ok === false && Array.isArray(result.validationErrors) && result.validationErrors.length > 0) {
        setLabRunError(formatLabValidationErrors(result.validationErrors))
        setLabRunStatus(t('lab_status_error'))
        setLabRunResult(null)
      } else {
        const firstRunSummary =
          Array.isArray(result?.runs) && result.runs.length > 0 ? result.runs[0]?.result?.summary ?? null : null
        const historyEntry = {
          id: `${experiment.id}:${new Date().toISOString()}`,
          timestamp: new Date().toISOString(),
          title: experiment.title ?? experiment.id,
          configHash: result?.configHash ?? 'unknown',
          totals: result?.totals ?? null,
          scaleApplicabilityLevel: String(firstRunSummary?.scaleApplicabilityLevel ?? 'n/a'),
          scalePresetId: String(firstRunSummary?.scalePresetId ?? 'custom'),
          runCount: Math.max(0, Math.floor(Number(result?.totals?.total ?? 0))),
          stepMedianMs: Number(firstRunSummary?.stepMedianMs ?? 0),
          throughputMedianPps: Number(firstRunSummary?.throughputMedianPps ?? 0),
          energyDriftPct: Number(firstRunSummary?.energyDriftPct ?? 0),
          adaptiveDecisionCount: Math.max(0, Math.floor(Number(firstRunSummary?.adaptiveDecisionCount ?? 0))),
          adaptiveRefineCount: Math.max(0, Math.floor(Number(firstRunSummary?.adaptiveRefineCount ?? 0))),
          adaptiveCoarsenCount: Math.max(0, Math.floor(Number(firstRunSummary?.adaptiveCoarsenCount ?? 0))),
          adaptiveAcceptanceOk: firstRunSummary?.adaptiveAcceptanceOk === true,
          adaptiveAcceptanceFailedChecks: String(firstRunSummary?.adaptiveAcceptanceFailedChecks ?? ''),
          adaptiveControllerVerificationOk: firstRunSummary?.adaptiveControllerVerificationOk === true,
          adaptiveControllerVerificationFailedChecks: String(
            firstRunSummary?.adaptiveControllerVerificationFailedChecks ?? '',
          ),
          adaptiveDominantLevel: String(firstRunSummary?.adaptiveDominantLevel ?? 'L1'),
          adaptiveTransitionCount: Math.max(0, Math.floor(Number(firstRunSummary?.adaptiveTransitionCount ?? 0))),
          adaptiveOccupancyL0Pct: Number(firstRunSummary?.adaptiveOccupancyL0Pct ?? 0),
          adaptiveOccupancyL1Pct: Number(firstRunSummary?.adaptiveOccupancyL1Pct ?? 0),
          adaptiveOccupancyL2Pct: Number(firstRunSummary?.adaptiveOccupancyL2Pct ?? 0),
          adaptiveOccupancyL3Pct: Number(firstRunSummary?.adaptiveOccupancyL3Pct ?? 0),
          adaptiveBaselineScenarioId: String(firstRunSummary?.adaptiveBaselineScenarioId ?? 'adaptive.mid'),
          adaptiveBaselineOk: firstRunSummary?.adaptiveBaselineOk === true,
          adaptiveBaselineFailedChecks: String(firstRunSummary?.adaptiveBaselineFailedChecks ?? ''),
        }
        const nextHistory = appendLabRunHistory(historyEntry)
        const nextArtifactIndex = appendLabArtifactIndex({
          id: `${historyEntry.id}:artifact`,
          timestamp: historyEntry.timestamp,
          title: historyEntry.title,
          configHash: historyEntry.configHash,
          ok: result?.ok === true,
          totalRuns: Math.max(0, Math.floor(Number(result?.totals?.total ?? 0) || 0)),
          completedRuns: Math.max(0, Math.floor(Number(result?.totals?.completed ?? 0) || 0)),
          failedRuns: Math.max(0, Math.floor(Number(result?.totals?.failed ?? 0) || 0)),
        })
        setLabRunHistory(nextHistory)
        setLabArtifactIndex(nextArtifactIndex)
        setLabSelectedHistoryId(String(nextHistory[0]?.id ?? historyEntry.id))
        setLabCompareHistoryId(String(nextHistory[1]?.id ?? nextHistory[0]?.id ?? historyEntry.id))
        setLabRunResult({
          experiment,
          result,
        })
        setLabInspectRunIndex(0)
        setLabRunStatus(result?.ok ? t('lab_status_done') : t('lab_status_done_with_failures'))
      }
    } catch (error) {
      setLabRunError(String(error?.message ?? error ?? 'lab_run_failed'))
      setLabRunStatus(t('lab_status_error'))
      setLabRunResult(null)
    } finally {
      setLabRunBusy(false)
      setLabRunProgress((prev) => Math.max(prev, 1))
    }
  }, [labRunBusy, resolveLabExperiment, t])

  const handleExportLabJson = useCallback(async () => {
    if (!labRunResult?.result) {
      return
    }
    const payload = buildExperimentArtifactPayload({
      experiment: labRunResult.experiment,
      batchResult: labRunResult.result,
      metadata: {
        source: 'lab_panel',
        artifactNamingContract: 'tt038.lab_artifact_name.v1',
        uiLanguage: uiLanguage,
        performanceProfileId: params.performanceProfileId ?? 'unknown',
        runtimeBackend: params.runtimeBackend ?? 'unknown',
        hardwareProfile: params.performanceHardwareClass ?? 'unknown',
      },
    })
    const defaultName = buildLabArtifactFileName({
      experiment: labRunResult.experiment,
      batchResult: labRunResult.result,
      artifactKind: 'result',
      extension: 'json',
    })
    await handleDownloadText({
      text: JSON.stringify(payload, null, 2),
      defaultName,
      mimeType: 'application/json',
      tauriExtensions: ['json'],
    })
  }, [
    handleDownloadText,
    labRunResult,
    params.performanceHardwareClass,
    params.performanceProfileId,
    params.runtimeBackend,
    uiLanguage,
  ])

  const handleExportLabCsv = useCallback(async () => {
    if (!labRunResult?.result) {
      return
    }
    const csv = buildExperimentSummaryCsv(labRunResult.result)
    const defaultName = buildLabArtifactFileName({
      experiment: labRunResult.experiment,
      batchResult: labRunResult.result,
      artifactKind: 'summary',
      extension: 'csv',
    })
    await handleDownloadText({
      text: csv,
      defaultName,
      mimeType: 'text/csv',
      tauriExtensions: ['csv'],
    })
  }, [handleDownloadText, labRunResult])

  const handleExportLabAcceptanceReport = useCallback(async () => {
    if (!labRunResult?.result) {
      return
    }
    const report = buildAdaptiveAcceptanceMatrixReport(labRunResult.result)
    const defaultName = buildLabArtifactFileName({
      experiment: labRunResult.experiment,
      batchResult: labRunResult.result,
      artifactKind: 'adaptive-acceptance',
      extension: 'md',
    })
    await handleDownloadText({
      text: report,
      defaultName,
      mimeType: 'text/markdown',
      tauriExtensions: ['md', 'txt'],
    })
  }, [handleDownloadText, labRunResult])

  const handleSaveLabExperiment = useCallback(() => {
    const experiment = resolveLabExperiment()
    if (!experiment) {
      setLabRunStatus(t('lab_status_error'))
      return
    }
    const safeName = String(labExperimentName ?? '').trim() || experiment.title || experiment.id
    const record = {
      id: `${experiment.id}:${safeName.replaceAll(' ', '_')}`.toLowerCase(),
      name: safeName,
      experiment,
    }
    const next = upsertLabExperiment(record)
    setLabSavedExperiments(next)
    setLabSavedExperimentId(record.id)
    setLabRunStatus(t('lab_status_saved'))
  }, [labExperimentName, resolveLabExperiment, t])

  const handleLoadLabExperiment = useCallback(() => {
    const selected = labSavedExperiments.find((item) => String(item?.id ?? '') === labSavedExperimentId)
    if (!selected?.experiment) {
      return
    }
    const experiment = selected.experiment
    const initial = experiment.initialConditions ?? {}
    const scale = initial.scale ?? {}
    setLabExperimentName(String(selected.name ?? experiment.title ?? 'Lab Experiment'))
    setLabMaxRuns(Math.max(1, Math.floor(Number(experiment.runBudget?.maxRuns ?? 4) || 4)))
    setLabWarmupSec(Math.max(0.2, Number(initial.warmupSec ?? 1.5) || 1.5))
    setLabDurationSec(Math.max(1, Number(initial.durationSec ?? 8) || 8))
    setLabSampleMs(Math.max(100, Math.floor(Number(initial.sampleEveryMs ?? 300) || 300)))
    const dim0 = Array.isArray(experiment.sweep?.dimensions) ? experiment.sweep.dimensions[0] : null
    setLabSweepMin(Number.isFinite(Number(dim0?.min)) ? String(dim0.min) : '')
    setLabSweepMax(Number.isFinite(Number(dim0?.max)) ? String(dim0.max) : '')
    setLabScaleEnabled(scale.enabled === true)
    setLabScaleApplyRuntime(scale.applyToRuntime === true)
    setLabScalePresetId(String(scale.scalePresetId ?? 'custom'))
    setLabScaleClass(
      scale.scaleClass === 'micro' ||
        scale.scaleClass === 'lab' ||
        scale.scaleClass === 'atmospheric' ||
        scale.scaleClass === 'astro'
        ? scale.scaleClass
        : 'lab',
    )
    setLabScaleRe(Math.max(100, Math.floor(Number(scale.targetReynolds ?? 4500) || 4500)))
    setLabScaleSt(Math.max(0.01, Number(scale.targetStrouhal ?? 0.22) || 0.22))
    setLabExperimentJson(JSON.stringify(experiment, null, 2))
    setLabExperimentJsonError('')
    setLabRunStatus(t('lab_status_loaded'))
  }, [labSavedExperimentId, labSavedExperiments, t])

  const handleScalePresetChange = useCallback(
    (value) => {
      const nextPresetId = String(value ?? 'custom')
      setLabScalePresetId(nextPresetId)
      const preset = getScalePresetById(nextPresetId)
      if (preset.id !== 'custom') {
        setLabScaleClass(String(preset.scaleClass ?? 'lab'))
        setLabScaleRe(Math.max(100, Math.floor(Number(preset.targetReynolds ?? 4500) || 4500)))
        setLabScaleSt(Math.max(0.01, Number(preset.targetStrouhal ?? 0.22) || 0.22))
      }
    },
    [setLabScaleClass, setLabScalePresetId, setLabScaleRe, setLabScaleSt],
  )

  const handleBuildLabJsonFromControls = useCallback(() => {
    const experiment = buildCurrentLabExperiment()
    setLabExperimentJson(JSON.stringify(experiment, null, 2))
    setLabExperimentJsonError('')
    setLabUseJsonEditor(true)
    setLabRunStatus(t('lab_status_json_ready'))
  }, [buildCurrentLabExperiment, t])

  const handleImportJsonClick = async () => {
    setImportError('')
    if (typeof window !== 'undefined' && window.__TAURI__) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const { readTextFile } = await import('@tauri-apps/plugin-fs')
        const path = await open({
          multiple: false,
          directory: false,
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
        if (path) {
          const text = await readTextFile(path)
          const payload = JSON.parse(text)
          importSceneFromJson(payload)
        }
      } catch (err) {
        setImportError(err instanceof Error ? err.message : t('json_import_error'))
        console.error('Tauri import failed:', err)
      }
      return
    }
    if (typeof window !== 'undefined' && window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
        })
        const file = await handle.getFile()
        const text = await file.text()
        const payload = JSON.parse(text)
        importSceneFromJson(payload)
      } catch (err) {
        if (err?.name !== 'AbortError') {
          setImportError(err instanceof Error ? err.message : t('json_import_error'))
          console.error('Open file dialog failed:', err)
        }
      }
      return
    }
    jsonInputRef.current?.click()
  }

  const handleImportJson = async (event) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setImportError('')
    try {
      const text = await file.text()
      const payload = JSON.parse(text)
      importSceneFromJson(payload)
      setImportError('')
    } catch (error) {
      setImportError(error instanceof Error ? error.message : t('json_import_error'))
    } finally {
      event.target.value = ''
    }
  }

  const selectedHistoryEntry =
    labRunHistory.find((item) => String(item.id ?? '') === labSelectedHistoryId) ?? labRunHistory[0] ?? null
  const compareHistoryEntry =
    labRunHistory.find((item) => String(item.id ?? '') === labCompareHistoryId) ?? labRunHistory[1] ?? null
  const selectedVsCompareThroughputDelta =
    selectedHistoryEntry && compareHistoryEntry
      ? Number(selectedHistoryEntry.throughputMedianPps ?? 0) - Number(compareHistoryEntry.throughputMedianPps ?? 0)
      : 0
  const selectedVsCompareStepDelta =
    selectedHistoryEntry && compareHistoryEntry
      ? Number(selectedHistoryEntry.stepMedianMs ?? 0) - Number(compareHistoryEntry.stepMedianMs ?? 0)
      : 0
  const labPreviewRows = labRunResult?.result ? buildExperimentSummaryRows(labRunResult.result) : []
  const labPreviewRow =
    labPreviewRows[Math.max(0, Math.min(labPreviewRows.length - 1, Math.floor(labInspectRunIndex)))] ?? null
  const labInspectRunResult =
    Array.isArray(labRunResult?.result?.runs) && labRunResult.result.runs.length > 0
      ? labRunResult.result.runs[
          Math.max(0, Math.min(labRunResult.result.runs.length - 1, Math.floor(labInspectRunIndex)))
        ]?.result ?? null
      : null
  const labTransitions = labInspectRunResult?.adaptive?.diagnosticsMap?.transitions ?? null
  const labTransitionMatrixRows = labTransitions
    ? ['L0', 'L1', 'L2', 'L3'].map((from) => {
        const row = labTransitions[from] ?? {}
        return `${from}-> [${['L0', 'L1', 'L2', 'L3']
          .map((to) => `${to}:${Math.max(0, Math.floor(Number(row[to] ?? 0) || 0))}`)
          .join(', ')}]`
      })
    : []
  const labArtifactPreview = labPreviewRow
    ? `run=${labPreviewRow.runIndex} ok=${labPreviewRow.ok} stepMed=${labPreviewRow.stepMedianMs.toFixed(
        2,
      )}ms throughput=${labPreviewRow.throughputMedianPps.toFixed(1)} pps scale=${labPreviewRow.scaleClass}/${labPreviewRow.scaleApplicabilityLevel} adaptive=${labPreviewRow.adaptiveEnabled ? 'on' : 'off'} acceptance=${labPreviewRow.adaptiveAcceptanceOk ? 'pass' : 'fail'}`
    : ''
  const latestArtifactEntry = labArtifactIndex[0] ?? null

  return (
    <>
      {isCollapsed ? (
        <div
          className="fixed right-0 top-0 z-40 h-full w-6"
          onMouseEnter={() => setShowCollapsedHandle(true)}
          onMouseLeave={() => setShowCollapsedHandle(false)}
        >
          <button
            className={`absolute right-0 top-1/2 h-20 w-5 -translate-y-1/2 flex items-center justify-center text-sm transition-opacity ${
              showCollapsedHandle ? 'opacity-60' : 'opacity-15'
            } hover:opacity-100`}
            onClick={() => setIsCollapsed(false)}
            type="button"
            aria-label={t('expand_panel')}
            style={{ color: 'rgba(255,255,255,0.4)' }}
          >
            ◀
          </button>
        </div>
      ) : null}
      {!isCollapsed && (
        <button
          className="fixed z-40 flex h-10 w-5 items-center justify-center rounded-l-md transition-opacity hover:opacity-100"
          onClick={() => setIsCollapsed(true)}
          type="button"
          aria-label={t('collapse_panel')}
          style={{
            top: '50%',
            right: '420px',
            transform: 'translateY(-50%)',
            color: 'rgba(255,255,255,0.4)',
            opacity: 0.7,
            background: 'rgba(99, 102, 241, 0.1)',
          }}
        >
          ▶
        </button>
      )}
      <aside
        className={`tt-panel absolute right-0 top-0 z-30 h-full transition-all duration-200 ${
          isCollapsed
            ? 'w-0 overflow-hidden p-0 opacity-0'
            : 'w-[420px] overflow-y-auto p-3.5 opacity-100'
        }`}
        style={{
          background: isCollapsed ? 'transparent' : `rgba(12, 13, 30, ${(panelOpacity / 100).toFixed(2)})`,
          backdropFilter: isCollapsed ? 'none' : `blur(${Math.round(40 * panelOpacity / 100)}px) saturate(${Math.round(100 + 80 * panelOpacity / 100)}%)`,
          WebkitBackdropFilter: isCollapsed ? 'none' : `blur(${Math.round(40 * panelOpacity / 100)}px) saturate(${Math.round(100 + 80 * panelOpacity / 100)}%)`,
          borderLeft: isCollapsed ? 'none' : '0.5px solid var(--panel-border)',
        }}
      >

        {!isCollapsed && (
          <>
            <input
              ref={jsonInputRef}
              className="hidden"
              type="file"
              accept=".json,application/json"
              onChange={handleImportJson}
            />
            <div className="space-y-3 pl-4">
            <DisclosureSection
              title={t('particles_and_vectors')}
              description={t('particle_rendering_settings_and_total_scene_particle_limit')}
            >
              <InlineDisclosure title={t('particles')}>
                <SelectField
                  label={t('active_particle')}
                  value={params.activeParticleType ?? 'amer'}
                  onChange={(value) => setParam('activeParticleType', value)}
                  options={[{ value: 'amer', label: t('amer') }]}
                />
                <RangeField
                  label={t('particle_size')}
                  hint={t('hint_particle_size')}
                  min={0.05}
                  max={2}
                  step={0.01}
                  value={params.particleSize}
                  onChange={(value) => setParam('particleSize', value)}
                />
                <RangeField
                  label={t('particle_opacity')}
                  hint={t('hint_particle_opacity')}
                  min={0.05}
                  max={1}
                  step={0.01}
                  value={params.opacity}
                  onChange={(value) => setParam('opacity', value)}
                />
                <ColorField
                  label={t('particle_color')}
                  hint={t('hint_particle_color')}
                  value={params.particleColor ?? '#ffffff'}
                  onChange={(value) => setParam('particleColor', value)}
                />
                <RangeField
                  label={t('scene_particle_limit')}
                  hint={t('hint_scene_particle_limit')}
                  min={500}
                  max={50000}
                  step={1}
                  value={params.particleCount}
                  onChange={(value) =>
                    setParam('particleCount', Math.max(500, Math.floor(value)))
                  }
                />
              </InlineDisclosure>

              <InlineDisclosure title={t('display')}>
                <SelectField
                  label={t('display_mode')}
                  hint={t('particles_are_shown_by_default')}
                  value={vectorDisplayMode}
                  onChange={(value) => setParam('vectorDisplayMode', value)}
                  options={[
                    { value: 'particles', label: t('particles_only') },
                    { value: 'vectors', label: t('vectors_only') },
                    { value: 'both', label: t('vectors_plus_particles') },
                  ]}
                />
                <RangeField
                  label={t('vector_length')}
                  hint={t('hint_vector_length')}
                  min={0.1}
                  max={60}
                  step={0.01}
                  value={params.arrowScale}
                  onChange={(value) => setParam('arrowScale', value)}
                />
                <RangeField
                  label={t('arrow_opacity')}
                  hint={t('hint_arrow_opacity')}
                  min={0.05}
                  max={1}
                  step={0.01}
                  value={params.arrowOpacity ?? 1}
                  onChange={(value) => setParam('arrowOpacity', value)}
                />
                <RangeField
                  label={t('vector_arrow_size')}
                  min={0.01}
                  max={1}
                  step={0.01}
                  value={params.arrowHead}
                  onChange={(value) => setParam('arrowHead', value)}
                />
              </InlineDisclosure>

              <InlineDisclosure title={t('trajectories')}>
                <CheckboxField
                  label={t('curved_vectors_along_trajectory')}
                  checked={params.curvedVectors}
                  onChange={(value) => setParam('curvedVectors', value)}
                />
                <RangeField
                  label={t('curve_segment_count')}
                  hint={t('hint_curve_segment_count')}
                  min={4}
                  max={64}
                  step={1}
                  value={params.curveSamples}
                  onChange={(value) => setParam('curveSamples', Math.max(4, Math.floor(value)))}
                />
                <RangeField
                  label={t('trajectory_trail_length')}
                  hint={t('hint_trajectory_trail')}
                  min={2}
                  max={40}
                  step={1}
                  value={params.curveHistoryLength}
                  onChange={(value) =>
                    setParam('curveHistoryLength', Math.max(2, Math.floor(value)))
                  }
                />
                <RangeField
                  label={t('trajectory_bend_strength')}
                  hint={t('hint_trajectory_bend_strength')}
                  min={0}
                  max={1}
                  step={0.01}
                  value={params.curveStrength}
                  onChange={(value) => setParam('curveStrength', value)}
                />
              </InlineDisclosure>

              <InlineDisclosure title={t('color')} hint={t('color_map_for_slow_and_fast')}>
                <ColorField
                  label={t('fast')}
                  value={params.colorFast}
                  onChange={(value) => setParam('colorFast', value)}
                />
                <ColorField
                  label={t('slow')}
                  value={params.colorSlow}
                  onChange={(value) => setParam('colorSlow', value)}
                />
                <CheckboxField
                  label={t('invert_colors')}
                  hint={t('hint_invert_colors')}
                  checked={params.invertColors}
                  onChange={(value) => setParam('invertColors', value)}
                />
              </InlineDisclosure>
            </DisclosureSection>

            <DisclosureSection
              title={t('emission')}
              description={t('emitter_geometry_pulsed_emission_settings_and_outgoing_jet_swirl')}
            >
              <InlineDisclosure title={t('emitter')}>
              <RangeField
                label={t('emitter_position_x')}
                hint={t('hint_emitter_position')}
                min={-10}
                max={10}
                step={0.01}
                value={nozzlePosition.x}
                onChange={(value) => setNozzlePosition({ x: value })}
              />
              <RangeField
                label={t('emitter_position_y')}
                hint={t('hint_emitter_position')}
                min={-10}
                max={10}
                step={0.01}
                value={nozzlePosition.y}
                onChange={(value) => setNozzlePosition({ y: value })}
              />
              <RangeField
                label={t('emitter_position_z')}
                hint={t('hint_emitter_position')}
                min={-10}
                max={10}
                step={0.01}
                value={nozzlePosition.z}
                onChange={(value) => setNozzlePosition({ z: value })}
              />
              <RangeField
                label={t('emitter_radius_r')}
                hint={t('hint_emitter_radius')}
                min={0.005}
                max={5}
                step={0.005}
                value={params.nozzleRadius}
                onChange={(value) => setParam('nozzleRadius', value)}
              />
              <SelectField
                label={t('emitter_direction_axis')}
                hint={t('hint_emission_direction_axis')}
                value={nozzleAxis}
                onChange={handleNozzleAxisChange}
                options={[
                  { value: '+x', label: '+X' },
                  { value: '-x', label: '-X' },
                  { value: '+y', label: '+Y' },
                  { value: '-y', label: '-Y' },
                  { value: '+z', label: '+Z' },
                  { value: '-z', label: '-Z' },
                ]}
              />
              <CheckboxField
                label={t('multi_emitter_preset')}
                checked={params.multiEmitterPresetEnabled === true}
                onChange={(value) => setParam('multiEmitterPresetEnabled', value)}
              />
              <RangeField
                label={t('multi_emitter_count')}
                min={1}
                max={3}
                step={1}
                value={multiEmitter.count}
                onChange={(value) => setParam('multiEmitterCount', Math.max(1, Math.min(3, Math.floor(value))))}
              />
              <CheckboxField
                label={t('multi_emitter_rotate_mouse')}
                hint={params.multiEmitterPresetEnabled === true ? t('multi_emitter_rotate_hint') : undefined}
                checked={params.multiEmitterRotateByMouse === true}
                onChange={(value) => setParam('multiEmitterRotateByMouse', value)}
              />
              {params.multiEmitterPresetEnabled === true
                ? Array.from({ length: multiEmitter.count }).map((_, emitterIndex) => {
                    const emitterConfig = multiEmitter.emitters[emitterIndex] ?? {}
                    const selected = multiEmitter.selectedIndex === emitterIndex
                    return (
                      <InlineDisclosure
                        key={`multi-emitter-${emitterIndex + 1}`}
                        title={`${t('emitter')} ${emitterIndex + 1}`}
                      >
                        <div className="space-y-2">
                          <button
                            className={`rounded border px-2 py-1 text-[11px] ${
                              selected
                                ? 'border-cyan-500/80 bg-cyan-900/40 text-cyan-100'
                                : 'border-slate-600 bg-slate-800/70 text-slate-300 hover:border-slate-500'
                            }`}
                            onClick={() => setParam('multiEmitterSelectedIndex', emitterIndex)}
                            type="button"
                          >
                            {selected ? t('multi_emitter_selected') : t('multi_emitter_select')}
                          </button>
                          <CheckboxField
                            label={t('multi_emitter_enabled')}
                            checked={emitterConfig.enabled === true}
                            onChange={(value) => updateMultiEmitterAt(emitterIndex, { enabled: value })}
                          />
                          <CheckboxField
                            label={t('multi_emitter_visible')}
                            checked={emitterConfig.visible === true}
                            onChange={(value) => updateMultiEmitterAt(emitterIndex, { visible: value })}
                          />
                          <CheckboxField
                            label={t('multi_emitter_opposite_direction')}
                            checked={emitterConfig.oppositeDirection === true}
                            onChange={(value) =>
                              updateMultiEmitterAt(emitterIndex, { oppositeDirection: value })
                            }
                          />
                          <RangeField
                            label={t('multi_emitter_delay_ms')}
                            min={0}
                            max={5000}
                            step={10}
                            value={emitterConfig.delayMs ?? 0}
                            onChange={(value) => updateMultiEmitterAt(emitterIndex, { delayMs: value })}
                          />
                          <RangeField
                            label={t('multi_emitter_offset_x')}
                            hint={t('hint_multi_emitter_offset')}
                            min={-10}
                            max={10}
                            step={0.01}
                            value={emitterConfig.offsetX ?? 0}
                            onChange={(value) => updateMultiEmitterAt(emitterIndex, { offsetX: value })}
                          />
                          <RangeField
                            label={t('multi_emitter_offset_y')}
                            hint={t('hint_multi_emitter_offset')}
                            min={-10}
                            max={10}
                            step={0.01}
                            value={emitterConfig.offsetY ?? 0}
                            onChange={(value) => updateMultiEmitterAt(emitterIndex, { offsetY: value })}
                          />
                          <RangeField
                            label={t('multi_emitter_offset_z')}
                            hint={t('hint_multi_emitter_offset')}
                            min={-10}
                            max={10}
                            step={0.01}
                            value={emitterConfig.offsetZ ?? 0}
                            onChange={(value) => updateMultiEmitterAt(emitterIndex, { offsetZ: value })}
                          />
                          <RangeField
                            label={t('multi_emitter_yaw')}
                            hint={t('hint_multi_emitter_yaw')}
                            min={-180}
                            max={180}
                            step={1}
                            value={emitterConfig.yawDeg ?? 0}
                            valueSuffix="°"
                            onChange={(value) => updateMultiEmitterAt(emitterIndex, { yawDeg: value })}
                          />
                          <RangeField
                            label={t('multi_emitter_pitch')}
                            hint={t('hint_multi_emitter_pitch')}
                            min={-89}
                            max={89}
                            step={1}
                            value={emitterConfig.pitchDeg ?? 0}
                            valueSuffix="°"
                            onChange={(value) => updateMultiEmitterAt(emitterIndex, { pitchDeg: value })}
                          />
                        </div>
                      </InlineDisclosure>
                    )
                  })
                : null}
              </InlineDisclosure>

              <InlineDisclosure title={t('mode_and_section')}>
              <SelectField
                label={t('emission_mode')}
                hint={isJetRollupEmission ? t('jet_rollup_dynamic_hint') : t('hint_emission_mode')}
                value={params.emissionMode}
                onChange={(value) => setParam('emissionMode', value)}
                options={[
                  { value: 'continuousJet', label: t('continuous_jet') },
                  { value: 'particleStream', label: t('particle_stream') },
                  { value: 'vortexRing', label: t('vortex_ring') },
                  { value: 'vortexKnot', label: t('vortex_knot_trefoil') },
                  { value: 'tube', label: t('vortex_tube') },
                  { value: 'jetRollup', label: t('jet_rollup_emitter') },
                ]}
              />
              {!isRingBasedEmission ? (
                <>
                  <SelectField
                    label={t('emitter_section_geometry')}
                    hint={
                      params.nozzleSectionMode === 'circle' ? t('uniform_filling_of_the_circular_emitter') :
                      params.nozzleSectionMode === 'fibonacci' ? t('points_placed_by_golden_angle') :
                      params.nozzleSectionMode === 'helicoid' ? t('ribbon_spirals_in_jet_cross_section') :
                      params.nozzleSectionMode === 'discrete' ? t('fixed_number_of_sectors_in_cross_section') :
                      undefined
                    }
                    value={params.nozzleSectionMode}
                    onChange={(value) => setParam('nozzleSectionMode', value)}
                    options={[
                      { value: 'circle', label: t('circular') },
                      { value: 'fibonacci', label: t('fibonacci_spiral') },
                      { value: 'helicoid', label: t('helicoid') },
                      { value: 'discrete', label: t('discrete_sectors') },
                    ]}
                  />
                  <CheckboxField
                    label={t('emitter_visibility')}
                    checked={params.showNozzle}
                    onChange={(value) => setParam('showNozzle', value)}
                  />
                  <CheckboxField
                    label={t('emitter_housing_enabled')}
                    checked={params.emitterHousingEnabled !== false}
                    onChange={(value) => setParam('emitterHousingEnabled', value)}
                  />
                  <SelectField
                    label={t('emitter_housing_style')}
                    value={params.emitterHousingStyle === 'blackHole' ? 'blackHole' : 'woodBox'}
                    onChange={(value) => setParam('emitterHousingStyle', value)}
                    options={[
                      { value: 'woodBox', label: t('emitter_housing_style_wood_box') },
                      { value: 'blackHole', label: t('emitter_housing_style_default') },
                    ]}
                  />
                  {params.nozzleSectionMode === 'fibonacci' && (
                    <>
                      <RangeField
                        label={t('spiral_point_count')}
                        hint={t('hint_spiral_point_count')}
                        min={12}
                        max={377}
                        step={1}
                        value={params.fibPointsPerPulse}
                        onChange={(value) =>
                          setParam('fibPointsPerPulse', Math.max(1, Math.floor(value)))
                        }
                      />
                      <RangeField
                        label={t('spiral_scale')}
                        min={0.1}
                        max={1.5}
                        step={0.01}
                        value={params.fibScale}
                        onChange={(value) => setParam('fibScale', value)}
                      />
                      <RangeField
                        label={t('spiral_turns')}
                        hint={t('hint_spiral_turns')}
                        min={0.2}
                        max={4}
                        step={0.01}
                        value={params.fibTurns}
                        onChange={(value) => setParam('fibTurns', value)}
                      />
                      <RangeField
                        label={t('radial_jitter')}
                        min={0}
                        max={0.4}
                        step={0.01}
                        value={params.fibJitter}
                        onChange={(value) => setParam('fibJitter', value)}
                      />
                    </>
                  )}
                  {params.nozzleSectionMode === 'helicoid' && (
                    <>
                      <RangeField
                        label={t('turns_count')}
                        min={0.5}
                        max={8}
                        step={0.01}
                        value={params.helicoidTurns}
                        onChange={(value) => setParam('helicoidTurns', value)}
                      />
                      <RangeField
                        label={t('helicoid_pitch')}
                        min={0.05}
                        max={1}
                        step={0.01}
                        value={params.helicoidPitch}
                        onChange={(value) => setParam('helicoidPitch', value)}
                      />
                      <RangeField
                        label={t('band_count')}
                        min={1}
                        max={12}
                        step={1}
                        value={params.helicoidBands}
                        onChange={(value) =>
                          setParam('helicoidBands', Math.max(1, Math.floor(value)))
                        }
                      />
                      <RangeField
                        label={t('helicoid_jitter')}
                        min={0}
                        max={0.4}
                        step={0.01}
                        value={params.helicoidJitter}
                        onChange={(value) => setParam('helicoidJitter', value)}
                      />
                      <RangeField
                        label={t('phase_shift_speed')}
                        hint={t('hint_phase_shift_speed')}
                        min={0}
                        max={1}
                        step={0.01}
                        value={params.helicoidPhaseSpeed}
                        onChange={(value) => setParam('helicoidPhaseSpeed', value)}
                      />
                    </>
                  )}
                  {params.nozzleSectionMode === 'discrete' && (
                    <>
                      <SelectField
                        label={t('sector_count')}
                        value={String(params.discreteSectionCount)}
                        onChange={(value) => setParam('discreteSectionCount', Number(value))}
                        options={[
                          { value: '3', label: '3' },
                          { value: '6', label: '6' },
                          { value: '9', label: '9' },
                          { value: '15', label: '15' },
                          { value: '28', label: '28' },
                        ]}
                      />
                      <RangeField
                        label={t('sector_width')}
                        hint={t('hint_sector_width')}
                        min={0.05}
                        max={1}
                        step={0.01}
                        value={params.discreteBandWidth}
                        onChange={(value) => setParam('discreteBandWidth', value)}
                      />
                      <RangeField
                        label={t('angular_jitter')}
                        min={0}
                        max={0.5}
                        step={0.01}
                        value={params.discreteAngularJitter}
                        onChange={(value) => setParam('discreteAngularJitter', value)}
                      />
                      <RangeField
                        label={t('radial_jitter')}
                        min={0}
                        max={0.5}
                        step={0.01}
                        value={params.discreteRadialJitter}
                        onChange={(value) => setParam('discreteRadialJitter', value)}
                      />
                    </>
                  )}
                </>
              ) : null}
              {isRingBasedEmission && (
                <InlineDisclosure
                  title={
                    params.emissionMode === 'vortexKnot'
                      ? t('vortex_knot_trefoil')
                      : params.emissionMode === 'tube'
                        ? t('vortex_tube')
                        : t('vortex_ring')
                  }
                  hint={t('ring_diagnostic_modes_are_in_the_debug_section')}
                >
                  <SelectField
                    label={t('particle_count')}
                    hint={params.emissionMode === 'vortexKnot' ? t('trefoil_knot_filament_hint') : undefined}
                    value={String(uiRingResolution)}
                    onChange={(value) => setParam('ringResolution', Number(value))}
                    options={[
                      { value: '60', label: '60' },
                      { value: '120', label: '120' },
                      { value: '180', label: '180' },
                      { value: '240', label: '240' },
                      { value: '300', label: '300' },
                      { value: '360', label: '360' },
                    ]}
                  />
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-200">
                    <span>{t('multiplier')}</span>
                    <div className="flex items-center gap-1">
                      {[3, 6, 9].map((option) => {
                        const isActive = ringResolutionMultiplier === option
                        return (
                          <button
                            key={option}
                            type="button"
                            className={`rounded border px-2 py-1 text-[11px] font-semibold transition-colors ${
                              isActive
                                ? 'border-cyan-400 bg-cyan-900/70 text-cyan-100'
                                : 'border-slate-600 bg-slate-800/70 text-slate-300 hover:border-slate-500'
                            }`}
                            onClick={() =>
                              setParam(
                                'ringResolutionMultiplier',
                                isActive ? 1 : option,
                              )
                            }
                          >
                            {option}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {t('ring_particles')} {uiRingResolution} × {ringResolutionMultiplier} = {effectiveRingResolution}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {t('formation_number')}: F = {formationNumber.toFixed(2)}
                  </p>
                </InlineDisclosure>
              )}
              </InlineDisclosure>

              <InlineDisclosure title={t('ejection_dynamics')}>
              <RangeField
                label={t('jet_speed_v')}
                hint={t('hint_jet_speed')}
                min={0.01}
                max={100}
                step={0.01}
                value={params.jetSpeed}
                disabled={lockJetSpeed}
                onChange={handleJetSpeedChange}
              />
              <RangeField
                label={t('swirl_intensity_tau')}
                hint={t('hint_swirl_intensity')}
                min={0}
                max={2 * Math.PI}
                step={0.01}
                value={params.jetTwist}
                onChange={(value) => setParam('jetTwist', value)}
              />
              <RangeField
                label={t('swirl_core_radius')}
                hint={t('hint_swirl_core_radius')}
                min={0.01}
                max={3}
                step={0.01}
                value={params.twistCoreRadius}
                onChange={(value) => setParam('twistCoreRadius', value)}
              />
              <RangeField
                label={t('decay_coefficient_beta')}
                hint={t('hint_decay_beta')}
                min={0}
                max={5}
                step={0.01}
                value={params.twistAxialDecay}
                onChange={(value) => setParam('twistAxialDecay', value)}
              />
              <RangeField
                label={t('swirl_transfer_coefficient')}
                min={0}
                max={1}
                step={0.01}
                value={params.twistToRingCoupling}
                onChange={(value) => setParam('twistToRingCoupling', value)}
              />
              <RangeField
                label={t('pulse_duration_t')}
                hint={t('hint_pulse_duration')}
                min={0.01}
                max={60}
                step={0.01}
                value={params.pulseDuration}
                disabled={lockPulseDuration}
                onChange={handlePulseDurationChange}
              />
              {isJetRollupEmission ? (
                <>
                  <RangeField
                    label={t('pulse_interval_t_off')}
                    hint={t('hint_pulse_interval')}
                    min={0}
                    max={60}
                    step={0.05}
                    value={params.jetRollupPulseInterval}
                    onChange={(value) => setParam('jetRollupPulseInterval', value)}
                  />
                  <RangeField
                    label={t('pulse_strength')}
                    hint={t('hint_pulse_strength')}
                    min={0}
                    max={3}
                    step={0.01}
                    value={params.jetRollupPulseStrength}
                    onChange={(value) => setParam('jetRollupPulseStrength', value)}
                  />
                  <RangeField
                    label={t('rollup_noise_amplitude')}
                    hint={t('hint_rollup_noise')}
                    min={0}
                    max={2}
                    step={0.01}
                    value={params.jetRollupNoiseAmplitude}
                    onChange={(value) => setParam('jetRollupNoiseAmplitude', value)}
                  />
                  <RangeField
                    label={t('edge_vorticity')}
                    hint={t('hint_edge_vorticity')}
                    min={0}
                    max={2}
                    step={0.01}
                    value={params.jetRollupEdgeVorticity}
                    onChange={(value) => setParam('jetRollupEdgeVorticity', value)}
                  />
                  <RangeField
                    label={t('stroke_length')}
                    hint={t('hint_stroke_length')}
                    min={0}
                    max={30}
                    step={0.05}
                    value={params.jetRollupStrokeLength}
                    onChange={(value) => setParam('jetRollupStrokeLength', value)}
                  />
                  <RangeField
                    label={t('edge_layer_threshold')}
                    hint={t('hint_edge_layer_threshold')}
                    min={0.4}
                    max={0.98}
                    step={0.01}
                    value={params.jetRollupEdgeThreshold}
                    onChange={(value) => setParam('jetRollupEdgeThreshold', value)}
                  />
                  <CheckboxField
                    label={t('jet_rollup_autotune')}
                    checked={params.jetRollupAutoTuneEnabled}
                    onChange={(value) => setParam('jetRollupAutoTuneEnabled', value)}
                  />
                </>
              ) : null}
              <SelectField
                label={t('emission_coupling_mode')}
                hint={t('hint_emission_coupling')}
                value={emissionCouplingMode}
                onChange={(value) => setParam('emissionCouplingMode', value)}
                options={[
                  { value: 'free', label: t('emission_coupling_free') },
                  { value: 'lockFormation', label: t('emission_coupling_lock_formation') },
                  {
                    value: 'lockPulseDuration',
                    label: t('emission_coupling_lock_pulse_duration'),
                  },
                  { value: 'lockJetSpeed', label: t('emission_coupling_lock_jet_speed') },
                ]}
              />
              <p className="text-[11px] text-slate-500">
                {t('formation_number')}: F = {formationNumber.toFixed(2)} (L = V₀·Tₚ, D = 2R₀ ={' '}
                {nozzleDiameter.toFixed(2)})
              </p>
              {isJetRollupEmission ? (
                <div className={`rounded border px-2 py-1 text-[11px] ${jetRollupGuardClassName}`}>
                  <p className="font-medium">{t('jet_rollup_scientific_guard')}</p>
                  <p>
                    {t('jet_rollup_effective_slug_length')}: L_eff = {effectiveStrokeLength.toFixed(3)} /{' '}
                    {t('jet_rollup_effective_formation_number')}: F_eff = {effectiveFormationNumber.toFixed(2)} /{' '}
                    {t('jet_rollup_envelope_status')}: {jetRollupEnvelopeStatus}
                  </p>
                  {effectiveFormationNumber > 4 ? (
                    <p className="mt-1">
                      {t('jet_rollup_guard_fix_hint')}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <RangeField
                label={t('pulse_frequency_f')}
                hint={t('hint_pulse_frequency')}
                min={0.01}
                max={50}
                step={0.01}
                value={params.frequency}
                onChange={(value) => setParam('frequency', value)}
              />
              <SelectField
                label={t('temporal_waveform')}
                hint={t('hint_temporal_waveform')}
                value={params.pulseShape}
                onChange={(value) => setParam('pulseShape', value)}
                options={[
                  { value: 'rectangular', label: t('rectangular') },
                  { value: 'sin', label: t('sinusoidal') },
                  { value: 'gaussian', label: t('gaussian') },
                ]}
              />
              <RangeField
                label={t('emission_density')}
                hint={t('hint_emission_density')}
                min={1}
                max={360}
                step={1}
                value={params.spawnRate}
                onChange={(value) => setParam('spawnRate', Math.max(1, Math.floor(value)))}
              />
              </InlineDisclosure>

              <InlineDisclosure title={t('pulse_control')} hint={t('hotkeys_single_pulse_or_reset_particles')}>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                  onClick={singlePulse}
                  type="button"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/></svg>
                  {t('single_pulse')}
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                  onClick={startPulseTrain}
                  type="button"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  {t('start_train')}
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                  onClick={stopPulseTrain}
                  type="button"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                  {t('stop_train')}
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                  onClick={handleResetScene}
                  type="button"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  {t('reset_particles')}
                </button>
              </div>
              </InlineDisclosure>
            </DisclosureSection>

            <DisclosureSection
              title={t('vortex_representation')}
              description={t('choose_vortex_representation_particles_filaments_or_hybrid')}
            >
              <SelectField
                label={t('representation_mode')}
                hint={
                  hybridMismatch ? t('mode_conflict_requires_and') :
                  representationRestrictionHintKey ? t(representationRestrictionHintKey) :
                  undefined
                }
                value={params.vortexRepresentation}
                onChange={(value) =>
                  setParams({
                    vortexRepresentation: value,
                    ...(value === 'filaments' || value === 'hybrid' || value === 'tubes'
                      ? { showFilaments: true }
                      : {}),
                  })
                }
                options={representationOptions}
              />
              {(params.vortexRepresentation === 'filaments' ||
                params.vortexRepresentation === 'hybrid' ||
                params.vortexRepresentation === 'tubes') && (
                <>
                  <InlineDisclosure title={t('filament_cat_discretization')}>
                    <RangeField
                      label={t('filament_core_radius')}
                      hint={t('hint_filament_core_radius')}
                      min={0.0005}
                      max={2}
                      step={0.0005}
                      value={params.filamentCoreRadius}
                      onChange={(value) => setParam('filamentCoreRadius', value)}
                    />
                    <RangeField
                      label={t('filament_node_count')}
                      hint={t('hint_filament_node_count')}
                      min={8}
                      max={512}
                      step={1}
                      value={params.filamentNodeCount}
                      onChange={(value) =>
                        setParam('filamentNodeCount', Math.max(8, Math.floor(value)))
                      }
                    />
                    <RangeField
                      label={t('max_filament_nodes_alt')}
                      hint={t('hint_max_filament_nodes')}
                      min={32}
                      max={2000}
                      step={1}
                      value={params.maxFilamentNodes}
                      onChange={(value) =>
                        setParam('maxFilamentNodes', Math.max(32, Math.floor(value)))
                      }
                    />
                    <RangeField
                      label={t('max_segment_length')}
                      hint={t('hint_max_segment_length')}
                      min={0.01}
                      max={2}
                      step={0.01}
                      value={params.maxSegmentLength}
                      onChange={(value) => setParam('maxSegmentLength', value)}
                    />
                    <RangeField
                      label={t('min_segment_length')}
                      hint={t('hint_min_segment_length')}
                      min={0.005}
                      max={1}
                      step={0.005}
                      value={params.minSegmentLength}
                      onChange={(value) => setParam('minSegmentLength', value)}
                    />
                    <RangeField
                      label={t('filament_adapt_iterations_alt')}
                      hint={t('hint_filament_adapt_iterations')}
                      min={4}
                      max={256}
                      step={1}
                      value={params.filamentAdaptMaxIterations}
                      onChange={(value) =>
                        setParam('filamentAdaptMaxIterations', Math.max(4, Math.floor(value)))
                      }
                    />
                    <RangeField
                      label={t('filament_cfl_safety')}
                      hint={t('hint_filament_cfl')}
                      min={0.05}
                      max={1}
                      step={0.01}
                      value={params.filamentCflSafety}
                      onChange={(value) => setParam('filamentCflSafety', value)}
                    />
                    <RangeField
                      label={t('filament_max_substeps')}
                      hint={t('hint_filament_max_substeps')}
                      min={2}
                      max={24}
                      step={1}
                      value={params.filamentMaxSubsteps}
                      onChange={(value) => setParam('filamentMaxSubsteps', value)}
                    />
                    <CheckboxField
                      label={t('filament_coupling_substeps')}
                      hint={t('hint_filament_coupling_substeps')}
                      checked={params.filamentCouplingSubsteps}
                      onChange={(value) => setParam('filamentCouplingSubsteps', value)}
                    />
                  </InlineDisclosure>
                  <InlineDisclosure title={t('filament_cat_reconnect')}>
                    <CheckboxField
                      label={t('reconnect_enabled')}
                      hint={t('hint_reconnect_enabled')}
                      checked={params.reconnectEnabled !== false}
                      onChange={(value) => setParam('reconnectEnabled', value)}
                    />
                    <CheckboxField
                      label={t('reconnect_inter_filament_enabled')}
                      hint={t('hint_reconnect_inter_filament')}
                      checked={params.reconnectInterFilamentEnabled !== false}
                      onChange={(value) => setParam('reconnectInterFilamentEnabled', value)}
                    />
                    <RangeField
                      label={t('reconnect_distance_threshold_alt')}
                      hint={t('hint_reconnect_distance')}
                      min={0}
                      max={2}
                      step={0.001}
                      value={params.reconnectDistanceThreshold}
                      onChange={(value) => {
                        setParam('reconnectDistanceThreshold', value)
                        setParam('reconnectionThreshold', value)
                      }}
                    />
                    <RangeField
                      label={t('reconnect_angle_threshold_deg_alt')}
                      hint={t('hint_reconnect_angle')}
                      min={0}
                      max={180}
                      step={1}
                      value={params.reconnectAngleThresholdDeg}
                      valueSuffix="°"
                      onChange={(value) =>
                        setParam('reconnectAngleThresholdDeg', Math.max(0, Math.floor(value)))
                      }
                    />
                    <RangeField
                      label={t('reconnect_cooldown_steps_alt')}
                      hint={t('hint_reconnect_cooldown')}
                      min={0}
                      max={128}
                      step={1}
                      value={params.filamentReconnectCooldownSteps}
                      onChange={(value) =>
                        setParam('filamentReconnectCooldownSteps', Math.max(0, Math.floor(value)))
                      }
                    />
                    <CheckboxField
                      label={t('reconnect_multiple_enabled_alt')}
                      hint={t('hint_reconnect_multiple')}
                      checked={params.reconnectMultipleEnabled !== false}
                      onChange={(value) => setParam('reconnectMultipleEnabled', value)}
                    />
                    <RangeField
                      label={t('reconnect_max_per_step_alt')}
                      hint={t('hint_reconnect_max_per_step')}
                      min={1}
                      max={32}
                      step={1}
                      value={params.reconnectMaxPerStep}
                      onChange={(value) =>
                        setParam('reconnectMaxPerStep', Math.max(1, Math.floor(value)))
                      }
                    />
                    <CheckboxField
                      label={t('reconnect_vortex_annihilation_enabled_alt')}
                      hint={t('hint_reconnect_annihilation')}
                      checked={params.reconnectVortexAnnihilationEnabled !== false}
                      onChange={(value) => setParam('reconnectVortexAnnihilationEnabled', value)}
                    />
                    <RangeField
                      label={t('reconnect_annihilation_circulation_threshold_alt')}
                      hint={t('hint_reconnect_annihilation_threshold')}
                      min={0}
                      max={1}
                      step={0.001}
                      value={params.reconnectAnnihilationCirculationThreshold}
                      onChange={(value) =>
                        setParam('reconnectAnnihilationCirculationThreshold', value)
                      }
                    />
                  </InlineDisclosure>
                  <InlineDisclosure title={t('filament_cat_smoothing')}>
                    <RangeField
                      label={t('filament_smoothing')}
                      hint={t('hint_filament_smoothing')}
                      min={0}
                      max={1}
                      step={0.01}
                      value={params.filamentSmoothing}
                      onChange={(value) => setParam('filamentSmoothing', value)}
                    />
                    <RangeField
                      label={t('filament_curvature_smoothing_gain_alt')}
                      hint={t('hint_filament_curvature_smoothing_gain')}
                      min={0}
                      max={4}
                      step={0.01}
                      value={params.filamentCurvatureSmoothingGain}
                      onChange={(value) => setParam('filamentCurvatureSmoothingGain', value)}
                    />
                    <RangeField
                      label={t('filament_curvature_smoothing_clamp_alt')}
                      hint={t('hint_filament_curvature_smoothing_clamp')}
                      min={0}
                      max={1}
                      step={0.01}
                      value={params.filamentCurvatureSmoothingClamp}
                      onChange={(value) => setParam('filamentCurvatureSmoothingClamp', value)}
                    />
                    <RangeField
                      label={t('regularization_curvature_strength_alt')}
                      hint={t('hint_regularization_curvature_strength')}
                      min={0}
                      max={4}
                      step={0.01}
                      value={params.filamentRegularizationCurvatureStrength}
                      onChange={(value) =>
                        setParam('filamentRegularizationCurvatureStrength', value)
                      }
                    />
                    <RangeField
                      label={t('regularization_curvature_clamp_alt')}
                      hint={t('hint_regularization_curvature_clamp')}
                      min={0.01}
                      max={0.5}
                      step={0.01}
                      value={params.filamentRegularizationCurvatureClamp}
                      onChange={(value) => setParam('filamentRegularizationCurvatureClamp', value)}
                    />
                  </InlineDisclosure>
                  <InlineDisclosure title={t('filament_cat_integration_lia')}>
                    <SelectField
                      label={t('filament_integrator_mode')}
                      value={params.filamentIntegrator}
                      onChange={(value) => setParam('filamentIntegrator', value)}
                      options={[
                        { value: 'euler', label: t('filament_integrator_euler') },
                        { value: 'rk2', label: t('filament_integrator_rk2') },
                        { value: 'rk3', label: t('filament_integrator_rk3') },
                      ]}
                    />
                    <CheckboxField
                      label={t('filament_kelvin_wave_enabled')}
                      hint={t('hint_kelvin_wave')}
                      checked={params.filamentKelvinWaveEnabled === true}
                      onChange={(value) => setParam('filamentKelvinWaveEnabled', value)}
                    />
                    <RangeField
                      label={t('filament_lia_strength_alt')}
                      hint={t('hint_filament_lia_strength')}
                      min={0}
                      max={4}
                      step={0.01}
                      value={params.filamentLiaStrength}
                      onChange={(value) => setParam('filamentLiaStrength', value)}
                    />
                    <RangeField
                      label={t('filament_lia_clamp_ratio_alt')}
                      hint={t('hint_filament_lia_clamp')}
                      min={0.05}
                      max={2}
                      step={0.01}
                      value={params.filamentLiaClampRatio}
                      onChange={(value) => setParam('filamentLiaClampRatio', value)}
                    />
                    <RangeField
                      label={t('filament_circulation_drift_warn_percent_alt')}
                      hint={t('hint_circulation_drift_warn')}
                      min={0}
                      max={100}
                      step={0.1}
                      value={params.filamentCirculationDriftWarnPercent}
                      onChange={(value) => setParam('filamentCirculationDriftWarnPercent', value)}
                    />
                  </InlineDisclosure>
                  <InlineDisclosure title={t('filament_cat_hybrid_legacy')} hint={t('filament_center_lock_emergency_hint') + '\n' + t('filament_fallback_controls_warning')}>
                    <p className="text-[11px]">
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 font-medium ${
                          filamentFallbackModeActive
                            ? 'bg-amber-500/20 text-amber-200'
                            : 'bg-blue-500/20 text-blue-200'
                        }`}
                      >
                        {filamentFallbackModeActive
                          ? t('filament_fallback_status_active')
                          : t('filament_fallback_status_standby')}
                      </span>
                    </p>
                    {filamentFallbackModeActive ? (
                      <p className="text-[11px] text-slate-400">
                        {t('filament_fallback_status_reasons')}:{' '}
                        {[
                          ...(params.filamentCenterLockEnabled === true
                            ? [t('filament_fallback_reason_center_lock_enabled')]
                            : []),
                          ...filamentFallbackDeviationReasons,
                        ].join(', ')}
                      </p>
                    ) : null}
                    <CheckboxField
                      label={t('filament_show_advanced_fallback_controls')}
                      hint={t('filament_emergency_controls_hidden_hint')}
                      checked={filamentEmergencyControlsVisible}
                      onChange={(value) => setShowFilamentEmergencyControls(value)}
                    />
                    {filamentEmergencyControlsVisible ? (
                      <>
                        <RangeField
                          label={t('filament_velocity_scale_alt')}
                          hint={t('hint_filament_velocity_scale')}
                          min={0.05}
                          max={3}
                          step={0.01}
                          value={params.filamentVelocityScale}
                          onChange={(value) => setParam('filamentVelocityScale', value)}
                        />
                        <RangeField
                          label={t('filament_multi_filament_velocity_factor')}
                          hint={t('filament_multi_filament_velocity_factor_hint')}
                          min={0.2}
                          max={2}
                          step={0.05}
                          value={params.filamentMultiFilamentVelocityFactor ?? 1}
                          onChange={(value) => setParam('filamentMultiFilamentVelocityFactor', value)}
                        />
                        <CheckboxField
                          label={t('filament_center_lock_enabled')}
                          checked={params.filamentCenterLockEnabled === true}
                          onChange={(value) => setParam('filamentCenterLockEnabled', value)}
                        />
                        <RangeField
                          label={t('filament_center_lock_gain_alt')}
                          min={0}
                          max={1}
                          step={0.01}
                          value={params.filamentCenterLockGain}
                          onChange={(value) => setParam('filamentCenterLockGain', value)}
                        />
                        <RangeField
                          label={t('filament_center_lock_max_shift_ratio_alt')}
                          hint={t('hint_filament_center_lock_max_shift')}
                          min={0.01}
                          max={2}
                          step={0.01}
                          value={params.filamentCenterLockMaxShiftRatio}
                          onChange={(value) => setParam('filamentCenterLockMaxShiftRatio', value)}
                        />
                      </>
                    ) : null}
                  </InlineDisclosure>
                  {params.vortexRepresentation === 'tubes' ? (
                    <InlineDisclosure title={t('filament_cat_tubes')}>
                      <RangeField
                        label={t('tube_radius')}
                        hint={t('hint_tube_radius')}
                        min={0.005}
                        max={2}
                        step={0.001}
                        value={params.tubeRadius}
                        onChange={(value) => setParam('tubeRadius', value)}
                      />
                      <RangeField
                        label={t('tube_core_sigma')}
                        hint={t('hint_tube_core_sigma')}
                        min={0.001}
                        max={1}
                        step={0.001}
                        value={params.tubeCoreSigma}
                        onChange={(value) => setParam('tubeCoreSigma', value)}
                      />
                      <RangeField
                        label={t('tube_layers')}
                        hint={t('hint_tube_layers')}
                        min={1}
                        max={8}
                        step={1}
                        value={params.tubeLayers}
                        onChange={(value) => setParam('tubeLayers', Math.max(1, Math.floor(value)))}
                      />
                      <RangeField
                        label={t('tube_particles_per_ring')}
                        hint={t('hint_tube_particles_per_ring')}
                        min={6}
                        max={128}
                        step={1}
                        value={params.tubeParticlesPerRing}
                        onChange={(value) =>
                          setParam('tubeParticlesPerRing', Math.max(6, Math.floor(value)))
                        }
                      />
                      <RangeField
                        label={t('tube_reproject_cadence_steps')}
                        hint={t('hint_tube_reproject_cadence')}
                        min={1}
                        max={64}
                        step={1}
                        value={params.tubeReprojectCadenceSteps}
                        onChange={(value) =>
                          setParam('tubeReprojectCadenceSteps', Math.max(1, Math.floor(value)))
                        }
                      />
                      <RangeField
                        label={t('tube_reproject_threshold')}
                        hint={t('hint_tube_reproject_threshold')}
                        min={0}
                        max={2}
                        step={0.01}
                        value={params.tubeReprojectThreshold}
                        onChange={(value) => setParam('tubeReprojectThreshold', value)}
                      />
                      <SelectField
                        label={t('tube_view_mode')}
                        value={params.tubeViewMode}
                        onChange={(value) => setParam('tubeViewMode', value)}
                        options={[
                          { value: 'particles', label: t('tube_view_particles') },
                          { value: 'surface', label: t('tube_view_surface') },
                          { value: 'spine_particles', label: t('tube_view_spine_particles') },
                        ]}
                      />
                    </InlineDisclosure>
                  ) : null}
                  {params.vortexRepresentation === 'hybrid' ? (
                    <InlineDisclosure title={t('filament_cat_hybrid_coupling')}>
                      <CheckboxField
                        label={t('hybrid_coupling_enabled')}
                        hint={t('hint_hybrid_coupling_enabled')}
                        checked={params.hybridCouplingEnabled}
                        onChange={(value) => setParam('hybridCouplingEnabled', value)}
                      />
                      <RangeField
                        label={t('particle_to_filament_strength')}
                        hint={t('hint_particle_to_filament_strength')}
                        min={0}
                        max={2}
                        step={0.01}
                        value={params.hybridParticleToFilamentStrength}
                        onChange={(value) => setParam('hybridParticleToFilamentStrength', value)}
                      />
                      <RangeField
                        label={t('filament_to_particle_strength')}
                        hint={t('hint_filament_to_particle_strength')}
                        min={0}
                        max={2}
                        step={0.01}
                        value={params.hybridFilamentToParticleStrength}
                        onChange={(value) => setParam('hybridFilamentToParticleStrength', value)}
                      />
                      <RangeField
                        label={t('particle_to_filament_clamp_ratio_alt')}
                        hint={t('hint_particle_to_filament_clamp')}
                        min={0}
                        max={1}
                        step={0.01}
                        value={params.hybridParticleToFilamentClampRatio}
                        onChange={(value) => setParam('hybridParticleToFilamentClampRatio', value)}
                      />
                      <RangeField
                        label={t('filament_to_particle_clamp_ratio_alt')}
                        hint={t('hint_filament_to_particle_clamp')}
                        min={0}
                        max={1}
                        step={0.01}
                        value={params.hybridFilamentToParticleClampRatio}
                        onChange={(value) => setParam('hybridFilamentToParticleClampRatio', value)}
                      />
                      <CheckboxField
                        label={t('hybrid_coupling_auto_balance')}
                        hint={t('hint_hybrid_auto_balance')}
                        checked={params.hybridCouplingAutoBalance !== false}
                        onChange={(value) => setParam('hybridCouplingAutoBalance', value)}
                      />
                      <RangeField
                        label={t('hybrid_coupling_balance_gain')}
                        hint={t('hint_hybrid_balance_gain')}
                        min={0}
                        max={2}
                        step={0.01}
                        value={params.hybridCouplingBalanceGain ?? 0.45}
                        onChange={(value) => setParam('hybridCouplingBalanceGain', value)}
                      />
                      <RangeField
                        label={t('filament_offset_x_alt')}
                        hint={t('hint_filament_offset_x') + '\n' + t('filament_offset_x_applies_on_spawn') + (!params.gpuAvailable || params.executionMode === 'cpu' ? '\n' + t('stays_active_but_in_the_current') : '')}
                        min={-10}
                        max={10}
                        step={0.01}
                        value={params.filamentOffsetX}
                        onChange={(value) => setParam('filamentOffsetX', value)}
                      />
                    </InlineDisclosure>
                  ) : null}
                  <InlineDisclosure title={t('filaments_diagnostics')} hint={t('and_already_use_the_cpu_filament')}>
                  <p className="text-[11px] text-slate-400">
                    {t('filaments')}: {Math.floor(filamentStats.filamentCount)} |{' '}
                    {t('nodes')}:{' '}
                    {Math.floor(filamentStats.nodeCount)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-slate-600 mt-2">Mesh</p>
                  <p className="text-[11px] text-slate-500">
                    {t('segment_length_avg_min_max')}:{' '}
                    {filamentStats.avgSegmentLength.toFixed(3)} /{' '}
                    {filamentStats.minSegmentLength.toFixed(3)} /{' '}
                    {filamentStats.maxSegmentLength.toFixed(3)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('split_merge')}: {Math.floor(filamentStats.splitCount)} /{' '}
                    {Math.floor(filamentStats.mergeCount)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('node_growth_added_net_budget_hits')}:{' '}
                    {Math.floor(filamentStats.nodesAddedThisStep)} /{' '}
                    {Math.floor(filamentStats.nodeGrowthPerStep)} /{' '}
                    {Math.floor(filamentStats.splitBudgetHitCount)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-slate-600 mt-2">Dynamics</p>
                  <p className="text-[11px] text-slate-500">
                    {t('avg_circulation_per_filament')}:{' '}
                    {filamentStats.avgCirculation.toFixed(4)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('filament_circulation_before_after_drift_percent')}
                    : {filamentStats.circulationBefore.toFixed(5)} /{' '}
                    {filamentStats.circulationAfter.toFixed(5)} /{' '}
                    {filamentStats.circulationDriftPercent.toFixed(3)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('filament_circulation_violation_count')}
                    : {Math.floor(filamentStats.circulationViolationCount)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('filament_transport_dist_avg_max_center')}:{' '}
                    {filamentStats.transportStepDistanceAvg.toFixed(4)} /{' '}
                    {filamentStats.transportStepDistanceMax.toFixed(4)} /{' '}
                    {filamentStats.transportCenterStep.toFixed(4)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('filament_lia_velocity_avg_max')}:{' '}
                    {filamentStats.liaVelocityAvg.toFixed(3)} /{' '}
                    {filamentStats.liaVelocityMax.toFixed(3)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('filament_smoothing_curvature_avg_max')}:{' '}
                    {filamentStats.smoothingCurvatureAvg.toFixed(3)} /{' '}
                    {filamentStats.smoothingCurvatureMax.toFixed(3)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('radius_guard_activations')}:{' '}
                    {Math.floor(filamentStats.radiusGuardActivations)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-slate-600 mt-2">Reconnect</p>
                  <p className="text-[11px] text-slate-500">
                    {t('reconnect_attempts_success_rejected')}:{' '}
                    {Math.floor(filamentStats.reconnectAttempts)} /{' '}
                    {Math.floor(filamentStats.reconnectSuccess)} /{' '}
                    {Math.floor(filamentStats.reconnectRejected)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('reconnect_rejects_cooldown_endpointa_endpointb_nodelimit_degenerate')}
                    :{' '}
                    {Math.floor(filamentStats.reconnectRejectedCooldown)} /{' '}
                    {Math.floor(filamentStats.reconnectRejectedNearEndpointA)} /{' '}
                    {Math.floor(filamentStats.reconnectRejectedNearEndpointB)} /{' '}
                    {Math.floor(filamentStats.reconnectRejectedNodeLimit)} /{' '}
                    {Math.floor(filamentStats.reconnectRejectedDegenerateInsert)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('reconnect_rejects_distance_angle')}
                    :{' '}
                    {Math.floor(filamentStats.reconnectRejectedDistance)} /{' '}
                    {Math.floor(filamentStats.reconnectRejectedAngle)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('reconnect_multiple_applied_annihilation')}
                    :{' '}
                    {Math.floor(filamentStats.reconnectMultipleApplied)} /{' '}
                    {Math.floor(filamentStats.vortexAnnihilationCount)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-slate-600 mt-2">Topology</p>
                  <p className="text-[11px] text-slate-500">
                    {t('topology_rejects_repaired_nodes_degenerate_removed')}
                    :{' '}
                    {Math.floor(filamentStats.topologyRejects)} /{' '}
                    {Math.floor(filamentStats.repairedNodes)} /{' '}
                    {Math.floor(filamentStats.degenerateSegmentsRemoved)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('closed_loop_violations_regularization_corrections_regularized_filaments')}
                    :{' '}
                    {Math.floor(filamentStats.closedLoopViolations)} /{' '}
                    {Math.floor(filamentStats.regularizationCorrections)} /{' '}
                    {Math.floor(filamentStats.regularizedFilaments)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-slate-600 mt-2">Adaptive</p>
                  <p className="text-[11px] text-slate-500">
                    {t('adaptive_filament_refinement_pressure_avg_max')}:{' '}
                    {filamentStats.adaptiveRefinementPressureAvg.toFixed(3)} /{' '}
                    {filamentStats.adaptiveRefinementPressureMax.toFixed(3)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('adaptive_filament_refinement_scales_split_maxseg_minseg')}:{' '}
                    {filamentStats.adaptiveSplitBudgetScale.toFixed(3)} /{' '}
                    {filamentStats.adaptiveMaxSegmentScale.toFixed(3)} /{' '}
                    {filamentStats.adaptiveMinSegmentScale.toFixed(3)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-slate-600 mt-2">Perf</p>
                  <p className="text-[11px] text-slate-500">
                    {t('filament_step_time')}:{' '}
                    {filamentStats.filamentStepMs.toFixed(2)} ms
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('filament_integrator_mode')}: {params.filamentIntegrator}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('filament_operator_breakdown_ms')}:{' '}
                    {filamentStats.operatorSelfInducedMs.toFixed(2)} /{' '}
                    {filamentStats.operatorSmoothingMs.toFixed(2)} /{' '}
                    {filamentStats.operatorRegularizationMs.toFixed(2)} /{' '}
                    {filamentStats.operatorReconnectionMs.toFixed(2)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('query_segment_refs_avg_max')}:{' '}
                    {filamentStats.avgQueriedSegmentRefs.toFixed(2)} /{' '}
                    {Math.floor(filamentStats.maxQueriedSegmentRefs)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('cross_coupling_samples_avg_max')}:{' '}
                    {filamentStats.avgCrossCouplingSamples.toFixed(2)} /{' '}
                    {Math.floor(filamentStats.maxCrossCouplingSamples)}
                  </p>
                  {params.vortexRepresentation === 'tubes' ? (
                    <>
                      <p className="text-[10px] uppercase tracking-wider text-slate-600 mt-2">Tubes</p>
                      <p className="text-[11px] text-slate-500">
                        {t('tubes')}: {Math.floor(params.runtimeTubeCount ?? 0)} | {t('particles')}:{' '}
                        {Math.floor(params.runtimeTubeParticleCount ?? 0)} | reproj:{' '}
                        {Math.floor(params.runtimeTubeProjectedCount ?? 0)} | r̄:{' '}
                        {Number(params.runtimeTubeAverageRadius ?? 0).toFixed(4)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t('tube_runtime_step_ms')}: {Number(params.runtimeTubeStepMs ?? 0).toFixed(2)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t('tube_runtime_speed_avg_max')}:{' '}
                        {Number(params.runtimeTubeSpeedAvg ?? 0).toFixed(3)} /{' '}
                        {Number(params.runtimeTubeSpeedMax ?? 0).toFixed(3)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t('tube_runtime_velocity_sources_filament_vpm_tube')}:{' '}
                        {Number(params.runtimeTubeFilamentContributionAvg ?? 0).toFixed(3)} /{' '}
                        {Number(params.runtimeTubeVpmContributionAvg ?? 0).toFixed(3)} /{' '}
                        {Number(params.runtimeTubeSelfContributionAvg ?? 0).toFixed(3)}
                      </p>
                    </>
                  ) : null}
                  {params.vortexRepresentation === 'hybrid' ? (
                    <>
                      <p className="text-[10px] uppercase tracking-wider text-slate-600 mt-2">Hybrid</p>
                      <p className="text-[11px] text-slate-500">
                        {t('hybrid_speed_particle_filament_ratio')}:{' '}
                        {filamentStats.hybridParticleSpeed.toFixed(3)} /{' '}
                        {filamentStats.hybridFilamentSpeed.toFixed(3)} /{' '}
                        {filamentStats.hybridSpeedRatio.toFixed(3)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t('filament_transport_velocity_avg_max')}:{' '}
                        {filamentStats.transportVelocityAvg.toFixed(3)} /{' '}
                        {filamentStats.transportVelocityMax.toFixed(3)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t('hybrid_cross_flow_particle_filament')}:{' '}
                        {filamentStats.hybridParticleCrossSpeed.toFixed(3)} /{' '}
                        {filamentStats.hybridFilamentCrossSpeed.toFixed(3)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t('hybrid_filament_local_self_speed_avg_max')}
                        :{' '}
                        {filamentStats.hybridFilamentLocalSelfSpeed.toFixed(3)} /{' '}
                        {filamentStats.hybridFilamentLocalSelfSpeedMax.toFixed(3)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t('hybrid_dt_particle_filament')}:{' '}
                        {filamentStats.hybridParticleDt.toFixed(4)} /{' '}
                        {filamentStats.hybridFilamentDt.toFixed(4)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t('hybrid_particle_to_filament_self_ratio_avg_max')}
                        :{' '}
                        {filamentStats.hybridFilamentCouplingSelfRatio.toFixed(3)} /{' '}
                        {filamentStats.hybridFilamentCouplingSelfRatioMax.toFixed(3)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t('hybrid_particle_to_filament_outward_forcing_avg_max_clamps')}
                        :{' '}
                        {filamentStats.hybridFilamentRadialOutward.toFixed(3)} /{' '}
                        {filamentStats.hybridFilamentRadialOutwardMax.toFixed(3)} /{' '}
                        {Math.floor(filamentStats.hybridParticleToFilamentClampHits)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t('hybrid_drift_clamp_avg_min_hits')}:{' '}
                        {filamentStats.hybridDriftClampFactorAvg.toFixed(3)} /{' '}
                        {filamentStats.hybridDriftClampFactorMin.toFixed(3)} /{' '}
                        {Math.floor(filamentStats.hybridDriftClampHitCount)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t('hybrid_center_radius_guard_activations')}
                        :{' '}
                        {Math.floor(filamentStats.hybridCenterGuardActivations)} /{' '}
                        {Math.floor(filamentStats.hybridRadiusGuardActivations)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t('hybrid_adaptive_minselfratio_centerpull_avg_max')}
                        :{' '}
                        {filamentStats.hybridAdaptiveMinSelfRatioAvg.toFixed(3)} /{' '}
                        {filamentStats.hybridAdaptiveMinSelfRatioMax.toFixed(3)} |{' '}
                        {filamentStats.hybridAdaptiveCenterPullGainAvg.toFixed(3)} /{' '}
                        {filamentStats.hybridAdaptiveCenterPullGainMax.toFixed(3)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {t('hybrid_drift_severity_avg_max')}:{' '}
                        {filamentStats.hybridDriftSeverityAvg.toFixed(3)} /{' '}
                        {filamentStats.hybridDriftSeverityMax.toFixed(3)}
                      </p>
                    </>
                  ) : null}
                  </InlineDisclosure>
                </>
              )}
            </DisclosureSection>

            <DisclosureSection
              title={t('turbulence')}
              description={t('turbulence_cascade_and_filament_instability')}
            >
              <InlineDisclosure title={t('cascade')}>
                <CheckboxField
                  label={t('cascade_enabled')}
                  hint={t('hint_cascade_enabled')}
                  checked={params.cascadeEnabled === true}
                  onChange={(value) => setParam('cascadeEnabled', value)}
                />
                <RangeField
                  label={t('cascade_threshold')}
                  hint={t('hint_cascade_threshold')}
                  min={0}
                  max={500}
                  step={1}
                  value={params.cascadeThreshold ?? 50}
                  onChange={(value) => setParam('cascadeThreshold', value)}
                />
                <RangeField
                  label={t('cascade_split_factor')}
                  hint={t('hint_cascade_split_factor')}
                  min={2}
                  max={4}
                  step={1}
                  value={params.cascadeSplitFactor ?? 2}
                  onChange={(value) =>
                    setParam('cascadeSplitFactor', Math.max(2, Math.min(4, Math.floor(value))))
                  }
                />
                <RangeField
                  label={t('cascade_interval')}
                  hint={t('hint_cascade_interval')}
                  min={1}
                  max={60}
                  step={1}
                  value={params.cascadeInterval ?? 5}
                  onChange={(value) =>
                    setParam('cascadeInterval', Math.max(1, Math.floor(value)))
                  }
                />
                <p className="text-[11px] text-slate-500">
                  {t('min_core_radius_dissipation')}: {params.minCoreRadius ?? 0.01}
                </p>
              </InlineDisclosure>
              <InlineDisclosure title={t('filament_instability')}>
                <RangeField
                  label={t('filament_curvature_threshold')}
                  hint={t('hint_filament_curvature_threshold')}
                  min={0.1}
                  max={20}
                  step={0.1}
                  value={params.filamentCurvatureThreshold ?? 2}
                  onChange={(value) => setParam('filamentCurvatureThreshold', value)}
                />
                <RangeField
                  label={t('filament_strain_threshold')}
                  hint={t('hint_filament_strain_threshold')}
                  min={0.01}
                  max={20}
                  step={0.1}
                  value={params.filamentStrainThreshold ?? 1}
                  onChange={(value) => setParam('filamentStrainThreshold', value)}
                />
                <RangeField
                  label={t('filament_instability_strength')}
                  hint={t('hint_filament_instability_strength')}
                  min={0}
                  max={1}
                  step={0.05}
                  value={params.filamentInstabilityStrength ?? 0}
                  onChange={(value) => setParam('filamentInstabilityStrength', value)}
                />
              </InlineDisclosure>
              <InlineDisclosure title={t('debug_visualization_turbulence')}>
                <CheckboxField
                  label={t('particle_color_by_cascade_level')}
                  hint={t('hint_particle_color_cascade')}
                  checked={params.particleColorByCascadeLevel === true}
                  onChange={(value) => setParam('particleColorByCascadeLevel', value)}
                />
                <CheckboxField
                  label={t('filament_color_by_curvature')}
                  checked={params.filamentColorByCurvature === true}
                  onChange={(value) => setParam('filamentColorByCurvature', value)}
                />
                <CheckboxField
                  label={t('filament_color_by_strain_rate')}
                  checked={params.filamentColorByStrainRate === true}
                  onChange={(value) => setParam('filamentColorByStrainRate', value)}
                />
              </InlineDisclosure>
            </DisclosureSection>

      <DisclosureSection
        title={t('vortex_dynamics')}
        description={t('toroidal_geometry_and_circulation_settings')}
      >
        <RangeField
          label={t('nu_viscosity')}
          hint={t('hint_viscosity')}
          min={0}
          max={0.5}
          step={0.0001}
          value={params.viscosity}
          onChange={(value) => setParam('viscosity', value)}
        />
        <RangeField
          label={t('gamma_vortex_circulation')}
          hint={t('hint_gamma_circulation')}
          min={0}
          max={20}
          step={0.01}
          value={params.gamma}
          onChange={(value) => setParam('gamma', value)}
        />
        {(isScriptedMode || isNaturalMode) && (
          <details open className="rounded border border-slate-700/50 bg-slate-900/30">
            <summary className="cursor-pointer select-none px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300">
              {t('torus_geometry')}
            </summary>
            <div className="px-2 pb-2 space-y-0">
              {isNaturalMode ? (
                <p className="text-[10px] text-slate-500 pb-1">
                  {t('target_torus_parameters_for_mode_are')}
                </p>
              ) : null}
              <RangeField
                label={
                  isNaturalMode
                    ? withNaturalBadge(t('r_target_torus_radius'))
                    : t('r_torus_radius')
                }
                hint={t('hint_torus_radius')}
                min={0.5}
                max={10}
                step={0.01}
                value={params.ringMajor}
                onChange={(value) => setParam('ringMajor', value)}
              />
              <RangeField
                label={
                  isNaturalMode
                    ? withNaturalBadge(t('r_target_tube_radius'))
                    : t('r_tube_radius')
                }
                hint={t('hint_tube_radius')}
                min={0.05}
                max={3}
                step={0.01}
                value={params.ringMinor}
                onChange={(value) => setParam('ringMinor', value)}
              />
              <RangeField
                label={
                  isNaturalMode
                    ? withNaturalBadge(t('omega_target_angular_speed'))
                    : t('omega_total_angular_speed')
                }
                hint={t('hint_omega_angular_speed')}
                min={0.001}
                max={2.0}
                step={0.001}
                value={params.thetaSpeed}
                onChange={(value) => setParam('thetaSpeed', value)}
              />
              <RangeField
                label={
                  isNaturalMode
                    ? withNaturalBadge(t('alpha_target_velocity_tilt_angle'))
                    : t('alpha_velocity_tilt_angle')
                }
                hint={isNaturalMode ? t('natural_modifier_alpha_biot_savart_hint') : t('hint_alpha_angle')}
                min={-90}
                max={90}
                step={1}
                value={params.alpha}
                valueSuffix="°"
                onChange={(value) => setParam('alpha', value)}
              />
            </div>
          </details>
        )}
        {isPhysicsMode && (
          <>
            <CheckboxField
              label={t('auto_sigma_r_ratio')}
              hint={t('hint_auto_sigma_r_ratio') + '\n' + t('recommended_0_05_0_15')}
              checked={params.autoCoreRadius}
              onChange={(value) => setParam('autoCoreRadius', value)}
            />
            <RangeField
              label={t('sigma_r_ratio')}
              hint={t('hint_sigma_r_ratio')}
              min={0.01}
              max={0.5}
              step={0.01}
              value={params.sigmaRatio}
              onChange={(value) => setParam('sigmaRatio', value)}
            />
            <p className="text-[11px] text-slate-500">
              σ_max = R × {params.maxSigmaRatio.toFixed(2)}
            </p>
            <RangeField
              label={t('sigma_max_ratio')}
              hint={t('hint_sigma_max_ratio')}
              min={0.1}
              max={1.0}
              step={0.05}
              value={params.maxSigmaRatio}
              onChange={(value) => setParam('maxSigmaRatio', value)}
            />
            <CheckboxField
              label={t('conserve_gamma')}
              hint={t('hint_conserve_gamma')}
              checked={params.conserveCirculation}
              onChange={(value) => setParam('conserveCirculation', value)}
            />
            {isNaturalMode && (
              <RangeField
                label={withNaturalBadge(t('natural_guiding_strength_alt'))}
                hint={t('hint_natural_guiding_strength')}
                min={0}
                max={1}
                step={0.01}
                value={params.guidedStrength}
                onChange={(value) => setParam('guidedStrength', value)}
              />
            )}
            <InlineDisclosure title={t('stability_metrics')}>
              <p className={`text-[11px] ${sigmaMonitorTone}`}>
                {t('sigma_r_measured')}: {sigmaOverRText}
              </p>
              <p className="text-[11px] text-slate-400">
                {t('gamma_total')}: {totalCirculationText}
              </p>
              <p className={`text-[11px] ${circulationDriftTone}`}>
                {t('drift')}: {circulationDriftPercentText}%
              </p>
              <p className="text-[11px] text-slate-500">
                {t('particles_2')}: {particleCountText} | {t('sigma_average')}: {avgSigmaText}
              </p>
              <p className="text-[11px] text-slate-500">
                {t('tilt_proxy_deg')}: {tiltProxyDegText} | {t('ring_coherence')}: {ringCoherenceText}
              </p>
              <p className="text-[11px] text-slate-500">
                {t('ring_major_minor_measured')}: {ringMajorMeasuredText} / {ringMinorMeasuredText}
              </p>
              <p className="text-[11px] text-slate-500">
                {t('hybrid_gamma_particles_filaments_total')}: {hybridParticleCirculationText} /{' '}
                {hybridFilamentCirculationText} / {hybridTotalCirculationText}
              </p>
              <p className="text-[11px] text-slate-500">
                {t('hybrid_drift')}: {hybridCirculationDriftPercentText}% | P/F: {hybridParticleCountText} /{' '}
                {hybridFilamentCountText}
              </p>
              <p className="text-[11px] text-slate-500">
                {t('hybrid_center_offset_axial_offset')}: {hybridCenterOffsetText} / {hybridAxialOffsetText}
              </p>
              <p className="text-[11px] text-slate-500">
                {t('hybrid_center_step_particle_filament')}: {hybridParticleCenterStepText} /{' '}
                {hybridFilamentCenterStepText}
              </p>
              <p className="text-[11px] text-slate-500">
                {t('hybrid_radius_offset_filament_radius_drift')}:{' '}
                {hybridRadiusOffsetText} / {hybridFilamentRadiusDriftPercentText}%
              </p>
              <p className="text-[11px] text-slate-500">
                {t('filaments_mean_radius_arc_length_arc')}:{' '}
                {hybridFilamentMeanRadiusText} / {hybridFilamentArcLengthText} /{' '}
                {hybridFilamentArcLengthDriftPercentText}%
              </p>
            </InlineDisclosure>
          </>
        )}
      </DisclosureSection>

      <DisclosureSection
        title={t('solver')}
        description={t('biot_savart_and_vortex_particle_method_alt')}
      >
        <SelectField
          label={t('dynamics_mode')}
          hint={
            isScriptedMode ? t('uses_predefined_torus_kinematics_ring_geometry') :
            isClassicPhysicsMode ? t('classic_physics_free_solver_evolution_not_direct_scripting') :
            isNaturalMode ? t('combines_real_physics_with_soft_target') :
            t('hint_dynamics_mode')
          }
          value={params.dynamicsMode}
          onChange={(value) => setParam('dynamicsMode', value)}
          options={[
            { value: 'scripted', label: t('scripted_motion_alt') },
            { value: 'fullPhysics', label: t('classic_physics') },
            { value: 'guidedPhysics', label: t('natural') },
          ]}
        />
        {isNaturalMode && (
          <>
            <div className="flex flex-wrap gap-1.5">
              <button
                className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                onClick={applyNaturalPreset}
                type="button"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                {t('apply_natural_preset')}
              </button>
            </div>
          </>
        )}
        {isPhysicsMode ? (
          <>
            {params.physicsBackend === 'webgpu' || isNaturalMode ? null : (
              <SelectField
                label={t('velocity_computation_mode')}
                hint={t('hint_velocity_computation_mode')}
                value={params.velocityComputationMode}
                onChange={(value) => setParam('velocityComputationMode', value)}
                options={[
                  { value: 'auto', label: t('velocity_mode_auto') },
                  { value: 'exact', label: t('exact_o_n') },
                  { value: 'spatialGrid', label: t('spatial_grid_accelerated_alt') },
                  { value: 'fmm', label: t('velocity_mode_fmm') },
                ]}
              />
            )}
            <CheckboxField
              label={t('vpm_mode_vortex_particle_method_alt')}
              hint={(params.physicsBackend === 'webgpu' || isNaturalMode) ? t('gpu_currently_uses_only_the_accelerated') + '\n' + t('hint_vpm_enabled') : t('hint_vpm_enabled')}
              checked={params.vpmEnabled}
              onChange={(value) => setParam('vpmEnabled', value)}
            />
            <RangeField
              label={t('vorticity_confinement_strength')}
              hint={t('hint_vorticity_confinement')}
              min={-0.5}
              max={0.5}
              step={0.01}
              value={params.vorticityConfinementStrength ?? 0.08}
              onChange={(value) => setParam('vorticityConfinementStrength', value)}
            />
          </>
        ) : null}
        <CheckboxField
          label={
            isNaturalMode
              ? withNaturalBadge(t('biot_savart_self_propulsion'))
              : t('biot_savart_self_propulsion')
          }
          hint={t('hint_biot_savart_self')}
          checked={params.useBiotSavart}
          onChange={(value) => setParam('useBiotSavart', value)}
        />
        {params.velocityComputationMode === 'auto' && (
          <InlineDisclosure title={t('velocity_mode_auto_policy')}>
            <RangeField
              label={t('velocity_auto_exact_max_particles')}
              hint={t('hint_velocity_auto_exact_max')}
              min={1000}
              max={200000}
              step={1000}
              value={params.velocityAutoExactMaxParticles ?? 12000}
              onChange={(value) => setParam('velocityAutoExactMaxParticles', value)}
            />
            <RangeField
              label={t('velocity_auto_spatial_max_particles')}
              hint={t('hint_velocity_auto_spatial_max')}
              min={2000}
              max={500000}
              step={1000}
              value={params.velocityAutoSpatialMaxParticles ?? 80000}
              onChange={(value) => setParam('velocityAutoSpatialMaxParticles', value)}
            />
            <RangeField
              label={t('velocity_auto_hysteresis_particles')}
              hint={t('hint_velocity_auto_hysteresis')}
              min={200}
              max={200000}
              step={100}
              value={params.velocityAutoHysteresisParticles ?? 4000}
              onChange={(value) => setParam('velocityAutoHysteresisParticles', value)}
            />
            <RangeField
              label={t('velocity_auto_switch_enter_steps')}
              hint={t('hint_velocity_auto_enter_steps')}
              min={1}
              max={120}
              step={1}
              value={params.velocityAutoSwitchEnterSteps ?? 3}
              onChange={(value) => setParam('velocityAutoSwitchEnterSteps', value)}
            />
            <RangeField
              label={t('velocity_auto_switch_cooldown_steps')}
              hint={t('hint_velocity_auto_cooldown')}
              min={0}
              max={360}
              step={1}
              value={params.velocityAutoSwitchCooldownSteps ?? 18}
              onChange={(value) => setParam('velocityAutoSwitchCooldownSteps', value)}
            />
          </InlineDisclosure>
        )}
        {(params.physicsBackend === 'webgpu' ||
          params.velocityComputationMode === 'spatialGrid' ||
          params.velocityComputationMode === 'auto') && (
          <InlineDisclosure title={t('spatial_grid_parameters')}>
            <RangeField
              label={t('cell_size_multiplier')}
              hint={t('hint_cell_size_multiplier') + '\n' + t('recommended_3sigma_5sigma')}
              min={1}
              max={10}
              step={0.5}
              value={params.cellSizeMultiplier}
              onChange={(value) => setParam('cellSizeMultiplier', value)}
            />
            <RangeField
              label={t('neighbor_cell_range')}
              hint={t('hint_neighbor_cell_range')}
              min={1}
              max={3}
              step={1}
              value={params.neighborCellRange}
              onChange={(value) => setParam('neighborCellRange', value)}
            />
            <RangeField
              label={t('aggregation_distance')}
              hint={t('hint_aggregation_distance') + '\n' + t('distant_cells_use_aggregated_contribution')}
              min={1}
              max={5}
              step={1}
              value={params.aggregationDistance}
              onChange={(value) => setParam('aggregationDistance', value)}
            />
          </InlineDisclosure>
        )}
        {(params.velocityComputationMode === 'fmm' || params.velocityComputationMode === 'auto') && (
          <InlineDisclosure title={t('fmm_parameters')}>
            <RangeField
              label={t('fmm_theta')}
              hint={t('hint_fmm_theta')}
              min={0.2}
              max={1.2}
              step={0.05}
              value={params.fmmTheta ?? 0.65}
              onChange={(value) => setParam('fmmTheta', value)}
            />
            <RangeField
              label={t('fmm_leaf_size')}
              hint={t('hint_fmm_leaf_size')}
              min={4}
              max={64}
              step={2}
              value={params.fmmLeafSize ?? 16}
              onChange={(value) => setParam('fmmLeafSize', value)}
            />
            <RangeField
              label={t('fmm_softening')}
              hint={t('hint_fmm_softening')}
              min={0.001}
              max={0.2}
              step={0.005}
              value={params.fmmSoftening ?? 0.02}
              onChange={(value) => setParam('fmmSoftening', value)}
            />
          </InlineDisclosure>
        )}
      </DisclosureSection>

      <DisclosureSection
        title={t('physical_models')}
        description={t('physical_models_desc')}
      >
        <CheckboxField
          label={t('runtime_physical_viscosity_enabled')}
          hint={t('hint_physical_viscosity_enabled')}
          checked={params.physicalViscosityEnabled === true}
          onChange={(value) => setParam('physicalViscosityEnabled', value)}
        />
        <RangeField
          label={t('runtime_physical_viscosity_nu')}
          hint={t('hint_physical_viscosity_nu')}
          value={params.physicalViscosityNu ?? 0.0001}
          min={0}
          max={0.05}
          step={0.0001}
          onChange={(value) => setParam('physicalViscosityNu', value)}
        />
        <CheckboxField
          label={t('runtime_physical_pse_enabled')}
          hint={t('hint_physical_pse_enabled')}
          checked={params.physicalPseEnabled === true}
          onChange={(value) => setParam('physicalPseEnabled', value)}
        />
        <CheckboxField
          label={t('runtime_physical_stretching_enabled')}
          hint={t('hint_physical_stretching_enabled')}
          checked={params.physicalStretchingEnabled === true}
          onChange={(value) => setParam('physicalStretchingEnabled', value)}
        />
        <RangeField
          label={t('runtime_physical_stretching_gain')}
          hint={t('hint_physical_stretching_gain')}
          value={params.physicalStretchingStrength ?? 1}
          min={0}
          max={4}
          step={0.05}
          onChange={(value) => setParam('physicalStretchingStrength', value)}
        />
        <details className="rounded border border-slate-700/50 bg-slate-900/30">
          <summary className="cursor-pointer select-none px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300">
            {t('physical_boundary')}
          </summary>
          <div className="px-2 pb-2 space-y-0">
            <CheckboxField
              label={t('runtime_physical_boundary_enabled')}
              hint={t('hint_physical_boundary_enabled')}
              checked={params.physicalBoundaryEnabled === true}
              onChange={(value) => setParam('physicalBoundaryEnabled', value)}
            />
            <CheckboxField
              label={t('runtime_physical_no_slip')}
              hint={t('hint_physical_no_slip')}
              checked={params.physicalNoSlipEnabled === true}
              onChange={(value) => setParam('physicalNoSlipEnabled', value)}
            />
            <CheckboxField
              label={t('runtime_physical_image_vortices')}
              hint={t('hint_physical_image_vortices')}
              checked={params.physicalImageVorticesEnabled === true}
              onChange={(value) => setParam('physicalImageVorticesEnabled', value)}
            />
            <SelectField
              label={t('runtime_physical_boundary_mode')}
              hint={t('hint_physical_boundary_mode')}
              value={params.physicalBoundaryMode ?? 'planes'}
              onChange={(value) => setParam('physicalBoundaryMode', String(value))}
              options={physicalBoundaryModeOptions}
            />
          </div>
        </details>
        <CheckboxField
          label={t('runtime_physical_wake_enabled')}
          hint={t('hint_physical_wake_enabled')}
          checked={params.physicalWakeEnabled === true}
          onChange={(value) => setParam('physicalWakeEnabled', value)}
        />
        <CheckboxField
          label={t('les_smagorinsky')}
          hint={t('hint_les_smagorinsky')}
          checked={params.lesEnabled === true}
          onChange={(value) => setParam('lesEnabled', value)}
        />
        {params.lesEnabled && (
          <RangeField
            label={t('les_cs')}
            hint={t('hint_les_cs')}
            value={params.lesSmagorinskyCs ?? 0.15}
            min={0.05}
            max={0.3}
            step={0.01}
            onChange={(value) => setParam('lesSmagorinskyCs', value)}
          />
        )}
        <CheckboxField
          label={t('runtime_physical_buoyancy')}
          hint={t('hint_physical_buoyancy')}
          checked={params.buoyancyEnabled === true}
          onChange={(value) => setParam('buoyancyEnabled', value)}
        />
        <SelectField
          label={t('runtime_physical_integration_order')}
          hint={t('hint_physical_integration_order')}
          value={params.physicalIntegrationOrderProfile ?? 'canonical'}
          onChange={(value) => setParam('physicalIntegrationOrderProfile', String(value))}
          options={physicalIntegrationOrderOptions}
        />
        <InlineDisclosure title={t('physical_runtime_status')}>
          <p className="text-[11px] text-slate-500">
            {t('runtime_physical_step_order')}: {params.runtimePhysicalStepOrder ?? 'velocity_computation'}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_physical_profile')}: {params.runtimePhysicalIntegrationOrderProfile ?? 'canonical'}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_physical_warnings')}:{' '}
            {Array.isArray(params.runtimePhysicalWarnings) && params.runtimePhysicalWarnings.length > 0
              ? params.runtimePhysicalWarnings.join(', ')
              : '-'}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_physical_modules')}:{' '}
            {params.runtimePhysicalViscosityApplied ? t('yes') : t('no')} /{' '}
            {params.runtimePhysicalStretchingApplied ? t('yes') : t('no')} /{' '}
            {params.runtimePhysicalBoundaryApplied ? t('yes') : t('no')} /{' '}
            {params.runtimePhysicalWakeApplied ? t('yes') : t('no')}
          </p>
        </InlineDisclosure>
      </DisclosureSection>

      <DisclosureSection
        title={t('backend_and_diagnostics')}
        description={t('execution_mode_and_simulation_step_diagnostics_alt')}
      >
        <CheckboxField
          label={t('show_fps')}
          hint={t('hint_show_fps')}
          checked={showFps}
          onChange={setShowFps}
        />
        <InlineDisclosure title={t('performance_profiles')}>
          <SelectField
            label={t('performance_profile')}
            hint={
              selectedPerformanceProfileId === 'quality_explorer'
                ? t('performance_profile_quality_explorer_note')
                : selectedPerformanceProfile?.description
            }
            value={selectedPerformanceProfileId}
            onChange={(value) =>
              setParams({
                performanceProfileId: value,
                performanceAutoProfileEnabled: false,
              })
            }
            options={allPerformanceProfiles.map((profile) => ({
              value: profile.id,
              label: profile.label,
            }))}
          />
          <CheckboxField
            label={t('performance_auto_profile_enabled')}
            hint={t('hint_performance_auto_profile')}
            checked={params.performanceAutoProfileEnabled === true}
            onChange={(value) => {
              setParam('performanceAutoProfileEnabled', value)
              if (value) {
                void runHardwareDetection()
              }
            }}
          />
          <p className="text-[11px] text-slate-500">
            {t('performance_hardware_summary')}: {params.performanceHardwareSummary || t('unknown_2')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('performance_hardware_class')}:{' '}
            {t(hardwareClassKey) || params.performanceHardwareClass || t('performance_hardware_class_unknown')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('performance_calibration_stage')}: {t(`performance_calibration_stage_${params.performanceCalibrationStage}`) || params.performanceCalibrationStage}
          </p>
          {params.performanceCalibrationInProgress === true ? (
            <>
              <p className="text-[11px] text-amber-300">{t('performance_calibration_running')}</p>
              <div className="h-2 w-full overflow-hidden rounded bg-slate-800">
                <div
                  className="h-full bg-amber-400 transition-all"
                  style={{ width: `${Math.round((params.performanceCalibrationProgress ?? 0) * 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500">
                {t('performance_calibration_progress')}: {Math.round((params.performanceCalibrationProgress ?? 0) * 100)}%
              </p>
            </>
          ) : null}
          {params.performanceCalibrationLastSummary ? (
            <p className="text-[11px] text-slate-500">
              {t('performance_calibration_last_summary')}: {params.performanceCalibrationLastSummary}
            </p>
          ) : null}
          {params.performanceCalibrationBestBackend && params.performanceCalibrationBestBackend !== 'none' ? (
            <p className="text-[11px] text-slate-500">
              {t('performance_calibration_best_backend')}: {params.performanceCalibrationBestBackend}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            <button
              className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
              onClick={() => applyPerformanceProfile(selectedPerformanceProfileId)}
              type="button"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              {t('performance_profile_apply')}
            </button>
            <button
              className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90 disabled:opacity-50"
              disabled={hardwareDetectBusy}
              onClick={() => {
                void runHardwareDetection()
              }}
              type="button"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>
              {t('performance_profile_detect_hardware')}
            </button>
            <button
              className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90 disabled:opacity-50"
              disabled={hardwareDetectBusy}
              onClick={() => {
                void applyRecommendedHardwareProfile()
              }}
              type="button"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              {t('performance_profile_apply_recommended')}
            </button>
            <button
              className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
              onClick={handleSaveCustomPerformanceProfile}
              type="button"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
              {t('performance_profile_save_current')}
            </button>
            <button
              className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
              onClick={handleCloneSelectedPerformanceProfile}
              type="button"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              {t('performance_profile_clone_selected')}
            </button>
            <button
              className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90 disabled:opacity-50"
              disabled={hardwareDetectBusy || params.performanceCalibrationInProgress === true}
              onClick={() => {
                void handleRerunHardwareCalibration()
              }}
              type="button"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 1 3 7"/><polyline points="3 22 3 12 13 12"/></svg>
              {t('performance_profile_rerun_calibration')}
            </button>
          </div>
        </InlineDisclosure>
        <SelectField
          label={t('execution_mode')}
          hint={executionRestrictionHintKeys.length > 0 ? executionRestrictionHintKeys.map((k) => t(k)).join('\n') : undefined}
          value={params.executionMode}
          onChange={(value) => setParam('executionMode', value)}
          options={executionOptions}
        />
        {isNaturalMode ? (
          <InlineDisclosure title={t('hybrid_plus_assist')}>
            <CheckboxField
              label={t('hybrid_plus_enable')}
              hint={t('hint_hybrid_plus_enable')}
              checked={params.hybridPlusEnabled === true}
              onChange={(value) => setParam('hybridPlusEnabled', value)}
            />
            <RangeField
              label={t('hybrid_plus_assist_budget_ms')}
              hint={t('hint_hybrid_plus_budget')}
              min={0.1}
              max={12}
              step={0.1}
              value={params.hybridPlusAssistBudgetMs ?? 2}
              onChange={(value) => setParam('hybridPlusAssistBudgetMs', value)}
            />
            <RangeField
              label={t('hybrid_plus_assist_cadence_steps')}
              min={1}
              max={32}
              step={1}
              value={params.hybridPlusAssistCadenceSteps ?? 1}
              onChange={(value) =>
                setParam('hybridPlusAssistCadenceSteps', Math.max(1, Math.floor(value)))
              }
            />
            <CheckboxField
              label={t('hybrid_plus_assist_adaptive_cadence')}
              checked={params.hybridPlusAssistAdaptiveCadenceEnabled !== false}
              onChange={(value) => setParam('hybridPlusAssistAdaptiveCadenceEnabled', value)}
            />
            <RangeField
              label={t('hybrid_plus_assist_max_cadence_steps')}
              min={1}
              max={64}
              step={1}
              value={params.hybridPlusAssistAdaptiveMaxCadenceSteps ?? 8}
              onChange={(value) =>
                setParam('hybridPlusAssistAdaptiveMaxCadenceSteps', Math.max(1, Math.floor(value)))
              }
            />
            <RangeField
              label={t('hybrid_plus_assist_over_budget_tolerance_pct')}
              min={0}
              max={200}
              step={1}
              value={params.hybridPlusAssistOverBudgetTolerancePct ?? 15}
              onChange={(value) => setParam('hybridPlusAssistOverBudgetTolerancePct', value)}
            />
            <RangeField
              label={t('hybrid_plus_assist_idle_delta_threshold')}
              hint={t('hint_hybrid_plus_idle_delta_threshold')}
              min={0}
              max={256}
              step={1}
              value={params.hybridPlusAssistIdleDeltaThreshold ?? 12}
              onChange={(value) =>
                setParam('hybridPlusAssistIdleDeltaThreshold', Math.max(0, Math.floor(value)))
              }
            />
            <CheckboxField
              label={t('hybrid_plus_cpu_base_assist_on_cpu')}
              hint={naturalHybridFilamentMode ? t('hybrid_plus_natural_hybrid_assist_locked_cpu') : t('hint_hybrid_plus_cpu_base')}
              checked={
                naturalHybridFilamentMode ? true : params.hybridPlusCpuBaseAssistBackend !== 'gpu'
              }
              disabled={naturalHybridFilamentMode}
              onChange={(value) =>
                setParam('hybridPlusCpuBaseAssistBackend', value ? 'cpu' : 'gpu')
              }
            />
            <CheckboxField
              label={t('hybrid_plus_topology_correction')}
              checked={params.hybridPlusTopologyCorrectionEnabled !== false}
              onChange={(value) => setParam('hybridPlusTopologyCorrectionEnabled', value)}
            />
            <RangeField
              label={t('hybrid_plus_topology_threshold')}
              hint={t('hint_hybrid_plus_topology_threshold')}
              min={0.01}
              max={1.5}
              step={0.01}
              value={params.hybridPlusTopologyThreshold ?? 0.18}
              onChange={(value) => setParam('hybridPlusTopologyThreshold', value)}
            />
            <RangeField
              label={t('hybrid_plus_topology_strength')}
              min={0}
              max={1}
              step={0.01}
              value={params.hybridPlusTopologyStrength ?? 0.25}
              onChange={(value) => setParam('hybridPlusTopologyStrength', value)}
            />
            <CheckboxField
              label={t('hybrid_plus_barnes_hut')}
              checked={params.hybridPlusBarnesHutEnabled === true}
              onChange={(value) => setParam('hybridPlusBarnesHutEnabled', value)}
            />
            <CheckboxField
              label={t('hybrid_plus_barnes_hut_auto')}
              hint={t('hint_hybrid_plus_barnes_hut_auto')}
              checked={params.hybridPlusBarnesHutAuto !== false}
              onChange={(value) => setParam('hybridPlusBarnesHutAuto', value)}
            />
            <SelectField
              label={t('hybrid_plus_far_field_method')}
              hint={t('hint_hybrid_plus_far_field')}
              value={params.hybridPlusFarFieldMethod ?? 'treecode'}
              onChange={(value) => setParam('hybridPlusFarFieldMethod', value)}
              options={[
                { value: 'treecode', label: t('hybrid_plus_far_field_treecode') },
                { value: 'fmm', label: t('hybrid_plus_far_field_fmm') },
              ]}
            />
            <RangeField
              label={t('hybrid_plus_barnes_hut_theta')}
              min={0.2}
              max={1.2}
              step={0.01}
              value={params.hybridPlusBarnesHutTheta ?? 0.65}
              onChange={(value) => setParam('hybridPlusBarnesHutTheta', value)}
            />
            <RangeField
              label={t('hybrid_plus_barnes_hut_strength')}
              hint={t('hint_hybrid_plus_barnes_hut_strength')}
              min={0}
              max={1}
              step={0.01}
              value={params.hybridPlusBarnesHutStrength ?? 0.18}
              onChange={(value) => setParam('hybridPlusBarnesHutStrength', value)}
            />
            <p className="text-[11px] text-slate-500">
              {t('hybrid_plus_barnes_hut_auto_thresholds')}: N≥
              {Math.floor(params.hybridPlusBarnesHutAutoParticleThreshold ?? 1200)} / step≥
              {(params.hybridPlusBarnesHutAutoStepMsThreshold ?? 10).toFixed(1)}ms
            </p>
          </InlineDisclosure>
        ) : null}
        {params.physicsBackend === 'webgpu' && (
          <>
            <RangeField
              label={t('local_hash_block_size')}
              hint={t('active_gpu_backend_uses_a_hash') + '\n' + t('hint_local_hash_block')}
              min={16}
              max={512}
              step={1}
              value={params.gpuChunkSize}
              onChange={(value) => setParam('gpuChunkSize', Math.max(16, Math.floor(value)))}
            />
            <RangeField
              label={t('local_search_radius')}
              min={1}
              max={20}
              step={0.1}
              value={params.interactionRadius}
              onChange={(value) => setParam('interactionRadius', value)}
            />
            <CheckboxField
              label={t('gpu_auto_quality_guard')}
              checked={params.gpuAutoQualityGuardEnabled === true}
              onChange={(value) => setParam('gpuAutoQualityGuardEnabled', value)}
            />
            <SelectField
              label={t('gpu_auto_quality_guard_scope')}
              value={gpuAutoQualityGuardScope}
              onChange={(value) =>
                setParam(
                  'gpuAutoQualityGuardScope',
                  value === 'monitor_only' ? 'monitor_only' : 'apply_supported_only',
                )
              }
              options={[
                {
                  value: 'apply_supported_only',
                  label: t('gpu_quality_guard_scope_apply_supported_only'),
                },
                { value: 'monitor_only', label: t('gpu_quality_guard_scope_monitor_only') },
              ]}
            />
            <SelectField
              label={t('gpu_auto_quality_guard_mode')}
              hint={t('hint_gpu_quality_guard_mode')}
              value={gpuAutoQualityGuardMode}
              onChange={(value) =>
                setParam(
                  'gpuAutoQualityGuardMode',
                  value === 'moderate' ? 'moderate' : 'minimal',
                )
              }
              options={[
                { value: 'minimal', label: t('gpu_quality_guard_mode_minimal') },
                { value: 'moderate', label: t('gpu_quality_guard_mode_moderate') },
              ]}
            />
          </>
        )}
        <InlineDisclosure title={t('runtime_gpu_diagnostics')}>
          <p className="text-[11px] text-slate-300">
            {t('current_runtime_mode')}: {currentDynamicsModeLabel}
          </p>
          <p className="text-[11px] text-slate-300">
            {t('current_runtime_execution_mode')}: {currentExecutionModeLabel}
          </p>
          <p className="text-[11px] text-slate-300">
            {t('current_runtime_representation')}: {currentRepresentationLabel}
          </p>
          <p className="text-[11px] text-slate-400">
            {t('active_pipeline_alt')}: {activePipelineLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('particles_backend')}: {particlesBackendLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('filaments_backend')}: {filamentsBackendLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_support')}: {params.gpuAvailable ? t('available_alt') : t('unavailable_alt')}
          </p>
          <p className="text-[11px] text-slate-400">
            {t('active_backend')}: {runtimeBackendLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('status_reason')}: {params.runtimeBackendReason ?? t('unknown_2')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('step_time')}: {(params.runtimeGpuStepMs ?? 0).toFixed(2)} ms
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_solver_status')}: {String(params.runtimeSolverMode ?? 'inactive')} (req:{' '}
            {String(params.runtimeSolverModeRequested ?? 'exact')}, N=
            {Math.floor(Number(params.runtimeSolverParticleCount ?? 0) || 0)}, theta=
            {(Number(params.runtimeSolverFmmTheta ?? 0.65) || 0.65).toFixed(2)}, leaf=
            {Math.floor(Number(params.runtimeSolverFmmLeafSize ?? 16) || 16)})
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_solver_flags')}: Biot-Savart=
            {params.runtimeSolverUseBiotSavart === true ? t('yes') : t('no')}, VPM=
            {params.runtimeSolverVpmEnabled === true ? t('yes') : t('no')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_solver_auto_state')}: cur={String(params.runtimeSolverAutoCurrentMode ?? 'exact')}, cand=
            {String(params.runtimeSolverAutoCandidateMode ?? 'exact')}, pending=
            {Math.floor(Number(params.runtimeSolverAutoPendingSteps ?? 0) || 0)}, cooldown=
            {Math.floor(Number(params.runtimeSolverAutoCooldownSteps ?? 0) || 0)}, switches=
            {Math.floor(Number(params.runtimeSolverAutoSwitchCount ?? 0) || 0)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_solver_auto_reason')}: {String(params.runtimeSolverAutoLastSwitchReason ?? 'none')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('simulation_time')}: {(params.runtimeSimulationTime ?? 0).toFixed(3)} s
          </p>
          <p className="text-[11px] text-slate-500">
            {t('cpu_gpu_steps')}: {Math.floor(params.runtimeCpuSteps ?? 0)} /{' '}
            {Math.floor(params.runtimeGpuSteps ?? 0)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_dispatch_pending')}: {params.runtimeGpuDispatchPending ? t('yes') : t('no')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('particle_render_policy')}: {runtimeParticleRenderPolicyLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('particle_render_backend')}: {runtimeParticleRenderBackendLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('fallback_reason')}: {runtimeParticleRenderFallbackReasonLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_policy_mode')}: {runtimeRenderPolicyModeLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_lod_tier')}: {runtimeRenderLodTierLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_transition_contract')}: {runtimeTransitionStateLabel} / candidate=
            {runtimeTransitionCandidateType} / pending={Math.floor(runtimeTransitionPendingFrames)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_transition_counts')}: c={Math.floor(runtimeTransitionCandidates)}, ok=
            {Math.floor(runtimeTransitionCommitted)}, reject={Math.floor(runtimeTransitionRejected)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_transition_drifts')}: gamma={runtimeTransitionGammaDriftPct.toFixed(2)}%, impulse=
            {runtimeTransitionImpulseDriftPct.toFixed(2)}%, energy={runtimeTransitionEnergyDriftPct.toFixed(2)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_transition_gates')}: conf={runtimeTransitionGateConfidenceOk ? t('yes') : t('no')}, inv=
            {runtimeTransitionGateInvariantOk ? t('yes') : t('no')}, hyst=
            {runtimeTransitionGateHysteresisOk ? t('yes') : t('no')} / {runtimeTransitionGateReason} / T=
            {Math.floor(runtimeTransitionEnterFrames)} / C=
            {(runtimeTransitionConfidenceEnterMin * 100).toFixed(0)}-{(runtimeTransitionConfidenceExitMin * 100).toFixed(0)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_ring_validation')}: {runtimeRingValidationVersion} /{' '}
            {runtimeRingValidationValid ? t('pass') : t('fail')} / {runtimeRingValidationVerdictLabel} / score=
            {(runtimeRingValidationAcceptanceScore * 100).toFixed(1)}% / gates=
            {runtimeRingValidationGatePassCount}/{runtimeRingValidationGateTotal} / commit=
            {(runtimeRingValidationTransitionCommitRatio * 100).toFixed(1)}% / profile=
            {String(params.runtimeRingValidationProfile ?? 'classic')} / mod=
            {(Math.max(0, Math.min(1, Number(params.runtimeRingValidationModifierStrength ?? 0) || 0)) * 100).toFixed(0)}%
            {' '} / {t('external_validation_eligibility')}=
            {params.runtimeRingExternalValidationEligible === false
              ? t('eligibility_not_eligible')
              : t('eligibility_eligible')}
            {params.runtimeRingExternalValidationEligible === false
              ? ` (${params.runtimeRingExternalValidationEligibilityReason === 'natural_modifier_active'
                ? t('eligibility_reason_natural_modifier_active')
                : String(params.runtimeRingExternalValidationEligibilityReason ?? 'n/a')})`
              : ''}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_jet_regime_validation')}: {runtimeJetRegimeVersion} /{' '}
            {runtimeJetRegimeValid ? t('pass') : t('fail')} / {runtimeJetRegimeVerdictLabel} / {runtimeJetRegimeType} /
            score={(runtimeJetRegimeAcceptanceScore * 100).toFixed(1)}% / gates=
            {runtimeJetRegimeGatePassCount}/{runtimeJetRegimeGateTotal} / profile=
            {String(params.runtimeJetRegimeProfile ?? 'classic')} / mod=
            {(Math.max(0, Math.min(1, Number(params.runtimeJetRegimeModifierStrength ?? 0) || 0)) * 100).toFixed(0)}%
            {' '} / {t('external_validation_eligibility')}=
            {params.runtimeJetExternalValidationEligible === false
              ? t('eligibility_not_eligible')
              : t('eligibility_eligible')}
            {params.runtimeJetExternalValidationEligible === false
              ? ` (${params.runtimeJetExternalValidationEligibilityReason === 'natural_modifier_active'
                ? t('eligibility_reason_natural_modifier_active')
                : params.runtimeJetExternalValidationEligibilityReason === 'jet_rollup_autotune_active'
                  ? t('eligibility_reason_jet_rollup_autotune_active')
                  : String(params.runtimeJetExternalValidationEligibilityReason ?? 'n/a')})`
              : ''}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_jet_regime_proxies')}: Re={runtimeJetRegimeReProxy.toFixed(2)}, St=
            {runtimeJetRegimeStProxy.toFixed(2)}, L/D={runtimeJetRegimeLdProxy.toFixed(2)}, ring=
            {runtimeJetRegimeRingDominance.toFixed(2)}, wake={runtimeJetRegimeWakeIndex.toFixed(2)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_jet_rollup_closure')}: score=
            {(Math.max(0, Math.min(1, Number(params.runtimeJetRollupClosureScore ?? 0) || 0)) * 100).toFixed(1)}% / state=
            {String(params.runtimeJetRollupClosureState ?? 'idle')} / autotune=
            {params.jetRollupAutoTuneEnabled ? t('yes') : t('no')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_jet_rollup_tuner')}: {String(params.runtimeJetRollupAutoTuneLastAction ?? 'none')} / Δsteps=
            {Math.floor(Number(params.runtimeJetRollupAutoTuneStepInterval ?? 0) || 0)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_detector_sheet_features')}: sheets={Math.floor(runtimeDetectedSheetCount)} / coherence=
            {(runtimeDetectionSheetSurfaceCoherence * 100).toFixed(1)}% / anisotropy=
            {(runtimeDetectionSheetCurvatureAnisotropy * 100).toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_detector_class_confidences')}: f={(runtimeDetectionClassConfidenceFilament * 100).toFixed(1)}%,
            r={(runtimeDetectionClassConfidenceRing * 100).toFixed(1)}%, t=
            {(runtimeDetectionClassConfidenceTube * 100).toFixed(1)}%, s=
            {(runtimeDetectionClassConfidenceSheet * 100).toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_detector_fusion_contract')}: {runtimeDetectorFusionVersion} /{' '}
            {runtimeDetectorFusionValid ? t('pass') : t('fail')} / {runtimeDetectorFusionVerdictLabel} / score=
            {(runtimeDetectorFusionAcceptanceScore * 100).toFixed(1)}% / weighted=
            {(runtimeDetectorFusionWeightedScore * 100).toFixed(1)}% / gates=
            {runtimeDetectorFusionGatePassCount}/{runtimeDetectorFusionGateTotal} / profile=
            {String(params.runtimeDetectorFusionProfile ?? 'classic')} / mod=
            {(Math.max(0, Math.min(1, Number(params.runtimeDetectorFusionModifierStrength ?? 0) || 0)) * 100).toFixed(0)}%
            {' '} / {t('external_validation_eligibility')}=
            {params.runtimeDetectorExternalValidationEligible === false
              ? t('eligibility_not_eligible')
              : t('eligibility_eligible')}
            {params.runtimeDetectorExternalValidationEligible === false
              ? ` (${params.runtimeDetectorExternalValidationEligibilityReason === 'natural_modifier_active'
                ? t('eligibility_reason_natural_modifier_active')
                : String(params.runtimeDetectorExternalValidationEligibilityReason ?? 'n/a')})`
              : ''}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_topology_tracking')}: {runtimeTopologyVersion} / {runtimeTopologyValid ? t('pass') : t('fail')} /
            frame={Math.floor(runtimeTopologyFrameSerial)} / events={Math.floor(runtimeTopologyEventCount)} / graph=
            {Math.floor(runtimeTopologyNodeCount)}/{Math.floor(runtimeTopologyEdgeCount)} / profile=
            {String(params.runtimeTopologyProfile ?? 'classic')} / mod=
            {(Math.max(0, Math.min(1, Number(params.runtimeTopologyModifierStrength ?? 0) || 0)) * 100).toFixed(0)}%
            {' '} / {t('external_validation_eligibility')}=
            {params.runtimeTopologyExternalValidationEligible === false
              ? t('eligibility_not_eligible')
              : t('eligibility_eligible')}
            {params.runtimeTopologyExternalValidationEligible === false
              ? ` (${params.runtimeTopologyExternalValidationEligibilityReason === 'natural_modifier_active'
                ? t('eligibility_reason_natural_modifier_active')
                : String(params.runtimeTopologyExternalValidationEligibilityReason ?? 'n/a')})`
              : ''}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_topology_counters')}: birth={Math.floor(runtimeTopologyBirthCount)}, decay=
            {Math.floor(runtimeTopologyDecayCount)}, merge={Math.floor(runtimeTopologyMergeCount)}, split=
            {Math.floor(runtimeTopologySplitCount)}, reconn={Math.floor(runtimeTopologyReconnectionCount)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_topology_latest_event')}: {runtimeTopologyLatestEventType} / conf=
            {(runtimeTopologyLatestEventConfidence * 100).toFixed(1)}% / frame=
            {Math.floor(runtimeTopologyLatestEventFrame)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_confidence_uncertainty')}: {(runtimeRenderDiagnosticsConfidence * 100).toFixed(1)}% /{' '}
            {(runtimeRenderDiagnosticsUncertainty * 100).toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_uncertainty_breakdown')}: det={(runtimeRenderUncertaintyDetectorGap * 100).toFixed(1)}%,
            fallback={(runtimeRenderUncertaintyFallback * 100).toFixed(1)}%, topo=
            {(runtimeRenderUncertaintyTopologyVolatility * 100).toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_score_vector')}: p={(runtimeRenderScoreParticles * 100).toFixed(1)}%, f=
            {(runtimeRenderScoreFilaments * 100).toFixed(1)}%, s={(runtimeRenderScoreSheets * 100).toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_score_current_best_margin')}: {(runtimeRenderScoreCurrent * 100).toFixed(1)}% /{' '}
            {runtimeRenderScoreBestModeLabel} / {(runtimeRenderScoreMargin * 100).toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_hysteresis_window')}: {Math.floor(runtimeRenderHysteresisRemaining)} /{' '}
            {Math.floor(runtimeRenderHysteresisHoldSteps)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_policy_health')}: fallback={(runtimeRenderHealthFallbackRate * 100).toFixed(1)}%, timeout=
            {(runtimeRenderHealthTimeoutRate * 100).toFixed(1)}%, drift=
            {(runtimeRenderHealthDriftSeverity * 100).toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_policy_hardware_budget')}: {(Number(params.performanceSheetWorkloadBudget ?? 0.35) * 100).toFixed(1)}% /{' '}
            {Math.floor(Number(params.performanceRepresentationSwitchCooldown ?? 12))} /{' '}
            {Math.floor(Number(params.performanceMaxSheetPanels ?? 900))}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_sheet_discretization')}: {runtimeRenderSheetPanelCount} /{' '}
            {(runtimeRenderSheetCoverage * 100).toFixed(1)}% / {(runtimeRenderSheetReadiness * 100).toFixed(1)}% / q
            {Math.floor(runtimeRenderSheetQuadratureOrder)} / eps=
            {runtimeRenderSheetDesingularizationEpsilon.toFixed(4)} /{' '}
            {runtimeRenderSheetPlaceholder ? t('render_sheet_placeholder_on') : t('render_sheet_placeholder_off')} /{' '}
            {runtimeRenderSheetProfileId}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_sheet_mesh_plan')}: {runtimeRenderSheetMeshTopology} / patches=
            {Math.floor(runtimeRenderSheetMeshPatchCount)} / aspectP95=
            {runtimeRenderSheetPanelAspectP95.toFixed(2)} / {runtimeRenderSheetQuadratureProfile} / seed=
            {Math.floor(runtimeRenderSheetMeshSeed)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_sheet_quality_gates')}: {runtimeRenderSheetQualityGatePassCount}/
            {runtimeRenderSheetQualityGateTotal} / {runtimeRenderSheetQualityVerdictLabel} / penalty=
            {(runtimeRenderSheetQualityPenalty * 100).toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_sheet_mesh_layout_contract')}: {runtimeRenderSheetMeshDeterministic ? t('yes') : t('no')} / digest=
            {Math.floor(runtimeRenderSheetMeshLayoutDigest)} / min-max=
            {Math.floor(runtimeRenderSheetMeshPatchMinPanels)}-{Math.floor(runtimeRenderSheetMeshPatchMaxPanels)} /
            imbalance={runtimeRenderSheetMeshPatchImbalance.toFixed(2)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_sheet_mesh_builder_contract')}: {runtimeRenderSheetMeshContractVersion} /{' '}
            {runtimeRenderSheetMeshContractValid ? t('pass') : t('fail')} / issues=
            {Math.floor(runtimeRenderSheetMeshContractIssueCount)} / areaMean=
            {runtimeRenderSheetMeshPatchAreaMean.toExponential(2)} / areaCv=
            {runtimeRenderSheetMeshPatchAreaCv.toFixed(2)} / edgeP95=
            {runtimeRenderSheetMeshEdgeLengthRatioP95.toFixed(2)} / curvP95=
            {runtimeRenderSheetMeshCurvatureProxyP95.toFixed(2)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_sheet_mesh_builder_gates')}: {runtimeRenderSheetMeshContractGatePassCount}/
            {runtimeRenderSheetMeshContractGateTotal} / {runtimeRenderSheetMeshContractVerdictLabel} / penalty=
            {(runtimeRenderSheetMeshContractPenalty * 100).toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_sheet_coupling_contract')}: {runtimeRenderSheetCouplingVersion} /{' '}
            {runtimeRenderSheetCouplingValid ? t('pass') : t('fail')} / {runtimeRenderSheetCouplingVerdictLabel} / penalty=
            {(runtimeRenderSheetCouplingPenalty * 100).toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_sheet_coupling_contract_amer')}: {runtimeRenderSheetCouplingAmerStateLabel} / budget=
            {(runtimeRenderSheetCouplingAmerTransferBudget * 100).toFixed(1)}% / driftCap=
            {runtimeRenderSheetCouplingAmerInvariantDriftCapPct.toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_sheet_coupling_contract_filament')}: {runtimeRenderSheetCouplingFilamentStateLabel} / cap=
            {Math.floor(runtimeRenderSheetCouplingFilamentNodeTransferCap)} / load=
            {(runtimeRenderSheetCouplingFilamentLoad * 100).toFixed(1)}% / guard=
            {runtimeRenderSheetRollupStabilityGuardLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('render_policy_override_reason')}: {runtimeRenderOverrideReasonLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('overlay_confidence_uncertainty')}: {(runtimeOverlayConfidenceComposite * 100).toFixed(1)}% /{' '}
            {(runtimeOverlayUncertaintyComposite * 100).toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('overlay_uncertainty_breakdown')}: det={(runtimeOverlayUncertaintyDetector * 100).toFixed(1)}%,
            topo={(runtimeOverlayUncertaintyTopology * 100).toFixed(1)}%, render=
            {(runtimeOverlayUncertaintyRender * 100).toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('sync_epoch_staledrop_resync')}: {Math.floor(params.runtimeSyncEpoch ?? 0)} /{' '}
            {Math.floor(params.runtimeSyncStaleDrops ?? 0)} /{' '}
            {Math.floor(params.runtimeSyncResyncCount ?? 0)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_sync_policy_reason')}: {runtimeGpuSyncPolicyLabel} / {runtimeGpuSyncReasonLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_sync_violation_last_readback')}: {runtimeGpuSyncViolationCount} /{' '}
            {runtimeGpuSyncLastReadbackReasonLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_readback_full_skipped')}: {runtimeGpuFullReadbackCount} /{' '}
            {runtimeGpuSkippedReadbackCount}
          </p>
          <p className={`text-[11px] ${runtimeGpuReadbackRatioTone}`}>
            {t('gpu_readback_efficiency')}: {runtimeGpuReadbackFullRatioPercent.toFixed(1)}% ({runtimeGpuReadbackStatus})
          </p>
          <p className={`text-[11px] ${runtimeGpuOverflowTone}`}>
            {t('gpu_hash_overflow')}: {runtimeGpuOverflowCount}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_hash_collisions')}: {runtimeGpuCollisionCount}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_hash_collision_ratio')}: {runtimeGpuCollisionRatioPercent.toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_hash_load_factor')}: {runtimeGpuHashLoadFactorPercent.toFixed(1)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_dispatch_gridbuild_count')}: {runtimeGpuDispatchCount} / {runtimeGpuGridBuildCount}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_hash_occupied_buckets')}: {runtimeGpuOccupiedBucketCount} / {runtimeGpuHashTableSize}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_hash_table_size')}: {runtimeGpuHashTableSize} / {runtimeGpuAdaptiveHashTableSize}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_hash_bucket_capacity')}: {runtimeGpuBucketCapacity} / {runtimeGpuAdaptiveBucketCapacity}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_hash_adapt_cooldown')}: {runtimeGpuOverflowCooldown}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_hash_low_pressure_streak')}: {runtimeGpuLowPressureStreak}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_hash_last_adapt_event')}: {runtimeGpuAdaptiveEventTypeLabel} / {runtimeGpuAdaptiveEventReasonLabel} /{' '}
            {runtimeGpuAdaptiveEventDispatchSerial}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_overflow_critical_streak')}: {runtimeGpuOverflowCriticalStreak}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_overflow_protection_active')}: {runtimeGpuOverflowProtectionActive ? t('yes') : t('no')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_overflow_protection_cooldown')}: {runtimeGpuOverflowProtectionCooldown}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_overflow_protection_last_action')}: {runtimeGpuOverflowProtectionLastActionLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_quality_guard_active')}: {runtimeGpuQualityGuardActive ? t('yes') : t('no')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_quality_guard_apply_active')}: {runtimeGpuQualityGuardApplyActive ? t('yes') : t('no')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_quality_guard_level')}: {runtimeGpuQualityGuardLevelLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_quality_guard_compatibility')}: {runtimeGpuQualityGuardCompatibilityLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_quality_guard_scales')}:{' '}
            {runtimeGpuQualityGuardGuidedScale.toFixed(2)} / {runtimeGpuQualityGuardStretchingScale.toFixed(2)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_quality_guard_streaks')}: {runtimeGpuQualityGuardHighStepStreak} /{' '}
            {runtimeGpuQualityGuardLowStepStreak}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_quality_guard_last_action')}: {runtimeGpuQualityGuardLastActionLabel}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_quality_guard_changes_when_enabled')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('gpu_quality_guard_does_not_change_when_enabled')}
          </p>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-amber-400/80">{t('fallback_recovery_section')}</p>
          <p className="text-[11px]">
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 font-medium ${
                hasActiveFallbacks
                  ? 'bg-amber-500/20 text-amber-200'
                  : 'bg-blue-500/20 text-blue-200'
              }`}
            >
              {hasActiveFallbacks
                ? t('fallback_recovery_status_active')
                : t('fallback_recovery_status_standby')}
            </span>
          </p>
          <p className="text-[11px] text-slate-500">
            {t('fallback_recovery_active_now')}:{' '}
            {hasActiveFallbacks ? (
              <span className="inline-flex flex-wrap items-center gap-1 align-middle">
                {activeFallbackChips.map((chip, index) => (
                  <span
                    key={`${chip.label}-${index}`}
                    className={`inline-flex items-center rounded px-1.5 py-0.5 font-medium ${chip.toneClass}`}
                  >
                    {chip.label}
                  </span>
                ))}
              </span>
            ) : (
              t('fallback_recovery_none')
            )}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('fallback_recovery_counters')}:{' '}
            {Math.floor(params.runtimeStabilityAutoCorrectionTotalCount ?? 0)} /{' '}
            {Math.floor(params.runtimeGpuOverflowCriticalStreak ?? 0)} /{' '}
            {Math.floor(params.runtimeGpuQualityGuardHighStepStreak ?? 0)}
          </p>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-cyan-400/80">{t('runtime_stability_section')}</p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_stability_level')}: {String(params.runtimeStabilityLevel ?? 'ok')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_stability_warnings')}:{' '}
            {Array.isArray(params.runtimeStabilityWarnings) && params.runtimeStabilityWarnings.length > 0
              ? params.runtimeStabilityWarnings.join(', ')
              : '-'}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_stability_corrections')}:{' '}
            {Array.isArray(params.runtimeStabilityCorrections) && params.runtimeStabilityCorrections.length > 0
              ? params.runtimeStabilityCorrections.join(', ')
              : '-'}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_stability_errors')}: {(params.runtimeStabilityEnergyErrorPct ?? 0).toFixed(2)}% /{' '}
            {(params.runtimeStabilityCirculationErrorPct ?? 0).toFixed(2)}% /{' '}
            {(params.runtimeStabilityVelocityDivergence ?? 0).toFixed(2)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_stability_dt_scale')}: {(params.runtimeStabilitySuggestedDtScale ?? 1).toFixed(3)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_stability_autocorrection')}: {runtimeStabilityLastActionLabel} /{' '}
            {Math.floor(params.runtimeStabilityAutoCorrectionCooldown ?? 0)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_stability_adaptive_drift')}:{' '}
            {(params.runtimeStabilityAdaptiveDriftSeverity ?? 0).toFixed(2)} /{' '}
            {(params.runtimeStabilityAdaptiveDriftScale ?? 0).toFixed(2)} /{' '}
            {Math.floor(params.runtimeStabilityAdaptiveDriftStreak ?? 0)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_stability_autocorrection_counters')}:{' '}
            {Math.floor(params.runtimeStabilityAutoCorrectionTotalCount ?? 0)} /{' '}
            {Math.floor(params.runtimeStabilityAutoCorrectionTimeScaleCount ?? 0)} /{' '}
            {Math.floor(params.runtimeStabilityAutoCorrectionSpawnRateCount ?? 0)} /{' '}
            {Math.floor(params.runtimeStabilityAutoCorrectionRemeshRefineCount ?? 0)} /{' '}
            {Math.floor(params.runtimeStabilityAutoCorrectionRemeshCoarsenCount ?? 0)} /{' '}
            {Math.floor(params.runtimeStabilityAutoCorrectionSaturationCount ?? 0)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_stability_autocorrection_window_per_1k')}:{' '}
            {(Number(params.runtimeStabilityAutoCorrectionWindowPer1k ?? 0) || 0).toFixed(2)}
          </p>
          <p className={`text-[11px] ${runtimeStabilityAutoCorrectionPressureTone}`}>
            {t('runtime_stability_autocorrection_pressure')}:{' '}
            {runtimeStabilityAutoCorrectionPer1kSteps.toFixed(2)} / 1k ({runtimeStabilityAutoCorrectionPressureLabel}) /{' '}
            {t('runtime_stability_steps_total')}: {runtimeTotalSteps}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('runtime_stability_autocorrection_timeline')}:{' '}
            {runtimeStabilityAutoCorrectionTimeline.length > 0
              ? runtimeStabilityAutoCorrectionTimeline.join(' | ')
              : '-'}
          </p>
          <p className="text-[11px] text-slate-400">
            {t('hybrid_plus_runtime_state')}:{' '}
            {params.runtimeHybridPlusActive ? t('yes') : t('no')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('hybrid_plus_runtime_reason')}: {params.runtimeHybridPlusReason ?? t('unknown_2')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('hybrid_plus_runtime_backends')}: {params.runtimeHybridPlusBaseBackend ?? '-'} /{' '}
            {params.runtimeHybridPlusAssistBackend ?? '-'}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('hybrid_plus_runtime_sync_operators')}: {params.runtimeHybridPlusSyncMode ?? 'none'} /{' '}
            {Math.floor(params.runtimeHybridPlusOperatorCount ?? 0)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('hybrid_plus_runtime_cadence')}: base=
            {Math.floor(params.runtimeHybridPlusAssistCadenceBaseSteps ?? 1)}, run=
            {Math.floor(params.runtimeHybridPlusAssistCadenceRuntimeSteps ?? 1)}, adaptive=
            {params.runtimeHybridPlusAssistCadenceAdaptive !== false ? t('yes') : t('no')}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('hybrid_plus_runtime_scheduler')}: pressure=
            {(params.runtimeHybridPlusAssistBudgetPressure ?? 0).toFixed(2)}x, over=
            {Math.floor(params.runtimeHybridPlusAssistOverBudgetStreak ?? 0)}, idle=
            {Math.floor(params.runtimeHybridPlusAssistIdleStreak ?? 0)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('hybrid_plus_runtime_cost_ms')}:{' '}
            {(params.runtimeHybridPlusAssistCostMs ?? 0).toFixed(3)} /{' '}
            {(params.runtimeHybridPlusTopologyCostMs ?? 0).toFixed(3)} /{' '}
            {(params.runtimeHybridPlusBarnesHutCostMs ?? 0).toFixed(3)} /{' '}
            {(params.runtimeHybridPlusApplyCostMs ?? 0).toFixed(3)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('hybrid_plus_runtime_deltas')}: {Math.floor(params.runtimeHybridPlusProducedDeltaCount ?? 0)} /{' '}
            {Math.floor(params.runtimeHybridPlusAppliedDeltaCount ?? 0)} /{' '}
            {Math.floor(params.runtimeHybridPlusRejectedDeltaCount ?? 0)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('hybrid_plus_runtime_deltas_by_operator')}:{' '}
            {Math.floor(params.runtimeHybridPlusTopologyProducedCount ?? 0)} /{' '}
            {Math.floor(params.runtimeHybridPlusBarnesHutProducedCount ?? 0)}
          </p>
          <p className="text-[11px] text-slate-500">
            {t('hybrid_plus_runtime_scheduler_counters')}: run=
            {Math.floor(params.runtimeHybridPlusAssistRunCount ?? 0)}, skipCadence=
            {Math.floor(params.runtimeHybridPlusAssistSkipCadenceCount ?? 0)}, skipBudget=
            {Math.floor(params.runtimeHybridPlusAssistSkipBudgetCount ?? 0)}
          </p>
          {params.runtimeBackendError ? (
            <p className="text-[11px] text-rose-300">
              {t('runtime_error')}: {params.runtimeBackendError}
            </p>
          ) : null}
          {params.executionMode !== 'cpu' && !params.gpuAvailable ? (
            <p className="text-[11px] text-amber-300">
              {t('gpu_unavailable_solver_automatically_falls_back')}
            </p>
          ) : null}
        </InlineDisclosure>
      </DisclosureSection>

            <DisclosureSection
              title={t('space_time')}
              description={t('coordinate_axes_and_time_settings_alt')}
            >
              <CheckboxField
                label={t('reverse_time')}
                hint={t('hint_reverse_time')}
                checked={params.reverse}
                onChange={(value) => setParam('reverse', value)}
              />
              <RangeField
                label={t('dt_time_scale')}
                hint={t('hint_dt_time_scale')}
                min={0.2}
                max={3}
                step={0.01}
                value={params.timeScale}
                onChange={(value) => setParam('timeScale', value)}
              />
              <CheckboxField
                label={t('show_x_y_z_axes')}
                hint={t('hint_show_axes')}
                checked={params.showAxes}
                onChange={(value) => setParam('showAxes', value)}
              />
              <CheckboxField
                label={t('axis_labels')}
                hint={t('hint_axis_labels')}
                checked={params.showAxisLabels}
                onChange={(value) => setParam('showAxisLabels', value)}
              />
              <RangeField
                label={t('axis_thickness')}
                hint={t('hint_axis_thickness')}
                min={0.005}
                max={0.3}
                step={0.005}
                value={params.axisThickness ?? 0.04}
                onChange={(value) => setParam('axisThickness', value)}
              />
              <RangeField
                label={t('axis_opacity')}
                hint={t('hint_axis_opacity')}
                min={0}
                max={1}
                step={0.01}
                value={params.axisOpacity ?? 1}
                onChange={(value) => setParam('axisOpacity', value)}
              />
              <CheckboxField
                label={t('infinite_axes')}
                hint={t('hint_infinite_axes')}
                checked={params.infiniteAxes}
                onChange={(value) => setParam('infiniteAxes', value)}
              />
              <CheckboxField
                label={t('show_negative_axes_x_y_z')}
                hint={t('hint_show_negative_axes')}
                checked={params.showNegativeAxes}
                onChange={(value) => setParam('showNegativeAxes', value)}
              />
            </DisclosureSection>

            <DisclosureSection
              title={t('data')}
              description={t('restore_parameters_and_save_load_scene_configuration')}
            >
              <SelectField
                label={t('ui_language')}
                value={uiLanguage}
                onChange={(value) => setParam('uiLanguage', value)}
                options={[
                  { value: 'ru', label: t('russian_language') },
                  { value: 'en', label: t('english_language') },
                ]}
              />
              {importError ? (
                <p className="text-[11px] text-rose-300">
                  {t('import_error')}: {importError}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                <button
                  className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                  onClick={handleResetParamsToDefault}
                  type="button"
                  title={t('restore_default_parameters')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 1 3 7"/><polyline points="3 22 3 12 13 12"/></svg>
                  {t('restore_default_parameters')}
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                  onClick={saveCurrentConfig}
                  type="button"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
                  {t('save_to_localstorage')}
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                  onClick={loadSavedConfig}
                  type="button"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 15v4c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  {t('load_from_localstorage')}
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                  onClick={handleExportJson}
                  type="button"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  {t('export_json')}
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                  onClick={handleImportJsonClick}
                  type="button"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 15v4c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  {t('import_json')}
                </button>
              </div>
            </DisclosureSection>
            <DisclosureSection
              title={t('simulation_lab_mode')}
              description={t('simulation_lab_mode_desc')}
            >
              <SelectField
                label={t('lab_preset_select')}
                value={labPresetId}
                onChange={(value) => setLabPresetId(String(value))}
                options={labPresetOptions}
              />
              <input
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                placeholder={t('lab_experiment_name')}
                value={labExperimentName}
                onChange={(event) => setLabExperimentName(event.target.value)}
              />
              <div className="flex flex-wrap gap-1.5">
                <button
                  className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                  onClick={handleSaveLabExperiment}
                  type="button"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
                  {t('lab_save_experiment')}
                </button>
              </div>
              <SelectField
                label={t('lab_saved_experiments')}
                value={labSavedExperimentId}
                onChange={(value) => setLabSavedExperimentId(String(value))}
                options={[
                  { value: '', label: t('lab_saved_experiments_none') },
                  ...labSavedExperiments.map((item) => ({
                    value: String(item.id ?? ''),
                    label: String(item.name ?? item.id ?? ''),
                  })),
                ]}
              />
              <div className="flex flex-wrap gap-1.5">
                <button
                  className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleLoadLabExperiment}
                  type="button"
                  disabled={!labSavedExperimentId}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 15v4c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  {t('lab_load_experiment')}
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                  onClick={handleBuildLabJsonFromControls}
                  type="button"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                  {t('lab_build_json')}
                </button>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={labUseJsonEditor}
                  onChange={(event) => setLabUseJsonEditor(event.target.checked)}
                />
                <span>{t('lab_use_json_editor')}</span>
              </label>
              {labUseJsonEditor ? (
                <>
                  <textarea
                    className="h-40 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
                    placeholder={t('lab_json_placeholder')}
                    value={labExperimentJson}
                    onChange={(event) => setLabExperimentJson(event.target.value)}
                  />
                  {labExperimentJsonError ? (
                    <p className="text-[11px] text-rose-300">
                      {t('lab_json_error')}: {labExperimentJsonError}
                    </p>
                  ) : null}
                </>
              ) : null}
              <RangeField
                label={t('lab_runs')}
                hint={t('hint_lab_runs')}
                min={1}
                max={20}
                step={1}
                value={labMaxRuns}
                onChange={(value) => setLabMaxRuns(Math.max(1, Math.floor(value)))}
              />
              <RangeField
                label={t('lab_warmup_sec')}
                min={0.2}
                max={10}
                step={0.1}
                value={labWarmupSec}
                onChange={(value) => setLabWarmupSec(value)}
              />
              <RangeField
                label={t('lab_duration_sec')}
                min={1}
                max={30}
                step={0.5}
                value={labDurationSec}
                onChange={(value) => setLabDurationSec(value)}
              />
              <RangeField
                label={t('lab_sample_ms')}
                hint={t('hint_lab_sample_ms') + '\n' + t('lab_sweep_override_hint')}
                min={100}
                max={1000}
                step={50}
                value={labSampleMs}
                onChange={(value) => setLabSampleMs(Math.max(100, Math.floor(value)))}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                  placeholder={t('lab_sweep_min')}
                  value={labSweepMin}
                  onChange={(event) => setLabSweepMin(event.target.value)}
                />
                <input
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                  placeholder={t('lab_sweep_max')}
                  value={labSweepMax}
                  onChange={(event) => setLabSweepMax(event.target.value)}
                />
              </div>
              <CheckboxField
                label={t('lab_scale_enabled')}
                checked={labScaleEnabled}
                onChange={(value) => setLabScaleEnabled(value)}
              />
              {labScaleEnabled ? (
                <>
                  <SelectField
                    label={t('lab_scale_preset')}
                    value={labScalePresetId}
                    onChange={handleScalePresetChange}
                    options={scalePresetOptions}
                  />
                  <CheckboxField
                    label={t('lab_scale_apply_runtime')}
                    hint={t('hint_lab_scale_apply_runtime')}
                    checked={labScaleApplyRuntime}
                    onChange={(value) => setLabScaleApplyRuntime(value)}
                  />
                  <SelectField
                    label={t('lab_scale_class')}
                    value={labScaleClass}
                    onChange={(value) => setLabScaleClass(String(value))}
                    options={[
                      { value: 'micro', label: t('lab_scale_class_micro') },
                      { value: 'lab', label: t('lab_scale_class_lab') },
                      { value: 'atmospheric', label: t('lab_scale_class_atmospheric') },
                      { value: 'astro', label: t('lab_scale_class_astro') },
                    ]}
                  />
                  <RangeField
                    label={t('lab_scale_reynolds')}
                    min={100}
                    max={20000}
                    step={100}
                    value={labScaleRe}
                    onChange={(value) => setLabScaleRe(Math.max(100, Math.floor(value)))}
                  />
                  <RangeField
                    label={t('lab_scale_strouhal')}
                    hint={t('lab_scale_hint')}
                    min={0.01}
                    max={1}
                    step={0.01}
                    value={labScaleSt}
                    onChange={(value) => setLabScaleSt(value)}
                  />
                </>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                <button
                  className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleRunLabPreset}
                  type="button"
                  disabled={labRunBusy}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  {labRunBusy ? t('lab_run_busy') : t('lab_run_preset')}
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleExportLabJson}
                  type="button"
                  disabled={!labRunResult?.result}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  {t('lab_export_json')}
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleExportLabCsv}
                  type="button"
                  disabled={!labRunResult?.result}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
                  {t('lab_export_csv')}
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleExportLabAcceptanceReport}
                  type="button"
                  disabled={!labRunResult?.result}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  {t('lab_export_acceptance')}
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                {t('lab_progress')}: {(labRunProgress * 100).toFixed(0)}% {labRunStatus ? `- ${labRunStatus}` : ''}
              </p>
              {labRunError ? <p className="text-[11px] text-rose-300">{labRunError}</p> : null}
              {latestArtifactEntry ? (
                <p className="text-[11px] text-slate-500">
                  {t('lab_artifact_sink')}: {labArtifactIndex.length} | last={latestArtifactEntry.configHash} |{' '}
                  {latestArtifactEntry.completedRuns}/{latestArtifactEntry.totalRuns} |{' '}
                  {latestArtifactEntry.ok ? 'ok' : 'err'}
                </p>
              ) : null}
              {labRunResult?.result?.totals ? (
                <p className="text-[11px] text-slate-500">
                  {t('lab_totals')}: {Math.floor(labRunResult.result.totals.completed ?? 0)} /{' '}
                  {Math.floor(labRunResult.result.totals.failed ?? 0)} /{' '}
                  {Math.floor(labRunResult.result.totals.total ?? 0)}
                </p>
              ) : null}
              {labArtifactPreview ? (
                <>
                  <SelectField
                    label={t('lab_inspect_run')}
                    value={String(labInspectRunIndex)}
                    onChange={(value) => setLabInspectRunIndex(Math.max(0, Number(value) || 0))}
                    options={labPreviewRows.map((row) => ({
                      value: String(row.runIndex),
                      label: `${t('lab_run_short')} ${row.runIndex} (${row.ok ? 'ok' : 'err'})`,
                    }))}
                  />
                  <p className="text-[11px] text-slate-500">
                    {t('lab_artifact_preview')}: {labArtifactPreview}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    scale-valid={labPreviewRow?.scaleValidationErrors ? 'fail' : 'ok'}, scale-consistency-maxerr=
                    {Number(labPreviewRow?.scaleConsistencyMaxErrorPct ?? 0).toFixed(4)}%
                    {labPreviewRow?.scaleValidationWarnings ? ` (${labPreviewRow.scaleValidationWarnings})` : ''}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('lab_adaptive_preview')}: decisions={labPreviewRow?.adaptiveDecisionCount ?? 0}, refine=
                    {labPreviewRow?.adaptiveRefineCount ?? 0}, coarsen={labPreviewRow?.adaptiveCoarsenCount ?? 0},
                    actuations={labPreviewRow?.adaptiveActuationAppliedCount ?? 0}/
                    {labPreviewRow?.adaptiveActuationSkippedCount ?? 0}, acceptance=
                    {labPreviewRow?.adaptiveAcceptanceOk ? t('lab_acceptance_pass') : t('lab_acceptance_fail')}
                    {labPreviewRow?.adaptiveAcceptanceFailedChecks
                      ? ` (${labPreviewRow.adaptiveAcceptanceFailedChecks})`
                      : ''}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('lab_adaptive_diagnostics_map')}: dominant={labPreviewRow?.adaptiveDominantLevel ?? 'L1'},
                    transitions={labPreviewRow?.adaptiveTransitionCount ?? 0}, verify=
                    {labPreviewRow?.adaptiveControllerVerificationOk
                      ? t('lab_acceptance_pass')
                      : t('lab_acceptance_fail')}
                    {labPreviewRow?.adaptiveControllerVerificationFailedChecks
                      ? ` (${labPreviewRow.adaptiveControllerVerificationFailedChecks})`
                      : ''}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('lab_adaptive_occupancy_overlay')}: L0={Number(
                      labPreviewRow?.adaptiveOccupancyL0Pct ?? 0,
                    ).toFixed(1)}
                    %, L1={Number(labPreviewRow?.adaptiveOccupancyL1Pct ?? 0).toFixed(1)}%, L2=
                    {Number(labPreviewRow?.adaptiveOccupancyL2Pct ?? 0).toFixed(1)}%, L3=
                    {Number(labPreviewRow?.adaptiveOccupancyL3Pct ?? 0).toFixed(1)}%
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {t('lab_adaptive_baseline')}: {labPreviewRow?.adaptiveBaselineScenarioId ?? 'adaptive.mid'} -{' '}
                    {labPreviewRow?.adaptiveBaselineOk ? t('lab_acceptance_pass') : t('lab_acceptance_fail')}
                    {labPreviewRow?.adaptiveBaselineFailedChecks
                      ? ` (${labPreviewRow.adaptiveBaselineFailedChecks})`
                      : ''}
                  </p>
                  {labTransitionMatrixRows.length > 0 ? (
                    <p className="text-[11px] text-slate-500">
                      {t('lab_adaptive_transition_matrix')}: {labTransitionMatrixRows.join(' | ')}
                    </p>
                  ) : null}
                </>
              ) : null}
              {Array.isArray(labRunResult?.result?.runs) && labRunResult.result.runs.length > 0 ? (
                <p className="text-[11px] text-slate-500">
                  {t('lab_scale_last_applicability')}:{' '}
                  {String(labRunResult.result.runs[0]?.result?.summary?.scaleApplicabilityLevel ?? 'n/a')} |{' '}
                  {String(labRunResult.result.runs[0]?.result?.summary?.scalePresetId ?? 'custom')}
                </p>
              ) : null}
              {labRunHistory.length > 0 ? (
                <>
                  <SelectField
                    label={t('lab_history_select')}
                    value={labSelectedHistoryId}
                    onChange={(value) => setLabSelectedHistoryId(String(value))}
                    options={labRunHistory.map((item) => ({
                      value: String(item.id ?? ''),
                      label: `${String(item.title ?? 'run')} (${String(item.timestamp ?? '').slice(0, 19)})`,
                    }))}
                  />
                  <SelectField
                    label={t('lab_history_compare_select')}
                    value={labCompareHistoryId}
                    onChange={(value) => setLabCompareHistoryId(String(value))}
                    options={labRunHistory
                      .filter((item) => String(item.id ?? '') !== String(labSelectedHistoryId ?? ''))
                      .map((item) => ({
                        value: String(item.id ?? ''),
                        label: `${String(item.title ?? 'run')} (${String(item.timestamp ?? '').slice(0, 19)})`,
                      }))}
                  />
                  {selectedHistoryEntry ? (
                    <p className="text-[11px] text-slate-500">
                      {t('lab_history_detail')}: {selectedHistoryEntry.title} |{' '}
                      {selectedHistoryEntry.totals?.completed ?? 0}/{selectedHistoryEntry.totals?.total ?? 0} |{' '}
                      {selectedHistoryEntry.scaleApplicabilityLevel ?? 'n/a'} |{' '}
                      {selectedHistoryEntry.scalePresetId ?? 'custom'} | hash=
                      {selectedHistoryEntry.configHash ?? 'unknown'} | adaptive=
                      {selectedHistoryEntry.adaptiveAcceptanceOk === true
                        ? t('lab_acceptance_pass')
                        : selectedHistoryEntry.adaptiveAcceptanceOk === false
                          ? t('lab_acceptance_fail')
                          : 'n/a'}
                    </p>
                  ) : null}
                  {selectedHistoryEntry && compareHistoryEntry ? (
                    <p className="text-[11px] text-slate-500">
                      {t('lab_history_compare')}: dThroughput={selectedVsCompareThroughputDelta.toFixed(1)} pps, dStep=
                      {selectedVsCompareStepDelta.toFixed(2)} ms
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-[11px] text-slate-500">{t('lab_history_empty')}</p>
              )}
            </DisclosureSection>
            <DisclosureSection
              title={t('visualization_tools')}
              description={t('visualization_tools_desc')}
            >
              <InlineDisclosure title={t('viz_section_overlays')} defaultOpen>
                <div className="space-y-0">
                  <CheckboxField
                    label={t('viz_scientific_mode')}
                    hint={t('hint_viz_scientific_mode')}
                    checked={params.vizScientificMode === true}
                    onChange={(value) => {
                      if (!value) {
                        setParam('vizScientificMode', false)
                        return
                      }
                      setParams({
                        ...params,
                        vizScientificMode: true,
                        vizShowVorticityField: true,
                        vizShowQCriterion: true,
                        vizShowVelocityField: true,
                        vizShowStreamlines: true,
                        vizShowPathlines: true,
                        vizShowDetectionOverlay: true,
                        vizShowTopologyOverlay: true,
                        vizShowEnergyOverlay: true,
                        vizOverlayShowLabels: true,
                      })
                    }}
                  />
                  <CheckboxField
                    label={t('viz_show_vorticity_field')}
                    checked={params.vizShowVorticityField === true}
                    onChange={(value) => setParam('vizShowVorticityField', value)}
                  />
                  <CheckboxField
                    label={t('viz_show_q_criterion')}
                    hint={t('hint_viz_q_criterion')}
                    checked={params.vizShowQCriterion === true}
                    onChange={(value) => setParam('vizShowQCriterion', value)}
                  />
                  <CheckboxField
                    label={t('viz_show_velocity_field')}
                    checked={params.vizShowVelocityField === true}
                    onChange={(value) => setParam('vizShowVelocityField', value)}
                  />
                  <CheckboxField
                    label={t('viz_show_streamlines')}
                    hint={t('hint_viz_streamlines')}
                    checked={params.vizShowStreamlines === true}
                    onChange={(value) => setParam('vizShowStreamlines', value)}
                  />
                  <CheckboxField
                    label={t('viz_show_pathlines')}
                    checked={params.vizShowPathlines === true}
                    onChange={(value) => setParam('vizShowPathlines', value)}
                  />
                  <CheckboxField
                    label={t('viz_show_detection_overlay')}
                    hint={t('hint_viz_detection_overlay')}
                    checked={params.vizShowDetectionOverlay === true}
                    onChange={(value) => setParam('vizShowDetectionOverlay', value)}
                  />
                  <CheckboxField
                    label={t('viz_show_topology_overlay')}
                    hint={t('hint_viz_topology_overlay')}
                    checked={params.vizShowTopologyOverlay === true}
                    onChange={(value) => setParam('vizShowTopologyOverlay', value)}
                  />
                  <CheckboxField
                    label={t('viz_show_energy_overlay')}
                    hint={t('hint_viz_energy_overlay')}
                    checked={params.vizShowEnergyOverlay === true}
                    onChange={(value) => setParam('vizShowEnergyOverlay', value)}
                  />
                </div>
              </InlineDisclosure>

              <InlineDisclosure title={t('viz_section_overlay_settings')}>
                <div className="space-y-0">
                  <CheckboxField
                    label={t('viz_overlay_show_labels')}
                    checked={params.vizOverlayShowLabels === true}
                    onChange={(value) => setParam('vizOverlayShowLabels', value)}
                  />
                  <RangeField
                    label={t('viz_overlay_label_max_count')}
                    value={params.vizOverlayLabelMaxCount ?? 8}
                    min={1}
                    max={24}
                    step={1}
                    onChange={(value) => setParam('vizOverlayLabelMaxCount', Math.floor(value))}
                  />
                  <RangeField
                    label={t('viz_overlay_label_max_distance')}
                    value={params.vizOverlayLabelMaxDistance ?? 12}
                    min={2}
                    max={60}
                    step={0.5}
                    onChange={(value) => setParam('vizOverlayLabelMaxDistance', value)}
                  />
                  <RangeField
                    label={t('viz_overlay_confidence_min')}
                    value={params.vizOverlayMinConfidence ?? 0.25}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => setParam('vizOverlayMinConfidence', value)}
                  />
                </div>
              </InlineDisclosure>

              <InlineDisclosure title={t('viz_section_photo')}>
                <div className="space-y-1">
                  <RangeField
                    label={t('viz_photo_burst_count')}
                    value={vizPhotoBurstCount}
                    min={2}
                    max={24}
                    step={1}
                    onChange={(value) => setVizPhotoBurstCount(Math.max(2, Math.min(24, Math.floor(value))))}
                  />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <button
                      className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                      onClick={handleApplyPhotoFramePreset}
                      type="button"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M20 4h-3.13a2 2 0 0 1-1.83-1.18C14.72 2.3 14.4 2 14 2h-4c-.4 0-.72.3-1.04.82A2 2 0 0 1 7.13 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/></svg>
                      {t('viz_photo_apply_preset')}
                    </button>
                    <button
                      className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                      onClick={handleSingleStepPhotoExport}
                      type="button"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                      {t('viz_photo_single_step_export')}
                    </button>
                    <button
                      className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90 disabled:opacity-50"
                      disabled={vizPhotoBurstBusy}
                      onClick={() => {
                        void handleBurstPhotoBestExport()
                      }}
                      type="button"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><rect x="6" y="6" width="12" height="12" rx="1"/><rect x="9" y="9" width="6" height="6" rx="0.5"/></svg>
                      {t('viz_photo_burst_best_export')}
                    </button>
                  </div>
                </div>
              </InlineDisclosure>

              <InlineDisclosure title={t('viz_section_snapshot')}>
                <div className="space-y-1">
                  <RangeField
                    label={t('viz_export_scale')}
                    hint={t('hint_viz_export_scale')}
                    value={params.vizExportScale ?? 1}
                    min={0.5}
                    max={4}
                    step={0.1}
                    onChange={(value) => setParam('vizExportScale', value)}
                  />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <button
                      className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                      onClick={handleExportScientificPng}
                      type="button"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                      {t('viz_export_png')}
                    </button>
                    <button
                      className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                      onClick={handleExportScientificMetadata}
                      type="button"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      {t('viz_export_metadata')}
                    </button>
                    <button
                      className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                      onClick={handleExportScientificBundle}
                      type="button"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                      {t('viz_export_bundle')}
                    </button>
                    <button
                      className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                      onClick={handleExportScientificSequenceManifest}
                      type="button"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                      {t('viz_export_sequence_manifest')}
                    </button>
                  </div>
                  {vizExportStatus ? <p className="text-[11px] text-slate-500 pt-1">{vizExportStatus}</p> : null}
                </div>
              </InlineDisclosure>

              <InlineDisclosure title={t('viz_section_video')}>
                <div className="space-y-1">
                  <RangeField
                    label={t('viz_mp4_capture_frame_count')}
                    value={vizMp4FrameCount}
                    min={4}
                    max={240}
                    step={1}
                    onChange={(value) => setVizMp4FrameCount(Math.max(4, Math.min(240, Math.floor(value))))}
                  />
                  <RangeField
                    label={t('viz_mp4_capture_fps')}
                    value={vizMp4Fps}
                    min={12}
                    max={60}
                    step={1}
                    onChange={(value) => setVizMp4Fps(Math.max(12, Math.min(60, Math.floor(value))))}
                  />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <button
                      className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                      onClick={handleExportScientificFfmpegPlan}
                      type="button"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                      {t('viz_export_ffmpeg_plan')}
                    </button>
                    <button
                      className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90 disabled:opacity-50"
                      disabled={vizMp4CaptureBusy}
                      onClick={() => {
                        void handleAutoCaptureScientificMp4Package()
                      }}
                      type="button"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                      {t('viz_export_mp4_auto_capture')}
                    </button>
                  </div>
                </div>
              </InlineDisclosure>

              <InlineDisclosure title={t('viz_section_topology')}>
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                      onClick={handleExportTopologyEventLogJson}
                      type="button"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                      {t('viz_export_topology_json')}
                    </button>
                    <button
                      className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                      onClick={handleExportTopologyEventLogCsv}
                      type="button"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
                      {t('viz_export_topology_csv')}
                    </button>
                    <button
                      className="inline-flex items-center gap-1 rounded border border-slate-600/70 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700/90"
                      onClick={handleClearVizTimeline}
                      type="button"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      {t('viz_timeline_clear')}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 pt-1">
                    {t('viz_timeline_points')}: {vizTimeline.length}
                  </p>
                </div>
              </InlineDisclosure>
            </DisclosureSection>
            <DisclosureSection
              title={t('debug_and_diagnostics')}
              description={t('spatial_debug_ring_debug_modes_and_diagnostic_coloring_alt')}
            >
              {(params.physicsBackend === 'webgpu' || params.velocityComputationMode === 'spatialGrid') ? (
                <>
                  <CheckboxField
                    label={t('debug_show_grid')}
                    hint={t('hint_debug_show_grid')}
                    checked={params.showGrid}
                    onChange={(value) => setParam('showGrid', value)}
                  />
                  <CheckboxField
                    label={t('debug_show_cell_centers_alt')}
                    checked={params.showCellCenters}
                    onChange={(value) => setParam('showCellCenters', value)}
                  />
                  <CheckboxField
                    label={t('debug_show_neighbor_cells_alt')}
                    hint={t('hint_debug_show_neighbor_cells')}
                    checked={params.showNeighborCells}
                    onChange={(value) => setParam('showNeighborCells', value)}
                  />
                </>
              ) : (
                <p className="text-[11px] text-slate-500">
                  {t('spatial_debug_is_available_only_for')}
                </p>
              )}
              {(params.vortexRepresentation === 'filaments' ||
                params.vortexRepresentation === 'hybrid' ||
                params.vortexRepresentation === 'tubes') && (
                <>
                  <CheckboxField
                    label={t('debug_show_filaments')}
                    hint={t('hint_debug_show_filaments')}
                    checked={params.showFilaments}
                    onChange={(value) => setParam('showFilaments', value)}
                  />
                  {params.vortexRepresentation === 'tubes' ? (
                    <>
                      <CheckboxField
                        label={t('show_tube_particles')}
                        hint={t('hint_show_tube_particles')}
                        checked={params.showTubeParticles !== false}
                        onChange={(value) => setParam('showTubeParticles', value)}
                      />
                      <CheckboxField
                        label={t('show_tube_surface')}
                        hint={t('hint_show_tube_surface')}
                        checked={params.showTubeSurface === true}
                        onChange={(value) => setParam('showTubeSurface', value)}
                      />
                      <CheckboxField
                        label={t('show_tube_spine')}
                        hint={t('hint_show_tube_spine')}
                        checked={params.showTubeSpine !== false}
                        onChange={(value) => setParam('showTubeSpine', value)}
                      />
                    </>
                  ) : null}
                  <CheckboxField
                    label={t('debug_show_filament_nodes_alt')}
                    hint={t('hint_debug_show_filament_nodes')}
                    checked={params.showFilamentNodes}
                    onChange={(value) => setParam('showFilamentNodes', value)}
                  />
                  <CheckboxField
                    label={t('debug_show_circulation')}
                    hint={t('hint_debug_show_circulation')}
                    checked={params.showCirculation}
                    onChange={(value) => setParam('showCirculation', value)}
                  />
                  <CheckboxField
                    label={t('debug_show_filament_velocity_vectors')}
                    hint={t('hint_debug_show_velocity_vectors')}
                    checked={params.showFilamentVelocityVectors}
                    onChange={(value) => setParam('showFilamentVelocityVectors', value)}
                  />
                  <CheckboxField
                    label={t('debug_show_filament_tangents')}
                    hint={t('hint_debug_show_tangents')}
                    checked={params.showFilamentTangents}
                    onChange={(value) => setParam('showFilamentTangents', value)}
                  />
                </>
              )}
              {isRingBasedEmission && (
                <>
                  <CheckboxField
                    label={t('debug_shear_layer_alt')}
                    hint={t('hint_debug_shear_layer')}
                    checked={params.showShearLayer}
                    onChange={(value) => setParam('showShearLayer', value)}
                  />
                  <CheckboxField
                    label={t('debug_axis_ring')}
                    hint={t('hint_debug_axis_ring')}
                    checked={params.showVortexRingAxis}
                    onChange={(value) => setParam('showVortexRingAxis', value)}
                  />
                </>
              )}
              <CheckboxField
                label={t('debug_color_by_omega')}
                hint={t('hint_debug_color_by_omega')}
                checked={params.debugVorticity}
                onChange={(value) => setParam('debugVorticity', value)}
              />
              {isPhysicsMode && (
                <CheckboxField
                  label={t('debug_stability_alt')}
                  hint={t('hint_debug_stability')}
                  checked={params.debugStability}
                  onChange={(value) => setParam('debugStability', value)}
                />
              )}
            </DisclosureSection>

            <DisclosureSection
              title={t('application')}
              description={t('application_desc')}
            >
              <RangeField
                label={t('ui_opacity')}
                hint={t('hint_ui_opacity')}
                min={20}
                max={100}
                step={1}
                value={panelOpacity}
                onChange={setPanelOpacity}
                valueSuffix="%"
              />
              <div className="mt-2 flex justify-center">
                <button
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors hover:text-white"
                  style={{
                    borderColor: 'rgba(99,102,241,0.2)',
                    color: '#9094c0',
                    background: 'rgba(99,102,241,0.06)',
                  }}
                  onClick={() => setAboutOpen(true)}
                  type="button"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  {t('about')}
                </button>
              </div>
            </DisclosureSection>
            </div>
          </>
        )}
      </aside>
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} language={uiLanguage} />
      {showFps && <FpsCounter nativeRender={typeof window !== 'undefined' && !!window.__TAURI__} />}
    </>
  )
}

