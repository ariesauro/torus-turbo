# Adaptive Baseline Validation Matrix

Input: /Users/auroboros/Code/Torus Turbo/audit-runner/long-run-benchmark-results.json

## Scenario Summary
- adaptive.low: 3/3 pass
- adaptive.mid: 3/3 pass
- adaptive.high: 2/3 pass

## Matrix

| Row | Source | stepP95 | energyDrift | circulationDrift | pathComplexity | low | mid | high |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| GPU:0 | longrun | 68.150 | 95.842 | 0.000 | 0.000 | PASS | PASS | FAIL |
| Hybrid:1 | longrun | 7.000 | 0.000 | 0.000 | 0.000 | PASS | PASS | PASS |
| Hybrid+:2 | longrun | 64.550 | 0.000 | 0.000 | 0.000 | PASS | PASS | PASS |

## Notes
- `PASS` means all four checks passed for the scenario envelope.
- `FAIL` means at least one check exceeded the scenario threshold.