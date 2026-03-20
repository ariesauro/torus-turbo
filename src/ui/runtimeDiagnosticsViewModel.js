export function buildRuntimeDiagnosticsViewModel(params, t) {
  const runtimeBackendLabel =
    params.runtimeBackend === 'gpu'
      ? 'GPU'
      : params.runtimeBackend === 'gpu_error'
        ? t('gpu_error')
        : params.runtimeBackend?.toUpperCase?.() ?? t('unknown')

  const runtimeParticleRenderBackendLabel =
    params.runtimeParticleRenderBackend === 'gpu' ? t('gpu_snapshot') : t('cpu_fallback')

  const runtimeParticleRenderPolicyLabel =
    params.runtimeParticleRenderPolicy === 'gpu_primary'
      ? t('particle_render_policy_gpu_primary')
      : params.runtimeParticleRenderPolicy === 'conservative_hybrid'
        ? t('particle_render_policy_conservative_hybrid')
        : t('particle_render_policy_cpu_backend')

  const runtimeParticleRenderFallbackReasonLabel = t(
    params.runtimeParticleRenderFallbackReason ?? 'unknown_2',
  )
  const runtimeRenderPolicyModeLabel =
    params.runtimeRenderPolicyMode === 'filaments'
      ? t('render_policy_mode_filaments')
      : params.runtimeRenderPolicyMode === 'hybrid'
        ? t('render_policy_mode_hybrid')
        : params.runtimeRenderPolicyMode === 'tubes'
          ? t('render_policy_mode_tubes')
          : t('render_policy_mode_particles')
  const runtimeRenderLodTierLabel =
    params.runtimeRenderLodTier === 'far'
      ? t('render_lod_tier_far')
      : params.runtimeRenderLodTier === 'mid'
        ? t('render_lod_tier_mid')
        : t('render_lod_tier_near')
  const runtimeTransitionStateLabel =
    params.runtimeTransitionState === 'candidate'
      ? t('runtime_transition_state_candidate')
      : params.runtimeTransitionState === 'pending_confirm'
        ? t('runtime_transition_state_pending_confirm')
        : params.runtimeTransitionState === 'committed'
          ? t('runtime_transition_state_committed')
          : params.runtimeTransitionState === 'rejected'
            ? t('runtime_transition_state_rejected')
            : t('runtime_transition_state_idle')
  const runtimeTransitionCandidateType = String(params.runtimeTransitionCandidateType ?? 'none')
  const runtimeTransitionPendingFrames = Math.max(0, Math.floor(Number(params.runtimeTransitionPendingFrames ?? 0) || 0))
  const runtimeTransitionCandidates = Math.max(0, Math.floor(Number(params.runtimeTransitionCandidates ?? 0) || 0))
  const runtimeTransitionCommitted = Math.max(0, Math.floor(Number(params.runtimeTransitionCommitted ?? 0) || 0))
  const runtimeTransitionRejected = Math.max(0, Math.floor(Number(params.runtimeTransitionRejected ?? 0) || 0))
  const runtimeTransitionGammaDriftPct = Math.max(0, Number(params.runtimeTransitionGammaDriftPct ?? 0) || 0)
  const runtimeTransitionImpulseDriftPct = Math.max(0, Number(params.runtimeTransitionImpulseDriftPct ?? 0) || 0)
  const runtimeTransitionEnergyDriftPct = Math.max(0, Number(params.runtimeTransitionEnergyDriftPct ?? 0) || 0)
  const runtimeTransitionGateConfidenceOk = params.runtimeTransitionGateConfidenceOk === true
  const runtimeTransitionGateInvariantOk = params.runtimeTransitionGateInvariantOk === true
  const runtimeTransitionGateHysteresisOk = params.runtimeTransitionGateHysteresisOk === true
  const runtimeTransitionGateReason = String(params.runtimeTransitionGateReason ?? 'none')
  const runtimeTransitionEnterFrames = Math.max(1, Math.floor(Number(params.runtimeTransitionEnterFrames ?? 3) || 3))
  const runtimeTransitionConfidenceEnterMin = Math.max(
    0,
    Math.min(1, Number(params.runtimeTransitionConfidenceEnterMin ?? 0.56) || 0),
  )
  const runtimeTransitionConfidenceExitMin = Math.max(
    0,
    Math.min(1, Number(params.runtimeTransitionConfidenceExitMin ?? 0.44) || 0),
  )
  const runtimeRingValidationVersion = String(params.runtimeRingValidationVersion ?? 'tt023b.ring_validation.v1')
  const runtimeRingValidationValid = params.runtimeRingValidationValid !== false
  const runtimeRingValidationVerdict = String(params.runtimeRingValidationVerdict ?? 'pass')
  const runtimeRingValidationVerdictLabel =
    runtimeRingValidationVerdict === 'fail'
      ? t('render_sheet_quality_verdict_fail')
      : runtimeRingValidationVerdict === 'warn'
        ? t('render_sheet_quality_verdict_warn')
        : t('render_sheet_quality_verdict_pass')
  const runtimeRingValidationAcceptanceScore = Math.max(
    0,
    Math.min(1, Number(params.runtimeRingValidationAcceptanceScore ?? 0) || 0),
  )
  const runtimeRingValidationGatePassCount = Math.max(
    0,
    Math.floor(Number(params.runtimeRingValidationGatePassCount ?? 0) || 0),
  )
  const runtimeRingValidationGateTotal = Math.max(
    1,
    Math.floor(Number(params.runtimeRingValidationGateTotal ?? 4) || 4),
  )
  const runtimeRingValidationTransitionCommitRatio = Math.max(
    0,
    Math.min(1, Number(params.runtimeRingValidationTransitionCommitRatio ?? 0) || 0),
  )
  const runtimeJetRegimeVersion = String(params.runtimeJetRegimeVersion ?? 'tt024b.jet_regime.v1')
  const runtimeJetRegimeValid = params.runtimeJetRegimeValid !== false
  const runtimeJetRegimeVerdict = String(params.runtimeJetRegimeVerdict ?? 'pass')
  const runtimeJetRegimeVerdictLabel =
    runtimeJetRegimeVerdict === 'fail'
      ? t('render_sheet_quality_verdict_fail')
      : runtimeJetRegimeVerdict === 'warn'
        ? t('render_sheet_quality_verdict_warn')
        : t('render_sheet_quality_verdict_pass')
  const runtimeJetRegimeType = String(params.runtimeJetRegimeType ?? 'ring_train')
  const runtimeJetRegimeAcceptanceScore = Math.max(
    0,
    Math.min(1, Number(params.runtimeJetRegimeAcceptanceScore ?? 0) || 0),
  )
  const runtimeJetRegimeGatePassCount = Math.max(
    0,
    Math.floor(Number(params.runtimeJetRegimeGatePassCount ?? 0) || 0),
  )
  const runtimeJetRegimeGateTotal = Math.max(
    1,
    Math.floor(Number(params.runtimeJetRegimeGateTotal ?? 4) || 4),
  )
  const runtimeJetRegimeReProxy = Math.max(0, Math.min(1, Number(params.runtimeJetRegimeReProxy ?? 0) || 0))
  const runtimeJetRegimeStProxy = Math.max(0, Math.min(1, Number(params.runtimeJetRegimeStProxy ?? 0) || 0))
  const runtimeJetRegimeLdProxy = Math.max(0, Math.min(1, Number(params.runtimeJetRegimeLdProxy ?? 0) || 0))
  const runtimeJetRegimeRingDominance = Math.max(
    0,
    Math.min(1, Number(params.runtimeJetRegimeRingDominance ?? 0) || 0),
  )
  const runtimeJetRegimeWakeIndex = Math.max(0, Math.min(1, Number(params.runtimeJetRegimeWakeIndex ?? 0) || 0))
  const runtimeDetectedSheetCount = Math.max(0, Math.floor(Number(params.runtimeDetectedSheetCount ?? 0) || 0))
  const runtimeDetectionSheetSurfaceCoherence = Math.max(
    0,
    Math.min(1, Number(params.runtimeDetectionSheetSurfaceCoherence ?? 0) || 0),
  )
  const runtimeDetectionSheetCurvatureAnisotropy = Math.max(
    0,
    Math.min(1, Number(params.runtimeDetectionSheetCurvatureAnisotropy ?? 0) || 0),
  )
  const runtimeDetectionClassConfidenceFilament = Math.max(
    0,
    Math.min(1, Number(params.runtimeDetectionClassConfidenceFilament ?? 0) || 0),
  )
  const runtimeDetectionClassConfidenceRing = Math.max(
    0,
    Math.min(1, Number(params.runtimeDetectionClassConfidenceRing ?? 0) || 0),
  )
  const runtimeDetectionClassConfidenceTube = Math.max(
    0,
    Math.min(1, Number(params.runtimeDetectionClassConfidenceTube ?? 0) || 0),
  )
  const runtimeDetectionClassConfidenceSheet = Math.max(
    0,
    Math.min(1, Number(params.runtimeDetectionClassConfidenceSheet ?? 0) || 0),
  )
  const runtimeDetectorFusionVersion = String(params.runtimeDetectorFusionVersion ?? 'tt025b.detector_fusion.v1')
  const runtimeDetectorFusionValid = params.runtimeDetectorFusionValid !== false
  const runtimeDetectorFusionVerdict = String(params.runtimeDetectorFusionVerdict ?? 'pass')
  const runtimeDetectorFusionVerdictLabel =
    runtimeDetectorFusionVerdict === 'fail'
      ? t('render_sheet_quality_verdict_fail')
      : runtimeDetectorFusionVerdict === 'warn'
        ? t('render_sheet_quality_verdict_warn')
        : t('render_sheet_quality_verdict_pass')
  const runtimeDetectorFusionAcceptanceScore = Math.max(
    0,
    Math.min(1, Number(params.runtimeDetectorFusionAcceptanceScore ?? 0) || 0),
  )
  const runtimeDetectorFusionGatePassCount = Math.max(
    0,
    Math.floor(Number(params.runtimeDetectorFusionGatePassCount ?? 0) || 0),
  )
  const runtimeDetectorFusionGateTotal = Math.max(
    1,
    Math.floor(Number(params.runtimeDetectorFusionGateTotal ?? 5) || 5),
  )
  const runtimeDetectorFusionWeightedScore = Math.max(
    0,
    Math.min(1, Number(params.runtimeDetectorFusionWeightedScore ?? 0) || 0),
  )
  const runtimeTopologyVersion = String(params.runtimeTopologyVersion ?? 'tt028b.topology_tracking.v1')
  const runtimeTopologyValid = params.runtimeTopologyValid !== false
  const runtimeTopologyFrameSerial = Math.max(0, Math.floor(Number(params.runtimeTopologyFrameSerial ?? 0) || 0))
  const runtimeTopologyEventCount = Math.max(0, Math.floor(Number(params.runtimeTopologyEventCount ?? 0) || 0))
  const runtimeTopologyNodeCount = Math.max(0, Math.floor(Number(params.runtimeTopologyNodeCount ?? 0) || 0))
  const runtimeTopologyEdgeCount = Math.max(0, Math.floor(Number(params.runtimeTopologyEdgeCount ?? 0) || 0))
  const runtimeTopologyBirthCount = Math.max(0, Math.floor(Number(params.runtimeTopologyBirthCount ?? 0) || 0))
  const runtimeTopologyDecayCount = Math.max(0, Math.floor(Number(params.runtimeTopologyDecayCount ?? 0) || 0))
  const runtimeTopologyMergeCount = Math.max(0, Math.floor(Number(params.runtimeTopologyMergeCount ?? 0) || 0))
  const runtimeTopologySplitCount = Math.max(0, Math.floor(Number(params.runtimeTopologySplitCount ?? 0) || 0))
  const runtimeTopologyReconnectionCount = Math.max(
    0,
    Math.floor(Number(params.runtimeTopologyReconnectionCount ?? 0) || 0),
  )
  const runtimeTopologyLatestEventType = String(params.runtimeTopologyLatestEventType ?? 'none')
  const runtimeTopologyLatestEventConfidence = Math.max(
    0,
    Math.min(1, Number(params.runtimeTopologyLatestEventConfidence ?? 0) || 0),
  )
  const runtimeTopologyLatestEventFrame = Math.max(
    0,
    Math.floor(Number(params.runtimeTopologyLatestEventFrame ?? 0) || 0),
  )
  const runtimeRenderScoreParticles = Math.max(0, Math.min(1, Number(params.runtimeRenderScoreParticles ?? 0) || 0))
  const runtimeRenderScoreFilaments = Math.max(
    0,
    Math.min(1, Number(params.runtimeRenderScoreFilaments ?? 0) || 0),
  )
  const runtimeRenderScoreSheets = Math.max(0, Math.min(1, Number(params.runtimeRenderScoreSheets ?? 0) || 0))
  const runtimeRenderScoreCurrent = Math.max(0, Math.min(1, Number(params.runtimeRenderScoreCurrent ?? 0) || 0))
  const runtimeRenderScoreMargin = Math.max(0, Math.min(1, Number(params.runtimeRenderScoreMargin ?? 0) || 0))
  const runtimeRenderScoreBestModeLabel =
    params.runtimeRenderScoreBestMode === 'filaments'
      ? t('render_policy_mode_filaments')
      : params.runtimeRenderScoreBestMode === 'sheets'
        ? t('render_policy_mode_sheets')
        : t('render_policy_mode_particles')
  const runtimeRenderHysteresisHoldSteps = Math.max(0, Math.floor(Number(params.runtimeRenderHysteresisHoldSteps ?? 0)))
  const runtimeRenderHysteresisRemaining = Math.max(
    0,
    Math.floor(Number(params.runtimeRenderHysteresisRemaining ?? 0)),
  )
  const runtimeRenderOverrideReasonLabel =
    params.runtimeRenderOverrideReason === 'fallback_storm'
      ? t('render_policy_override_reason_fallback_storm')
      : params.runtimeRenderOverrideReason === 'timeout_burst'
        ? t('render_policy_override_reason_timeout_burst')
        : params.runtimeRenderOverrideReason === 'invariant_guard'
          ? t('render_policy_override_reason_invariant_guard')
          : t('render_policy_override_reason_none')
  const runtimeRenderHealthFallbackRate = Math.max(
    0,
    Math.min(1, Number(params.runtimeRenderHealthFallbackRate ?? 0) || 0),
  )
  const runtimeRenderHealthTimeoutRate = Math.max(
    0,
    Math.min(1, Number(params.runtimeRenderHealthTimeoutRate ?? 0) || 0),
  )
  const runtimeRenderHealthDriftSeverity = Math.max(
    0,
    Math.min(1, Number(params.runtimeRenderHealthDriftSeverity ?? 0) || 0),
  )
  const runtimeRenderDiagnosticsConfidence = Math.max(
    0,
    Math.min(1, Number(params.runtimeRenderDiagnosticsConfidence ?? 0) || 0),
  )
  const runtimeRenderDiagnosticsUncertainty = Math.max(
    0,
    Math.min(1, Number(params.runtimeRenderDiagnosticsUncertainty ?? 1) || 0),
  )
  const runtimeRenderUncertaintyDetectorGap = Math.max(
    0,
    Math.min(1, Number(params.runtimeRenderUncertaintyDetectorGap ?? 1) || 0),
  )
  const runtimeRenderUncertaintyFallback = Math.max(
    0,
    Math.min(1, Number(params.runtimeRenderUncertaintyFallback ?? 0) || 0),
  )
  const runtimeRenderUncertaintyTopologyVolatility = Math.max(
    0,
    Math.min(1, Number(params.runtimeRenderUncertaintyTopologyVolatility ?? 1) || 0),
  )
  const runtimeRenderSheetPanelCount = Math.max(0, Math.floor(Number(params.runtimeRenderSheetPanelCount ?? 0) || 0))
  const runtimeRenderSheetCoverage = Math.max(0, Math.min(1, Number(params.runtimeRenderSheetCoverage ?? 0) || 0))
  const runtimeRenderSheetReadiness = Math.max(
    0,
    Math.min(1, Number(params.runtimeRenderSheetReadiness ?? 0) || 0),
  )
  const runtimeRenderSheetQuadratureOrder = Math.max(
    1,
    Math.floor(Number(params.runtimeRenderSheetQuadratureOrder ?? 1) || 1),
  )
  const runtimeRenderSheetDesingularizationEpsilon = Math.max(
    0,
    Number(params.runtimeRenderSheetDesingularizationEpsilon ?? 0.01) || 0.01,
  )
  const runtimeRenderSheetProfileId = String(params.runtimeRenderSheetProfileId ?? 'sheet_profile_balanced')
  const runtimeRenderSheetQuadratureProfile = String(params.runtimeRenderSheetQuadratureProfile ?? 'gauss_legendre_1x2')
  const runtimeRenderSheetMeshSeed = Math.max(0, Math.floor(Number(params.runtimeRenderSheetMeshSeed ?? 0) || 0))
  const runtimeRenderSheetMeshTopology = String(params.runtimeRenderSheetMeshTopology ?? 'tri_fan')
  const runtimeRenderSheetMeshPatchCount = Math.max(
    1,
    Math.floor(Number(params.runtimeRenderSheetMeshPatchCount ?? 1) || 1),
  )
  const runtimeRenderSheetPanelAspectP95 = Math.max(1, Number(params.runtimeRenderSheetPanelAspectP95 ?? 1) || 1)
  const runtimeRenderSheetQualityGatePassCount = Math.max(
    0,
    Math.floor(Number(params.runtimeRenderSheetQualityGatePassCount ?? 0) || 0),
  )
  const runtimeRenderSheetQualityGateTotal = Math.max(
    1,
    Math.floor(Number(params.runtimeRenderSheetQualityGateTotal ?? 4) || 4),
  )
  const runtimeRenderSheetQualityPenalty = Math.max(
    0,
    Math.min(1, Number(params.runtimeRenderSheetQualityPenalty ?? 0.5) || 0),
  )
  const runtimeRenderSheetMeshDeterministic = params.runtimeRenderSheetMeshDeterministic !== false
  const runtimeRenderSheetMeshLayoutDigest = Math.max(
    0,
    Math.floor(Number(params.runtimeRenderSheetMeshLayoutDigest ?? 0) || 0),
  )
  const runtimeRenderSheetMeshPatchMinPanels = Math.max(
    0,
    Math.floor(Number(params.runtimeRenderSheetMeshPatchMinPanels ?? 0) || 0),
  )
  const runtimeRenderSheetMeshPatchMaxPanels = Math.max(
    0,
    Math.floor(Number(params.runtimeRenderSheetMeshPatchMaxPanels ?? 0) || 0),
  )
  const runtimeRenderSheetMeshPatchImbalance = Math.max(
    0,
    Number(params.runtimeRenderSheetMeshPatchImbalance ?? 0) || 0,
  )
  const runtimeRenderSheetMeshContractVersion = String(
    params.runtimeRenderSheetMeshContractVersion ?? 'tt021b.panel_mesh.v1',
  )
  const runtimeRenderSheetMeshContractValid = params.runtimeRenderSheetMeshContractValid !== false
  const runtimeRenderSheetMeshContractIssueCount = Math.max(
    0,
    Math.floor(Number(params.runtimeRenderSheetMeshContractIssueCount ?? 0) || 0),
  )
  const runtimeRenderSheetMeshContractGatePassCount = Math.max(
    0,
    Math.floor(Number(params.runtimeRenderSheetMeshContractGatePassCount ?? 4) || 4),
  )
  const runtimeRenderSheetMeshContractGateTotal = Math.max(
    1,
    Math.floor(Number(params.runtimeRenderSheetMeshContractGateTotal ?? 4) || 4),
  )
  const runtimeRenderSheetMeshContractVerdict = String(params.runtimeRenderSheetMeshContractVerdict ?? 'pass')
  const runtimeRenderSheetMeshContractVerdictLabel =
    runtimeRenderSheetMeshContractVerdict === 'fail'
      ? t('render_sheet_quality_verdict_fail')
      : runtimeRenderSheetMeshContractVerdict === 'warn'
        ? t('render_sheet_quality_verdict_warn')
        : t('render_sheet_quality_verdict_pass')
  const runtimeRenderSheetMeshContractPenalty = Math.max(
    0,
    Math.min(1, Number(params.runtimeRenderSheetMeshContractPenalty ?? 0) || 0),
  )
  const runtimeRenderSheetMeshPatchAreaMean = Math.max(
    0,
    Number(params.runtimeRenderSheetMeshPatchAreaMean ?? 0.01) || 0.01,
  )
  const runtimeRenderSheetMeshPatchAreaCv = Math.max(
    0,
    Number(params.runtimeRenderSheetMeshPatchAreaCv ?? 0) || 0,
  )
  const runtimeRenderSheetMeshEdgeLengthRatioP95 = Math.max(
    1,
    Number(params.runtimeRenderSheetMeshEdgeLengthRatioP95 ?? 1) || 1,
  )
  const runtimeRenderSheetMeshCurvatureProxyP95 = Math.max(
    1,
    Number(params.runtimeRenderSheetMeshCurvatureProxyP95 ?? 1) || 1,
  )
  const runtimeRenderSheetCouplingVersion = String(params.runtimeRenderSheetCouplingVersion ?? 'tt021c.sheet_coupling.v1')
  const runtimeRenderSheetCouplingValid = params.runtimeRenderSheetCouplingValid !== false
  const runtimeRenderSheetCouplingVerdict = String(params.runtimeRenderSheetCouplingVerdict ?? 'pass')
  const runtimeRenderSheetCouplingVerdictLabel =
    runtimeRenderSheetCouplingVerdict === 'fail'
      ? t('render_sheet_quality_verdict_fail')
      : runtimeRenderSheetCouplingVerdict === 'warn'
        ? t('render_sheet_quality_verdict_warn')
        : t('render_sheet_quality_verdict_pass')
  const runtimeRenderSheetCouplingPenalty = Math.max(
    0,
    Math.min(1, Number(params.runtimeRenderSheetCouplingPenalty ?? 0) || 0),
  )
  const runtimeRenderSheetCouplingAmerState = String(params.runtimeRenderSheetCouplingAmerState ?? 'pass')
  const runtimeRenderSheetCouplingAmerStateLabel =
    runtimeRenderSheetCouplingAmerState === 'fail'
      ? t('render_sheet_quality_verdict_fail')
      : runtimeRenderSheetCouplingAmerState === 'warn'
        ? t('render_sheet_quality_verdict_warn')
        : t('render_sheet_quality_verdict_pass')
  const runtimeRenderSheetCouplingAmerTransferBudget = Math.max(
    0,
    Math.min(1, Number(params.runtimeRenderSheetCouplingAmerTransferBudget ?? 0.5) || 0),
  )
  const runtimeRenderSheetCouplingAmerInvariantDriftCapPct = Math.max(
    0,
    Number(params.runtimeRenderSheetCouplingAmerInvariantDriftCapPct ?? 4) || 4,
  )
  const runtimeRenderSheetCouplingFilamentState = String(params.runtimeRenderSheetCouplingFilamentState ?? 'pass')
  const runtimeRenderSheetCouplingFilamentStateLabel =
    runtimeRenderSheetCouplingFilamentState === 'fail'
      ? t('render_sheet_quality_verdict_fail')
      : runtimeRenderSheetCouplingFilamentState === 'warn'
        ? t('render_sheet_quality_verdict_warn')
        : t('render_sheet_quality_verdict_pass')
  const runtimeRenderSheetCouplingFilamentNodeTransferCap = Math.max(
    0,
    Math.floor(Number(params.runtimeRenderSheetCouplingFilamentNodeTransferCap ?? 64) || 0),
  )
  const runtimeRenderSheetCouplingFilamentLoad = Math.max(
    0,
    Number(params.runtimeRenderSheetCouplingFilamentLoad ?? 0) || 0,
  )
  const runtimeRenderSheetRollupStabilityGuard = String(params.runtimeRenderSheetRollupStabilityGuard ?? 'clear')
  const runtimeRenderSheetRollupStabilityGuardLabel =
    runtimeRenderSheetRollupStabilityGuard === 'engaged'
      ? t('runtime_stability_pressure_high')
      : t('runtime_stability_pressure_healthy')
  const runtimeRenderSheetQualityVerdict = String(params.runtimeRenderSheetQualityVerdict ?? 'warn')
  const runtimeRenderSheetQualityVerdictLabel =
    runtimeRenderSheetQualityVerdict === 'pass'
      ? t('render_sheet_quality_verdict_pass')
      : runtimeRenderSheetQualityVerdict === 'fail'
        ? t('render_sheet_quality_verdict_fail')
        : t('render_sheet_quality_verdict_warn')
  const runtimeRenderSheetPlaceholder = params.runtimeRenderSheetPlaceholder !== false
  const runtimeOverlayConfidenceComposite = Math.max(
    0,
    Math.min(1, Number(params.runtimeOverlayConfidenceComposite ?? 0) || 0),
  )
  const runtimeOverlayUncertaintyComposite = Math.max(
    0,
    Math.min(1, Number(params.runtimeOverlayUncertaintyComposite ?? 1) || 0),
  )
  const runtimeOverlayUncertaintyDetector = Math.max(
    0,
    Math.min(1, Number(params.runtimeOverlayUncertaintyDetector ?? 1) || 0),
  )
  const runtimeOverlayUncertaintyTopology = Math.max(
    0,
    Math.min(1, Number(params.runtimeOverlayUncertaintyTopology ?? 1) || 0),
  )
  const runtimeOverlayUncertaintyRender = Math.max(
    0,
    Math.min(1, Number(params.runtimeOverlayUncertaintyRender ?? 1) || 0),
  )
  const runtimeGpuSyncPolicyLabel =
    params.runtimeGpuSyncPolicy === 'strict'
      ? t('gpu_sync_policy_strict')
      : params.runtimeGpuSyncPolicy === 'forced'
        ? t('gpu_sync_policy_forced')
        : params.runtimeGpuSyncPolicy === 'relaxed'
          ? t('gpu_sync_policy_relaxed')
          : t('gpu_sync_policy_unavailable')
  const runtimeGpuSyncReasonLabel =
    params.runtimeGpuSyncReason === 'hybrid_representation'
      ? t('gpu_sync_reason_hybrid_representation')
      : params.runtimeGpuSyncReason === 'guided_physics'
        ? t('gpu_sync_reason_guided_physics')
        : params.runtimeGpuSyncReason === 'hybrid_plus_assist'
          ? t('gpu_sync_reason_hybrid_plus_assist')
          : params.runtimeGpuSyncReason === 'particle_gpu_primary'
            ? t('gpu_sync_reason_particle_gpu_primary')
            : params.runtimeGpuSyncReason === 'pulse_sync_requested'
              ? t('gpu_sync_reason_pulse_sync_requested')
              : t('gpu_sync_reason_manager_unavailable')
  const runtimeGpuSyncViolationCount = Math.max(0, Math.floor(params.runtimeGpuSyncViolationCount ?? 0))
  const runtimeGpuSyncLastReadbackReasonLabel =
    params.runtimeGpuSyncLastReadbackReason === 'bootstrap'
      ? t('gpu_sync_readback_reason_bootstrap')
      : params.runtimeGpuSyncLastReadbackReason === 'interval_tick'
        ? t('gpu_sync_readback_reason_interval_tick')
        : params.runtimeGpuSyncLastReadbackReason === 'manual_force'
          ? t('gpu_sync_readback_reason_manual_force')
          : t('gpu_sync_readback_reason_none')

  const particlesBackendLabel = params.executionMode === 'cpu' ? 'CPU' : 'GPU'
  const filamentsBackendLabel = params.vortexRepresentation === 'particles' ? t('off') : 'CPU'

  const activePipelineLabel =
    particlesBackendLabel === 'GPU' && filamentsBackendLabel === 'CPU'
      ? t('gpu_plus_cpu')
      : particlesBackendLabel === 'GPU'
        ? t('gpu_only')
        : t('cpu_only')

  const currentDynamicsModeLabel =
    params.dynamicsMode === 'scripted'
      ? t('scripted_motion_alt')
      : params.dynamicsMode === 'fullPhysics'
        ? t('classic_physics')
        : t('natural')

  const currentExecutionModeLabel =
    params.executionMode === 'hybrid' ? t('hybrid_gpu_plus_cpu') : params.executionMode.toUpperCase()

  const currentRepresentationLabel =
    params.vortexRepresentation === 'hybrid'
      ? t('hybrid')
      : params.vortexRepresentation === 'tubes'
        ? t('tubes')
      : params.vortexRepresentation === 'filaments'
        ? t('filaments')
        : t('particles')

  const runtimeGpuFullReadbackCount = Math.max(0, Math.floor(params.runtimeGpuFullReadbackCount ?? 0))
  const runtimeGpuSkippedReadbackCount = Math.max(
    0,
    Math.floor(params.runtimeGpuSkippedReadbackCount ?? 0),
  )
  const runtimeGpuReadbackTotal = runtimeGpuFullReadbackCount + runtimeGpuSkippedReadbackCount
  const runtimeGpuReadbackFullRatioPercent =
    runtimeGpuReadbackTotal > 0
      ? (runtimeGpuFullReadbackCount / runtimeGpuReadbackTotal) * 100
      : 0
  const runtimeGpuReadbackRatioTone =
    runtimeGpuReadbackFullRatioPercent > 70
      ? 'text-rose-300'
      : runtimeGpuReadbackFullRatioPercent >= 30
        ? 'text-amber-300'
        : 'text-blue-300'
  const runtimeGpuReadbackStatus =
    runtimeGpuReadbackFullRatioPercent > 70
      ? t('gpu_readback_status_heavy_sync')
      : runtimeGpuReadbackFullRatioPercent >= 30
        ? t('gpu_readback_status_moderate')
        : t('gpu_readback_status_healthy')

  const runtimeGpuOverflowCount = Math.max(0, Math.floor(params.runtimeGpuDiagOverflowCount ?? 0))
  const runtimeGpuCollisionCount = Math.max(0, Math.floor(params.runtimeGpuDiagCollisionCount ?? 0))
  const runtimeGpuCollisionRatioPercent = Math.max(
    0,
    (Number(params.runtimeGpuDiagCollisionRatio ?? 0) || 0) * 100,
  )
  const runtimeGpuHashLoadFactorPercent = Math.max(
    0,
    (Number(params.runtimeGpuDiagHashLoadFactor ?? 0) || 0) * 100,
  )
  const runtimeGpuDispatchCount = Math.max(0, Math.floor(params.runtimeGpuDiagDispatchCount ?? 0))
  const runtimeGpuGridBuildCount = Math.max(0, Math.floor(params.runtimeGpuDiagGridBuildCount ?? 0))
  const runtimeGpuOccupiedBucketCount = Math.max(
    0,
    Math.floor(params.runtimeGpuDiagOccupiedBucketCount ?? 0),
  )
  const runtimeGpuHashTableSize = Math.max(0, Math.floor(params.runtimeGpuDiagHashTableSize ?? 0))
  const runtimeGpuAdaptiveHashTableSize = Math.max(
    0,
    Math.floor(params.runtimeGpuDiagAdaptiveHashTableSize ?? 0),
  )
  const runtimeGpuBucketCapacity = Math.max(0, Math.floor(params.runtimeGpuDiagBucketCapacity ?? 0))
  const runtimeGpuAdaptiveBucketCapacity = Math.max(
    0,
    Math.floor(params.runtimeGpuDiagAdaptiveBucketCapacity ?? 0),
  )
  const runtimeGpuOverflowCooldown = Math.max(
    0,
    Math.floor(params.runtimeGpuDiagOverflowCooldown ?? 0),
  )
  const runtimeGpuLowPressureStreak = Math.max(
    0,
    Math.floor(params.runtimeGpuDiagLowPressureStreak ?? 0),
  )
  const runtimeGpuAdaptiveEventType = String(params.runtimeGpuDiagAdaptiveEventType ?? 'none')
  const runtimeGpuAdaptiveEventReason = String(params.runtimeGpuDiagAdaptiveEventReason ?? 'none')
  const runtimeGpuAdaptiveEventDispatchSerial = Math.floor(
    params.runtimeGpuDiagAdaptiveEventDispatchSerial ?? -1,
  )
  const runtimeGpuOverflowCriticalStreak = Math.max(
    0,
    Math.floor(params.runtimeGpuOverflowCriticalStreak ?? 0),
  )
  const runtimeGpuOverflowProtectionActive = params.runtimeGpuOverflowCriticalActive === true
  const runtimeGpuOverflowProtectionCooldown = Math.max(
    0,
    Math.floor(params.runtimeGpuOverflowProtectionCooldown ?? 0),
  )
  const runtimeGpuOverflowProtectionLastAction = String(
    params.runtimeGpuOverflowProtectionLastAction ?? 'none',
  )
  const runtimeGpuOverflowProtectionLastActionLabel =
    runtimeGpuOverflowProtectionLastAction === 'reduce_spawn_rate'
      ? t('gpu_overflow_action_reduce_spawn_rate')
      : t('gpu_overflow_action_none')
  const runtimeGpuQualityGuardActive = params.runtimeGpuQualityGuardActive === true
  const runtimeGpuQualityGuardApplyActive = params.runtimeGpuQualityGuardApplyActive === true
  const runtimeGpuQualityGuardLevelLabel =
    params.runtimeGpuQualityGuardLevel === 'minimal'
      ? t('gpu_quality_guard_mode_minimal')
      : params.runtimeGpuQualityGuardLevel === 'moderate'
        ? t('gpu_quality_guard_mode_moderate')
        : params.runtimeGpuQualityGuardLevel === 'ui_only'
          ? t('gpu_quality_guard_mode_ui_only')
        : t('off')
  const runtimeGpuQualityGuardCompatibilityLabel =
    params.runtimeGpuQualityGuardCompatibility === 'apply_allowed'
      ? t('gpu_quality_guard_compatibility_apply_allowed')
      : params.runtimeGpuQualityGuardCompatibility === 'monitor_only_forced_natural'
        ? t('gpu_quality_guard_compatibility_monitor_only_natural')
        : params.runtimeGpuQualityGuardCompatibility === 'monitor_only_forced_hybrid_plus'
          ? t('gpu_quality_guard_compatibility_monitor_only_hybrid_plus')
          : params.runtimeGpuQualityGuardCompatibility === 'disabled_backend_not_gpu'
            ? t('gpu_quality_guard_compatibility_disabled_backend_not_gpu')
            : t('gpu_quality_guard_compatibility_disabled_user_off')
  const runtimeGpuQualityGuardGuidedScale = Number(params.runtimeGpuQualityGuardGuidedScale ?? 1)
  const runtimeGpuQualityGuardStretchingScale = Number(
    params.runtimeGpuQualityGuardStretchingScale ?? 1,
  )
  const runtimeGpuQualityGuardHighStepStreak = Math.max(
    0,
    Math.floor(params.runtimeGpuQualityGuardHighStepStreak ?? 0),
  )
  const runtimeGpuQualityGuardLowStepStreak = Math.max(
    0,
    Math.floor(params.runtimeGpuQualityGuardLowStepStreak ?? 0),
  )
  const runtimeGpuQualityGuardLastAction = String(params.runtimeGpuQualityGuardLastAction ?? 'none')
  const runtimeGpuQualityGuardLastActionLabel =
    runtimeGpuQualityGuardLastAction === 'activate'
      ? t('gpu_quality_guard_action_activate')
      : runtimeGpuQualityGuardLastAction === 'recover'
        ? t('gpu_quality_guard_action_recover')
        : runtimeGpuQualityGuardLastAction === 'activate_ui_only'
          ? t('gpu_quality_guard_action_activate_ui_only')
          : runtimeGpuQualityGuardLastAction === 'recover_ui_only'
            ? t('gpu_quality_guard_action_recover_ui_only')
        : t('gpu_overflow_action_none')
  const runtimeGpuAdaptiveEventTypeLabel =
    runtimeGpuAdaptiveEventType === 'grow_bucket'
      ? t('gpu_hash_adapt_event_grow_bucket')
      : runtimeGpuAdaptiveEventType === 'grow_hash'
        ? t('gpu_hash_adapt_event_grow_hash')
        : runtimeGpuAdaptiveEventType === 'shrink_bucket'
          ? t('gpu_hash_adapt_event_shrink_bucket')
          : runtimeGpuAdaptiveEventType === 'shrink_hash'
            ? t('gpu_hash_adapt_event_shrink_hash')
            : t('gpu_hash_adapt_event_none')
  const runtimeGpuAdaptiveEventReasonLabel =
    runtimeGpuAdaptiveEventReason === 'overflow'
      ? t('gpu_hash_adapt_reason_overflow')
      : runtimeGpuAdaptiveEventReason === 'collisions'
        ? t('gpu_hash_adapt_reason_collisions')
        : runtimeGpuAdaptiveEventReason === 'low_pressure'
          ? t('gpu_hash_adapt_reason_low_pressure')
          : t('gpu_hash_adapt_reason_none')
  const runtimeGpuOverflowTone =
    runtimeGpuOverflowCount > 0
      ? 'text-rose-300'
      : runtimeGpuOverflowCooldown > 0
        ? 'text-amber-300'
        : 'text-blue-300'
  const runtimeCpuSteps = Math.max(0, Math.floor(Number(params.runtimeCpuSteps ?? 0) || 0))
  const runtimeGpuSteps = Math.max(0, Math.floor(Number(params.runtimeGpuSteps ?? 0) || 0))
  const runtimeTotalSteps = runtimeCpuSteps + runtimeGpuSteps
  const runtimeStabilityAutoCorrectionTotalCount = Math.max(
    0,
    Math.floor(Number(params.runtimeStabilityAutoCorrectionTotalCount ?? 0) || 0),
  )
  const runtimeStabilityAutoCorrectionPer1kSteps =
    runtimeTotalSteps > 0 ? (runtimeStabilityAutoCorrectionTotalCount / runtimeTotalSteps) * 1000 : 0
  const runtimeStabilityAutoCorrectionPressureTone =
    runtimeStabilityAutoCorrectionPer1kSteps > 25
      ? 'text-rose-300'
      : runtimeStabilityAutoCorrectionPer1kSteps >= 8
        ? 'text-amber-300'
        : 'text-blue-300'
  const runtimeStabilityAutoCorrectionPressureLabel =
    runtimeStabilityAutoCorrectionPer1kSteps > 25
      ? t('runtime_stability_pressure_high')
      : runtimeStabilityAutoCorrectionPer1kSteps >= 8
        ? t('runtime_stability_pressure_moderate')
        : t('runtime_stability_pressure_healthy')

  return {
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
    runtimeGpuReadbackTotal,
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
    runtimeStabilityAutoCorrectionTotalCount,
    runtimeStabilityAutoCorrectionPer1kSteps,
    runtimeStabilityAutoCorrectionPressureTone,
    runtimeStabilityAutoCorrectionPressureLabel,
  }
}
