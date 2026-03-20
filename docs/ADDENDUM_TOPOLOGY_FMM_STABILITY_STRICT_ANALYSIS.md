# Strict Analysis: Topology + FMM + Stability Addendum

Документ фиксирует неточности исходного плана и принятые строгие корректировки.

## 1) Topology Addendum - неточности

- Недостаточно указать "graph узлы/ребра":
  - нужен строгий event schema, confidence и lineage semantics.
- Формулировка "не влияет на физику" верная по цели, но требует архитектурного ограничения:
  - read-only доступ, асинхронная обработка, bounded overhead.
- Метрики (energy/circulation/radius/velocity) без окна сравнения неинформативны:
  - нужны temporal aggregates и uncertainty tags.

Коррекция:

- введен event-sourced topology contract с `schemaVersion` и export discipline.

## 2) FMM Addendum - неточности

- `O(N)` заявлять без условий некорректно:
  - для treecode обычно `O(N log N)`, FMM `O(N)` при фиксированном порядке и контролируемой точности.
- "каждый кадр rebuild octree" может быть слишком дорого:
  - нужен adaptive/incremental rebuild policy.
- "GPU near / CPU far" не всегда быстрее:
  - возможны тяжелые sync/readback потери; выбор зависит от memory locality.
- Multipole for filaments нельзя считать бесплатным extension:
  - сначала Amer-only validation.

Коррекция:

- добавлены accuracy gates, near/far split policy и phase-wise rollout.

## 3) Numerical Stability Addendum - неточности

- Только `dt = CFL*h/maxVelocity` недостаточно:
  - нужны дополнительные bounds (spacing/curvature/sheet quality).
- Split/merge без conservation constraints разрушит физическую достоверность.
- "Auto correction" без reproducibility может сделать результаты нефальсифицируемыми.

Коррекция:

- введены formal thresholds, correction audit trail и per-step diagnostics schema.

## 4) Рекомендованный порядок внедрения

1. Stability foundation (`TT-030`) до крупных solver изменений.
2. FMM solver (`TT-029`) с accuracy/performance gates.
3. Topology analytics (`TT-028`) поверх зрелого detector/transitions слоя.

## 5) Научные acceptance критерии

- Reproducible runs under fixed seed/config.
- Bounded drift for circulation/energy under target scenarios.
- Explicit error bars for accelerated solvers.
- Versioned export schemas for downstream research analysis.
