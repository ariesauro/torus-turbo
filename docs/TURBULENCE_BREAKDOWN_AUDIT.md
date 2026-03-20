# Turbulence Breakdown Audit

`audit-runner/turbulenceBreakdownAudit.mjs` validates turbulence stability envelopes for
`guidedPhysics` in a reproducible matrix:

- backends: `cpu`, `gpu`
- scenarios: `single_pulse`, `pulse_train`, `long_run`
- representation: `particles`

## Commands

- `npm run benchmark:turbulence:breakdown`
- `npm run benchmark:turbulence:breakdown:ci`

For faster local smoke checks:

- `TURBULENCE_BREAKDOWN_DURATION_SCALE=0.25 npm run benchmark:turbulence:breakdown`
- `TURBULENCE_BREAKDOWN_CASE_TIMEOUT_SEC=180` overrides per-case watchdog timeout (default: adaptive, `max(60s, duration x multiplier)`).
- `TURBULENCE_BREAKDOWN_CASE_TIMEOUT_MULTIPLIER_CPU=5` and `TURBULENCE_BREAKDOWN_CASE_TIMEOUT_MULTIPLIER_GPU=2` tune adaptive watchdog window when `TURBULENCE_BREAKDOWN_CASE_TIMEOUT_SEC` is not set.
- `TURBULENCE_BREAKDOWN_CPU_TRAIN_DURATION_SCALE=0.25` applies an extra duration scale for CPU `train` scenarios to keep CI reproducible under browser/main-thread pressure.
- CPU `train` scenarios use a lower effective `particleCount` than GPU to avoid browser-thread stalls and preserve reproducible sampling windows.

## Artifacts

- JSON: `audit-runner/turbulence-breakdown-audit.json`
- Markdown: `audit-runner/turbulence-breakdown-audit.md`

## Gate checks

Per backend/scenario row:

- `metrics_present`
- `drift_within_limit` (`circulationDriftAbsMaxPct`)
- `sigma_min_ok` / `sigma_max_ok` (`sigmaOverR` envelope, optional: check is auto-skipped when metric is unavailable in runtime params)
- `gpu_dispatch_not_stuck` (for GPU rows)

Thresholds:

- `single_pulse`: `|drift| <= 7%`, `0.03 <= sigmaOverR <= 0.35`
- `pulse_train`: `|drift| <= 12%`, `0.03 <= sigmaOverR <= 0.40`
- `long_run`: `|drift| <= 18%`, `0.02 <= sigmaOverR <= 0.45`

CI mode (`TURBULENCE_BREAKDOWN_FAIL_ON_GATE=true`) fails the process if any row gate fails.
