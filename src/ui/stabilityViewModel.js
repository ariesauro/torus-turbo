export function buildStabilityViewModel(stabilityStats) {
  const sigmaOverR = Number(stabilityStats?.sigmaOverR ?? 0)
  const circulationDriftPercent = Number(stabilityStats?.circulationDriftPercent ?? 0)

  const sigmaMonitorTone =
    sigmaOverR > 0.25
      ? 'text-rose-300'
      : sigmaOverR >= 0.15 || sigmaOverR <= 0.05
        ? 'text-amber-300'
        : 'text-blue-300'

  const circulationDriftTone =
    Math.abs(circulationDriftPercent) > 5
      ? 'text-rose-300'
      : Math.abs(circulationDriftPercent) > 1
        ? 'text-amber-300'
        : 'text-blue-300'

  return {
    sigmaMonitorTone,
    circulationDriftTone,
    sigmaOverRText: sigmaOverR.toFixed(3),
    totalCirculationText: Number(stabilityStats?.totalCirculation ?? 0).toFixed(4),
    circulationDriftPercentText: circulationDriftPercent.toFixed(2),
    particleCountText: Math.floor(Number(stabilityStats?.particleCount ?? 0)),
    avgSigmaText: Number(stabilityStats?.avgSigma ?? 0).toFixed(4),
    tiltProxyDegText: Number(stabilityStats?.tiltProxyDeg ?? 0).toFixed(2),
    ringCoherenceText: Number(stabilityStats?.ringCoherence ?? 0).toFixed(3),
    ringMajorMeasuredText: Number(stabilityStats?.ringMajorMeasured ?? 0).toFixed(3),
    ringMinorMeasuredText: Number(stabilityStats?.ringMinorMeasured ?? 0).toFixed(3),
    hybridParticleCirculationText: Number(stabilityStats?.hybridParticleCirculation ?? 0).toFixed(4),
    hybridFilamentCirculationText: Number(stabilityStats?.hybridFilamentCirculation ?? 0).toFixed(4),
    hybridTotalCirculationText: Number(stabilityStats?.hybridTotalCirculation ?? 0).toFixed(4),
    hybridCirculationDriftPercentText: Number(stabilityStats?.hybridCirculationDriftPercent ?? 0).toFixed(2),
    hybridParticleCountText: Math.floor(Number(stabilityStats?.hybridParticleCount ?? 0)),
    hybridFilamentCountText: Math.floor(Number(stabilityStats?.hybridFilamentCount ?? 0)),
    hybridCenterOffsetText: Number(stabilityStats?.hybridCenterOffset ?? 0).toFixed(3),
    hybridAxialOffsetText: Number(stabilityStats?.hybridAxialOffset ?? 0).toFixed(3),
    hybridParticleCenterStepText: Number(stabilityStats?.hybridParticleCenterStep ?? 0).toFixed(3),
    hybridFilamentCenterStepText: Number(stabilityStats?.hybridFilamentCenterStep ?? 0).toFixed(3),
    hybridRadiusOffsetText: Number(stabilityStats?.hybridRadiusOffset ?? 0).toFixed(3),
    hybridFilamentRadiusDriftPercentText: Number(stabilityStats?.hybridFilamentRadiusDriftPercent ?? 0).toFixed(2),
    hybridFilamentMeanRadiusText: Number(stabilityStats?.hybridFilamentMeanRadius ?? 0).toFixed(3),
    hybridFilamentArcLengthText: Number(stabilityStats?.hybridFilamentArcLength ?? 0).toFixed(3),
    hybridFilamentArcLengthDriftPercentText: Number(
      stabilityStats?.hybridFilamentArcLengthDriftPercent ?? 0,
    ).toFixed(2),
  }
}
