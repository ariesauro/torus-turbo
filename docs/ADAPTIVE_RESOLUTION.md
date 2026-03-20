# Adaptive Resolution System (TT-035)

Цель: динамически перераспределять вычислительный бюджет с контролем численной ошибки и стабильности.

## 1. Scope

Adaptive resolution применяется к:
- particles (split/merge),
- filaments (node refine/coarsen),
- tubes (resolution by deformation),
- sheets (после `TT-025` detector readiness и `TT-026` render-path readiness).

## 2. Control objective

Оптимизация формулируется как:
- минимизация error proxy при фиксированном compute budget,
- а не фиксированное обещание "N объектов в realtime на любом железе".

## 3. Resolution Levels

Operational bands:
- `L0` coarse,
- `L1` medium,
- `L2` fine,
- `L3` ultra.

Bands задаются policy-параметрами, а не hard-coded UI labels.

## 4. Region Detection Signals

Controller использует измеряемые сигналы:
- vorticity intensity,
- filament curvature / curvature gradient,
- reconnection proximity,
- detector uncertainty/confidence,
- local stability warnings.

Обязательны hysteresis и dwell-time, чтобы избежать flip-flop.

## 5. Resolution Controller Contract

`resolutionController` должен:
- получать snapshot diagnostics,
- выдавать bounded patch для resolution params,
- публиковать decision trace (почему был refine/coarsen).

Каждый patch проверяется:
- conservation guard,
- max delta per step,
- cooldown constraints.

## 6. CPU/GPU partition policy

Гибридная partition схема допустима только с budget guards:
- transfer budget per second,
- max migration events per minute,
- sync pressure threshold.

Без этих лимитов policy "GPU dense / CPU coarse" может ухудшить performance.

## 7. Stability integration

Adaptive resolution должен быть совместим с `TT-030`:
- не обходить stability cooldowns,
- учитывать active auto-corrections,
- не усиливать drift в стресс-окнах.

## 8. Experiment integration

В Lab Mode adaptive resolution включается как controlled factor:
- `adaptiveEnabled`,
- `controllerProfile`,
- `errorBudget`.

Artifacts включают:
- refine/coarsen counts,
- time in each L-level,
- error proxy timeline,
- conservation drift correlation.

## 9. Debug Visualization

Debug mode:
- resolution map overlay,
- controller decisions timeline,
- hotspots of refine/coarsen actions.

Визуализация read-only; не влияет на solver.

## 10. Performance and acceptance

Вместо фиксированного universal target:
- benchmark matrix by hardware class (`low/mid/high`),
- per-class objectives for stepP95 / throughput / drift.

Acceptance criteria:
- no regression in benchmark gates,
- bounded oscillation in resolution levels,
- improved cost-error tradeoff vs static baseline.

## 11. Runtime guard acceptance runbook (TT-035B)

Для controller-core в runtime/Lab применяются обязательные guard checks:
- actuation budget guard (`maxActuationsPerMinute`),
- cooldown guard (`cooldownMs`),
- bounded step guard (ограничение per-step delta для `particleCount/spawnRate/ringResolution/timeScale`),
- soft drift guard (energy/circulation drift в допустимом окне для profile budget).

Стресс-верификация policy:
- встроенный synthetic harness (`low_stress_stability`, `high_stress_refine`, `oscillation_guard`),
- результат сохраняется в run summary (`adaptiveControllerVerificationOk/FailedChecks`),
- `failed` верификация блокирует перевод policy в production preset до ручного разбора.

Интерпретация:
- `adaptiveAcceptanceOk=true` и `adaptiveControllerVerificationOk=true` -> policy считается runtime-safe для текущего run envelope,
- при `adaptiveAcceptanceFailedChecks != ""` run используется только для диагностики, не для финальных выводов.

Baseline scenarios (hardware-aware):
- `adaptive.low`
  - `stepP95 <= 80ms`, `|energyDrift| <= 55%`, `|circulationDrift| <= 30%`, `pathComplexity <= 1.25`
- `adaptive.mid`
  - `stepP95 <= 45ms`, `|energyDrift| <= 45%`, `|circulationDrift| <= 25%`, `pathComplexity <= 1.00`
- `adaptive.high`
  - `stepP95 <= 30ms`, `|energyDrift| <= 35%`, `|circulationDrift| <= 20%`, `pathComplexity <= 0.90`

Результаты baseline-check сохраняются в artifacts:
- `adaptiveBaselineScenarioId`,
- `adaptiveBaselineOk`,
- `adaptiveBaselineFailedChecks`.

## 12. Acceptance matrix interpretation (TT-035C)

Для batch post-analysis используется adaptive acceptance matrix report (`audit-runner/adaptive-baseline-matrix.md`):
- строки — individual runs,
- колонки — сценарии `adaptive.low/mid/high`,
- `PASS` означает прохождение полного набора guards для сценария,
- `FAIL` означает выход хотя бы одного check за допустимый envelope.

Правило чтения:
- если run проходит только `adaptive.low`, policy пригоден как conservative fallback,
- прохождение `adaptive.mid` считается минимальным целевым уровнем для рабочих профилей,
- `adaptive.high` используется как целевой envelope для high-tier hardware и не является обязательным для low/mid классов.
