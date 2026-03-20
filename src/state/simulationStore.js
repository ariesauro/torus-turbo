import { create } from 'zustand'
import { defaultParams } from '../simulation/params/defaultParams'
import {
  cloneSimulationParams,
  normalizeSimulationParams,
} from '../simulation/params/normalizeParams'
import {
  getNaturalPreset,
  getStableRingPreset,
  getTrailingJetPreset,
} from '../simulation/physics/runtime/stableRingPreset'
import {
  loadParamsFromStorage,
  normalizePhysicsBackend,
  saveParamsToStorage,
} from '../simulation/params/storage'

function cloneParams(params) {
  return cloneSimulationParams(params)
}

const initialParams = loadParamsFromStorage()

function normalizeScenePayload(payload) {
  const base = cloneParams(defaultParams)

  if (!payload || typeof payload !== 'object') {
    return null
  }

  const payloadParams =
    payload.params && typeof payload.params === 'object' ? payload.params : payload
  const normalizedPayloadParams = normalizePhysicsBackend(payloadParams)
  const payloadCamera =
    payload.camera && typeof payload.camera === 'object'
      ? payload.camera
      : normalizedPayloadParams.camera

  return {
    ...normalizeSimulationParams({
      ...base,
      ...normalizedPayloadParams,
    }),
    camera: {
      ...base.camera,
      ...(payloadCamera ?? {}),
    },
  }
}

