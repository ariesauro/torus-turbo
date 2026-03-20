# Hybrid Sync Diagnostic

Generated: 2026-03-18T15:14:42.734Z

Overall gate: PASS
Modes: hybrid, hybrid_plus

## Mode: hybrid

Backend observed: gpu
Gate: PASS

### Metrics

- sampleCount: 80
- gpuStepsDelta: 105
- pendingRatio: 0.800
- hybridParticleSpeed avg: 18.8918
- hybridFilamentSpeed avg: 32.3477
- hybridSpeedRatio avg: 0.5707
- centerStepGap avg: 0.0013
- frozenParticleWhileFilamentMovesCount: 0
- frozenDecoupledStreakMax: 1
- blockedUnsyncedDelta: 610
- unsafeUnsyncedDelta: 0
- thresholds: minGpuStepsDelta=5, maxPendingRatio=0.950, maxCenterGapAvg=0.250, maxFrozenRatio=0.100, maxDecoupledStreak=1, requireBlockedUnsync=yes

### Failed checks

- none

## Mode: hybrid_plus

Backend observed: gpu
Gate: PASS

### Metrics

- sampleCount: 80
- gpuStepsDelta: 128
- pendingRatio: 0.775
- hybridParticleSpeed avg: 35.4814
- hybridFilamentSpeed avg: 3.9623
- hybridSpeedRatio avg: 12.1282
- centerStepGap avg: 0.0096
- frozenParticleWhileFilamentMovesCount: 6
- frozenDecoupledStreakMax: 1
- blockedUnsyncedDelta: 593
- unsafeUnsyncedDelta: 0
- thresholds: minGpuStepsDelta=5, maxPendingRatio=0.950, maxCenterGapAvg=0.250, maxFrozenRatio=0.150, maxDecoupledStreak=1, requireBlockedUnsync=yes

### Failed checks

- none

