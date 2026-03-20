> Status: DONE — TT-011A through TT-011F implemented.

# TT-011 RFC: GPU Coupling Offload (Particle -> Filament)

Статус: DONE (Implemented)  
Дата: 2026-03-16  
Связанные файлы: `src/simulation/filaments/hybridCoupling.js`, `src/simulation/filaments/biotSavartFilament.js`, `src/simulation/physics/webgpu/hashGridParticleComputeManager.js`

## 1. Цель

Перенести вычисление `particle -> filament coupling` с CPU на GPU для режима `hybrid`, сохранив текущую физику клампов и автobalance, но снизив CPU load и цену strict-sync.

Что переносим:

- sampling скорости частиц в точках filament nodes (сейчас `sampleParticleVelocityAtPoint` в `hybridCoupling.js`).

Что оставляем на CPU (на первом этапе):

- пост-обработку клампов (magnitude/outward/center),
- adaptive guards/drift statistics,
- filament->particle coupling ветку.

## 2. Текущая проблема

В текущем пути:

1. строится CPU particle grid,
2. для каждого node идет CPU sampling,
3. затем применяются CPU клампы.

Это создает высокий CPU overhead при больших `Np` и `Nf_nodes`, и дублирует логику spatial acceleration, уже близкую к hash-grid модели на GPU.

## 3. Предлагаемая архитектура

## 3.1 Новый GPU query path

В `WebGPUHashGridParticleComputeManager` добавляется query API:

- `sampleParticleVelocityAtPoints(pointsPacked, params, options?) -> { velocitiesPacked, sampleCountsPacked, diagnostics }`

Где:

- `pointsPacked`: `Float32Array` (`x,y,z,w`) для filament nodes.
- `velocitiesPacked`: `Float32Array` (`vx,vy,vz,w`) результат sampling.
- `sampleCountsPacked`: `Uint32Array` число сэмплов на точку.

## 3.2 Новый compute pass

Добавляется WGSL pass (концепт):

- `couplingQueryParticlesToPoints`

Вход:

- актуальный particle state buffer,
- hash-grid buffers (`gridCounts`, `gridIndices`),
- points buffer.

Выход:

- velocity buffer на point.
- optional sample count buffer.

## 3.3 CPU orchestration

В `applyHybridCoupling`:

1. собрать список node points (`filamentId`, `nodeIndex`, `x,y,z`),
2. вызвать GPU query (если backend доступен),
3. для каждого node применить уже существующие CPU clamps/guards,
4. fallback на CPU sampling при любой ошибке/timeout.

## 3.4 Feature flag / safety

Новый параметр (предложение):

- `hybridParticleToFilamentBackend: 'cpu' | 'gpu' | 'auto'` (default `auto`).

Политика:

- `auto` -> `gpu` если WebGPU и query pass готов; иначе `cpu`.
- при ошибке GPU query: graceful fallback на CPU + runtime reason update.

## 4. Data contract (предложение)

## 4.1 Point record

- `vec4<f32> point = (x,y,z,meta)`
- `meta` резерв под `filamentId/nodeIndex` или padding.

## 4.2 Result record

- `vec4<f32> vel = (vx,vy,vz,sampleCountAsFloat)`
- либо отдельный `u32` буфер count.

## 4.3 Batch strategy

- единый batch на все filament nodes за substep.
- chunking для очень больших сцен: `queryChunkSize` (например 4096-16384 points).

## 5. Синхронизация и readback стратегия

Ключевая идея: readback только query-результата (`Nf_nodes * 16 bytes`) вместо полного particle snapshot.

- В strict hybrid это дешевле, чем full particle readback.
- Query readback имеет независимую cadence от общего full-readback.

Риски:

- mapAsync latency spikes.
- конфликт очередей с основным particle dispatch.

Смягчение:

- query dispatch после poll completed step,
- ограниченный timeout/guard и fallback на CPU path,
- ring-buffer query buffers для избежания map stalls.

## 6. План внедрения (по этапам)

## Phase 0: Plumbing

- Добавить новый runtime param для backend selection.
- Добавить интерфейс query API (пока stub + CPU fallback passthrough).

Критерий: поведение не меняется.

## Phase 1: GPU query kernel MVP

- Реализовать `couplingQueryParticlesToPoints` без изменения клампов.
- Подключить в `applyHybridCoupling` при `backend=gpu`.

Критерий: numeric error относительно CPU sampling в пределах допусков.

## Phase 2: Diagnostics + safety

- Счетчики: queryMs, pointsCount, avgSamples, fallbackCount, timeoutCount.
- Runtime reason для UI diagnostics.

Критерий: дебаг-панель показывает query health.

## Phase 3: Strict hybrid optimization

- В `configureGpuReadbackCadence` добавить query-aware policy.
- Минимизировать full readback когда достаточно query readback.

Критерий: снижение step time в hybrid при сопоставимой стабильности.

## Phase 4: Optional clamp offload (advanced)

- Вынести часть magnitude clamp на GPU.
- Outward/center drift guards пока оставить CPU (требуют доп. геометрического контекста).

## 7. Метрики успеха

- `hybridCoupling.stepMs` снижение не менее 25% на сценах с большими filament node counts.
- Сохранение drift/guard показателей в допустимом коридоре.
- Fallback стабильность: отсутствие hard-fail при проблемах WebGPU.

## 8. Риски и ограничения

- Текущий `WebGPUHashGridParticleComputeManager` проектирован как step pipeline; query API добавляет вторую роль.
- Возможен contention на одних и тех же hash buffers между step и query.
- Необходимо четко сериализовать стадии: poll -> (optional query) -> submit.

## 9. Изменения файлов (план)

Обязательные:

- `src/simulation/physics/webgpu/hashGridParticleComputeManager.js`
- `src/simulation/filaments/hybridCoupling.js`
- `src/simulation/runtime/simulationRuntime.js`
- `src/simulation/params/defaultParams.js`
- `src/simulation/params/normalizeParams.js`

Диагностика/UI (по необходимости):

- `src/ui/runtimeDiagnosticsViewModel.js`
- `src/ui/ControlPanel.jsx`
- `src/ui/i18n/controlPanelMessages.js`

## 10. Совместимость

- Полная обратная совместимость через default backend `auto` + CPU fallback.
- Никаких изменений в внешнем формате сохранения сцены, кроме нового опционального param.
