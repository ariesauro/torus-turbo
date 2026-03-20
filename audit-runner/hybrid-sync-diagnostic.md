# Hybrid Sync Diagnostic

Generated: 2026-03-18T04:40:03.919Z

Overall gate: PASS
Modes: hybrid, hybrid_plus

## Mode: hybrid

Backend observed: gpu
Gate: PASS

### Metrics

- sampleCount: 80
- gpuStepsDelta: 61
- pendingRatio: 0.762
- hybridParticleSpeed avg: 19.9979
- hybridFilamentSpeed avg: 32.3477
- hybridSpeedRatio avg: 0.6042
- centerStepGap avg: 0.0012
- frozenParticleWhileFilamentMovesCount: 0
- frozenDecoupledStreakMax: 1
- blockedUnsyncedDelta: 588
- unsafeUnsyncedDelta: 0
- thresholds: minGpuStepsDelta=5, maxPendingRatio=0.950, maxCenterGapAvg=0.250, maxFrozenRatio=0.100, maxDecoupledStreak=1, requireBlockedUnsync=yes

### Failed checks

- none

## Mode: hybrid_plus

Backend observed: gpu
Gate: PASS

### Metrics

- sampleCount: 80
- gpuStepsDelta: 131
- pendingRatio: 0.800
- hybridParticleSpeed avg: 39.5291
- hybridFilamentSpeed avg: 4.1830
- hybridSpeedRatio avg: 13.5357
- centerStepGap avg: 0.0097
- frozenParticleWhileFilamentMovesCount: 4
- frozenDecoupledStreakMax: 1
- blockedUnsyncedDelta: 602
- unsafeUnsyncedDelta: 0
- thresholds: minGpuStepsDelta=5, maxPendingRatio=0.950, maxCenterGapAvg=0.250, maxFrozenRatio=0.150, maxDecoupledStreak=1, requireBlockedUnsync=yes

### Failed checks

- none

