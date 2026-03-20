export const SCIENTIFIC_SNAPSHOT_SCHEMA_VERSION = 2
export const SCIENTIFIC_SNAPSHOT_SCHEMA_ID = 'torus.viz.snapshot.bundle.v2'

function toFinite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toInt(value, fallback = 0) {
  return Math.max(0, Math.floor(toFinite(value, fallback)))
}

function sanitizeString(value, fallback = '') {
  const text = String(value ?? fallback).trim()
  return text.length > 0 ? text : fallback
}

function buildOverlayEvents(params = {}) {
  const events = []
  const transitions = toInt(params.runtimeNewtoniumTransitions, 0)
  if (transitions > 0) {
    events.push({
      type: 'topology_transitions',
      value: transitions,
      confidence: toFinite(params.runtimeNewtoniumConfidence, 0),
      source: 'runtimeNewtoniumTransitions',
    })
  }
  const detected = {
    filaments: toInt(params.runtimeDetectedFilamentCount, 0),
    rings: toInt(params.runtimeDetectedRingCount, 0),
    tubes: toInt(params.runtimeDetectedTubeCount, 0),
    sheets: toInt(params.runtimeDetectedSheetCount, 0),
    clusters: toInt(params.runtimeDetectedClusterCount, 0),
  }
  if (detected.filaments + detected.rings + detected.tubes + detected.sheets + detected.clusters > 0) {
    events.push({
      type: 'detector_counts',
      ...detected,
      confidence: toFinite(params.runtimeDetectionConfidence, 0),
      source: 'runtimeDetection',
    })
  }
  events.push({
    type: 'overlay_uncertainty',
    confidenceComposite: toFinite(params.runtimeOverlayConfidenceComposite, 0),
    uncertaintyComposite: toFinite(params.runtimeOverlayUncertaintyComposite, 1),
    detector: toFinite(params.runtimeOverlayUncertaintyDetector, 1),
    topology: toFinite(params.runtimeOverlayUncertaintyTopology, 1),
    render: toFinite(params.runtimeOverlayUncertaintyRender, 1),
    source: 'runtimeOverlayDiagnostics',
  })
  return events
}

function normalizeTimeline(events = []) {
  return (Array.isArray(events) ? events : [])
    .map((item) => ({
      tSec: toFinite(item?.tSec, 0),
      detectorConfidence: toFinite(item?.detectorConfidence, 0),
      newtoniumConfidence: toFinite(item?.newtoniumConfidence, 0),
      newtoniumTransitions: toInt(item?.newtoniumTransitions, 0),
      renderConfidence: toFinite(item?.renderConfidence, 0),
      renderUncertainty: toFinite(item?.renderUncertainty, 1),
      uncertaintyDetectorGap: toFinite(item?.uncertaintyDetectorGap, 1),
      uncertaintyRenderFallback: toFinite(item?.uncertaintyRenderFallback, 0),
      uncertaintyTopologyVolatility: toFinite(item?.uncertaintyTopologyVolatility, 1),
      overlayConfidence: toFinite(item?.overlayConfidence, 0),
      overlayUncertainty: toFinite(item?.overlayUncertainty, 1),
      overlayUncertaintyDetector: toFinite(item?.overlayUncertaintyDetector, 1),
      overlayUncertaintyTopology: toFinite(item?.overlayUncertaintyTopology, 1),
      overlayUncertaintyRender: toFinite(item?.overlayUncertaintyRender, 1),
      energyProxy: toFinite(item?.energyProxy, 0),
      enstrophyProxy: toFinite(item?.enstrophyProxy, 0),
      detectedFilaments: toInt(item?.detectedFilaments, 0),
      detectedRings: toInt(item?.detectedRings, 0),
      detectedTubes: toInt(item?.detectedTubes, 0),
      detectedClusters: toInt(item?.detectedClusters, 0),
    }))
    .slice(-240)
}

function buildTimelineDerivedEvents(timeline = []) {
  const derived = []
  for (let i = 1; i < timeline.length; i += 1) {
    const prev = timeline[i - 1]
    const current = timeline[i]
    const dt = Math.max(1e-9, current.tSec - prev.tSec)
    const detectorDelta = current.detectorConfidence - prev.detectorConfidence
    const topologyDelta = current.newtoniumTransitions - prev.newtoniumTransitions
    const energyDeltaRate = Math.abs(current.energyProxy - prev.energyProxy) / dt
    const enstrophyDeltaRate = Math.abs(current.enstrophyProxy - prev.enstrophyProxy) / dt
    const renderUncertaintyDelta = current.renderUncertainty - prev.renderUncertainty
    const overlayUncertaintyDelta = current.overlayUncertainty - prev.overlayUncertainty

    if (detectorDelta >= 0.15) {
      derived.push({
        type: 'detector_confidence_rise',
        tSec: current.tSec,
        value: detectorDelta,
      })
    }
    if (topologyDelta > 0) {
      derived.push({
        type: 'topology_transition_increment',
        tSec: current.tSec,
        value: topologyDelta,
      })
    }
    if (energyDeltaRate >= 0.12) {
      derived.push({
        type: 'energy_proxy_jump_rate',
        tSec: current.tSec,
        value: energyDeltaRate,
      })
    }
    if (enstrophyDeltaRate >= 0.18) {
      derived.push({
        type: 'enstrophy_proxy_jump_rate',
        tSec: current.tSec,
        value: enstrophyDeltaRate,
      })
    }
    if (renderUncertaintyDelta >= 0.14) {
      derived.push({
        type: 'render_uncertainty_rise',
        tSec: current.tSec,
        value: renderUncertaintyDelta,
      })
    }
    if (overlayUncertaintyDelta >= 0.12) {
      derived.push({
        type: 'overlay_uncertainty_rise',
        tSec: current.tSec,
        value: overlayUncertaintyDelta,
      })
    }
  }
  return derived.slice(-240)
}

