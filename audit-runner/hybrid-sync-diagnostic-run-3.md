# Hybrid Sync Diagnostic

Generated: 2026-03-18T15:16:16.684Z

Overall gate: PASS
Modes: hybrid, hybrid_plus

## Mode: hybrid

Backend observed: gpu
Gate: PASS

### Metrics

- sampleCount: 80
- gpuStepsDelta: 82
- pendingRatio: 0.762
- hybridParticleSpeed avg: 23.6851
- hybridFilamentSpeed avg: 32.3477
- hybridSpeedRatio avg: 0.7156
- centerStepGap avg: 0.0048
- frozenParticleWhileFilamentMovesCount: 0
- frozenDecoupledStreakMax: 1
- blockedUnsyncedDelta: 604
- unsafeUnsyncedDelta: 0
- thresholds: minGpuStepsDelta=5, maxPendingRatio=0.950, maxCenterGapAvg=0.250, maxFrozenRatio=0.100, maxDecoupledStreak=1, requireBlockedUnsync=yes

### Failed checks

- none

## Mode: hybrid_plus

Backend observed: gpu
Gate: PASS

### Metrics

- sampleCount: 80
- gpuStepsDelta: 144
- pendingRatio: 0.775
- hybridParticleSpeed avg: 39.7574
- hybridFilamentSpeed avg: 3.9439
- hybridSpeedRatio avg: 13.6125
- centerStepGap avg: 0.0116
- frozenParticleWhileFilamentMovesCount: 7
- frozenDecoupledStreakMax: 1
- blockedUnsyncedDelta: 618
- unsafeUnsyncedDelta: 0
- thresholds: minGpuStepsDelta=5, maxPendingRatio=0.950, maxCenterGapAvg=0.250, maxFrozenRatio=0.150, maxDecoupledStreak=1, requireBlockedUnsync=yes

### Failed checks

- none

