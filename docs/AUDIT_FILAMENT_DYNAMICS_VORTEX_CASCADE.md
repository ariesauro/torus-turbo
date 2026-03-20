# Torus Turbo — Аудит архитектуры для Filament Dynamics и Vortex Cascade

> **Note**: This audit predates the Physics-First Redesign (2026-03-19). For current state see `ROADMAP_V2.md`.

**Дата:** 2025-03-16  
**Цель:** Подготовка к внедрению новых физических моделей (Filament Dynamics, Vortex Cascade): анализ pipeline, структур данных, пространственного ускорения, hybrid coupling и производительности.

---

## 1. Полная схема simulation pipeline

### Порядок вызова в кадре

Регистрация кадра и шаг симуляции выполняются в цикле анимации в `src/scene/VortexScene.jsx`:

1. **beginFrame** — `src/simulation/runtime/frameScheduler.js:16`  
   - Обновляет `scheduler.accumulator` на `frameDelta`, сохраняет `lastFrameTime`.  
   - Вызов: `VortexScene.jsx:648` — `beginFrame(runtime.simulationState.scheduler, now)`.

2. **stepSimulationRuntime** — `src/simulation/runtime/simulationRuntime.js:807`  
   - В цикле `while (hasPendingSimulationStep(scheduler))` выполняет:
     - **updateParticles** (частицы)
     - при `shouldStepFilaments`: подготовка контекста, **applyHybridCoupling** (опционально), **stepFilaments**
     - при GPU: submit step, затем **runHybridPlusAssistPass**
   - Вызов: `VortexScene.jsx:774` — `stepSimulationRuntime(runtime, normalizeSimulationParams(currentParams), idRef)`.

3. **updateParticles** — `src/simulation/physics/updateParticles.js:402`  
   - Подготовка шага, затем либо `runGpuParticleStep`, либо `runCpuParticleStep`.  
   - В CPU-ветке внутри `runCpuParticleStep` (стр. 277–302) вызывается **runVortexParticlePipeline** при `vpmEnabled`.

4. **runVortexParticlePipeline** — `src/simulation/physics/vpm/pipeline.js:9`  
   - Порядок: velocityComputer (Biot–Savart) → vorticityConfinement → applyStabilityConstraints → advectParticles → vortexStretching → viscousDiffusion → vortexReconnection → applyStabilityConstraints.

5. **stepFilaments** — `src/simulation/filaments/filamentSolver.js:625`  
   - В каждом substep: prepareFilamentSolverContext → (onSubstepPrepared = applyHybridCoupling) → computeFilamentSelfVelocities → alignFilamentVelocityToParticleFlow → advectFilamentsWithIntegrator → applyHybridCenterLock → applyKelvinWavePerturbation → smoothFilaments → regularizeFilaments → ensureFilamentTopology.  
   - После всех substeps: adaptFilaments (remesh) → applyHybridRadiusGuard → reconnectFilaments → ensureFilamentTopology.

6. **applyHybridCoupling** — `src/simulation/filaments/hybridCoupling.js:432`  
   - Вызывается из `simulationRuntime.js` перед stepFilaments (если не recoupleWithinSubsteps) и в каждом substep через `onSubstepPrepared` (стр. 938–946).  
   - Внутри: prepareHybridCouplingContext → resetHybridCouplingTerms → цикл по filaments (particle→filament: `nodes[].couplingVelocity`) → цикл по particles (filament→particle: addCrossFlowToParticle).

7. **render** — визуализация после stepSimulationRuntime в `VortexScene.jsx` (resolveParticleRenderSource, обновление particle views, `renderer.render(scene, camera)` ~стр. 1035).

### Сводная схема по этапам