function normalizeOverlayStructures(features = []) {
  return (Array.isArray(features) ? features : []).slice(0, 24).map((item) => ({
    class: sanitizeString(item?.class, 'cluster'),
    confidence: toFinite(item?.confidence, 0),
    center: {
      x: toFinite(item?.center?.x, 0),
      y: toFinite(item?.center?.y, 0),
      z: toFinite(item?.center?.z, 0),
    },
    radius: Math.max(1e-4, toFinite(item?.radius, 0.1)),
    count: toInt(item?.count, 0),
    elongation: toFinite(item?.elongation, 0),
    planarity: toFinite(item?.planarity, 0),
  }))
}

export function buildScientificSnapshotBundle({
  timestamp = new Date(),
  camera = {},
  params = {},
  stabilityStats = {},
  filamentStats = {},
  expectedImageFileName = '',
  timeline = [],
} = {}) {
  const now = timestamp instanceof Date ? timestamp : new Date(timestamp)
  const isoTs = now.toISOString()
  const normalizedTimeline = normalizeTimeline(timeline)
  return {
    schemaVersion: SCIENTIFIC_SNAPSHOT_SCHEMA_VERSION,
    schemaId: SCIENTIFIC_SNAPSHOT_SCHEMA_ID,
    type: 'torus-vortex-scientific-snapshot',
    generatedAt: isoTs,
    image: {
      fileName: sanitizeString(expectedImageFileName, 'torus-scientific-snapshot.png'),
      mimeType: 'image/png',
    },
    camera: {
      px: toFinite(camera?.px, 0),
      py: toFinite(camera?.py, 0),
      pz: toFinite(camera?.pz, 7),
      tx: toFinite(camera?.tx, 0),
      ty: toFinite(camera?.ty, 0),
      tz: toFinite(camera?.tz, 0),
    },
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
      exportScale: toFinite(params.vizExportScale, 1),
      overlayMinConfidence: toFinite(params.vizOverlayMinConfidence, 0.25),
      overlayLabelPolicy: {
        enabled: params.vizOverlayShowLabels === true,
        maxCount: toInt(params.vizOverlayLabelMaxCount, 8),
        maxDistance: toFinite(params.vizOverlayLabelMaxDistance, 12),
      },
    },
    runtime: {
      backend: sanitizeString(params.runtimeBackend, 'unknown'),
      simulationTimeSec: toFinite(params.runtimeSimulationTime, 0),
      hybridPlus: {
        active: params.runtimeHybridPlusActive === true,
        reason: sanitizeString(params.runtimeHybridPlusReason, 'disabled'),
        baseBackend: sanitizeString(params.runtimeHybridPlusBaseBackend, 'cpu'),
        assistBackend: sanitizeString(params.runtimeHybridPlusAssistBackend, 'gpu'),
        syncMode: sanitizeString(params.runtimeHybridPlusSyncMode, 'none'),
        operatorCount: toInt(params.runtimeHybridPlusOperatorCount, 0),
        costMs: {
          total: toFinite(params.runtimeHybridPlusAssistCostMs, 0),
          topology: toFinite(params.runtimeHybridPlusTopologyCostMs, 0),
          barnesHut: toFinite(params.runtimeHybridPlusBarnesHutCostMs, 0),
          apply: toFinite(params.runtimeHybridPlusApplyCostMs, 0),
        },
        deltas: {
          produced: toInt(params.runtimeHybridPlusProducedDeltaCount, 0),
          applied: toInt(params.runtimeHybridPlusAppliedDeltaCount, 0),
          rejected: toInt(params.runtimeHybridPlusRejectedDeltaCount, 0),
          topology: toInt(params.runtimeHybridPlusTopologyProducedCount, 0),
          barnesHut: toInt(params.runtimeHybridPlusBarnesHutProducedCount, 0),
        },
        scheduler: {
          cadenceBaseSteps: toInt(params.runtimeHybridPlusAssistCadenceBaseSteps, 1),
          cadenceRuntimeSteps: toInt(params.runtimeHybridPlusAssistCadenceRuntimeSteps, 1),
          cadenceAdaptive: params.runtimeHybridPlusAssistCadenceAdaptive !== false,
          overBudgetStreak: toInt(params.runtimeHybridPlusAssistOverBudgetStreak, 0),
          idleStreak: toInt(params.runtimeHybridPlusAssistIdleStreak, 0),
          budgetPressure: toFinite(params.runtimeHybridPlusAssistBudgetPressure, 0),
          runCount: toInt(params.runtimeHybridPlusAssistRunCount, 0),
          skipCadenceCount: toInt(params.runtimeHybridPlusAssistSkipCadenceCount, 0),
          skipBudgetCount: toInt(params.runtimeHybridPlusAssistSkipBudgetCount, 0),
        },
      },
      detector: {
        filamentCount: toInt(params.runtimeDetectedFilamentCount, 0),
        ringCount: toInt(params.runtimeDetectedRingCount, 0),
        tubeCount: toInt(params.runtimeDetectedTubeCount, 0),
        sheetCount: toInt(params.runtimeDetectedSheetCount, 0),
        clusterCount: toInt(params.runtimeDetectedClusterCount, 0),
        confidence: toFinite(params.runtimeDetectionConfidence, 0),
        classConfidences: {
          filament: toFinite(params.runtimeDetectionClassConfidenceFilament, 0),
          ring: toFinite(params.runtimeDetectionClassConfidenceRing, 0),
          tube: toFinite(params.runtimeDetectionClassConfidenceTube, 0),
          sheet: toFinite(params.runtimeDetectionClassConfidenceSheet, 0),
        },
        sheetFeatures: {
          surfaceCoherence: toFinite(params.runtimeDetectionSheetSurfaceCoherence, 0),
          curvatureAnisotropy: toFinite(params.runtimeDetectionSheetCurvatureAnisotropy, 0),
        },
      },
      topology: {
        type: sanitizeString(params.runtimeNewtoniumType, 'none'),
        confidence: toFinite(params.runtimeNewtoniumConfidence, 0),
        transitions: toInt(params.runtimeNewtoniumTransitions, 0),
        transitionContract: {
          state: sanitizeString(params.runtimeTransitionState, 'idle'),
          candidateType: sanitizeString(params.runtimeTransitionCandidateType, 'none'),
          pendingFrames: toInt(params.runtimeTransitionPendingFrames, 0),
          counters: {
            candidates: toInt(params.runtimeTransitionCandidates, 0),
            committed: toInt(params.runtimeTransitionCommitted, 0),
            rejected: toInt(params.runtimeTransitionRejected, 0),
          },
          driftPct: {
            gamma: toFinite(params.runtimeTransitionGammaDriftPct, 0),
            impulse: toFinite(params.runtimeTransitionImpulseDriftPct, 0),
            energy: toFinite(params.runtimeTransitionEnergyDriftPct, 0),
          },
          gates: {
            confidenceOk: params.runtimeTransitionGateConfidenceOk === true,
            invariantOk: params.runtimeTransitionGateInvariantOk === true,
            hysteresisOk: params.runtimeTransitionGateHysteresisOk === true,
            reason: sanitizeString(params.runtimeTransitionGateReason, 'none'),
            enterFrames: toInt(params.runtimeTransitionEnterFrames, 3),
            confidenceEnterMin: toFinite(params.runtimeTransitionConfidenceEnterMin, 0.56),
            confidenceExitMin: toFinite(params.runtimeTransitionConfidenceExitMin, 0.44),
          },
        },
        ringValidation: {
          version: sanitizeString(params.runtimeRingValidationVersion, 'tt023b.ring_validation.v1'),
          valid: params.runtimeRingValidationValid !== false,
          verdict: sanitizeString(params.runtimeRingValidationVerdict, 'pass'),
          acceptanceScore: toFinite(params.runtimeRingValidationAcceptanceScore, 0),
          gatePassCount: toInt(params.runtimeRingValidationGatePassCount, 0),
          gateTotal: toInt(params.runtimeRingValidationGateTotal, 4),
          transitionCommitRatio: toFinite(params.runtimeRingValidationTransitionCommitRatio, 0),
          profile: sanitizeString(params.runtimeRingValidationProfile, 'classic'),
          modifierStrength: toFinite(params.runtimeRingValidationModifierStrength, 0),
          externalValidationEligible: params.runtimeRingExternalValidationEligible !== false,
          externalValidationEligibilityReason: sanitizeString(
            params.runtimeRingExternalValidationEligibilityReason,
            'eligible',
          ),
        },
        jetRegime: {
          version: sanitizeString(params.runtimeJetRegimeVersion, 'tt024b.jet_regime.v1'),
          valid: params.runtimeJetRegimeValid !== false,
          verdict: sanitizeString(params.runtimeJetRegimeVerdict, 'pass'),
          regime: sanitizeString(params.runtimeJetRegimeType, 'ring_train'),
          acceptanceScore: toFinite(params.runtimeJetRegimeAcceptanceScore, 0),
          gatePassCount: toInt(params.runtimeJetRegimeGatePassCount, 0),
          gateTotal: toInt(params.runtimeJetRegimeGateTotal, 4),
          profile: sanitizeString(params.runtimeJetRegimeProfile, 'classic'),
          modifierStrength: toFinite(params.runtimeJetRegimeModifierStrength, 0),
          externalValidationEligible: params.runtimeJetExternalValidationEligible !== false,
          externalValidationEligibilityReason: sanitizeString(
            params.runtimeJetExternalValidationEligibilityReason,
            'eligible',
          ),
          proxies: {
            re: toFinite(params.runtimeJetRegimeReProxy, 0),
            st: toFinite(params.runtimeJetRegimeStProxy, 0),
            ld: toFinite(params.runtimeJetRegimeLdProxy, 0),
            ringDominance: toFinite(params.runtimeJetRegimeRingDominance, 0),
            wakeIndex: toFinite(params.runtimeJetRegimeWakeIndex, 0),
          },
        },
        detectorFusion: {
          version: sanitizeString(params.runtimeDetectorFusionVersion, 'tt025b.detector_fusion.v1'),
          valid: params.runtimeDetectorFusionValid !== false,
          verdict: sanitizeString(params.runtimeDetectorFusionVerdict, 'pass'),
          profile: sanitizeString(params.runtimeDetectorFusionProfile, 'classic'),
          modifierStrength: toFinite(params.runtimeDetectorFusionModifierStrength, 0),
          externalValidationEligible: params.runtimeDetectorExternalValidationEligible !== false,
          externalValidationEligibilityReason: sanitizeString(
            params.runtimeDetectorExternalValidationEligibilityReason,
            'eligible',
          ),
          acceptanceScore: toFinite(params.runtimeDetectorFusionAcceptanceScore, 0),
          gatePassCount: toInt(params.runtimeDetectorFusionGatePassCount, 0),
          gateTotal: toInt(params.runtimeDetectorFusionGateTotal, 5),
          weightedScore: toFinite(params.runtimeDetectorFusionWeightedScore, 0),
        },
        tracking: {
          version: sanitizeString(params.runtimeTopologyVersion, 'tt028b.topology_tracking.v1'),
          valid: params.runtimeTopologyValid !== false,
          profile: sanitizeString(params.runtimeTopologyProfile, 'classic'),
          modifierStrength: toFinite(params.runtimeTopologyModifierStrength, 0),
          externalValidationEligible: params.runtimeTopologyExternalValidationEligible !== false,
          externalValidationEligibilityReason: sanitizeString(
            params.runtimeTopologyExternalValidationEligibilityReason,
            'eligible',
          ),
          frameSerial: toInt(params.runtimeTopologyFrameSerial, 0),
          eventCount: toInt(params.runtimeTopologyEventCount, 0),
          nodeCount: toInt(params.runtimeTopologyNodeCount, 0),
          edgeCount: toInt(params.runtimeTopologyEdgeCount, 0),
          counters: {
            birth: toInt(params.runtimeTopologyBirthCount, 0),
            decay: toInt(params.runtimeTopologyDecayCount, 0),
            merge: toInt(params.runtimeTopologyMergeCount, 0),
            split: toInt(params.runtimeTopologySplitCount, 0),
            reconnection: toInt(params.runtimeTopologyReconnectionCount, 0),
          },
          latestEvent: {
            eventType: sanitizeString(params.runtimeTopologyLatestEventType, 'none'),
            confidence: toFinite(params.runtimeTopologyLatestEventConfidence, 0),
            frame: toInt(params.runtimeTopologyLatestEventFrame, 0),
          },
          eventLog: Array.isArray(params.runtimeTopologyEventLog) ? params.runtimeTopologyEventLog.slice(-240) : [],
          graph: {
            nodes: Array.isArray(params.runtimeTopologyGraphNodes) ? params.runtimeTopologyGraphNodes.slice(-128) : [],
            edges: Array.isArray(params.runtimeTopologyGraphEdges) ? params.runtimeTopologyGraphEdges.slice(-240) : [],
          },
        },
      },
      energy: {
        energyProxy: toFinite(params.runtimeEnergyProxy, 0),
        enstrophyProxy: toFinite(params.runtimeEnstrophyProxy, 0),
        sampleCount: toInt(params.runtimeEnergySampleCount, 0),
      },
      renderPolicy: {
        mode: sanitizeString(params.runtimeRenderPolicyMode, 'particles'),
        lodTier: sanitizeString(params.runtimeRenderLodTier, 'near'),
        layers: {
          particlesVisible: params.runtimeRenderParticleLayerVisible !== false,
          filamentsVisible: params.runtimeRenderFilamentLayerVisible !== false,
          sheetsVisible: params.runtimeRenderSheetLayerVisible === true,
        },
        diagnostics: {
          confidence: toFinite(params.runtimeRenderDiagnosticsConfidence, 0),
          uncertainty: toFinite(params.runtimeRenderDiagnosticsUncertainty, 1),
          uncertaintyComponents: {
            detectorGap: toFinite(params.runtimeRenderUncertaintyDetectorGap, 1),
            fallback: toFinite(params.runtimeRenderUncertaintyFallback, 0),
            topologyVolatility: toFinite(params.runtimeRenderUncertaintyTopologyVolatility, 1),
          },
          scores: {
            particles: toFinite(params.runtimeRenderScoreParticles, 0),
            filaments: toFinite(params.runtimeRenderScoreFilaments, 0),
            sheets: toFinite(params.runtimeRenderScoreSheets, 0),
            current: toFinite(params.runtimeRenderScoreCurrent, 0),
            margin: toFinite(params.runtimeRenderScoreMargin, 0),
            bestMode: sanitizeString(params.runtimeRenderScoreBestMode, 'particles'),
          },
          hysteresis: {
            holdSteps: toInt(params.runtimeRenderHysteresisHoldSteps, 0),
            remaining: toInt(params.runtimeRenderHysteresisRemaining, 0),
          },
          health: {
            fallbackRate: toFinite(params.runtimeRenderHealthFallbackRate, 0),
            timeoutRate: toFinite(params.runtimeRenderHealthTimeoutRate, 0),
            driftSeverity: toFinite(params.runtimeRenderHealthDriftSeverity, 0),
          },
          hardwareBudget: {
            sheetWorkloadBudget: toFinite(params.performanceSheetWorkloadBudget, 0.35),
            maxSheetPanels: toInt(params.performanceMaxSheetPanels, 900),
            representationSwitchCooldown: toInt(params.performanceRepresentationSwitchCooldown, 12),
          },
          sheetDiscretization: {
            panelCount: toInt(params.runtimeRenderSheetPanelCount, 0),
            coverage: toFinite(params.runtimeRenderSheetCoverage, 0),
            readiness: toFinite(params.runtimeRenderSheetReadiness, 0),
            profileId: sanitizeString(params.runtimeRenderSheetProfileId, 'sheet_profile_balanced'),
            quadratureOrder: toInt(params.runtimeRenderSheetQuadratureOrder, 1),
            quadratureProfile: sanitizeString(params.runtimeRenderSheetQuadratureProfile, 'gauss_legendre_1x2'),
            desingularizationEpsilon: toFinite(params.runtimeRenderSheetDesingularizationEpsilon, 0.01),
            meshSeed: toInt(params.runtimeRenderSheetMeshSeed, 0),
            topology: sanitizeString(params.runtimeRenderSheetMeshTopology, 'tri_fan'),
            patchCount: toInt(params.runtimeRenderSheetMeshPatchCount, 1),
            panelAspectP95: toFinite(params.runtimeRenderSheetPanelAspectP95, 1),
            qualityGates: {
              passCount: toInt(params.runtimeRenderSheetQualityGatePassCount, 0),
              total: toInt(params.runtimeRenderSheetQualityGateTotal, 4),
              verdict: sanitizeString(params.runtimeRenderSheetQualityVerdict, 'warn'),
              penalty: toFinite(params.runtimeRenderSheetQualityPenalty, 0.5),
            },
            meshLayout: {
              deterministic: params.runtimeRenderSheetMeshDeterministic !== false,
              digest: toInt(params.runtimeRenderSheetMeshLayoutDigest, 0),
              patchPanelMin: toInt(params.runtimeRenderSheetMeshPatchMinPanels, 0),
              patchPanelMax: toInt(params.runtimeRenderSheetMeshPatchMaxPanels, 0),
              patchPanelImbalance: toFinite(params.runtimeRenderSheetMeshPatchImbalance, 0),
            },
            meshBuilderContract: {
              version: sanitizeString(params.runtimeRenderSheetMeshContractVersion, 'tt021b.panel_mesh.v1'),
              valid: params.runtimeRenderSheetMeshContractValid !== false,
              issueCount: toInt(params.runtimeRenderSheetMeshContractIssueCount, 0),
              gatePassCount: toInt(params.runtimeRenderSheetMeshContractGatePassCount, 4),
              gateTotal: toInt(params.runtimeRenderSheetMeshContractGateTotal, 4),
              verdict: sanitizeString(params.runtimeRenderSheetMeshContractVerdict, 'pass'),
              penalty: toFinite(params.runtimeRenderSheetMeshContractPenalty, 0),
              envelope: {
                patchAreaMean: toFinite(params.runtimeRenderSheetMeshPatchAreaMean, 0.01),
                patchAreaCv: toFinite(params.runtimeRenderSheetMeshPatchAreaCv, 0),
                edgeLengthRatioP95: toFinite(params.runtimeRenderSheetMeshEdgeLengthRatioP95, 1),
                curvatureProxyP95: toFinite(params.runtimeRenderSheetMeshCurvatureProxyP95, 1),
              },
            },
            couplingContracts: {
              version: sanitizeString(params.runtimeRenderSheetCouplingVersion, 'tt021c.sheet_coupling.v1'),
              valid: params.runtimeRenderSheetCouplingValid !== false,
              verdict: sanitizeString(params.runtimeRenderSheetCouplingVerdict, 'pass'),
              penalty: toFinite(params.runtimeRenderSheetCouplingPenalty, 0),
              amer: {
                state: sanitizeString(params.runtimeRenderSheetCouplingAmerState, 'pass'),
                transferBudget: toFinite(params.runtimeRenderSheetCouplingAmerTransferBudget, 0.5),
                invariantDriftCapPct: toFinite(params.runtimeRenderSheetCouplingAmerInvariantDriftCapPct, 4),
              },
              filament: {
                state: sanitizeString(params.runtimeRenderSheetCouplingFilamentState, 'pass'),
                nodeTransferCap: toInt(params.runtimeRenderSheetCouplingFilamentNodeTransferCap, 64),
                load: toFinite(params.runtimeRenderSheetCouplingFilamentLoad, 0),
              },
              rollupStabilityGuard: sanitizeString(params.runtimeRenderSheetRollupStabilityGuard, 'clear'),
            },
            placeholder: params.runtimeRenderSheetPlaceholder !== false,
          },
          overrideReason: sanitizeString(params.runtimeRenderOverrideReason, 'none'),
        },
      },
      overlayDiagnostics: {
        confidenceComposite: toFinite(params.runtimeOverlayConfidenceComposite, 0),
        uncertaintyComposite: toFinite(params.runtimeOverlayUncertaintyComposite, 1),
        uncertaintyComponents: {
          detector: toFinite(params.runtimeOverlayUncertaintyDetector, 1),
          topology: toFinite(params.runtimeOverlayUncertaintyTopology, 1),
          render: toFinite(params.runtimeOverlayUncertaintyRender, 1),
        },
      },
      overlayStructures: normalizeOverlayStructures(params.runtimeOverlayStructures),
      stabilityAutoCorrection: {
        totalCount: toInt(params.runtimeStabilityAutoCorrectionTotalCount, 0),
        saturationCount: toInt(params.runtimeStabilityAutoCorrectionSaturationCount, 0),
        cooldown: toInt(params.runtimeStabilityAutoCorrectionCooldown, 0),
        lastAction: sanitizeString(params.runtimeStabilityAutoCorrectionLastAction, 'none'),
        timeline: Array.isArray(params.runtimeStabilityAutoCorrectionTimeline)
          ? params.runtimeStabilityAutoCorrectionTimeline.slice(-24).map((entry) => sanitizeString(entry, ''))
          : [],
        stepsTotal:
          toInt(params.runtimeCpuSteps, 0) + toInt(params.runtimeGpuSteps, 0),
        per1kSteps: (() => {
          const steps = Math.max(1, toInt(params.runtimeCpuSteps, 0) + toInt(params.runtimeGpuSteps, 0))
          const total = Math.max(0, toInt(params.runtimeStabilityAutoCorrectionTotalCount, 0))
          return toFinite((total / steps) * 1000, 0)
        })(),
        windowPer1kSteps: toFinite(params.runtimeStabilityAutoCorrectionWindowPer1k, 0),
      },
      physicalStepOrder: sanitizeString(params.runtimePhysicalStepOrder, 'velocity_computation'),
      overlayEvents: buildOverlayEvents(params),
      timeline: normalizedTimeline,
      timelineDerivedEvents: buildTimelineDerivedEvents(normalizedTimeline),
    },
    stability: {
      ...(stabilityStats ?? {}),
    },
    filaments: {
      ...(filamentStats ?? {}),
    },
  }
}

