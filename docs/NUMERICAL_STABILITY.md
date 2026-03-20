# Numerical Stability System (TT-030A)

Цель: обеспечить устойчивость и научную корректность vortex solver в long-run режимах.

## 1) Риски, которые нужно контролировать

- exploding velocities,
- particle clustering/voids,
- circulation loss,
- numerical noise accumulation.

## 2) Adaptive Time Step

Базовый критерий:

- `dt <= CFL * h / maxVelocity`

Дополнительные ограничения:

- min particle spacing,
- max filament curvature,
- optional sheet quality constraints.

Итоговый `dt` = minimum из всех активных bounds.

## 3) Particle Spacing Control

Операторы:

- `split` при oversparse зонах,
- `merge` при over-dense зонах.

Требования:

- сохранение total circulation,
- минимизация локального импульсного дрейфа.

## 4) Core Radius Control

- enforce `coreRadius` lower/upper bounds,
- плавное обновление радиуса ядра (без жестких скачков),
- защита от сингулярных скоростей в near interactions.

## 5) Conservation Monitoring

Каждый шаг:

- `totalCirculation`,
- `energyProxy`,
- `enstrophyProxy`.

Публикуются drift-метрики к reference window.

## 6) Filament Regularization

- curvature smoothing,
- node redistribution,
- reconnection-safe remeshing hooks.

## 7) Reconnection Stability

При reconnection:

- balance circulation redistribution,
- контролировать bounded energy jump,
- помечать событие в diagnostics.

## 8) Sheet Stability (для TT-021)

- mesh distortion guards,
- curvature/area quality thresholds,
- controlled conversion в particles/filaments при деградации качества.

## 9) Stability Monitor

`stabilityMonitor` публикует:

- warnings,
- per-step statistics,
- auto-correction actions.

Ключи:

- `runtimeStabilityLevel`
- `runtimeStabilityWarnings[]`
- `runtimeStabilityCorrections[]`

## 10) Auto-correction Policy

При нарушениях:

1. `dt downscale`,
2. selective split/merge,
3. filament remesh hooks,
4. optional quality guard relaxation.

Политика должна быть threshold-based и воспроизводимой.

## 11) Debug Mode

`Stability Debug` показывает:

- spacing heatmap,
- curvature spikes,
- velocity spike markers,
- active corrections timeline.

## 12) Dashboard Integration

Добавить stability panel:

- energy drift,
- circulation error,
- timestep,
- correction counters.

## 13) Research Logging

Сохранять:

- stability logs (JSON lines),
- run metadata,
- correction timeline,
- configuration snapshot.

## 14) Интеграция в runtime loop

Контур выполняется после каждого simulation step:

1. collect stability metrics,
2. evaluate thresholds,
3. publish diagnostics,
4. schedule corrections for next step.