| Этап | Где вызывается | Читаемые данные | Модифицируемые данные | Вставка новых операторов |
|------|----------------|-----------------|------------------------|---------------------------|
| beginFrame | VortexScene.jsx:648 | scheduler | scheduler.accumulator, lastFrameTime | После beginFrame / перед stepSimulationRuntime |
| stepSimulationRuntime | VortexScene.jsx:774 | params, simulationState, particles, filaments | particles, filaments, hybridCouplingContext, filamentSolverContext, runtimeStatus | Внутри цикла шагов: до/после updateParticles или до/после stepFilaments |
| updateParticles | simulationRuntime.js:882 | particles, params, pulseState, webgpuManager | particles (x,y,z, flowVx/Vy/Vz, vorticity, gamma, coreRadius, velocity, …) | После runVortexParticlePipeline (в runCpuParticleStep) или в GPU-ветке после pollCompletedStep |
| runVortexParticlePipeline | updateParticles.js:291 | particles, params | particles (flowV*, vorticity, position, gamma, coreRadius) | Между шагами pipeline (например после stretching или после reconnection) |
| stepFilaments | simulationRuntime.js:930 | filaments, params, particles, hybridCouplingContext | filaments (nodes[].position, velocity, selfVelocity, couplingVelocity, localSelfVelocity) | После computeFilamentSelfVelocities; после advect; после smooth/regularize; до/после reconnectFilaments |
| applyHybridCoupling | simulationRuntime.js:920, 940 | particles, filaments, params, filamentSolverContext | particles (flowV*, selfFlowV*, crossFlowV*, velocity); filaments nodes (couplingVelocity) | До/после resetHybridCouplingTerms; между p2f и f2p циклами |
| render | VortexScene.jsx | runtime, group, particleMaterial, currentParams | particle views, mesh positions | Только визуализация |

---

## 2. Структуры данных: Particles и Filaments

### Particle (VPM)

Источники: инициализация в `updateParticles.js` (initializeParticleState), эмиссия `emitParticles.js`, GPU pack/unpack в `hashGridParticleComputeManager.js` (packParticlesToFloat32, applyParticleFields).

**Поля, используемые в симуляции и доступные для cascade:**

- **position:** `x, y, z` (и `px, py, pz` — предыдущий шаг).
- **velocity:** `vx, vy, vz` и объект `velocity: { x, y, z }`.
- **vorticity:** `particle.vorticity` — `{ x, y, z }` (используется в Biot–Savart, stretching, reconnection, hybrid coupling). См. `vpm/biotSavart.js`, `vortexStretching.js`, `vortexReconnection.js`, `hybridCoupling.js` (sampleParticleVelocityAtPoint).
- **gamma (circulation):** `particle.gamma` — используется в Biot–Savart, reconnection, консервации циркуляции. См. `vpm/biotSavart.js`, `vpm/vortexReconnection.js`, `vpm/stability.js` (conserveCirculation).
- **coreRadius:** `particle.coreRadius` — везде (Biot–Savart, stretching, diffusion, reconnection, stability, hybrid). См. `updateParticles.js:30`, `vortexStretching.js:52`, `vortexReconnection.js:79`, `stability.js:70,84`, `hybridCoupling.js:384`.
- **flow:** `flowVx, flowVy, flowVz` — поле скорости от Biot–Savart; `selfFlowVx/Vy/Vz`, `crossFlowVx/Vy/Vz` — для hybrid.

Для cascade доступны: **particle.vorticity**, **particle.gamma**, **particle.coreRadius** — все присутствуют и используются.

### Filament

Определение: `src/simulation/filaments/filamentTypes.js` — `createFilament({ id, circulation, coreRadius, closedLoop, nodes })`.

**Поля:**

- `id`, `circulation`, `coreRadius`, `closedLoop`, `nodes` (массив узлов).

### FilamentNode

Определение: `src/simulation/filaments/filamentTypes.js:1` — `createFilamentNode(position, velocity)`.

**Базовые поля:**

- `position: { x, y, z }`
- `velocity: { x, y, z }` — итоговая скорость узла (self + coupling), используется в advection (`advectFilaments.js:6`).

**Вычисляемые/записываемые в solver и coupling:**

- **selfVelocity** — устанавливается в `biotSavartFilament.js:956` (remoteSelfVelocity + localSelfVelocity).
- **localSelfVelocity** — локальная индуцированная скорость (LIA), там же стр. 955.
- **couplingVelocity** — вклад от частиц, задаётся в `hybridCoupling.js:816`.

**Segment-level данные (не хранятся в узле, считаются по месту):**

- **segmentLength** — не хранится в узле; вычисляется в `filamentStats.js:190` (distance между соседними узлами), в `adaptFilaments.js:69,106`, в `filamentSolver.js:428`, в `biotSavartFilament.js` (averageSegmentLength для LIA).

**Curvature / strain:**

