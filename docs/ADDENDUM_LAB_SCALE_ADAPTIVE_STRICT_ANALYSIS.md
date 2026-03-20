# Strict Analysis: Lab / Scale / Adaptive Addendum

Документ фиксирует неточности исходного addendum-плана и корректировки для научно-строгой реализации.

## 1. Главные неточности исходного плана

1. **Смешение physics и UX масштабов**
- Исходный план не отделяет `physicsScale` от визуального масштаба.
- Риск: пользователь меняет "картинку", а получает изменение физики.

2. **Неполная физическая валидность "micro -> cosmic"**
- Одинаковая модель без envelope для compressibility/stratification/MHD нефизична.
- Риск: ложные интерпретации результатов.

3. **Недоопределенные метрики**
- "vortex count" без confidence и uncertainty недостаточен для research-grade выводов.
- Риск: метрики нестабильны к detector noise.

4. **Нереалистичный perf-target**
- "1e6 particles realtime" как жесткий universal target не привязан к hardware class.
- Риск: невыполнимые acceptance criteria.

5. **Auto-run по умолчанию**
- Автоматический запуск экспериментов сразу после старта может ломать reproducibility (thermal/ramp effects).
- Риск: шум в benchmark/lab данных.

6. **Adaptive policy без transfer-budget**
- "GPU dense / CPU coarse" без migration/sync budgets может ухудшить latency.
- Риск: отрицательный performance gain при кажущейся адаптации.

## 2. Корректный порядок и приоритет

- `P5` research infrastructure:
  1) `TT-033` Simulation Lab Mode,
  2) `TT-034` Scale Physics Mode,
  3) `TT-035` Adaptive Resolution System.

Почему именно так:
- `TT-033` сначала, чтобы получить воспроизводимый orchestration и artifact contract.
- `TT-034` затем, чтобы sweep/experiments выполнялись в nondimensional-consistent пространстве.
- `TT-035` после, чтобы controller был scale-aware и не ломал stability guards.

## 3. Принятые научно-строгие улучшения

- Введен `Experiment` contract с `schemaVersion`, `seed`, `runBudget`, `acceptanceChecks`.
- Введен nondimensional framework (`Re/St/Ro`) + applicability envelope.
- Введен error-bounded objective для adaptive resolution вместо фиксированного universal FPS-target.
- Введен обязательный reproducibility metadata set для всех artifacts.
- Введены hysteresis/dwell-time требования для adaptation decisions.

## 4. Что считать "готово" (high-level acceptance)

- Reproducible batch runs with bounded variance on repeated seeds.
- Scale conversions pass nondimensional consistency checks.
- Adaptive controller improves cost-error tradeoff without gate regressions.
- All research exports include reproducibility metadata and validity annotations.
