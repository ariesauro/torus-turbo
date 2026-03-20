# Spatial Acceleration для Biot–Savart

Система ускорения вычислений Biot–Savart law через uniform grid spatial hashing.

## Архитектура

```
spatialAcceleration/
├── gridBuilder.js           # Построение uniform grid
├── neighborSearch.js        # Поиск соседних ячеек (3×3×3)
├── aggregatedCells.js       # Агрегация дальних клеток
├── biotSavartSpatial.js     # CPU версия Biot–Savart с ускорением
├── shaders/
│   ├── computeCellIndex.wgsl    # WGSL: индекс ячейки
│   └── computeVelocityGrid.wgsl # WGSL: вычисление скорости
└── index.js                 # Экспорт API
```

## Алгоритм

1. **Построение сетки**: частицы сортируются по ячейкам uniform grid
2. **Neighbor search**: для каждой частицы находятся 3×3×3 соседних ячеек
3. **Точные вычисления**: Biot–Savart для частиц в соседних ячейках
4. **Агрегация**: дальние клетки используют aggregated representation

## Параметры

- `cellSizeMultiplier`: множитель размера ячейки (рекомендуется 3–5 × coreRadius)
- `neighborCellRange`: радиус соседних ячеек (1 = 3×3×3)
- `aggregationDistance`: дистанция агрегации дальних клеток

## Использование

```javascript
import { computeVelocityBiotSavartSpatial } from './spatialAcceleration/biotSavartSpatial'

// CPU версия
if (params.velocityComputationMode === 'spatialGrid') {
  computeVelocityBiotSavartSpatial(particles, params)
}
```

## Производительность

Целевые показатели:
- 10k частиц → 60 FPS
- 50k частиц → 40 FPS
- 100k частиц → 20–30 FPS (GPU)

## Debug визуализация

- `showGrid`: отрисовка сетки
- `showCellCenters`: центры ячеек
- `showNeighborCells`: подсветка соседних ячеек
