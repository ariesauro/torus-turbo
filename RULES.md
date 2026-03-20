# RULES

## Назначение

Единые правила для AI-ведения проекта Torus Turbo как научного vortex solver.

## Источник истины

При конфликте чатов и файлов приоритет имеют:

1. `docs/ROADMAP_V2.md` — физика, архитектура, Phase 5 scaffold-killlist
2. `docs/ROADMAP.md` — PM/task-tracking (legacy TT-xxx)
3. `docs/TASKS.md`
4. `docs/PROJECT_CONTEXT.md`

Чат используется только для обсуждения и уточнений.

## Текущее состояние проекта (2026-03-19)

**Emergence Score: 8.7 / 10** (было 6.75, было 1.75) — 7 категорий, 15 тестов  
**Тесты**: 8/8 PASS (`npm run test:convergence`) + 15/15 PASS (`npm run test:emergence`)

### Что работает (IMPLEMENTED)

| Модуль | Статус |
|--------|--------|
| VPM: PSE diffusion, analytic stretching, CFL dt, RK2 | OK |
| Filament: Biot-Savart, LIA, viscous reconnection | OK |
| Vortex tubes | OK |
| FMM solver (monopole p=0) | OK (p=2 TODO) |
| Simulation Lab (7 presets, batch, artifacts) | OK |
| Topology tracking, Newtonium tracker | OK |
| Structure detection (упрощённый) | OK |
| Ring/Jet/Fusion contracts | OK |
| Representation policy engine | OK |
| Snapshot export pipeline | OK |

### Что scaffold (логика есть, не подключена)

| Модуль | Проблема | Phase 5 |
|--------|---------|---------|
| Vortex Sheet | Файлы считают quality для несуществующего mesh | — (далёкая перспектива) |
| ~~Object hierarchy~~ | ~~Cluster/Sheet/Newtonium = метки, не data structures~~ | ~~P5.6/P5.7~~ DONE |
| Transitions | State machine классифицирует, но не конвертирует представления | — |
| ~~Ring lifecycle~~ | ~~Validation score есть, lifecycle нет~~ | ~~P5.7~~ DONE |
| ~~Adaptive Resolution~~ | ~~Работает только в Lab, не в runtime~~ | ~~P5.2~~ DONE |
| ~~Scale Physics~~ | ~~Из Re/St/Ro применяется только ν~~ | ~~P5.1~~ DONE |
| ~~LOD rendering~~ | ~~Policy считает tier, визуально ничего не меняется~~ | ~~P5.10~~ DONE |
| ~~Sci-viz~~ | ~~Раскраска частиц~~ | ~~P5.9~~ DONE |
| ~~Stability monitor~~ | ~~Диагностирует, не корректирует~~ | ~~P5.5~~ DONE (TT-030C) |

### Что stub (пустые placeholder'ы)

| Модуль | Phase 5 |
|--------|---------|
| ~~`applyBoundaryInteractionHook()`~~ | ~~P5.3~~ DONE |
| ~~`applyWakeForcingHook()`~~ | ~~P5.4~~ DONE |

**Текущий приоритет**: Phase 1–6 ALL DONE. Проект в состоянии research-ready.

## Обязательные обновления

После каждого значимого шага:

- обновить `docs/ROADMAP_V2.md` (Phase 5 статусы),
- обновить `docs/TASKS.md` / `docs/PROGRESS.md`,
- синхронизировать `dev/dashboard.html`,
- если scaffold → implemented: обновить таблицу выше и physics-guard rule.

## Статусы

- `TODO` / `IN_PROGRESS` / `DONE`
- Для кода: `[IMPLEMENTED]` / `[SCAFFOLD]` / `[STUB]` / `[SPEC ONLY]`
- Допускается несколько `IN_PROGRESS`, но одна главная (primary focus).
- Scaffold допустим только с ссылкой на Phase 5 задачу. Новые scaffold'ы запрещены.

## Правила работы с кодом

### Запрет на scaffold inflation

- **Не создавать** новые diagnostic contracts, policy engines, или validation gates для физики, которая не реализована.
- Сначала физический оператор → потом contract/policy для него.
- Существующие scaffold'ы: довести до implementation (Phase 5) или пометить `[DEPRECATED]`.

### Запрет на fake-физику

- Каждый оператор: `[CORRECT]`, `[PROXY]`, или `[PLACEHOLDER]` — в коде.
- Proxy допустим временно, с TODO и ссылкой на Phase 5.
- Placeholder = stub. Должен быть в Phase 5 kill-list.

### Conservation

- Оператор, меняющий ω/γ/σ → документировать влияние на Γ, E, Ω.
- Hard clamp = safety net с логированием. Не физика.

### Dual-codebase

- JS ↔ WGSL: изменение в одном → изменение в другом (или explicit TODO).

### Валидация

- Новый физический оператор → аналитический тест в `audit-runner/`.

## Архитектурные правила

- Модель уровней: `Amer → (Cluster) → Filament → Tube → (Newtonium)`.
  - В скобках — semantic labels, не physical data structures (пока не реализовано).
- Любая подсистема: явно CPU/GPU/Hybrid.
- 4 реализации Biot-Savart: direct, FMM, spatial, GPU hash-grid — при изменении ядра проверять все.

## Научные правила

- Любые эвристики → метрики валидации.
- Визуальные эффекты ≠ физическая модель (без явного флага).
- `internal diagnostics` ≠ `external validation eligibility` во всех verdict-контурах.
- `guidedPhysics` + модификаторы → external validation = `not eligible`.

## Языковая политика

- Общение: русский.
- UI/сообщения: двуязычные (`ru`/`en`).

## Новый чат ("привет")

1. Открыть `docs/PROJECT_CONTEXT.md`.
2. Свериться с `docs/ROADMAP_V2.md` (Phase 5 — текущий фокус).
3. Проверить `docs/TASKS.md`.
4. Предложить следующую задачу Phase 5 (приоритет: P5.1 → P5.2 → P5.5 → P5.3).

## Ключевые файлы

| Файл | Назначение |
|------|-----------|
| `docs/ROADMAP_V2.md` | Physics-first roadmap (5 фаз, Phase 5 = scaffolds) |
| `docs/ROADMAP.md` | Legacy PM (TT-xxx) |
| `docs/PROJECT_CONTEXT.md` | Persistent context |
| `dev/dashboard.html` | Dashboard + Physics Integrity |
| `src/simulation/physics/vpm/pipeline.js` | VPM pipeline entry |
| `src/simulation/filaments/filamentSolver.js` | Filament solver entry |
| `src/simulation/physics/updateParticles.js` | CPU/GPU orchestrator |
| `src/simulation/runtime/simulationRuntime.js` | Main runtime loop |
| `src/simulation/scaling/nondimensionalScaling.js` | Scale physics (P5.1 target) |
| `src/simulation/adaptive/resolutionController.js` | Adaptive resolution (P5.2 target) |
| `src/simulation/stability/stabilityMonitor.js` | Stability monitor (P5.5 target) |
| `audit-runner/convergenceTest.mjs` | 8 physics tests |
| `audit-runner/emergenceAudit.mjs` | 13 emergence tests (P6.2) |
| `audit-runner/gpuParityAudit.mjs` | CPU/GPU parity test (P3.3) |
