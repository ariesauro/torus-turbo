# Simulation Lab Mode (TT-033)

Цель: превратить runtime в воспроизводимую экспериментальную платформу, а не только интерактивный визуализатор.

## 1. Scope и научные требования

- Поддерживаемые исследовательские сценарии:
  - vortex ring collision,
  - leapfrogging,
  - reconnection-driven topology changes,
  - jet instability / cascade windows.
- Каждое исследование должно быть воспроизводимо при одинаковом:
  - `seed`,
  - simulation profile,
  - backend policy,
  - config hash.

## 2. Experiment Contract

`Experiment` задается как сериализуемый объект:

- `id`, `title`, `hypothesis`,
- `initialConditions` (mode, representation, preset patch, seed),
- `sweep` (one-factor или multi-factor grid/latin hypercube),
- `metrics` (what + sampling cadence + aggregation),
- `acceptanceChecks` (numerical and physical guards),
- `runBudget` (maxRuns, maxWallClockSec, maxRetries),
- `artifacts` policy (raw, summary, plots, recordings).

Обязательное поле: `schemaVersion`.

## 3. Parameter Sweep (strict)

- Разрешены только физически интерпретируемые параметры с указанными bounds.
- Sweep должен явно указывать тип:
  - `linspace`,
  - `logspace`,
  - `categorical`,
  - `lhs` (latin hypercube).
- Для каждого sweep измерения:
  - `name`,
  - `units` (или nondimensional),
  - `range`,
  - `samplingDensity`.

Минимальный набор V1:
- `particleCount` (numerical resolution),
- `circulationStrength`,
- `kinematicViscosity`,
- `coreRadius`,
- `ringMajorRadius`.

## 4. Batch Runner

- Batch execution через очередь с бюджетами:
  - `maxConcurrentRuns`,
  - `maxWallClockSec`,
  - `maxGpuMemoryMb` (soft guard),
  - `maxCpuLoad` (soft guard).
- Retry policy:
  - только для transient startup/health failures,
  - лимит `N` retries,
  - лог причины каждого retry.
- Non-blocking режим для UI + CLI-compatible режим для автоматизации.

## 5. Metrics и статистика

Raw metrics (time-series):
- `energyProxy`,
- `enstrophyProxy`,
- `totalCirculation`,
- detector-confidence-weighted vortex counts by class,
- structure lifetimes and transitions.

Aggregated metrics:
- median/p95/p99,
- drift over reference window,
- confidence intervals (bootstrap или repeated runs),
- run-to-run variance.

Нельзя использовать "vortex count" без confidence/uncertainty.

## 6. Artifact Storage

Обязательные форматы:
- `JSON` (full run metadata + summaries),
- `CSV` (flat tabular export).

Обязательные метаданные reproducibility:
- app version / git sha,
- config hash,
- hardware profile,
- backend mode and sync policy,
- timestamp and timezone.

Рекомендуемые артефакты:
- plots metadata spec,
- optional recordings index (video path + config hash).

## 7. Visualization и Lab Panel

Lab UI (separate panel):
- experiment editor (contract form),
- JSON/schema editor with explicit validation errors before run,
- queue status and progress,
- live metrics plots (`energy vs time`, `vortex count vs time`, drift plots),
- run explorer (filters, compare two runs, history drill-down by run-id/config-hash),
- export actions (CSV/JSON/plot PNG).

UI не должен влиять на physics step; вся аналитика - read-only.

## 8. Presets (scientific)

V1 presets:
- vortex ring collision,
- vortex leapfrogging,
- jet instability window,
- turbulence cascade window.
- helmholtz shear growth,
- kelvin wave train,
- reconnection pair stability.

Каждый preset обязан включать:
- гипотезу,
- expected regime,
- acceptance checks,
- known limitations.

Исполнимый runbook для research preset pack и artifact naming contract: `docs/RESEARCH_EXECUTABLE_RUNBOOK.md` (`TT-038`).
Mini acceptance-аудит preset pack (`TT-039`): `docs/RESEARCH_PRESET_PACK_AUDIT.md`.

## 9. Automation Policy

Auto-run после старта приложения:
- только opt-in (`labAutoRun=true` или CLI flag),
- никогда не включается по умолчанию для обычного пользователя,
- обязательно показывает budget estimate до запуска.

## 10. Acceptance Criteria (TT-033)

- Deterministic replay tolerance:
  - drift variance <= agreed threshold for repeated seed runs.
- Batch robustness:
  - >= 95% runs finish without manual intervention.
- Artifact completeness:
  - 100% runs include reproducibility metadata.
- Zero physics coupling:
  - lab layer не изменяет runtime physics semantics.
