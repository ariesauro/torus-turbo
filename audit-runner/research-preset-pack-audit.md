# Research Preset Pack Audit

Generated: 2026-03-18T05:20:38.901Z

| Preset | Family | Samples | driftAbsMax% | stepP95ms | Gate |
|---|---|---:|---:|---:|---|
| vortex_ring_collision | rings | 25 | 0.000 | 54.95 | PASS |
| vortex_leapfrogging | rings | 25 | 0.000 | 54.90 | PASS |
| jet_instability | jets | 28 | 0.000 | 134.40 | PASS |
| turbulence_cascade | turbulence | 28 | 0.000 | 62.70 | PASS |
| helmholtz_shear | helmholtz | 26 | 0.000 | 134.60 | PASS |
| kelvin_wave_train | kelvin | 26 | 0.000 | 58.20 | PASS |
| reconnection_pair | reconnection | 28 | 0.000 | 62.35 | PASS |

## Failed checks

- none

## Trend
- compared baseline snapshots: none (insufficient history)
- baseline snapshot count: 2
- trend regress gate: PASS
- trend path: /Users/auroboros/Code/Torus Turbo/audit-runner/research-preset-pack-trend.json
- trend policy profile: standard
- trend policy source: policy_file_profile
- trend compare profile: standard
- trend policy path: /Users/auroboros/Code/Torus Turbo/audit-runner/research-preset-pack-trend-policy.v1.json
- trend comparison skipped: insufficient_baseline_snapshots
- fail on insufficient baseline: no

Overall gate: PASS
