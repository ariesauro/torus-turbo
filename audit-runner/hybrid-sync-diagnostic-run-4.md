# Hybrid Sync Diagnostic

Generated: 2026-03-18T15:17:04.201Z

Overall gate: PASS
Modes: hybrid, hybrid_plus

## Mode: hybrid

Backend observed: gpu
Gate: PASS

### Metrics

- sampleCount: 80
- gpuStepsDelta: 73
- pendingRatio: 0.762
- hybridParticleSpeed avg: 19.2281
- hybridFilamentSpeed avg: 32.3477
- hybridSpeedRatio avg: 0.5809
- centerStepGap avg: 0.0017
- frozenParticleWhileFilamentMovesCount: 0
- frozenDecoupledStreakMax: 1
- blockedUnsyncedDelta: 583
- unsafeUnsyncedDelta: 0
- thresholds: minGpuStepsDelta=5, maxPendingRatio=0.950, maxCenterGapAvg=0.250, maxFrozenRatio=0.100, maxDecoupledStreak=1, requireBlockedUnsync=yes

### Failed checks

- none

## Mode: hybrid_plus

Backend observed: gpu
Gate: PASS

### Metrics

- sampleCount: 80
- gpuStepsDelta: 198
- pendingRatio: 0.863
- hybridParticleSpeed avg: 24.7493
- hybridFilamentSpeed avg: 6.5131
- hybridSpeedRatio avg: 7.7968
- centerStepGap avg: 0.0124
- frozenParticleWhileFilamentMovesCount: 0
- frozenDecoupledStreakMax: 0
- blockedUnsyncedDelta: 607
- unsafeUnsyncedDelta: 0
- thresholds: minGpuStepsDelta=5, maxPendingRatio=0.950, maxCenterGapAvg=0.250, maxFrozenRatio=0.150, maxDecoupledStreak=1, requireBlockedUnsync=yes

### Failed checks

- none

