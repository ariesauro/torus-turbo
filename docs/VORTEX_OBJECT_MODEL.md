# Hierarchical Vortex Objects

Цель: единая иерархия представления вихрей для масштабируемого solver (CPU/GPU/Hybrid/Hybrid+).

## Уровни

`Amer -> Cluster -> (Filament | Sheet) -> Tube -> Newtonium`

## 2.1 Amer

Базовая вихревая частица (fundamental vortex particle).

Минимальные поля:

- `id`
- `position`, `velocity`, `vorticity`
- `gamma` (circulation weight)
- `coreRadius`
- служебные runtime поля (`age`, history, render/meta)

Роль:

- базовый носитель циркуляции,
- элементарная единица для VPM, GPU hash-grid и детекции структур.

## 2.2 Cluster

Группа Amer-частиц (динамический агрегат).

Поля:

- `clusterId`
- `particleIds[]`
- `center`, `bbox`, `radius`
- `totalGamma`, `avgVorticity`, `principalAxes` (PCA)
- `quality`/`confidence`

Использование:

- Barnes-Hut / treecode,
- FMM multipole groups,
- structure detection (coherent packets),
- adaptive LOD (GPU/CPU transfer granularity).

## 2.3 Filament

Линейная вихревая структура (nodes + segments).

Поля:

- `id`, `closedLoop`
- `nodes[]` (position, velocity, tangent, curvature)
- `circulation`, `coreRadius`
- topology metadata (reconnect cooldown, split/merge state)

Физика:

- Local Induction Approximation (LIA),
- self-induced + coupling velocity,
- smoothing/regularization/reconnection operators.

## 2.4 Sheet

Surface-level вихревая структура для shear/wake зон.

Поля:

- `id`
- `meshVertices[]`, `meshPanels[]`
- `surfaceGammaDensity` (`gamma_s`)
- `regularizationEps`, `qualityMetrics`
- transition metadata (`toFilamentScore`, `toParticlesScore`)

Физика:

- panel Biot-Savart integration (desingularized),
- advection + roll-up,
- controlled conversion в `filaments` или `particles`.

## 2.5 Tube

Вихревая трубка как volumetric оболочка вокруг filament spine.

Поля:

- `id`, `spineFilamentId`
- `tubeParticles[]`/`rings[]`
- `radius`, `layers`, `coreSigma`
- projection/reproject diagnostics

Физический смысл:

- реализация теорем Гельмгольца (сохранение трубчатой структуры и циркуляции),
- мост между filament геометрией и particle облаком.

## 2.6 Newtonium

Макро-объект верхнего уровня (наблюдаемая вихревая структура):

- `vortex ring`
- `vortex jet`
- `vortex torus`

Поля:

- `type`
- `memberTubes[]/filaments[]/clusters[]`
- интегральные характеристики (`totalGamma`, `energy`, `impulse`)
- стабильность/фаза (`forming`, `stable`, `breakdown`)

## Контракт между уровнями

- Amer -> Cluster: пространственная агрегация + статистика coherence.
- Cluster -> Filament: детекция линий циркуляции и local tangent alignment.
- Cluster/Sheet -> Filament: extraction skeleton or ridges.
- Sheet -> Amer: controlled resampling с bounded circulation drift.
- Filament -> Tube: экструзия/репроекция tube envelope.
- Tube -> Newtonium: классификация макро-структуры и tracking жизненного цикла.

## CPU/GPU mapping

- GPU: Amer, Cluster (hash/tree kernels), часть Sheet feature precompute, часть Tube projection.
- CPU: сложная топология Filament/Sheet/Tube, Newtonium semantic classification.
- Hybrid+: delta-based synchronization между уровнями вместо полного snapshot.

## Двуязычный стандарт (RU/EN)

- Внутренние идентификаторы сущностей: English (`amer`, `cluster`, `filament`, `tube`, `newtonium`).
- UI/документация: русский и английский через единый i18n словарь.