export const useSimulationStore = create((set, get) => ({
  params: cloneParams(initialParams),
  cameraState: { ...initialParams.camera },
  stabilityStats: {
    sigmaOverR: 0,
    totalCirculation: 0,
    particleCount: 0,
    avgSigma: 0,
    minSigma: 0,
    maxSigma: 0,
    ringMajorMeasured: 0,
    ringMinorMeasured: 0,
    tiltProxyDeg: 0,
    ringCoherence: 0,
    targetSigmaRatio: 0,
    circulationBaseline: 0,
    circulationDriftPercent: 0,
    hybridParticleCirculation: 0,
    hybridFilamentCirculation: 0,
    hybridTotalCirculation: 0,
    hybridCirculationBaseline: 0,
    hybridCirculationDriftPercent: 0,
    hybridParticleCount: 0,
    hybridFilamentCount: 0,
    hybridCenterOffset: 0,
    hybridAxialOffset: 0,
    hybridParticleCenterStep: 0,
    hybridFilamentCenterStep: 0,
    hybridRadiusOffset: 0,
    hybridFilamentMeanRadius: 0,
    hybridFilamentRadiusDriftPercent: 0,
    hybridFilamentArcLength: 0,
    hybridFilamentArcLengthDriftPercent: 0,
  },
  filamentStats: {
    filamentCount: 0,
    nodeCount: 0,
    avgSegmentLength: 0,
    minSegmentLength: 0,
    maxSegmentLength: 0,
    avgCirculation: 0,
    avgQueriedSegmentRefs: 0,
    maxQueriedSegmentRefs: 0,
    avgCrossCouplingSamples: 0,
    maxCrossCouplingSamples: 0,
    filamentStepMs: 0,
    splitCount: 0,
    mergeCount: 0,
    nodesAddedThisStep: 0,
    splitMergeNet: 0,
    splitBudgetHitCount: 0,
    nodeGrowthPerStep: 0,
    transportStepDistanceAvg: 0,
    transportStepDistanceMax: 0,
    transportVelocityAvg: 0,
    transportVelocityMax: 0,
    transportCenterStep: 0,
    radiusGuardActivations: 0,
    reconnectAttempts: 0,
    reconnectSuccess: 0,
    reconnectRejected: 0,
    reconnectRejectedCooldown: 0,
    reconnectRejectedNearEndpointA: 0,
    reconnectRejectedNearEndpointB: 0,
    reconnectRejectedNodeLimit: 0,
    reconnectRejectedDegenerateInsert: 0,
    reconnectRejectedDistance: 0,
    reconnectRejectedAngle: 0,
    reconnectMultipleApplied: 0,
    vortexAnnihilationCount: 0,
    topologyRejects: 0,
    repairedNodes: 0,
    degenerateSegmentsRemoved: 0,
    closedLoopViolations: 0,
    regularizationCorrections: 0,
    regularizedFilaments: 0,
    operatorSelfInducedMs: 0,
    operatorSmoothingMs: 0,
    operatorRegularizationMs: 0,
    operatorReconnectionMs: 0,
    adaptiveRefinementPressureAvg: 0,
    adaptiveRefinementPressureMax: 0,
    adaptiveSplitBudgetScale: 1,
    adaptiveMaxSegmentScale: 1,
    adaptiveMinSegmentScale: 1,
    liaVelocityAvg: 0,
    liaVelocityMax: 0,
    smoothingCurvatureAvg: 0,
    smoothingCurvatureMax: 0,
    circulationBefore: 0,
    circulationAfter: 0,
    circulationDriftAbs: 0,
    circulationDriftPercent: 0,
    circulationViolationCount: 0,
    hybridParticleSpeed: 0,
    hybridFilamentSpeed: 0,
    hybridParticleCrossSpeed: 0,
    hybridFilamentCrossSpeed: 0,
    hybridFilamentLocalSelfSpeed: 0,
    hybridFilamentLocalSelfSpeedMax: 0,
    hybridSpeedRatio: 0,
    hybridParticleDt: 0,
    hybridFilamentDt: 0,
    hybridParticleToFilamentClampHits: 0,
    hybridFilamentCouplingSelfRatio: 0,
    hybridFilamentCouplingSelfRatioMax: 0,
    hybridFilamentRadialOutward: 0,
    hybridFilamentRadialOutwardMax: 0,
    hybridDriftClampFactorAvg: 1,
    hybridDriftClampFactorMin: 1,
    hybridDriftClampHitCount: 0,
    hybridCenterGuardActivations: 0,
    hybridRadiusGuardActivations: 0,
    hybridAdaptiveMinSelfRatioAvg: 0,
    hybridAdaptiveMinSelfRatioMax: 0,
    hybridAdaptiveCenterPullGainAvg: 0,
    hybridAdaptiveCenterPullGainMax: 0,
    hybridDriftSeverityAvg: 0,
    hybridDriftSeverityMax: 0,
  },
  resetToken: 0,
  loadToken: 0,
  pulseCommandId: 0,
  pulseCommandType: 'stop',
  setParam: (key, value) =>
    set((state) => ({
      params: normalizeSimulationParams({
        ...state.params,
        [key]: value,
      }),
    })),
  setParams: (partialParams) =>
    set((state) => ({
      params: normalizeSimulationParams({
        ...state.params,
        ...partialParams,
      }),
    })),
  setCameraState: (cameraState) =>
    set((state) => ({
      cameraState: {
        ...state.cameraState,
        ...cameraState,
      },
      params: {
        ...state.params,
        camera: {
          ...state.params.camera,
          ...cameraState,
        },
      },
    })),
  setStabilityStats: (stabilityStats) =>
    set(() => ({
      stabilityStats: {
        sigmaOverR: 0,
        totalCirculation: 0,
        particleCount: 0,
        avgSigma: 0,
        minSigma: 0,
        maxSigma: 0,
        ringMajorMeasured: 0,
        ringMinorMeasured: 0,
        tiltProxyDeg: 0,
        ringCoherence: 0,
        targetSigmaRatio: 0,
        circulationBaseline: 0,
        circulationDriftPercent: 0,
        hybridParticleCirculation: 0,
        hybridFilamentCirculation: 0,
        hybridTotalCirculation: 0,
        hybridCirculationBaseline: 0,
        hybridCirculationDriftPercent: 0,
        hybridParticleCount: 0,
        hybridFilamentCount: 0,
        hybridCenterOffset: 0,
        hybridAxialOffset: 0,
        hybridParticleCenterStep: 0,
        hybridFilamentCenterStep: 0,
        hybridRadiusOffset: 0,
        hybridFilamentMeanRadius: 0,
        hybridFilamentRadiusDriftPercent: 0,
        hybridFilamentArcLength: 0,
        hybridFilamentArcLengthDriftPercent: 0,
        ...(stabilityStats ?? {}),
      },
    })),
  setFilamentStats: (filamentStats) =>
    set(() => ({
      filamentStats: {
        filamentCount: 0,
        nodeCount: 0,
        avgSegmentLength: 0,
        minSegmentLength: 0,
        maxSegmentLength: 0,
        avgCirculation: 0,
        avgQueriedSegmentRefs: 0,
        maxQueriedSegmentRefs: 0,
        avgCrossCouplingSamples: 0,
        maxCrossCouplingSamples: 0,
        filamentStepMs: 0,
        splitCount: 0,
        mergeCount: 0,
        nodesAddedThisStep: 0,
        splitMergeNet: 0,
        splitBudgetHitCount: 0,
        nodeGrowthPerStep: 0,
        transportStepDistanceAvg: 0,
        transportStepDistanceMax: 0,
        transportVelocityAvg: 0,
        transportVelocityMax: 0,
        transportCenterStep: 0,
        radiusGuardActivations: 0,
        reconnectAttempts: 0,
        reconnectSuccess: 0,
        reconnectRejected: 0,
        reconnectRejectedCooldown: 0,
        reconnectRejectedNearEndpointA: 0,
        reconnectRejectedNearEndpointB: 0,
        reconnectRejectedNodeLimit: 0,
        reconnectRejectedDegenerateInsert: 0,
        reconnectRejectedDistance: 0,
        reconnectRejectedAngle: 0,
        reconnectMultipleApplied: 0,
        vortexAnnihilationCount: 0,
        topologyRejects: 0,
        repairedNodes: 0,
        degenerateSegmentsRemoved: 0,
        closedLoopViolations: 0,
        regularizationCorrections: 0,
        regularizedFilaments: 0,
        operatorSelfInducedMs: 0,
        operatorSmoothingMs: 0,
        operatorRegularizationMs: 0,
        operatorReconnectionMs: 0,
        adaptiveRefinementPressureAvg: 0,
        adaptiveRefinementPressureMax: 0,
        adaptiveSplitBudgetScale: 1,
        adaptiveMaxSegmentScale: 1,
        adaptiveMinSegmentScale: 1,
        liaVelocityAvg: 0,
        liaVelocityMax: 0,
        smoothingCurvatureAvg: 0,
        smoothingCurvatureMax: 0,
        circulationBefore: 0,
        circulationAfter: 0,
        circulationDriftAbs: 0,
        circulationDriftPercent: 0,
        circulationViolationCount: 0,
        hybridParticleSpeed: 0,
        hybridFilamentSpeed: 0,
        hybridParticleCrossSpeed: 0,
        hybridFilamentCrossSpeed: 0,
        hybridFilamentLocalSelfSpeed: 0,
        hybridFilamentLocalSelfSpeedMax: 0,
        hybridSpeedRatio: 0,
        hybridParticleDt: 0,
        hybridFilamentDt: 0,
        hybridParticleToFilamentClampHits: 0,
        hybridFilamentCouplingSelfRatio: 0,
        hybridFilamentCouplingSelfRatioMax: 0,
        hybridFilamentRadialOutward: 0,
        hybridFilamentRadialOutwardMax: 0,
        hybridDriftClampFactorAvg: 1,
        hybridDriftClampFactorMin: 1,
        hybridDriftClampHitCount: 0,
        hybridCenterGuardActivations: 0,
        hybridRadiusGuardActivations: 0,
        hybridAdaptiveMinSelfRatioAvg: 0,
        hybridAdaptiveMinSelfRatioMax: 0,
        hybridAdaptiveCenterPullGainAvg: 0,
        hybridAdaptiveCenterPullGainMax: 0,
        hybridDriftSeverityAvg: 0,
        hybridDriftSeverityMax: 0,
        ...(filamentStats ?? {}),
      },
    })),
  resetScene: () =>
    set((state) => ({
      resetToken: state.resetToken + 1,
    })),
  singlePulse: () =>
    set((state) => ({
      pulseCommandId: state.pulseCommandId + 1,
      pulseCommandType: 'single',
    })),
  singleBurstPulse: () =>
    set((state) => ({
      pulseCommandId: state.pulseCommandId + 1,
      pulseCommandType: 'singleBurst',
    })),
  startPulseTrain: () =>
    set((state) => ({
      pulseCommandId: state.pulseCommandId + 1,
      pulseCommandType: 'startTrain',
    })),
  stopPulseTrain: () =>
    set((state) => ({
      pulseCommandId: state.pulseCommandId + 1,
      pulseCommandType: 'stop',
    })),
  applyStableRingPreset: () =>
    set((state) => ({
      params: normalizeSimulationParams({
        ...state.params,
        ...getStableRingPreset(state.params),
      }),
      resetToken: state.resetToken + 1,
      pulseCommandId: state.pulseCommandId + 1,
      pulseCommandType: 'stop',
    })),
  applyNaturalPreset: () =>
    set((state) => ({
      params: normalizeSimulationParams({
        ...state.params,
        ...getNaturalPreset(state.params),
      }),
      resetToken: state.resetToken + 1,
      pulseCommandId: state.pulseCommandId + 1,
      pulseCommandType: 'stop',
    })),
  applyTrailingJetPreset: () =>
    set((state) => ({
      params: normalizeSimulationParams({
        ...state.params,
        ...getTrailingJetPreset(state.params),
      }),
      resetToken: state.resetToken + 1,
      pulseCommandId: state.pulseCommandId + 1,
      pulseCommandType: 'stop',
    })),
  saveCurrentConfig: () => {
    const state = get()
    saveParamsToStorage(state.params, state.cameraState)
  },
  loadSavedConfig: () => {
    const next = cloneParams(loadParamsFromStorage())
    set((state) => ({
      params: next,
      cameraState: { ...next.camera },
      loadToken: state.loadToken + 1,
      pulseCommandId: state.pulseCommandId + 1,
      pulseCommandType: 'stop',
    }))
  },
  exportSceneToJson: () => {
    const state = get()
    return {
      version: 1,
      type: 'torus-vortex-scene',
      savedAt: new Date().toISOString(),
      params: {
        ...state.params,
      },
      camera: {
        ...state.cameraState,
      },
    }
  },
  importSceneFromJson: (payload) => {
    const next = normalizeScenePayload(payload)

    if (!next) {
      throw new Error('Некорректный JSON сцены')
    }

    set((state) => ({
      params: next,
      cameraState: { ...next.camera },
      resetToken: state.resetToken + 1,
      loadToken: state.loadToken + 1,
      pulseCommandId: state.pulseCommandId + 1,
      pulseCommandType: 'stop',
    }))
  },
  resetParamsToDefault: () =>
    set((state) => ({
      params: cloneParams(defaultParams),
      cameraState: { ...defaultParams.camera },
      resetToken: state.resetToken + 1,
      loadToken: state.loadToken + 1,
      pulseCommandId: state.pulseCommandId + 1,
      pulseCommandType: 'stop',
    })),
}))