export function buildScientificSnapshotSequenceManifest({
  timestamp = new Date(),
  baseName = 'torus-scientific-sequence',
  timeline = [],
  imageFrameStepSec = 0.5,
} = {}) {
  const now = timestamp instanceof Date ? timestamp : new Date(timestamp)
  const normalizedTimeline = normalizeTimeline(timeline)
  const safeBaseName = sanitizeString(baseName, 'torus-scientific-sequence')
  const step = Math.max(0.1, toFinite(imageFrameStepSec, 0.5))
  const frames = []
  let nextFrameSec = normalizedTimeline.length > 0 ? normalizedTimeline[0].tSec : 0
  let frameIdx = 0
  for (let i = 0; i < normalizedTimeline.length; i += 1) {
    const point = normalizedTimeline[i]
    if (point.tSec + 1e-9 < nextFrameSec) {
      continue
    }
    frames.push({
      index: frameIdx,
      tSec: point.tSec,
      fileName: `${safeBaseName}-frame-${String(frameIdx).padStart(4, '0')}.png`,
    })
    frameIdx += 1
    nextFrameSec = point.tSec + step
  }
  return {
    schemaVersion: SCIENTIFIC_SNAPSHOT_SCHEMA_VERSION,
    schemaId: `${SCIENTIFIC_SNAPSHOT_SCHEMA_ID}.sequence`,
    type: 'torus-vortex-scientific-snapshot-sequence',
    generatedAt: now.toISOString(),
    baseName: safeBaseName,
    frameStepSec: step,
    timelinePointCount: normalizedTimeline.length,
    frameCount: frames.length,
    frames,
  }
}

