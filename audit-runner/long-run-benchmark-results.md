# Long-run stability benchmark suite

Generated: 2026-03-17T23:24:23.818Z

## Main metrics

| Mode | N actual | Step median/p95 (ms) | Throughput med (pps) | Energy drift % | Enstrophy drift % | Sync Δ (viol/full/skip) | Newtonium transitions | Auto-corr /1k steps | Policy override (f/t/i) | Drift severity p95 | Stability |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| GPU | 30000 | 6.63/68.15 | 4528366 | 95.8 | 1600.9 | 0/222/0 | 0 | 62.36 | 0/0/100 | 0.000 | FAIL |
| Hybrid | 30000 | 6.50/7.00 | 4615385 | 0.0 | 0.0 | 0/599/993 | 0 | 24.08 | 2/0/60 | 0.857 | PASS |
| Hybrid+ | 30000 | 6.45/64.55 | 4651163 | 0.0 | 0.0 | 0/830/2075 | 0 | 21.28 | 0/0/58 | 0.857 | WARN |

## Recommendations

| Mode | Stability | Recommendation |
|---|---|---|
| GPU | FAIL | tune sync cadence and avoid strict full readback every frame |
| Hybrid | PASS | baseline is stable; use this mode as reference for regressions |
| Hybrid+ | WARN | reduce expensive operators and decrease filament workload in this mode |

## Baseline Gates

| Mode | Gate | Failed checks |
|---|---|---|
| GPU | PASS | - |
| Hybrid | PASS | - |
| Hybrid+ | PASS | - |

## Policy Gate Verdict

| Mode | Verdict | Failed policy checks | Note |
|---|---|---|---|
| GPU | PASS | - | policy checks pass |
| Hybrid | PASS | - | policy checks pass |
| Hybrid+ | PASS | - | policy checks pass |

## Policy Gates

| Mode | Policy gate | Value | Limit | Pass |
|---|---|---:|---:|---|
| GPU | driftSeverityP95RegressPct | 0.000 | 35.000 | PASS |
| GPU | driftSeverityP95AbsMax | 0.000 | 0.850 | PASS |
| GPU | overrideFallbackStormCountMax | 0.000 | 6.000 | PASS |
| GPU | overrideTimeoutBurstCountMax | 0.000 | 4.000 | PASS |
| GPU | overrideInvariantGuardCountMax | 100.000 | 101.000 | PASS |
| Hybrid | driftSeverityP95RegressPct | 0.000 | 35.000 | PASS |
| Hybrid | driftSeverityP95AbsMax | 0.857 | 0.960 | PASS |
| Hybrid | overrideFallbackStormCountMax | 2.000 | 12.000 | PASS |
| Hybrid | overrideTimeoutBurstCountMax | 0.000 | 4.000 | PASS |
| Hybrid | overrideInvariantGuardCountMax | 60.000 | 63.000 | PASS |
| Hybrid+ | driftSeverityP95RegressPct | 0.000 | 30.000 | PASS |
| Hybrid+ | driftSeverityP95AbsMax | 0.857 | 1.000 | PASS |
| Hybrid+ | overrideFallbackStormCountMax | 0.000 | 5.000 | PASS |
| Hybrid+ | overrideTimeoutBurstCountMax | 0.000 | 3.000 | PASS |
| Hybrid+ | overrideInvariantGuardCountMax | 58.000 | 82.000 | PASS |

## Threshold Retuning Hints (TT-017D)

| Mode | Check | Value | Current limit | Suggested limit | Reason |
|---|---|---:|---:|---:|---|
| - | - | - | - | - | no retuning needed |

Suggested patch paths: `thresholdsByModeProfiles.standard.*`, `thresholdsByHardwareClassProfiles.standard.mid`, `thresholdsByModeHardwareClassProfiles.standard.mid.*` (headroom: 12%).
Patch template is emitted into `thresholdRetuningHints.baselinePatchTemplate` (JSON artifact).

## Retuning Auto-Apply

enabled=false, applied=false, hints=0, reason=disabled
