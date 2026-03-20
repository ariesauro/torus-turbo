# Research Roadmap

`TT-051` status: DONE. Soak-контур hybrid sync получил rolling trend/history и regress flags, плюс strict trend CI (`benchmark:hybrid:syncdiag:soak:trend:ci`), что переводит контроль интермиттентных regressions в стабильный исторический pipeline.

## Направления

## 1) Vortex Rings

- Self-propulsion vs circulation scaling.
- Ring stability envelope по `R/r`, `Gamma`, viscosity.
- Ring-ring interaction (leapfrog, annihilation, reconnection onset).

## 2) Vortex Jets

- Pulse train режимы и формирование coherent structures.
- Multi-emitter конфигурации и фазовые задержки.
- Связь jet twist параметров с downstream breakdown.

## 3) Vortex Turbulence

- Transition критерии от organized ring/tube к turbulent cluster.
- Energy cascade signatures в particle/filament representation.
- Влияние reconnection policy на спектральный перенос.

## 4) Helmholtz Instabilities

- Условия роста неустойчивостей на interface/filament оболочках.
- Калибровка curvature/strain thresholds.
- Сопоставление с tube deformation metrics.

## 5) Kelvin Waves

- Модель возбуждения и затухания на filament/tube уровнях.
- Wave-energy coupling с reconnection frequency.
- Пороговые режимы перехода в vortex breakdown.

## 6) Vortex Reconnection

- Критерии distance/angle/topology для физически правдоподобного reconnect.
- Стабильность циркуляции при многократных reconnect на шаг.
- Влияние annihilation thresholds на long-run drift.

## Методология

- Единый набор сценариев + seeds.
- Повторяемые прогоны по backend matrix: CPU / GPU / Hybrid / Hybrid+.
- Отдельные метрики:
  - circulation drift,
  - energy/enstrophy proxy,
  - runtime step cost,
  - structure detection confidence.