- **Curvature** уже используется, но не хранится в узле:
  - `smoothFilaments.js:77` — `measureCurvature(prev, current, next)` для сглаживания.
  - `regularizeFilaments.js:119` — `measureLocalCurvature` для регуляризации.
  - `biotSavartFilament.js:829` — curvature binormal в LIA (вычисляется на лету).
- **strainRate** в узлах не вычисляется и не хранится.

**Возможность добавить в узел:**

- **curvature** — можно сохранять после measureCurvature / measureLocalCurvature в узле (например в `node.curvature`).
- **strainRate** — нового кода нет, нужно ввести (например на основе градиента скорости по дуге).
- **instabilityFlag** — поля нет; можно добавить как булев или числовой флаг после критерия неустойчивости.

---

## 3. Spatial acceleration structures

### 3.1 Uniform grid (particles)

- **Файл:** `src/simulation/physics/spatialAcceleration/gridBuilder.js`
- **Создание:** `buildGrid(particles, cellSize, gridResolution)` — стр. 29. Возвращает `cellIndexBuffer`, `cellStartBuffer`, `cellCountBuffer`, `particleIndexBuffer`, `gridOrigin`.
- **Использование:** 
  - `biotSavartSpatial.js` — `computeVelocityBiotSavartSpatial` строит grid (стр. 155) для ускорения Biot–Savart по частицам.
  - `hybridCoupling.js` — `prepareHybridCouplingContext` вызывает `buildGrid(particles, ...)` (стр. 422) для выборки скорости частиц в точках узлов нитей.
- **Clustering:** подходит для поиска соседей по ячейкам и агрегации (в hybrid уже есть aggregatedCells по ячейкам).

### 3.2 Segment grid (filaments)

- **Файл:** `src/simulation/filaments/segmentGrid.js`
- **Создание:** `buildSegmentGrid(filaments, cellSize)` — стр. 16. Сетка по сегментам нитей: для каждого сегмента записываются ячейки, пересекаемые bbox сегмента; возвращает `{ cellSize, cells, segments }`.
- **Использование:** `biotSavartFilament.js` — `prepareFilamentSolverContext` вызывает `buildSegmentGrid(filaments, context.gridCellSize)` (стр. 705); `querySegmentGrid` используется в `sampleFilamentVelocityAtPoint` для поиска сегментов рядом с точкой.
- **Clustering:** по ячейкам уже есть список сегментов; для particle clustering по положению нужна отдельная сетка частиц (например та же uniform grid или hash grid).

### 3.3 Hash grid (GPU particles)

- **Файл:** `src/simulation/physics/webgpu/hashGridParticleComputeManager.js`
- **Создание/использование:** на GPU — hash-таблица по ячейкам для частиц (WORKGROUP_SIZE, bucketCapacity, hashTableSize). Используется в compute shader для Biot–Savart и соседей.
- **CPU:** на CPU нет отдельного hash grid; используется uniform grid в gridBuilder.

### 3.4 FMM octree (particles)

- **Файлы:** `src/simulation/physics/fmm/octree.js`, `multipole.js`, `biotSavartFmm.js`
- **Создание:** в `biotSavartFmm.js` строится octree по particles (buildNode, collectLeaves, buildSourceData с x,y,z, gamma, sigma, omega*gamma).
- **Использование:** `computeVelocityBiotSavartFMM(particles, params)` — upward/downward pass, P2P для близких; вызывается из `updateParticles.js` при `velocityComputationMode === 'fmm'`.
- **Clustering:** иерархия ячеек и листьев подходит для far-field агрегации и, при необходимости, для кластеризации частиц (например по листьям).

### 3.5 Barnes–Hut

- **Упоминание:** `src/simulation/runtime/hybridPlusOperators.js:203` — описание «Barnes-Hut far-field velocity correction (CPU assist)». Реализация — через FMM/octree или отдельный Barnes–Hut в hybridPlus; отдельного классического Barnes–Hut дерева в коде не найдено в корне simulation.

**Итог для cascade:** для particle clustering можно опереться на: (1) uniform grid из gridBuilder/hybridCoupling, (2) FMM octree (листья = кластеры), (3) GPU hash grid (данные на GPU, для cascade нужен readback или отдельный CPU clustering).

---

## 4. Точки интеграции Cascade

