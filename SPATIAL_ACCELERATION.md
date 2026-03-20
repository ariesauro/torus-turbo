# Опциональное ускорение Biot–Savart

## Краткое описание

Добавлена система spatial acceleration для вычисления Biot–Savart law через uniform grid. Позволяет ускорить вычисления без изменения базовой физики.

## Режимы вычисления скорости

В секции **Solver** доступны два режима:

1. **Exact (O(N²))** — полный перебор всех частиц (по умолчанию)
2. **Spatial Grid** — ускоренный алгоритм с uniform grid

## Параметры ускорения

При выборе **Spatial Grid** становятся доступны:

- **Множитель размера ячейки** (1–10): cellSize = σ × multiplier
  - Рекомендуется: 3σ – 5σ
  - По умолчанию: 4σ

- **Радиус соседних ячеек** (1–3): количество соседних ячеек
  - 1 = 3×3×3 соседних ячейки
  - По умолчанию: 1

- **Дистанция агрегации** (1–5): для дальних клеток используется агрегированный вклад
  - По умолчанию: 2

## Debug режим

Для диагностики доступны:
- `showGrid` — отрисовка сетки
- `showCellCenters` — центры ячеек
- `showNeighborCells` — подсветка соседних ячеек

## Архитектура

### CPU реализация
- `src/simulation/physics/spatialAcceleration/biotSavartSpatial.js`
- Точные вычисления для 3×3×3 соседних ячеек
- Агрегация для дальних клеток

### GPU реализация
- WGSL шейдеры: `shaders/computeCellIndex.wgsl`, `shaders/computeVelocityGrid.wgsl`
- Активный GPU runtime использует `src/simulation/physics/webgpu/hashGridParticleComputeManager.js`

## Целевая производительность

- 10k частиц → 60 FPS
- 50k частиц → 40 FPS
- 100k частиц → 20–30 FPS (GPU режим)

## Безопасность

- `maxParticlesPerCell` — ограничение для избежания перегрузки
- `minCellSize` — минимальный размер ячейки
- Spatial acceleration не включается по умолчанию (exact режим)

## Совместимость

Работает с:
- vortex stretching
- viscous diffusion
- vortex reconnection
- vortex ring generator

## Расположение в UI

Настройки находятся в секции **Solver**:
- Выбор режима вычисления скорости
- Параметры spatial grid (при включенном режиме)
- Debug опции
