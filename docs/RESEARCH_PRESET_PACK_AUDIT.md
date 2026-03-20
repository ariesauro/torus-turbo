# RESEARCH_PRESET_PACK_AUDIT

`TT-039` mini acceptance suite for `TT-038` executable research runbook.

## Purpose

Validate that the research preset pack (`7` presets) can run end-to-end in automation and produce reproducible audit artifacts (`JSON/MD`) with gate verdicts.

## Commands

- Local run:
  - `cd audit-runner`
  - `npm run benchmark:research:presetpack`
- CI fail mode:
  - `npm run benchmark:research:presetpack:ci`
- CI fail mode with trend regress gate:
  - `npm run benchmark:research:presetpack:trend:ci`
- Smoke profile runs:
  - `npm run benchmark:research:presetpack:smoke`
  - `npm run benchmark:research:presetpack:trend:smoke:ci`
- Nightly profile runs:
  - `npm run benchmark:research:presetpack:nightly`
  - `npm run benchmark:research:presetpack:trend:nightly:ci`
  - `npm run benchmark:research:presetpack:trend:nightly:strict-baseline:ci`
- Policy integrity bridge (`TT-053`):
  - `npm run benchmark:research:presetpack:policy:integrity`
  - `npm run benchmark:research:presetpack:policy:integrity:ci`
- Policy template generator (`TT-055`):
  - `npm run benchmark:research:presetpack:policy:template`
- Policy drift gate (`TT-056`):
  - `npm run benchmark:research:presetpack:policy:drift`
  - `npm run benchmark:research:presetpack:policy:drift:ci`
  - `npm run benchmark:research:presetpack:policy:drift:smoke:ci`
  - `npm run benchmark:research:presetpack:policy:drift:nightly:strict:ci`

## Environment Variables

- `RESEARCH_PRESET_AUDIT_DURATION_SCALE` (default `1`, safe range `0.1..2`)
  - Short smoke: `RESEARCH_PRESET_AUDIT_DURATION_SCALE=0.25`