- **После шага частиц (после runVortexParticlePipeline при CPU):** у частиц уже обновлены vorticity, gamma, coreRadius, позиции; можно запускать cascade (разбиение/мержинг, перенос циркуляции и т.д.). Файл: `updateParticles.js`, после вызова `runVortexParticlePipeline` (стр. 291). Physical cascade mode is now available (`cascadeMode: 'physical'`): uses stretching→enstrophy + PSE→dissipation.
- **Перед/после hybrid coupling:** если cascade меняет частицы (позиции, число, gamma, coreRadius), логично выполнять cascade до applyHybridCoupling, чтобы filament→particle и particle→filament видели уже обновлённое множество. Вставка в `simulationRuntime.js`: после `updateParticles`, перед блоком `if (stepAdvanced && shouldStepFilaments)` (или в начале этого блока, до prepareFilamentSolverContext).
- **Внутри runVortexParticlePipeline:** после `vortexReconnection` и финального `applyStabilityConstraints` — ещё одна естественная точка: все VPM операторы применены, можно запускать cascade перед следующим кадром.
- **GPU:** при GPU-бэкенде данные частиц на CPU доступны после readback в `pollCompletedStep`. Cascade тогда разумно вызывать после `pollCompletedStep` при `applied: true` (в `simulationRuntime.js` после получения `latestRuntimeStatus` от updateParticles), с учётом того, что следующий шаг может снова уйти на GPU.

Рекомендация: **основная точка вставки cascade — после updateParticles (и при GPU — после успешного readback), до stepFilaments и applyHybridCoupling**, чтобы и частицы, и нити работали с уже «каскадным» полем частиц.

---

## 5. Точки интеграции Filament Dynamics

- **Расчёт скорости нитей:** уже есть — `computeFilamentSelfVelocities` в `biotSavartFilament.js:917` (LIA + remote self), затем в том же месте складываются selfVelocity и couplingVelocity в `node.velocity`. Расширение динамики (например дополнительные члены в LIA или другие силы) — рядом с `computeLocalSelfInducedVelocity` и местом присвоения `node.velocity`.
- **Advection узлов:** `advectFilaments` в `advectFilaments.js` и `advectFilamentsWithIntegrator` в `filamentSolver.js` (RK2/RK3). Новые члены в скорости нужно учитывать до advection (т.е. уже учтены, если добавить их в `node.velocity` в computeFilamentSelfVelocities или сразу после него).
- **Remeshing (adapt):** `adaptFilaments` в `filamentSolver.js:702` — split/merge по длинам сегментов. Параметры задаются через `resolveAdaptiveRefinementSettings`. Вставка логики «нестабильность → разбиение» возможна до или внутри adaptFilaments (например флаги по curvature/strain в узлах).
- **Reconnection нитей:** `reconnectFilaments` в `filamentSolver.js:710`; файл `reconnectFilaments.js`. Критерии и слияние циркуляции уже есть; расширение под filament dynamics — рядом с этим вызовом или внутри `reconnectFilaments.js`.
- **Curvature / strain для динамики:** curvature уже считается в smoothFilaments и regularizeFilaments, но не сохраняется в узле. Для filament dynamics полезно:
  - ввести сохранение curvature в узле (например в `prepareFilamentSolverContext` или отдельным проходом после smooth/regularize);
  - ввести strainRate (градиент скорости по дуге) и при необходимости instabilityFlag;
  - вызывать новый оператор filament dynamics после computeFilamentSelfVelocities (или после smooth/regularize), до или после reconnectFilaments в зависимости от того, меняет ли оператор топологию.

Конкретные места в коде:
- `filamentSolver.js`: после `computeFilamentSelfVelocities` (стр. 670); после `regularizeFilaments` (стр. 682); до/после `reconnectFilaments` (стр. 710).
- `biotSavartFilament.js`: расширение `computeLocalSelfInducedVelocity` или добавление отдельной функции и сложение с `node.velocity`.
- `filamentTypes.js` / создание узлов: добавить опциональные поля `curvature`, `strainRate`, `instabilityFlag`.

---

## 6. Потенциальные проблемы производительности

- **O(N²) по частицам:**
  - **Biot–Savart (CPU):** `biotSavart.js` — двойной цикл по particles (стр. 35–43). Смягчается при использовании `velocityComputationMode === 'spatialGrid'` (biotSavartSpatial) или `'fmm'` (biotSavartFmm).
  - **Vortex stretching:** `vortexStretching.js` — analytic (ω·∇)u is now default; legacy Gaussian-weighted Δv available as fallback (`stretchingMethod: 'legacy'`). PSE diffusion is default (`diffusionMethod: 'coreSpread'` for fallback).
  - **Vortex reconnection:** `vortexReconnection.js:24–41` — попарный перебор частиц для поиска пар на расстоянии ≤ threshold — O(N²).
