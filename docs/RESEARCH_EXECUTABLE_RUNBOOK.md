# RESEARCH_EXECUTABLE_RUNBOOK

Последнее обновление: 2026-03-18

## Назначение (`TT-038`)

Сделать `TT-037` исполнимым: связать research-matrix с готовым Lab preset pack и единым контрактом именования артефактов.

## Preset Pack v1

Preset pack реализован в `src/simulation/lab/runtimeLabRunner.js` и доступен через:

- `getLabPresetOptions()`
- `getResearchPresetPackV1()`

Состав pack v1:

1. `vortex_ring_collision`
2. `vortex_leapfrogging`
3. `jet_instability`
4. `turbulence_cascade`
5. `helmholtz_shear`
6. `kelvin_wave_train`
7. `reconnection_pair`

Каждый preset содержит hypothesis + sweep + acceptance checks и может быть запущен без ручной сборки контракта.

## Artifact Naming Contract v1

Контракт реализован в `src/simulation/lab/labArtifacts.js`:

- `buildLabArtifactFileName(...)`
- версия контракта: `tt038.lab_artifact_name.v1`

Формат имени:

`torus-lab-<experimentId>-<artifactKind>-<status>-r<totalRuns>-<configHashShort>-<timestamp>.<ext>`

Где:

- `experimentId` — slug из `experiment.id`/`title`,
- `artifactKind` — `result` / `summary` / `adaptive-acceptance`,
- `status` — `ok` / `partial` / `fail`,
- `totalRuns` — из `batchResult.totals.total`,
- `configHashShort` — укороченный hash конфигурации,
- `timestamp` — UTC stamp без двоеточий.

## Export Integration

Lab Panel export (`src/ui/ControlPanel.jsx`) использует naming contract для:

- JSON (`result`)
- CSV (`summary`)
- Markdown (`adaptive-acceptance`)

Payload JSON также включает метаданные:

- `metadata.artifactNamingContract = "tt038.lab_artifact_name.v1"`.

## Acceptance Criteria

- Все Lab exports формируют детерминированные имена без ручного rename.
- Наименование отражает experiment/config/status/run-count.
- Research preset pack покрывает families из `TT-037` (rings/jets/turbulence/Helmholtz/Kelvin/reconnection).

## Audit Bridge (`TT-039`)

- Mini acceptance-аудит preset pack реализован в `audit-runner/researchPresetPackAudit.mjs`.
- Runbook и команды: `docs/RESEARCH_PRESET_PACK_AUDIT.md`.