- `RESEARCH_PRESET_AUDIT_CASE_TIMEOUT_SEC` (default adaptive watchdog)
- `RESEARCH_PRESET_AUDIT_FAIL_ON_GATE` (`true/false`)
- `RESEARCH_PRESET_AUDIT_TREND_PATH` (default `./research-preset-pack-trend.json`)
- `RESEARCH_PRESET_AUDIT_TREND_MAX` (default `120`)
- `RESEARCH_PRESET_AUDIT_CASE_POLICY_PATH` (default `./research-preset-pack-case-policy.v1.json`)
- `RESEARCH_PRESET_AUDIT_CASE_POLICY_PROFILE` (`smoke/standard/nightly`, default: `RESEARCH_PRESET_AUDIT_TREND_POLICY_PROFILE` или policy `defaultProfile`)
- `RESEARCH_PRESET_AUDIT_TREND_POLICY_PATH` (default `./research-preset-pack-trend-policy.v1.json`)
- `RESEARCH_PRESET_AUDIT_TREND_POLICY_PROFILE` (`smoke/standard/nightly`, default из policy `defaultProfile`)
- `RESEARCH_PRESET_AUDIT_STEP_P95_REGRESS_MAX_PCT` (default `120`)
- `RESEARCH_PRESET_AUDIT_STEP_P95_REGRESS_BASELINE_FLOOR` (default `30`)
- `RESEARCH_PRESET_AUDIT_STEP_P95_REGRESS_ABS_MS` (default `40`)
- `RESEARCH_PRESET_AUDIT_SAMPLE_DROP_MAX_PCT` (default `40`)
- `RESEARCH_PRESET_AUDIT_TREND_BASELINE_WINDOW` (default `6`)
- `RESEARCH_PRESET_AUDIT_TREND_MIN_BASELINE_POINTS` (default `3`)
- `RESEARCH_PRESET_AUDIT_FAIL_ON_TREND_REGRESS` (`true/false`)
- `RESEARCH_PRESET_AUDIT_FAIL_ON_INSUFFICIENT_BASELINE` (`true/false`, default `false`)
- `RESEARCH_PRESET_POLICY_INTEGRITY_CASE_POLICY_PATH` (default `./research-preset-pack-case-policy.v1.json`)
- `RESEARCH_PRESET_POLICY_INTEGRITY_TREND_POLICY_PATH` (default `./research-preset-pack-trend-policy.v1.json`)
- `RESEARCH_PRESET_POLICY_INTEGRITY_AUDIT_JSON_PATH` (default `./research-preset-pack-audit.json`)
- `RESEARCH_PRESET_POLICY_INTEGRITY_REQUIRE_ARTIFACT_META` (`true/false`)
- `RESEARCH_PRESET_POLICY_INTEGRITY_FAIL_ON_GATE` (`true/false`)
- `RESEARCH_PRESET_POLICY_TEMPLATE_TREND_PATH` (default `./research-preset-pack-trend.json`)
- `RESEARCH_PRESET_POLICY_TEMPLATE_AUDIT_JSON_PATH` (default `./research-preset-pack-audit.json`)
- `RESEARCH_PRESET_POLICY_TEMPLATE_CASE_POLICY_PATH` (default `./research-preset-pack-case-policy.v1.json`)
- `RESEARCH_PRESET_POLICY_TEMPLATE_OUTPUT_PATH` (default `./research-preset-policy-template.suggested.v1.json`)
- `RESEARCH_PRESET_POLICY_DRIFT_CASE_POLICY_PATH` (default `./research-preset-pack-case-policy.v1.json`)
- `RESEARCH_PRESET_POLICY_DRIFT_TEMPLATE_PATH` (default `./research-preset-policy-template.suggested.v1.json`)
- `RESEARCH_PRESET_POLICY_DRIFT_ENVELOPE_POLICY_PATH` (default `./research-preset-policy-drift-envelope.v1.json`)
- `RESEARCH_PRESET_POLICY_DRIFT_PROFILE` (optional profile filter: `smoke/standard/nightly`)
- `RESEARCH_PRESET_POLICY_DRIFT_STAGE` (staged strictness: `lenient/default/strict`)
- `RESEARCH_PRESET_POLICY_DRIFT_OUTPUT_JSON` (default `./research-preset-policy-drift-audit.json`)
- `RESEARCH_PRESET_POLICY_DRIFT_OUTPUT_MD` (default `./research-preset-policy-drift-audit.md`)
- `RESEARCH_PRESET_POLICY_DRIFT_FAIL_ON_GATE` (`true/false`)
- `TORUS_BASE_URL` (default `http://localhost:5173/`)
- `PLAYWRIGHT_HEADLESS`, `PLAYWRIGHT_BROWSER_CHANNEL`

## Preset Matrix

- `vortex_ring_collision` (`rings`)
- `vortex_leapfrogging` (`rings`)
- `jet_instability` (`jets`)
- `turbulence_cascade` (`turbulence`)
- `helmholtz_shear` (`helmholtz`)
- `kelvin_wave_train` (`kelvin`)
- `reconnection_pair` (`reconnection`)

## Artifacts

- `audit-runner/research-preset-pack-audit.json`
- `audit-runner/research-preset-pack-audit.md`
- `audit-runner/research-preset-pack-trend.json`
- `audit-runner/research-preset-policy-integrity-audit.json`
- `audit-runner/research-preset-policy-integrity-audit.md`
- `audit-runner/research-preset-policy-template.suggested.v1.json`
- `audit-runner/research-preset-policy-drift-audit.json`
- `audit-runner/research-preset-policy-drift-audit.md`
- `audit-runner/research-preset-policy-drift-envelope.v1.json`

## Gates

Per-preset checks:

- `case_completed`
- `samples_present`
- `drift_within_limit` (`circulationDriftAbsMaxPct`)
- `step_p95_within_limit` (`runtimeGpuStepMs` p95 envelope)
- `no_unsafe_unsynced_filament_steps` (`runtimeHybridFilamentStepUnsafeUnsyncedCount` delta must be `0`)

Overall verdict fails if any preset fails in CI mode.

Runtime sync bridge (`TT-050`):

- report/table now includes per-case `unsafeUnsyncedDelta` (and internal blocked delta wiring),
- expected invariant for all presets: `unsafeUnsyncedDelta = 0`.

Trend mode:

- trend compares against a recent window of successful snapshots with the same `durationScale` and policy profile (`smoke/standard/nightly`) (default window: `6`),
- per-preset baseline uses median/p90 anchors from this window (requires minimum baseline points),
- regress flags are emitted per preset for `stepP95` and `sampleCount` drops,
- `stepP95` regress is raised only when both relative and absolute overflow are exceeded,
- strict trend CI can fail on regressions when `RESEARCH_PRESET_AUDIT_FAIL_ON_TREND_REGRESS=true`.
- strict trend CI can also fail on missing baseline history when `RESEARCH_PRESET_AUDIT_FAIL_ON_INSUFFICIENT_BASELINE=true`.

## Trend Calibration (`TT-043`)

- Цель: уменьшить ложные regress-flags в strict trend CI при высокой межзапусковой вариативности отдельных preset-кейсов.
- Политика baseline: последние успешные same-scale snapshots, а не одиночный предыдущий snapshot.
- Политика regress:
  - `step_p95_regress`: только при одновременном превышении `%`-порога и `abs-ms`-порога над baseline p90.
  - `sample_count_drop`: по drop% относительно baseline median sample count.
- Верификация: `RESEARCH_PRESET_AUDIT_DURATION_SCALE=0.25 npm run benchmark:research:presetpack:trend:ci` -> `PASS`.

## Versioned Trend Policy (`TT-044`)

- Пороги trend-gate вынесены в versioned policy contract: `audit-runner/research-preset-pack-trend-policy.v1.json`.
- Профили:
  - `smoke` — более мягкие допуски для коротких CI прогонов,
  - `standard` — базовый профиль,
  - `nightly` — более строгие пороги и расширенное baseline window.
- Resolver precedence в `researchPresetPackAudit.mjs`:
  - `env overrides` -> `policy profile` -> встроенные defaults.
- Baseline segmentation:
  - compare идет только в рамках совпадающих `durationScale + trendPolicyProfile`, чтобы smoke/nightly истории не смешивались.
- Baseline sufficiency strict mode (`TT-046`):
  - при `RESEARCH_PRESET_AUDIT_FAIL_ON_INSUFFICIENT_BASELINE=true` audit падает, если baseline history для выбранного профиля еще недостаточна.
  - рабочий строгий nightly pipeline: `benchmark:research:presetpack:trend:nightly:strict-baseline:ci`.
- Проверка профилей strict trend CI:
  - `npm run benchmark:research:presetpack:trend:smoke:ci` -> `PASS`
  - `npm run benchmark:research:presetpack:trend:nightly:ci` -> `PASS`
- Stability note:
  - `helmholtz_shear` `step_p95_within_limit` калиброван до `170ms` для снижения smoke CI флейков.
  - `reconnection_pair` `step_p95_within_limit` калиброван до `170ms` для снижения редких вариативных выбросов в smoke CI.

## Versioned Case Gate Policy (`TT-052`)

- Пороги case-gate (`drift_within_limit`, `step_p95_within_limit`) вынесены в versioned policy contract:
  - `audit-runner/research-preset-pack-case-policy.v1.json`.
- Профили:
  - `smoke` — более мягкие допуски,
  - `standard` — базовый профиль,
  - `nightly` — более строгие допуски.