export function buildScientificFfmpegTranscodePlan({
  sequenceManifest = null,
  fps = 30,
  outputFileName = 'torus-scientific-sequence.mp4',
} = {}) {
  const manifest = sequenceManifest && typeof sequenceManifest === 'object' ? sequenceManifest : {}
  const frames = Array.isArray(manifest.frames) ? manifest.frames : []
  const safeFps = Math.max(1, Math.floor(toFinite(fps, 30)))
  const safeOutput = sanitizeString(outputFileName, 'torus-scientific-sequence.mp4')
  const concatLines = frames.map((frame) => `file '${sanitizeString(frame.fileName, 'frame.png')}'`)
  const planId = `${sanitizeString(manifest.baseName, 'torus-scientific-sequence')}-${safeFps}fps`
  const ffmpegCommand = concatLines.length
    ? `ffmpeg -r ${safeFps} -f concat -safe 0 -i frames.txt -c:v libx264 -pix_fmt yuv420p "${safeOutput}"`
    : `ffmpeg -r ${safeFps} -f concat -safe 0 -i frames.txt -c:v libx264 -pix_fmt yuv420p "${safeOutput}"`
  return {
    schemaVersion: SCIENTIFIC_SNAPSHOT_SCHEMA_VERSION,
    schemaId: `${SCIENTIFIC_SNAPSHOT_SCHEMA_ID}.ffmpeg`,
    type: 'torus-vortex-scientific-ffmpeg-plan',
    planId,
    generatedAt: new Date().toISOString(),
    frameCount: frames.length,
    fps: safeFps,
    outputFileName: safeOutput,
    inputs: {
      framesListFileName: 'frames.txt',
      expectedFrameNames: frames.map((frame) => sanitizeString(frame.fileName, 'frame.png')),
    },
    concatFileContent: concatLines.join('\n'),
    ffmpegCommand,
    notes: [
      'Place frames.txt рядом с PNG кадрами.',
      'Убедитесь, что sequence manifest frame names совпадают с фактическими PNG файлами.',
    ],
  }
}

