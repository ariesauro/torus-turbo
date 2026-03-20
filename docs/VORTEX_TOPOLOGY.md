# Vortex Topology System (TT-028A)

Цель: аналитическое отслеживание топологии вихревых структур без влияния на физический solver.

## 1) Scope

Отслеживаем события:

- `vortex_birth`
- `vortex_merge`
- `vortex_split`
- `vortex_reconnection`
- `vortex_decay`

Topology модуль работает как read-only consumer runtime diagnostics/detector output.

## 2) Vortex Object Contract

Каждый объект:

- `id`
- `type` (`sheet|filament|ring|tube|cluster|macro`)
- `ageSteps`
- `energy`
- `circulation`
- `radius`
- `velocity`
- `lifetimeSec`

Lineage поля:

- `creationFrame`
- `parents[]`
- `children[]`

## 3) Event Model

`vortexEvent`:

- `eventId`
- `frame`
- `eventType`
- `subjectIds[]`
- `parentIds[]`
- `childIds[]`
- `confidence`
- `deltaEnergy`
- `deltaCirculation`

Событие валидно только если переход подтвержден transition gates (`TT-022`).

Runtime topology contract (snapshot/runtime diagnostics):

- `transitionContract` (state + gate flags + invariant drifts),
- `ringValidation` (`TT-023B`, gates/verdict/score),
- `jetRegime` (`TT-024B`, regime + `Re/St/L-D` proxies + gates/verdict/score).
- `detectorFusion` (`TT-025B`, multiclass fusion verdict/score + gate counters).
- `tracking` (`TT-028B/C`, lineage events + graph snapshot + counters + latest event).

## 4) Vortex Graph

`vortexGraph`:

- nodes = vortex objects,
- edges = topology events/lineage relations.

Рекомендация: хранить graph в append-only event log + materialized view для UI.

## 5) Scientific Metrics

- lifetime distribution,
- merge/split/reconnect frequency,
- energy cascade by event type,
- survival curves by object class.

## 6) Detector Integration

`Vortex Structure Detection` создает/обновляет объекты-кандидаты.

Topology слой:

1. получает detector snapshots,
2. ассоциирует идентичность во времени,
3. публикует события.

## 7) Runtime Isolation

- Topology не меняет state физики.
- Обновление выполняется асинхронно (по кадрам или батчами).
- При перегрузке допускается decimation event stream.

## 8) Topology View

Режим визуализации:

- temporal graph,
- timeline событий,
- фильтры по типам структур/событий.

Runtime view (ControlPanel/HUD):

- `runtimeTopologyFrameSerial`,
- `runtimeTopologyEventCount`, `runtimeTopologyNodeCount`, `runtimeTopologyEdgeCount`,
- counters: `birth/decay/merge/split/reconnection`,
- latest event: `type/confidence/frame`.

## 9) Export

- `JSON` для полного event log,
- `CSV` для табличной аналитики.

Реализованный export contract:

- `torus.topology.events.v1` JSON (eventLog + graph + counters),
- `topology-events.csv` (flat event table для offline анализа).

Версионирование:

- `schemaVersion` обязательно в каждом export файле.
