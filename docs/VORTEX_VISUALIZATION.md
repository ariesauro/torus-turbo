# Advanced Vortex Visualization System (TT-031A)

Цель: научно-строгая визуализация вихревых структур и полей для анализа, а не только для рендера.

## 1) Объекты и поля визуализации

- vortex rings / filaments / tubes / sheets
- turbulent structures
- vorticity field
- velocity field
- derived diagnostics (`Q`, energy spectrum proxies)

## 2) Vorticity Field Visualization

Поддерживаем режимы:

- scalar color map (`|omega|`),
- glyph vectors (sparse sampling),
- isosurfaces (по уровню `|omega|`/invariant threshold).

Требования:

- нормировка и единицы измерения должны быть явными,
- визуальный scale фиксируемым и воспроизводимым.

## 3) Q-Criterion (как диагностика)

`Q` = `(1/2) (||Omega||^2 - ||S||^2)` вычисляется из градиента скорости.

Важно:

- Q-criterion - диагностический индикатор вихревых областей,
- не должен быть единственным источником detector truth.

## 4) Core Lines, Tubes, Sheets

- filament core lines: centerline rendering + curvature color.
- tube rendering: cylindrical mesh / swept volume.
- sheet rendering: surface mesh с quality overlay (`stretch`, `distortion`).

## 5) Streamlines и Pathlines

- streamlines: мгновенная структура velocity field.
- pathlines: траектории tracer particles во времени.

Оба режима нужны, так как отвечают на разные научные вопросы.

## 6) Velocity Field View

- vector arrows на сетке/выборке,
- decimation + LOD для больших N.

## 7) Energy Spectrum View

- график turbulence energy spectrum из runtime diagnostics.
- обязательна привязка к окну времени и параметрам sampling.

## 8) Integration with Detection/Topology

- подсветка detector-объектов с confidence.
- topology events overlay: `birth/merge/split/reconnect/decay`.

## 9) UI Integration

ControlPanel раздел `Visualization`:

- базовые representation modes,
- field/diagnostic overlays,
- streamline/pathline toggles,
- scientific mode preset.

## 10) Dashboard Integration

`dev/dashboard.html` -> Visualization Tools секция:

- состояние режимов,
- export readiness,
- linked dependencies (detector/topology/performance).

## 11) Performance and LOD

- GPU rendering path приоритетен.
- LOD обязателен для больших симуляций.
- ограничение draw-call budget и overlay density.

## 12) Export

- `PNG`: single-frame scientific snapshots.
- `MP4`: time-encoded run capture.
- `snapshot bundle`: params + metadata + frame references.

Baseline export contract (`TT-031C`, phase-1):

- bundle schema id: `torus.viz.snapshot.bundle.v2`,
- required payload blocks: `camera`, `visualization`, `runtime.detector/topology/energy`,
- `overlayEvents` list for detector/topology event annotations,
- `runtime.timeline` (sampled detector/topology/energy series, bounded window),
- `runtime.timeline` includes render diagnostics (`renderConfidence/renderUncertainty` + uncertainty components) for policy-auditability,
- `runtime.overlayDiagnostics` includes composite overlay confidence/uncertainty and decomposition (`detector/topology/render`) for TT-019 coupling,
- `runtime.overlayStructures` contains bounded detected-structure marker payload (class/confidence/center/radius) for scene overlays and reproducible analysis,
- `visualization.overlayMinConfidence` фиксирует confidence-threshold, примененный к scene overlays при экспорте,
- `visualization.overlayLabelPolicy.enabled` фиксирует, были ли включены class/confidence labels в overlay режиме,
- `visualization.overlayLabelPolicy.maxCount/maxDistance` фиксируют anti-overlap label budget policy,
- validation report проверяет policy-bounds (`overlayMinConfidence`, `maxCount`, `maxDistance`) и boundedness `runtime.overlayStructures`,
- UI export flow выполняет pre-save validation gate и показывает failed-checks при нарушении contract checks,
- `sequence manifest` export (frame naming + time mapping) for reproducible snapshot-sequence assembly,
- `ffmpeg transcode plan` export (concat list + command template) for deterministic MP4 assembly,
- `export validation report` (`torus.viz.snapshot.bundle.v2.validation`) with consistency checks for `bundle schema`, `manifest frame count/uniqueness`, `ffmpeg concat/input parity`, `output *.mp4`,
- `image.fileName` link to expected PNG frame name for reproducible pairing (`PNG + JSON`).
- automated MP4 capture wiring: auto-capture N PNG frames (single-step pulses), auto-export `bundle + sequence manifest + ffmpeg plan + frames.txt + validation`.

Phase-1 reproducible runbook:

1. Включить scientific overlays и накопить timeline (`>= 10` points).
2. Экспортировать `snapshot bundle` (JSON) и как минимум один `PNG` кадр.
3. Экспортировать `sequence manifest` (JSON).
4. Экспортировать `FFmpeg plan` (JSON + `frames.txt`) и validation-report JSON.
5. Проверить `validationReport.pass === true`.
6. Выполнить команду из `ffmpegPlan.ffmpegCommand`.

## 13) Scientific Visualization Mode

Preset включает:

- vortex core lines,
- energy spectrum panel,
- structure detection overlay,
- topology event markers.