- **O(M²) / большие затраты по нитям:**
  - **Filament self-velocity:** для каждого узла вызывается `sampleFilamentVelocityAtPoint` с исключением текущей нити/узла; внутри — обход сегментов по segment grid и far-field агрегатов. Количество сегментов растёт с числом нитей и узлов — основная стоимость filament step.
  - **Reconnection нитей:** `reconnectFilaments.js` — поиск пар сегментов на близком расстоянии; зависит от реализации (перебор пар или пространственный поиск).
- **Оценки порядков:** средние N (particles) и M (filament nodes) в коде не зафиксированы; задаются параметрами (scene particle limit, filament node count, число нитей). При росте N и M узкие места — vortexStretching (N²), vortexReconnection (N²), filament self-velocity (узлы × сегменты).

Рекомендации: для cascade и дополнительной физики по частицам по возможности использовать существующие spatial структуры (grid/FMM) и избегать новых глобальных O(N²); для filament dynamics — по возможности кэшировать curvature/strain и не увеличивать число проходов по всем узлам без необходимости.

---

## 7. GPU pipeline и readback

- **Менеджер:** `src/simulation/physics/webgpu/hashGridParticleComputeManager.js` (класс `WebGPUHashGridParticleComputeManager`).
- **Данные частиц на GPU:** в шейдерах структура `ParticleData` (positionLife, velocityAge, angleState, vorticityGamma, coreFlow, identity). На CPU у частиц те же поля, что и в разделе 2 (vorticity, gamma, coreRadius, flowVx/Vy/Vz и т.д.).
- **Readback:** при завершении dispatch вызывается асинхронное чтение буферов (`mapAsync`, `getMappedRange` — стр. 2065–2078). После завершения в `pollCompletedStep` (стр. 1437) вызывается `syncParticlesFromPacked(particles, this.completedResult.data, this.completedResult.activeCount)` — массив `particles` на CPU заполняется из упакованных GPU-данных (в т.ч. vorticity, gamma, coreRadius, flowV*). Полный readback выполняется по политике (cadence, overflow, по запросу `requestFullReadbackNextDispatch`).
- **Cascade и GPU:** cascade может использовать CPU-массив `particles` после того, как `pollCompletedStep` вернул `applied: true` и синхронизировал частицы. Если cascade меняет частицы (число, поля), при следующем submit step нужно передать обновлённый массив в `submitStep` и при необходимости обновить seed snapshot (forceResyncSnapshot уже используется при hybrid в simulationRuntime.js:898).

---

## 8. UI: ControlPanel, normalizeParams, defaultParams, simulationStore

- **ControlPanel:** `src/ui/ControlPanel.jsx`. Секции задаются через `DisclosureSection` с `title` и при необходимости `description`; внутри — `InlineDisclosure` и контролы. Примеры секций: «particles_and_vectors», «emission», «mode_and_section» и др. (по ключам из `t('...')` в i18n).
- **Добавление раздела «Turbulence»:** добавить новый `DisclosureSection` с `title={t('turbulence')}` (или аналогичным ключом) и поместить туда переключатели/слайдеры для cascade и связанных параметров. Ключи добавить в `src/ui/i18n/controlPanelMessages.js`.
- **Параметры:** `normalizeParams` — `src/simulation/params/normalizeParams.js` (в т.ч. hybridCoupling*, coreRadiusSigma, vpm и т.д.); `defaultParams` — `src/simulation/params/defaultParams.js`. Новые параметры turbulence/cascade нужно добавить в defaultParams и в normalizeParams (clamp/значения по умолчанию).
- **simulationStore:** `src/state/simulationStore.js` — zustand store, начальные params из `defaultParams` и loadParamsFromStorage; обновление через `setParams`. Новые ключи параметров автоматически попадут в store при использовании `setParam` в ControlPanel.

---

## 9. Предлагаемая архитектура новых модулей

