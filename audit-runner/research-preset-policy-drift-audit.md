# Research Preset Policy Drift Audit

Generated: 2026-03-18T18:41:51.913Z

- envelope profile: smoke
- envelope stage: default
- envelope source: policy_file_stage
- envelope thresholds: driftΔ<=15%, stepΔ<=25ms
- envelope policy path: /Users/auroboros/Code/Torus Turbo/audit-runner/research-preset-policy-drift-envelope.v1.json

| Check | Result |
|---|---|
| case_policy_exists | PASS |
| template_exists | PASS |
| envelope_policy_exists_or_default | PASS |
| envelope_profile_known | PASS |
| envelope_stage_known | PASS |
| profile_sets_match | PASS |
| all_rows_within_envelope | PASS |

## Drift Rows

| Profile | Preset | DriftΔ% | StepΔms | Gate |
|---|---|---:|---:|---|
| smoke | vortex_ring_collision | 0.000 | 0.000 | PASS |
| smoke | vortex_leapfrogging | 0.000 | 0.000 | PASS |
| smoke | jet_instability | 0.000 | 0.000 | PASS |
| smoke | turbulence_cascade | 0.000 | 20.000 | PASS |
| smoke | helmholtz_shear | 0.000 | 0.000 | PASS |
| smoke | kelvin_wave_train | 0.000 | 0.000 | PASS |
| smoke | reconnection_pair | 0.000 | 0.000 | PASS |

Overall gate: PASS
