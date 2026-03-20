# Vortex Structure Detection Architecture

Цель: обнаружение `vortex sheets`, `vortex filaments`, `vortex rings`, `vortex tubes`, `vortex clusters` в облаке Amer-частиц и hybrid-состоянии.

## Входные данные

- Amer облако: `position`, `velocity`, `vorticity`, `gamma`, `coreRadius`.
- Опционально: filament/tube runtime состояния (если режим hybrid/tubes активен).

## Выходные данные

- `detectedFilaments[]`
- `detectedRings[]`
- `detectedTubes[]`
- `detectedSheets[]`
- `detectedClusters[]`
- confidence score + temporal tracking id.

## Конвейер detection

1. **Precompute features**
   - локальные инварианты: `|omega|`, helicity proxy, swirl strength proxy.
2. **Neighbor graph build**
   - spatial grid/hash graph на Amer.
3. **Candidate extraction**
   - связные компоненты + направленные цепочки.
4. **Classifier stage**
   - sheet/ring/tube/filament/cluster labeling.
5. **Temporal association**
   - связывание структур между кадрами.

## Методы

## 1) Vorticity alignment

- Для соседей считаем косинусное выравнивание направлений вихревости.
- Высокая когерентность формирует filament/tube кандидаты.
- Сложность: `O(N * k)`.

## 2) PCA clustering

- По локальным компонентам считаем PCA:
  - 1 доминирующая ось -> filament-like,
  - 2 оси -> tube/ring shell,
  - 3 оси -> turbulent cluster.
- Сложность: `O(N * k)`.

## 3) Circulation loops

- Ищем замкнутые пути/контуры по направлению циркуляции.
- Ring кандидат подтверждается при:
  - топологической замкнутости,
  - стабильном радиусе,
  - согласованной ориентации.

## 4) Topological detection

- Графовый анализ connectivity + cycle basis.
- Tube detection: filament spine + surrounding coherent shell.
- Cluster detection: связный регион высокой вихревой плотности без явной 1D spine.

## 5) Sheet detection (surface coherence)

- Признаки:
  - локальная планарность (2 доминирующих PCA оси),
  - устойчивый jump в тангенциальной скорости,
  - surface curvature continuity.
- Кандидат sheet подтверждается при:
  - устойчивости surface confidence на окне `N` шагов,
  - согласии с transition state (`candidate` или `committed` в `sheet->filament`).

`TT-025A` runtime признаки:

- `sheetSurfaceCoherence` (0..1),
- `sheetCurvatureAnisotropy` (0..1),
- class confidence per family (`filament/ring/tube/sheet`).

`TT-025B` fusion contract:

- версия: `tt025b.detector_fusion.v1`,
- выход: `valid/verdict/acceptanceScore`, `gatePassCount/gateTotal`, `weightedFusionScore`,
- гейты: `globalConfidence`, `classCoverage`, `sheetSurfaceCoherence`, `sheetCurvatureAnisotropy`, `fusionScore`.

## Объектная интеграция

- Amer -> Cluster: детектор компонент.
- Cluster -> Filament: extraction skeleton.
- Filament + shell -> Tube.
- Sheet -> Filament/Particles transition candidates.
- Ring/Tube/Jet -> Newtonium labeler (верхний semantic слой).

## Online режим (runtime)

- Fast path (каждый кадр): alignment + lightweight clustering + sheet confidence update.
- Full path (каждые M шагов): PCA + topology loops + surface coherence relabel.
- Хранение истории: `structureTrackId`, `birthStep`, `confidenceEMA`.

## Производительность

- Основная стоимость: neighbor graph и topological cycle search.
- GPU-кандидат: feature precompute + alignment matrix.
- CPU-кандидат: cycle basis + semantic classification + sheet transition gating.

## MVP план внедрения

1. Feature extractor на Amer.
2. Cluster + filament candidate detector.
3. Ring loop validator.
4. Tube detector.
5. Temporal tracker и Newtonium labeling.