- **Cascade (Vortex Cascade):**
  - Отдельный модуль, например `src/simulation/physics/vpm/vortexCascade.js` (или `cascade/`), с одной точкой входа, например `runVortexCascade(particles, params, dt)`.
  - Вызов из `simulationRuntime.js` после `updateParticles`, при `latestRuntimeStatus?.advanced` и при наличии данных частиц на CPU (после readback при GPU). Параметры: через params (в defaultParams/normalizeParams и раздел «Turbulence» в ControlPanel).
  - Вход: массив particles с актуальными vorticity, gamma, coreRadius, позициями. Выход: мутация того же массива (изменение числа частиц, полей) или замена массива в simulationState при необходимости.

- **Filament Dynamics:**
  - Модуль, например `src/simulation/filaments/filamentDynamics.js`, с функцией типа `applyFilamentDynamics(filaments, params, solverContext, qualityStats)`.
  - Вызов в `filamentSolver.js` после `regularizeFilaments` (или после computeFilamentSelfVelocities, в зависимости от того, нужны ли уже curvature/strain). Использовать существующие структуры узлов; при необходимости расширить `createFilamentNode` и места создания узлов (createFilamentRing и т.д.) полями curvature, strainRate, instabilityFlag.
  - Предварительно вычислить и записать curvature (и при необходимости strainRate) в один проход по узлам (можно переиспользовать measureCurvature / measureLocalCurvature из smoothFilaments/regularizeFilaments), затем в applyFilamentDynamics читать эти поля и применять критерии/операторы (например разбиение в adaptFilaments по флагу).

- **Spatial clustering для cascade:** использовать существующие `buildGrid` (gridBuilder) или FMM octree; при необходимости добавить утилиту в `src/simulation/physics/spatialAcceleration/` (например агрегация по ячейкам по vorticity/gamma для выбора кандидатов cascade), без дублирования полной N² логики.

- **Параметры и UI:** все новые параметры cascade и filament dynamics завести в defaultParams.js и normalizeParams.js; секция «Turbulence» в ControlPanel с привязкой к этим ключам и simulationStore.

---

## Ссылки на файлы и строки

| Элемент | Файл | Строки |
|--------|------|--------|
| beginFrame | frameScheduler.js | 16–24 |
| stepSimulationRuntime, цикл шагов | simulationRuntime.js | 807–954 |
| updateParticles, runCpuParticleStep | updateParticles.js | 402–419, 277–302 |
| runVortexParticlePipeline | vpm/pipeline.js | 9–37 |
| stepFilaments, substeps, adapt, reconnect | filamentSolver.js | 625–731, 657–713 |
| applyHybridCoupling | hybridCoupling.js | 432–860, 679–824 |
| Filament/FilamentNode типы | filamentTypes.js | 1–30 |
| createFilamentRing | createFilamentRing.js | 5–27 |
| computeFilamentSelfVelocities, node.velocity | biotSavartFilament.js | 917–971, 695–709 |
| LIA (curvature binormal) | biotSavartFilament.js | 800–840 |
| measureCurvature, smoothFilaments | smoothFilaments.js | 1–25, 26–87 |
| measureLocalCurvature, regularizeFilaments | regularizeFilaments.js | 75–80, 83–140 |
| advectFilaments | advectFilaments.js | 6–8 |
| adaptFilaments | adaptFilaments.js | 69–70, 106–107 |
| reconnectFilaments | reconnectFilaments.js | 154–163 |
| vortexStretching | vpm/vortexStretching.js | 5–80 |
| vortexReconnection | vpm/vortexReconnection.js | 13–89 |
| Biot–Savart particles | vpm/biotSavart.js | 29–86 |
| buildGrid | spatialAcceleration/gridBuilder.js | 29–72 |
| buildSegmentGrid, querySegmentGrid | segmentGrid.js | 16–76, 69–… |
| FMM octree, biotSavartFmm | fmm/biotSavartFmm.js, octree.js | 33–57, 62–74 |
| packParticlesToFloat32, applyParticleFields | hashGridParticleComputeManager.js | 850–918 |
| pollCompletedStep, readback | hashGridParticleComputeManager.js | 1437–1474, 2065–2078 |
| ControlPanel секции | ControlPanel.jsx | 443–445, 581–582 |
| defaultParams, normalizeParams | defaultParams.js, normalizeParams.js | — |
| simulationStore | state/simulationStore.js | 50–80 |

Этот документ можно использовать как основу для внедрения Filament Dynamics и Vortex Cascade с минимальными изменениями существующей архитектуры и чёткими точками интеграции и расширения структур данных.