export function buildScientificExportValidationReport({
  snapshotBundle = null,
  sequenceManifest = null,
  ffmpegPlan = null,
} = {}) {
  const bundle = snapshotBundle && typeof snapshotBundle === 'object' ? snapshotBundle : {}
  const manifest = sequenceManifest && typeof sequenceManifest === 'object' ? sequenceManifest : {}
  const plan = ffmpegPlan && typeof ffmpegPlan === 'object' ? ffmpegPlan : {}
  const manifestFrames = Array.isArray(manifest.frames) ? manifest.frames : []
  const planFrames = Array.isArray(plan.inputs?.expectedFrameNames) ? plan.inputs.expectedFrameNames : []
  const concatLines = sanitizeString(plan.concatFileContent, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const visualization = bundle.visualization && typeof bundle.visualization === 'object'
    ? bundle.visualization
    : {}
  const overlayLabelPolicy = visualization.overlayLabelPolicy && typeof visualization.overlayLabelPolicy === 'object'
    ? visualization.overlayLabelPolicy
    : {}
  const overlayMinConfidence = toFinite(visualization.overlayMinConfidence, 0.25)
  const overlayLabelMaxCount = toInt(overlayLabelPolicy.maxCount, 8)
  const overlayLabelMaxDistance = toFinite(overlayLabelPolicy.maxDistance, 12)
  const overlayStructures = Array.isArray(bundle.runtime?.overlayStructures) ? bundle.runtime.overlayStructures : []
  const sheetDiscretization = bundle.runtime?.renderPolicy?.diagnostics?.sheetDiscretization ?? {}
  const sheetMeshBuilderContract = sheetDiscretization.meshBuilderContract ?? {}
  const sheetCouplingContracts = sheetDiscretization.couplingContracts ?? {}
  const ringProfile = sanitizeString(bundle.runtime?.topology?.ringValidation?.profile, '')
  const jetProfile = sanitizeString(bundle.runtime?.topology?.jetRegime?.profile, '')
  const detectorProfile = sanitizeString(bundle.runtime?.topology?.detectorFusion?.profile, '')
  const trackingProfile = sanitizeString(bundle.runtime?.topology?.tracking?.profile, '')
  const ringModifierStrength = Math.abs(
    toFinite(bundle.runtime?.topology?.ringValidation?.modifierStrength, 0),
  )
  const jetModifierStrength = Math.abs(
    toFinite(bundle.runtime?.topology?.jetRegime?.modifierStrength, 0),
  )
  const detectorModifierStrength = Math.abs(
    toFinite(bundle.runtime?.topology?.detectorFusion?.modifierStrength, 0),
  )
  const trackingModifierStrength = Math.abs(
    toFinite(bundle.runtime?.topology?.tracking?.modifierStrength, 0),
  )
  const manifestFrameNames = manifestFrames.map((frame) => sanitizeString(frame?.fileName, 'frame.png'))
  const uniqueManifestNames = new Set(manifestFrameNames)
  const checks = [
    {
      id: 'bundle_schema_id',
      ok: sanitizeString(bundle.schemaId, '') === SCIENTIFIC_SNAPSHOT_SCHEMA_ID,
      value: sanitizeString(bundle.schemaId, ''),
      expected: SCIENTIFIC_SNAPSHOT_SCHEMA_ID,
    },
    {
      id: 'manifest_schema_id',
      ok: sanitizeString(manifest.schemaId, '') === `${SCIENTIFIC_SNAPSHOT_SCHEMA_ID}.sequence`,
      value: sanitizeString(manifest.schemaId, ''),
      expected: `${SCIENTIFIC_SNAPSHOT_SCHEMA_ID}.sequence`,
    },
    {
      id: 'ffmpeg_schema_id',
      ok: sanitizeString(plan.schemaId, '') === `${SCIENTIFIC_SNAPSHOT_SCHEMA_ID}.ffmpeg`,
      value: sanitizeString(plan.schemaId, ''),
      expected: `${SCIENTIFIC_SNAPSHOT_SCHEMA_ID}.ffmpeg`,
    },
    {
      id: 'manifest_frame_count',
      ok: toInt(manifest.frameCount, 0) === manifestFrames.length,
      value: toInt(manifest.frameCount, 0),
      expected: manifestFrames.length,
    },
    {
      id: 'manifest_frame_names_unique',
      ok: uniqueManifestNames.size === manifestFrameNames.length,
      value: uniqueManifestNames.size,
      expected: manifestFrameNames.length,
    },
    {
      id: 'ffmpeg_expected_frame_count',
      ok: planFrames.length === manifestFrames.length,
      value: planFrames.length,
      expected: manifestFrames.length,
    },
    {
      id: 'ffmpeg_concat_line_count',
      ok: concatLines.length === manifestFrames.length,
      value: concatLines.length,
      expected: manifestFrames.length,
    },
    {
      id: 'ffmpeg_output_extension',
      ok: sanitizeString(plan.outputFileName, '').toLowerCase().endsWith('.mp4'),
      value: sanitizeString(plan.outputFileName, ''),
      expected: '*.mp4',
    },
    {
      id: 'bundle_render_policy_block',
      ok: typeof bundle.runtime?.renderPolicy === 'object' && bundle.runtime?.renderPolicy !== null,
      value: typeof bundle.runtime?.renderPolicy,
      expected: 'object',
    },
    {
      id: 'bundle_overlay_diagnostics_block',
      ok: typeof bundle.runtime?.overlayDiagnostics === 'object' && bundle.runtime?.overlayDiagnostics !== null,
      value: typeof bundle.runtime?.overlayDiagnostics,
      expected: 'object',
    },
    {
      id: 'bundle_overlay_structures_block',
      ok: Array.isArray(bundle.runtime?.overlayStructures),
      value: Array.isArray(bundle.runtime?.overlayStructures),
      expected: true,
    },
    {
      id: 'bundle_topology_transition_contract_block',
      ok:
        typeof bundle.runtime?.topology?.transitionContract === 'object' &&
        bundle.runtime?.topology?.transitionContract !== null,
      value: typeof bundle.runtime?.topology?.transitionContract,
      expected: 'object',
    },
    {
      id: 'bundle_topology_transition_gate_reason_present',
      ok: sanitizeString(bundle.runtime?.topology?.transitionContract?.gates?.reason, '').length > 0,
      value: sanitizeString(bundle.runtime?.topology?.transitionContract?.gates?.reason, ''),
      expected: 'non-empty reason',
    },
    {
      id: 'bundle_topology_ring_validation_block',
      ok:
        typeof bundle.runtime?.topology?.ringValidation === 'object' &&
        bundle.runtime?.topology?.ringValidation !== null,
      value: typeof bundle.runtime?.topology?.ringValidation,
      expected: 'object',
    },
    {
      id: 'bundle_topology_ring_validation_verdict',
      ok: sanitizeString(bundle.runtime?.topology?.ringValidation?.verdict, 'fail') !== 'fail',
      value: sanitizeString(bundle.runtime?.topology?.ringValidation?.verdict, 'fail'),
      expected: 'pass|warn',
    },
    {
      id: 'bundle_topology_ring_external_validation_eligible',
      ok: bundle.runtime?.topology?.ringValidation?.externalValidationEligible === true,
      value: bundle.runtime?.topology?.ringValidation?.externalValidationEligibilityReason ?? 'unknown',
      expected: 'eligible',
    },
    {
      id: 'bundle_topology_ring_external_validation_classic_profile',
      ok: ringProfile === 'classic',
      value: ringProfile || 'n/a',
      expected: 'classic',
    },
    {
      id: 'bundle_topology_ring_external_validation_modifier_strength_zero',
      ok: ringModifierStrength <= 1e-6,
      value: ringModifierStrength,
      expected: '<= 1e-6',
    },
    {
      id: 'bundle_topology_jet_regime_block',
      ok: typeof bundle.runtime?.topology?.jetRegime === 'object' && bundle.runtime?.topology?.jetRegime !== null,
      value: typeof bundle.runtime?.topology?.jetRegime,
      expected: 'object',
    },
    {
      id: 'bundle_topology_jet_regime_verdict',
      ok: sanitizeString(bundle.runtime?.topology?.jetRegime?.verdict, 'fail') !== 'fail',
      value: sanitizeString(bundle.runtime?.topology?.jetRegime?.verdict, 'fail'),
      expected: 'pass|warn',
    },
    {
      id: 'bundle_topology_jet_external_validation_eligible',
      ok: bundle.runtime?.topology?.jetRegime?.externalValidationEligible === true,
      value: bundle.runtime?.topology?.jetRegime?.externalValidationEligibilityReason ?? 'unknown',
      expected: 'eligible',
    },
    {
      id: 'bundle_topology_jet_external_validation_classic_profile',
      ok: jetProfile === 'classic',
      value: jetProfile || 'n/a',
      expected: 'classic',
    },
    {
      id: 'bundle_topology_jet_external_validation_modifier_strength_zero',
      ok: jetModifierStrength <= 1e-6,
      value: jetModifierStrength,
      expected: '<= 1e-6',
    },
    {
      id: 'bundle_topology_jet_regime_regime_type',
      ok: sanitizeString(bundle.runtime?.topology?.jetRegime?.regime, '').length > 0,
      value: sanitizeString(bundle.runtime?.topology?.jetRegime?.regime, ''),
      expected: 'non-empty regime',
    },
    {
      id: 'bundle_topology_detector_fusion_block',
      ok:
        typeof bundle.runtime?.topology?.detectorFusion === 'object' &&
        bundle.runtime?.topology?.detectorFusion !== null,
      value: typeof bundle.runtime?.topology?.detectorFusion,
      expected: 'object',
    },
    {
      id: 'bundle_topology_detector_fusion_verdict',
      ok: sanitizeString(bundle.runtime?.topology?.detectorFusion?.verdict, 'fail') !== 'fail',
      value: sanitizeString(bundle.runtime?.topology?.detectorFusion?.verdict, 'fail'),
      expected: 'pass|warn',
    },
    {
      id: 'bundle_topology_detector_external_validation_eligible',
      ok: bundle.runtime?.topology?.detectorFusion?.externalValidationEligible === true,
      value: bundle.runtime?.topology?.detectorFusion?.externalValidationEligibilityReason ?? 'unknown',
      expected: 'eligible',
    },
    {
      id: 'bundle_topology_detector_external_validation_classic_profile',
      ok: detectorProfile === 'classic',
      value: detectorProfile || 'n/a',
      expected: 'classic',
    },
    {
      id: 'bundle_topology_detector_external_validation_modifier_strength_zero',
      ok: detectorModifierStrength <= 1e-6,
      value: detectorModifierStrength,
      expected: '<= 1e-6',
    },
    {
      id: 'bundle_topology_tracking_block',
      ok: typeof bundle.runtime?.topology?.tracking === 'object' && bundle.runtime?.topology?.tracking !== null,
      value: typeof bundle.runtime?.topology?.tracking,
      expected: 'object',
    },
    {
      id: 'bundle_topology_tracking_event_log_array',
      ok: Array.isArray(bundle.runtime?.topology?.tracking?.eventLog),
      value: Array.isArray(bundle.runtime?.topology?.tracking?.eventLog),
      expected: true,
    },
    {
      id: 'bundle_topology_tracking_graph_block',
      ok:
        typeof bundle.runtime?.topology?.tracking?.graph === 'object' &&
        bundle.runtime?.topology?.tracking?.graph !== null,
      value: typeof bundle.runtime?.topology?.tracking?.graph,
      expected: 'object',
    },
    {
      id: 'bundle_topology_tracking_external_validation_eligible',
      ok: bundle.runtime?.topology?.tracking?.externalValidationEligible === true,
      value: bundle.runtime?.topology?.tracking?.externalValidationEligibilityReason ?? 'unknown',
      expected: 'eligible',
    },
    {
      id: 'bundle_topology_tracking_external_validation_classic_profile',
      ok: trackingProfile === 'classic',
      value: trackingProfile || 'n/a',
      expected: 'classic',
    },
    {
      id: 'bundle_topology_tracking_external_validation_modifier_strength_zero',
      ok: trackingModifierStrength <= 1e-6,
      value: trackingModifierStrength,
      expected: '<= 1e-6',
    },
    {
      id: 'bundle_detector_sheet_feature_block',
      ok:
        typeof bundle.runtime?.detector?.sheetFeatures === 'object' &&
        bundle.runtime?.detector?.sheetFeatures !== null,
      value: typeof bundle.runtime?.detector?.sheetFeatures,
      expected: 'object',
    },
    {
      id: 'bundle_sheet_discretization_block',
      ok: typeof sheetDiscretization === 'object' && sheetDiscretization !== null,
      value: typeof sheetDiscretization,
      expected: 'object',
    },
    {
      id: 'bundle_sheet_profile_id_present',
      ok: sanitizeString(sheetDiscretization.profileId, '').length > 0,
      value: sanitizeString(sheetDiscretization.profileId, ''),
      expected: 'non-empty profile id',
    },
    {
      id: 'bundle_sheet_mesh_builder_contract_valid',
      ok: sheetMeshBuilderContract.valid === true,
      value: sheetMeshBuilderContract.valid === true,
      expected: true,
    },
    {
      id: 'bundle_sheet_mesh_builder_gate_threshold',
      ok:
        toInt(sheetMeshBuilderContract.gatePassCount, 0) >=
        Math.ceil(Math.max(1, toInt(sheetMeshBuilderContract.gateTotal, 4)) * 0.5),
      value: `${toInt(sheetMeshBuilderContract.gatePassCount, 0)}/${toInt(sheetMeshBuilderContract.gateTotal, 4)}`,
      expected: '>= 50% pass',
    },
    {
      id: 'bundle_sheet_coupling_contract_valid',
      ok: sheetCouplingContracts.valid === true,
      value: sheetCouplingContracts.valid === true,
      expected: true,
    },
    {
      id: 'bundle_sheet_coupling_contract_verdict',
      ok: sanitizeString(sheetCouplingContracts.verdict, 'fail') !== 'fail',
      value: sanitizeString(sheetCouplingContracts.verdict, 'fail'),
      expected: 'pass|warn',
    },
    {
      id: 'visualization_overlay_label_policy_block',
      ok:
        typeof bundle.visualization?.overlayLabelPolicy === 'object' &&
        bundle.visualization?.overlayLabelPolicy !== null,
      value: typeof bundle.visualization?.overlayLabelPolicy,
      expected: 'object',
    },
    {
      id: 'visualization_overlay_min_confidence_range',
      ok: overlayMinConfidence >= 0 && overlayMinConfidence <= 1,
      value: overlayMinConfidence,
      expected: '[0..1]',
    },
    {
      id: 'visualization_overlay_label_enabled_boolean',
      ok: typeof overlayLabelPolicy.enabled === 'boolean',
      value: typeof overlayLabelPolicy.enabled,
      expected: 'boolean',
    },
    {
      id: 'visualization_overlay_label_max_count_bounds',
      ok: overlayLabelMaxCount >= 1 && overlayLabelMaxCount <= 24,
      value: overlayLabelMaxCount,
      expected: '[1..24]',
    },
    {
      id: 'visualization_overlay_label_max_distance_bounds',
      ok: overlayLabelMaxDistance >= 2 && overlayLabelMaxDistance <= 60,
      value: overlayLabelMaxDistance,
      expected: '[2..60]',
    },
    {
      id: 'runtime_overlay_structures_bounded',
      ok: overlayStructures.length <= 24,
      value: overlayStructures.length,
      expected: '<=24',
    },
  ]
  const failedChecks = checks.filter((item) => item.ok !== true).map((item) => item.id)
  return {
    schemaVersion: SCIENTIFIC_SNAPSHOT_SCHEMA_VERSION,
    schemaId: `${SCIENTIFIC_SNAPSHOT_SCHEMA_ID}.validation`,
    type: 'torus-vortex-scientific-export-validation',
    generatedAt: new Date().toISOString(),
    pass: failedChecks.length === 0,
    failedChecks,
    checks,
  }
}
