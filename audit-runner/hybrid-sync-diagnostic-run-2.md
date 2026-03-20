# Hybrid Sync Diagnostic

Generated: 2026-03-18T15:15:29.559Z

Overall gate: PASS
Modes: hybrid, hybrid_plus

## Mode: hybrid

Backend observed: gpu
Gate: PASS

### Metrics

- sampleCount: 80
- gpuStepsDelta: 108
- pendingRatio: 0.787
- hybridParticleSpeed avg: 18.7445
- hybridFilamentSpeed avg: 32.3475
- hybridSpeedRatio avg: 0.5663
- centerStepGap avg: 0.0009
- frozenParticleWhileFilamentMovesCount: 0
- frozenDecoupledStreakMax: 1
- blockedUnsyncedDelta: 612
- unsafeUnsyncedDelta: 0
- thresholds: minGpuStepsDelta=5, maxPendingRatio=0.950, maxCenterGapAvg=0.250, maxFrozenRatio=0.100, maxDecoupledStreak=1, requireBlockedUnsync=yes

### Failed checks

- none

## Mode: hybrid_plus

Backend observed: gpu
Gate: PASS

### Metrics

- sampleCount: 80
- gpuStepsDelta: 129
- pendingRatio: 0.762
- hybridParticleSpeed avg: 21.5575
- hybridFilamentSpeed avg: 3.8468
- hybridSpeedRatio avg: 7.3555
- centerStepGap avg: 0.0089
- frozenParticleWhileFilamentMovesCount: 7
- frozenDecoupledStreakMax: 1
- blockedUnsyncedDelta: 607
- unsafeUnsyncedDelta: 0
- thresholds: minGpuStepsDelta=5, maxPendingRatio=0.950, maxCenterGapAvg=0.250, maxFrozenRatio=0.150, maxDecoupledStreak=1, requireBlockedUnsync=yes

### Failed checks

- none

