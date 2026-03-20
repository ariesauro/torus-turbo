# RESEARCH_PRESET_PACK_BASELINE_REPORT

Последнее обновление: 2026-03-18

`TT-041`: aggregate baseline report для `research preset pack` (`smoke` vs `full-duration`).

## Inputs

- Smoke CI:
  - `RESEARCH_PRESET_AUDIT_DURATION_SCALE=0.25`
  - artifacts:
    - `audit-runner/research-preset-pack-audit-smoke.json`
    - `audit-runner/research-preset-pack-audit-smoke.md`
- Full-duration CI:
  - `RESEARCH_PRESET_AUDIT_DURATION_SCALE=1`
  - artifacts:
    - `audit-runner/research-preset-pack-audit-full.json`
    - `audit-runner/research-preset-pack-audit-full.md`

## Comparative Table

| Preset | Smoke samples | Full samples | Delta samples | Smoke stepP95 | Full stepP95 | Delta stepP95 | Gate |
|---|---:|---:|---:|---:|---:|---:|---|
| `vortex_ring_collision` | 9 | 25 | +16 | 70.40 | 77.30 | +6.90 | PASS |
| `vortex_leapfrogging` | 9 | 25 | +16 | 58.25 | 61.95 | +3.70 | PASS |
| `jet_instability` | 9 | 28 | +19 | 74.30 | 77.15 | +2.85 | PASS |
| `turbulence_cascade` | 8 | 28 | +20 | 57.70 | 56.80 | -0.90 | PASS |
| `helmholtz_shear` | 10 | 26 | +16 | 128.30 | 7.10 | -121.20 | PASS |
| `kelvin_wave_train` | 10 | 26 | +16 | 58.20 | 57.30 | -0.90 | PASS |
| `reconnection_pair` | 9 | 28 | +19 | 57.10 | 125.80 | +68.70 | PASS |

## Verdict

- Gate verdict: `PASS` for all presets in both smoke and full-duration suites.
- Sample coverage scales as expected (`smoke -> full` increase for every preset).
- `stepP95` variability remains noticeable on select presets (`helmholtz_shear`, `reconnection_pair`) while staying inside configured envelopes.

## Reproducibility Notes

- Current threshold envelopes are sufficient for CI stability and regression guarding.
- Because of occasional step-latency swings between runs, trend interpretation should prioritize multi-run aggregates rather than single-run absolute comparisons.
- Rolling trend snapshots are stored in `audit-runner/research-preset-pack-trend.json` and use same-scale (`durationScale`) comparison.
