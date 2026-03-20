# HYBRID_SYNC_DIAGNOSTIC

`TT-048` runtime invariant diagnostic for filament/particle synchronization in `hybrid` and `hybrid_plus`.

## Purpose

Detect and prevent runtime states where filaments advance while particle CPU snapshot is stale (GPU dispatch not synchronized yet).

## Commands

- Local run:
  - `cd audit-runner`
  - `npm run benchmark:hybrid:syncdiag`
- Strict CI run:
  - `npm run benchmark:hybrid:syncdiag:ci`
- Soak CI run:
  - `npm run benchmark:hybrid:syncdiag:soak:ci`
- Soak trend CI run:
  - `npm run benchmark:hybrid:syncdiag:soak:trend:ci`

## Environment Variables

- `HYBRID_SYNC_DIAG_DURATION_SEC` (default `16`)
- `HYBRID_SYNC_DIAG_SAMPLE_EVERY_MS` (default `200`)
- `HYBRID_SYNC_DIAG_MODES` (default `hybrid,hybrid_plus`)
- `HYBRID_SYNC_DIAG_MIN_GPU_STEPS_DELTA` (default `5`)
- `HYBRID_SYNC_DIAG_MAX_PENDING_RATIO` (default `0.95`)
- `HYBRID_SYNC_DIAG_MAX_CENTER_GAP_AVG` (default `0.25`)
- `HYBRID_SYNC_DIAG_MAX_FROZEN_RATIO` (default `0.2`)
- `HYBRID_SYNC_DIAG_MAX_FROZEN_RATIO_HYBRID_PLUS` (default inherits `HYBRID_SYNC_DIAG_MAX_FROZEN_RATIO`)
- `HYBRID_SYNC_DIAG_MAX_DECOUPLED_STREAK` (default `2`)
- `HYBRID_SYNC_DIAG_REQUIRE_BLOCKED_UNSYNC` (default `false`)
- `HYBRID_SYNC_SOAK_REPEAT` (default `4`)
- `HYBRID_SYNC_SOAK_STRICT` (default `true`)
- `HYBRID_SYNC_SOAK_TREND_PATH` (default `./hybrid-sync-soak-trend.json`)
- `HYBRID_SYNC_SOAK_TREND_MAX` (default `120`)
- `HYBRID_SYNC_SOAK_FAIL_ON_TREND_REGRESS` (default `false`)
- `HYBRID_SYNC_SOAK_HYBRID_PLUS_FROZEN_P95_REGRESS_ABS_MAX` (default `2`)
- `PLAYWRIGHT_HEADLESS`, `PLAYWRIGHT_BROWSER_CHANNEL`
- `TORUS_BASE_URL`

## Gate Checks

- `gpu_steps_progress`
- `particle_filament_motion_not_decoupled`
- `no_long_decoupled_streak`
- `no_unsafe_unsynced_filament_steps`
- `blocked_unsynced_observed` (optional strict mode)
- `center_gap_bounded`
- `pending_ratio_reasonable`

## Artifacts

- `audit-runner/hybrid-sync-diagnostic.json`
- `audit-runner/hybrid-sync-diagnostic.md`
- `audit-runner/hybrid-sync-soak-audit.json`
- `audit-runner/hybrid-sync-soak-audit.md`
- `audit-runner/hybrid-sync-soak-trend.json`

## Runtime Counters

Diagnostic reads runtime counters exported by simulation runtime:

- `runtimeHybridFilamentStepBlockedUnsyncedCount`
- `runtimeHybridFilamentStepUnsafeUnsyncedCount`

Invariant target for strict mode: `unsafe` delta must remain `0`.

## Soak Policy (`TT-049`)

- `benchmark:hybrid:syncdiag:soak:ci` runs repeated strict diagnostics and fails on any run-level gate failure.
- Soak strict mode is tuned with mode-aware frozen-ratio thresholds:
  - baseline strict ratio: `HYBRID_SYNC_DIAG_MAX_FROZEN_RATIO=0.1`
  - `hybrid_plus` override: `HYBRID_SYNC_DIAG_MAX_FROZEN_RATIO_HYBRID_PLUS=0.15`
- Rationale: retain zero-tolerance on unsafe unsynced steps, while accounting for stable hybrid-plus micro-stall behavior without masking real decoupling regressions.

## Soak Trend Policy (`TT-051`)

- Soak audit stores rolling snapshots in `hybrid-sync-soak-trend.json`.
- Compare baseline uses previous successful snapshot with the same `strict/repeat` profile.
- Trend regress flags:
  - `fail_run_count_regress`
  - `unsafe_unsynced_total_regress`
  - `hybrid_plus_frozen_p95_regress` (abs threshold via env)
- `benchmark:hybrid:syncdiag:soak:trend:ci` fails on trend regressions.