- Resolver precedence в `researchPresetPackAudit.mjs`:
  - case policy profile: `RESEARCH_PRESET_AUDIT_CASE_POLICY_PROFILE` -> `RESEARCH_PRESET_AUDIT_TREND_POLICY_PROFILE` -> policy `defaultProfile`,
  - case thresholds: `policy perPreset/defaults` -> встроенный fallback.
- В audit artifacts (`JSON/MD`) публикуются `case policy profile/source/path`, чтобы сравнение прогонов было воспроизводимым.

## Policy Integrity Bridge (`TT-053`)

- Добавлен независимый integrity-аудит policy-стека:
  - `audit-runner/researchPresetPolicyIntegrityAudit.mjs`.
- Проверяет:
  - наличие/схемы `case/trend` policy файлов,
  - согласованность profile set (`smoke/standard/nightly`) между policy contracts,
  - полноту `perPreset` coverage в case policy,
  - наличие и согласованность policy meta в `research-preset-pack-audit.json`,
  - полноту `casePolicy.thresholdsByPreset` в artifact.
- В CI режиме (`benchmark:research:presetpack:policy:integrity:ci`) включены:
  - `RESEARCH_PRESET_POLICY_INTEGRITY_REQUIRE_ARTIFACT_META=true`,
  - `RESEARCH_PRESET_POLICY_INTEGRITY_FAIL_ON_GATE=true`.

## Policy Template Generator (`TT-055`)

- Добавлен CLI генератор шаблонов порогов policy:
  - `audit-runner/researchPresetPolicyTemplateGenerator.mjs`.
- На входе использует:
  - `research-preset-pack-trend.json` (история успешных snapshots),
  - `research-preset-pack-audit.json` (последние drift наблюдения),
  - `research-preset-pack-case-policy.v1.json` (база профилей и fallback).
- На выходе формирует:
  - `research-preset-policy-template.suggested.v1.json` с предложенными per-profile/per-preset thresholds и source metadata.
- Результат предназначен для review/retuning и не применяется автоматически в production policy.

## Policy Drift Gate (`TT-056`)

- Добавлен drift-аудит policy envelope:
  - `audit-runner/researchPresetPolicyDriftAudit.mjs`.
- Сравнивает текущий `case policy` с `suggested template`:
  - `circulationDriftAbsMaxPct` delta,
  - `stepP95MsMax` delta.
- В CI режиме:
  - сначала генерируется свежий template (`policy:template`),
  - затем включается fail-gate (`RESEARCH_PRESET_POLICY_DRIFT_FAIL_ON_GATE=true`).
- Цель: раннее обнаружение чрезмерного дрейфа policy threshold-ов относительно исторического envelope.

## Drift Adaptive Envelope (`TT-057`)

- Drift gate переведен на versioned envelope policy:
  - `audit-runner/research-preset-policy-drift-envelope.v1.json`.
- Добавлены profile-aware и staged thresholds:
  - profiles: `smoke/standard/nightly`,
  - stages: `lenient/default/strict`.
- Drift audit теперь публикует active envelope meta (`profile/stage/source/path`) в artifacts.
- Staged CI примеры:
  - smoke default strictness: `benchmark:research:presetpack:policy:drift:smoke:ci`,
  - nightly strict strictness: `benchmark:research:presetpack:policy:drift:nightly:strict:ci`.

## Baseline Verdict (`TT-040`)

Full-duration baseline recheck completed:

- command: `RESEARCH_PRESET_AUDIT_DURATION_SCALE=1 npm run benchmark:research:presetpack:ci`
- verdict: `PASS` for all `7` presets
- sample coverage (latest run): `25, 25, 28, 28, 26, 26, 28` across preset matrix order.

## Aggregate Report (`TT-041`)

- Comparative smoke/full baseline report: `docs/RESEARCH_PRESET_PACK_BASELINE_REPORT.md`.
