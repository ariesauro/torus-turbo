function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function computeFilamentStats(filaments, queryStats = null) {
  const averageQueriedSegmentRefs = queryStats?.averageSegmentRefs ?? 0
  const maxQueriedSegmentRefs = queryStats?.maxSegmentRefs ?? 0
  const averageCouplingSamples = queryStats?.averageCouplingSamples ?? 0
  const maxCouplingSamples = queryStats?.maxCouplingSamples ?? 0
  const stepMs = queryStats?.stepMs ?? 0
  const splitCount = queryStats?.splitCount ?? 0
  const mergeCount = queryStats?.mergeCount ?? 0
  const nodesAddedThisStep = queryStats?.nodesAddedThisStep ?? 0
  const splitMergeNet = queryStats?.splitMergeNet ?? 0
  const splitBudgetHitCount = queryStats?.splitBudgetHitCount ?? 0
  const transportStepDistanceAvg = queryStats?.transportStepDistanceAvg ?? 0
  const transportStepDistanceMax = queryStats?.transportStepDistanceMax ?? 0
  const transportVelocityAvg = queryStats?.transportVelocityAvg ?? 0
  const transportVelocityMax = queryStats?.transportVelocityMax ?? 0
  const transportCenterStep = queryStats?.transportCenterStep ?? 0
  const radiusGuardActivations = queryStats?.radiusGuardActivations ?? 0
  const reconnectAttempts = queryStats?.reconnectAttempts ?? 0
  const reconnectSuccess = queryStats?.reconnectSuccess ?? 0
  const reconnectRejected = queryStats?.reconnectRejected ?? 0
  const reconnectRejectedCooldown = queryStats?.reconnectRejectedCooldown ?? 0
  const reconnectRejectedNearEndpointA = queryStats?.reconnectRejectedNearEndpointA ?? 0
  const reconnectRejectedNearEndpointB = queryStats?.reconnectRejectedNearEndpointB ?? 0
  const reconnectRejectedNodeLimit = queryStats?.reconnectRejectedNodeLimit ?? 0
  const reconnectRejectedDegenerateInsert = queryStats?.reconnectRejectedDegenerateInsert ?? 0
  const reconnectRejectedDistance = queryStats?.reconnectRejectedDistance ?? 0
  const reconnectRejectedAngle = queryStats?.reconnectRejectedAngle ?? 0
  const reconnectMultipleApplied = queryStats?.reconnectMultipleApplied ?? 0
  const vortexAnnihilationCount = queryStats?.vortexAnnihilationCount ?? 0
  const topologyRejects = queryStats?.topologyRejects ?? 0
  const repairedNodes = queryStats?.repairedNodes ?? 0
  const degenerateSegmentsRemoved = queryStats?.degenerateSegmentsRemoved ?? 0
  const closedLoopViolations = queryStats?.closedLoopViolations ?? 0
  const regularizationCorrections = queryStats?.regularizationCorrections ?? 0
  const regularizedFilaments = queryStats?.regularizedFilaments ?? 0
  const operatorSelfInducedMs = queryStats?.operatorSelfInducedMs ?? 0
  const operatorSmoothingMs = queryStats?.operatorSmoothingMs ?? 0
  const operatorRegularizationMs = queryStats?.operatorRegularizationMs ?? 0
  const operatorReconnectionMs = queryStats?.operatorReconnectionMs ?? 0
  const adaptiveRefinementPressureAvg = queryStats?.adaptiveRefinementPressureAvg ?? 0
  const adaptiveRefinementPressureMax = queryStats?.adaptiveRefinementPressureMax ?? 0
  const adaptiveSplitBudgetScale = queryStats?.adaptiveSplitBudgetScale ?? 1
  const adaptiveMaxSegmentScale = queryStats?.adaptiveMaxSegmentScale ?? 1
  const adaptiveMinSegmentScale = queryStats?.adaptiveMinSegmentScale ?? 1
  const liaVelocityAvg = queryStats?.liaVelocityAvg ?? 0
  const liaVelocityMax = queryStats?.liaVelocityMax ?? 0
  const smoothingCurvatureAvg = queryStats?.smoothingCurvatureAvg ?? 0
  const smoothingCurvatureMax = queryStats?.smoothingCurvatureMax ?? 0
  const circulationBefore = queryStats?.circulationBefore ?? 0
  const circulationAfter = queryStats?.circulationAfter ?? 0
  const circulationDriftAbs = queryStats?.circulationDriftAbs ?? 0
  const circulationDriftPercent = queryStats?.circulationDriftPercent ?? 0
  const circulationViolationCount = queryStats?.circulationViolationCount ?? 0
  const hybridParticleSpeed = queryStats?.hybridParticleSpeed ?? 0
  const hybridFilamentSpeed = queryStats?.hybridFilamentSpeed ?? 0
  const hybridParticleCrossSpeed = queryStats?.hybridParticleCrossSpeed ?? 0
  const hybridFilamentCrossSpeed = queryStats?.hybridFilamentCrossSpeed ?? 0
  const hybridFilamentLocalSelfSpeed = queryStats?.hybridFilamentLocalSelfSpeed ?? 0
  const hybridFilamentLocalSelfSpeedMax = queryStats?.hybridFilamentLocalSelfSpeedMax ?? 0
  const hybridSpeedRatio = queryStats?.hybridSpeedRatio ?? 0
  const hybridParticleDt = queryStats?.hybridParticleDt ?? 0
  const hybridFilamentDt = queryStats?.hybridFilamentDt ?? 0
  const hybridParticleToFilamentClampHits = queryStats?.hybridParticleToFilamentClampHits ?? 0
  const hybridFilamentCouplingSelfRatio = queryStats?.hybridFilamentCouplingSelfRatio ?? 0
  const hybridFilamentCouplingSelfRatioMax = queryStats?.hybridFilamentCouplingSelfRatioMax ?? 0
  const hybridFilamentRadialOutward = queryStats?.hybridFilamentRadialOutward ?? 0
  const hybridFilamentRadialOutwardMax = queryStats?.hybridFilamentRadialOutwardMax ?? 0
  const hybridDriftClampFactorAvg = queryStats?.hybridDriftClampFactorAvg ?? 1
  const hybridDriftClampFactorMin = queryStats?.hybridDriftClampFactorMin ?? 1
  const hybridDriftClampHitCount = queryStats?.hybridDriftClampHitCount ?? 0
  const hybridCenterGuardActivations = queryStats?.hybridCenterGuardActivations ?? 0
  const hybridRadiusGuardActivations = queryStats?.hybridRadiusGuardActivations ?? 0
  const hybridAdaptiveMinSelfRatioAvg = queryStats?.hybridAdaptiveMinSelfRatioAvg ?? 0
  const hybridAdaptiveMinSelfRatioMax = queryStats?.hybridAdaptiveMinSelfRatioMax ?? 0
  const hybridAdaptiveCenterPullGainAvg = queryStats?.hybridAdaptiveCenterPullGainAvg ?? 0
  const hybridAdaptiveCenterPullGainMax = queryStats?.hybridAdaptiveCenterPullGainMax ?? 0
  const hybridDriftSeverityAvg = queryStats?.hybridDriftSeverityAvg ?? 0
  const hybridDriftSeverityMax = queryStats?.hybridDriftSeverityMax ?? 0
  if (!Array.isArray(filaments) || filaments.length === 0) {
    return {
      filamentCount: 0,
      nodeCount: 0,
      avgSegmentLength: 0,
      minSegmentLength: 0,
      maxSegmentLength: 0,
      avgCirculation: 0,
      avgQueriedSegmentRefs: averageQueriedSegmentRefs,
      maxQueriedSegmentRefs: maxQueriedSegmentRefs,
      avgCrossCouplingSamples: averageCouplingSamples,
      maxCrossCouplingSamples: maxCouplingSamples,
      filamentStepMs: stepMs,
      splitCount,
      mergeCount,
      nodesAddedThisStep,
      splitMergeNet,
      splitBudgetHitCount,
      nodeGrowthPerStep: splitMergeNet,
      transportStepDistanceAvg,
      transportStepDistanceMax,
      transportVelocityAvg,
      transportVelocityMax,
      transportCenterStep,
      radiusGuardActivations,
      reconnectAttempts,
      reconnectSuccess,
      reconnectRejected,
      reconnectRejectedCooldown,
      reconnectRejectedNearEndpointA,
      reconnectRejectedNearEndpointB,
      reconnectRejectedNodeLimit,
      reconnectRejectedDegenerateInsert,
      reconnectRejectedDistance,
      reconnectRejectedAngle,
      reconnectMultipleApplied,
      vortexAnnihilationCount,
      topologyRejects,
      repairedNodes,
      degenerateSegmentsRemoved,
      closedLoopViolations,
      regularizationCorrections,
      regularizedFilaments,
      operatorSelfInducedMs,
      operatorSmoothingMs,
      operatorRegularizationMs,
      operatorReconnectionMs,
      adaptiveRefinementPressureAvg,
      adaptiveRefinementPressureMax,
      adaptiveSplitBudgetScale,
      adaptiveMaxSegmentScale,
      adaptiveMinSegmentScale,
      liaVelocityAvg,
      liaVelocityMax,
      smoothingCurvatureAvg,
      smoothingCurvatureMax,
      circulationBefore,
      circulationAfter,
      circulationDriftAbs,
      circulationDriftPercent,
      circulationViolationCount,
      hybridParticleSpeed,
      hybridFilamentSpeed,
      hybridParticleCrossSpeed,
      hybridFilamentCrossSpeed,
      hybridFilamentLocalSelfSpeed,
      hybridFilamentLocalSelfSpeedMax,
      hybridSpeedRatio,
      hybridParticleDt,
      hybridFilamentDt,
      hybridParticleToFilamentClampHits,
      hybridFilamentCouplingSelfRatio,
      hybridFilamentCouplingSelfRatioMax,
      hybridFilamentRadialOutward,
      hybridFilamentRadialOutwardMax,
      hybridDriftClampFactorAvg,
      hybridDriftClampFactorMin,
      hybridDriftClampHitCount,
      hybridCenterGuardActivations,
      hybridRadiusGuardActivations,
      hybridAdaptiveMinSelfRatioAvg,
      hybridAdaptiveMinSelfRatioMax,
      hybridAdaptiveCenterPullGainAvg,
      hybridAdaptiveCenterPullGainMax,
      hybridDriftSeverityAvg,
      hybridDriftSeverityMax,
    }
  }

  let nodeCount = 0
  let segmentCount = 0
  let totalSegmentLength = 0
  let minSegmentLength = Infinity
  let maxSegmentLength = 0
  let totalCirculation = 0

  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const filament = filaments[filamentIndex]
    nodeCount += filament.nodes.length
    totalCirculation += filament.circulation ?? 0
    const count = filament.closedLoop
      ? filament.nodes.length
      : Math.max(0, filament.nodes.length - 1)

    for (let i = 0; i < count; i += 1) {
      const a = filament.nodes[i].position
      const b = filament.nodes[(i + 1) % filament.nodes.length].position
      const segmentLength = distance(a, b)
      totalSegmentLength += segmentLength
      segmentCount += 1
      if (segmentLength < minSegmentLength) minSegmentLength = segmentLength
      if (segmentLength > maxSegmentLength) maxSegmentLength = segmentLength
    }
  }

  return {
    filamentCount: filaments.length,
    nodeCount,
    avgSegmentLength: segmentCount > 0 ? totalSegmentLength / segmentCount : 0,
    minSegmentLength: segmentCount > 0 ? minSegmentLength : 0,
    maxSegmentLength,
    avgCirculation: filaments.length > 0 ? totalCirculation / filaments.length : 0,
    avgQueriedSegmentRefs: averageQueriedSegmentRefs,
    maxQueriedSegmentRefs: maxQueriedSegmentRefs,
    avgCrossCouplingSamples: averageCouplingSamples,
    maxCrossCouplingSamples: maxCouplingSamples,
    filamentStepMs: stepMs,
    splitCount,
    mergeCount,
    nodesAddedThisStep,
    splitMergeNet,
    splitBudgetHitCount,
    nodeGrowthPerStep: splitMergeNet,
    transportStepDistanceAvg,
    transportStepDistanceMax,
    transportVelocityAvg,
    transportVelocityMax,
    transportCenterStep,
    radiusGuardActivations,
    reconnectAttempts,
    reconnectSuccess,
    reconnectRejected,
    reconnectRejectedCooldown,
    reconnectRejectedNearEndpointA,
    reconnectRejectedNearEndpointB,
    reconnectRejectedNodeLimit,
    reconnectRejectedDegenerateInsert,
    reconnectRejectedDistance,
    reconnectRejectedAngle,
    reconnectMultipleApplied,
    vortexAnnihilationCount,
    topologyRejects,
    repairedNodes,
    degenerateSegmentsRemoved,
    closedLoopViolations,
    regularizationCorrections,
    regularizedFilaments,
    operatorSelfInducedMs,
    operatorSmoothingMs,
    operatorRegularizationMs,
    operatorReconnectionMs,
    adaptiveRefinementPressureAvg,
    adaptiveRefinementPressureMax,
    adaptiveSplitBudgetScale,
    adaptiveMaxSegmentScale,
    adaptiveMinSegmentScale,
    liaVelocityAvg,
    liaVelocityMax,
    smoothingCurvatureAvg,
    smoothingCurvatureMax,
    circulationBefore,
    circulationAfter,
    circulationDriftAbs,
    circulationDriftPercent,
    circulationViolationCount,
    hybridParticleSpeed,
    hybridFilamentSpeed,
    hybridParticleCrossSpeed,
    hybridFilamentCrossSpeed,
    hybridFilamentLocalSelfSpeed,
    hybridFilamentLocalSelfSpeedMax,
    hybridSpeedRatio,
    hybridParticleDt,
    hybridFilamentDt,
    hybridParticleToFilamentClampHits,
    hybridFilamentCouplingSelfRatio,
    hybridFilamentCouplingSelfRatioMax,
    hybridFilamentRadialOutward,
    hybridFilamentRadialOutwardMax,
    hybridDriftClampFactorAvg,
    hybridDriftClampFactorMin,
    hybridDriftClampHitCount,
    hybridCenterGuardActivations,
    hybridRadiusGuardActivations,
    hybridAdaptiveMinSelfRatioAvg,
    hybridAdaptiveMinSelfRatioMax,
    hybridAdaptiveCenterPullGainAvg,
    hybridAdaptiveCenterPullGainMax,
    hybridDriftSeverityAvg,
    hybridDriftSeverityMax,
  }
}
