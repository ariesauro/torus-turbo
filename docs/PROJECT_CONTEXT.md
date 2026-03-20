# PROJECT_CONTEXT

Этот файл — короткий persistent context проекта для новых чатов.  
Источник истины: `docs/ROADMAP_V2.md` (физика + Phase 5), `docs/ROADMAP.md` (PM), `docs/TASKS.md`.

## 0) Статус проекта (2026-03-19)

**Вердикт**: научная вихревая симуляция с верифицированными физ. операторами (Phase 5 complete).  
**Emergence Score: 8.7 / 10** (15/15 PASS; `npm run test:emergence` + 8/8 `npm run test:convergence`)  
**Архитектурный долг**: минимальный — все scaffold'ы реализованы.

### Что работает
- VPM: PSE diffusion, analytic (ω·∇)u, CFL dt, RK2, M'4 remeshing
- Filaments: Biot-Savart, LIA, viscous reconnection
- Tubes: Biot-Savart integration, stretching, reprojection
- FMM: quadrupole (p=2) + O(N log N) tree walk, auto-switching exact/spatial/fmm
- Lab: 7 presets, batch runner, artifacts, CSV, localStorage, UI
- Detection: structure classifier, topology tracker, Newtonium state machine
- Contracts: ring validation, jet regime, fusion — all gate-checked
- GPU: WGSL shaders match CPU physics (PSE + analytic stretching); parity test PASS (|δx|/h=0.00038)
- LES: Smagorinsky SGS model (ν_sgs = (C_s·Δ)²·|S|, per-particle eddy viscosity)
- Buoyancy: Boussinesq baroclinic torque + temperature PSE diffusion

### Scaffold'ы (Phase 5 targets)
- ~~**Scale Physics** → только ν применяется в runtime (P5.1)~~ **DONE**: full runtime scaling
- ~~**Adaptive Resolution** → только в Lab, не в runtime (P5.2)~~ **DONE**: wired into main runtime
- ~~**Stability monitor** → только диагностика, нет auto-correction (P5.5)~~ **DONE**: auto-correction implemented (TT-030C)
- ~~**Boundary/Wake** → пустые hooks (P5.3, P5.4)~~ **DONE**: image vortex boundary + uniform wake
- ~~**Structure detection** → упрощённый (P5.6)~~ **DONE**: full PCA + circulation closure
- ~~**Ring lifecycle** → нет state machine (P5.7)~~ **DONE**: forming→stable→deforming→breakdown
- ~~**FMM** → monopole only (P5.8)~~ **DONE**: quadrupole (qTrace)
- ~~**Sci-viz** → раскраска частиц (P5.9)~~ **DONE**: grid fields + RK4 streamlines + E(k)
- ~~**LOD** → policy считает, rendering не меняется (P5.10)~~ **DONE**: visual LOD applied

## 1) Архитектура

- Runtime: `beginFrame → stepSimulationRuntime → updateParticles → applyHybridCoupling → stepFilaments → render`
- VPM pipeline: `Biot-Savart → confinement → clamp → advect → [stretching, diffusion] → reconnection → clamp → [remesh]`
- Dual codebase: CPU (JS float64) + GPU (WGSL float32)
- 4 Biot-Savart: direct N² / FMM / spatial grid / GPU hash-grid

## 2) Текущий roadmap-фокус

**Phase 1–6 — ALL DONE.** Phase 7 (Native Core) — следующий.

### Phase 7 — Native Core (Rust + wgpu) — ALL DONE
Вычислительное ядро на Rust + wgpu:
- P7.1 Rust workspace + data structures — **DONE** (16 tests)
- P7.2 wgpu compute pipeline (13 shaders + GpuComputeManager + VelocityComputer) — **DONE** (6 tests)
- P7.3 CPU physics Rust + rayon (7 operators + pipeline) — **DONE** (35 tests)
- P7.4 FMM Rust (octree + multipole + tree walk) — **DONE** (9 tests)
- P7.5 Tauri bridge (6 IPC commands) — **DONE**
- P7.6 Native rendering (bridge adapter + wgpu shader) — **DONE**
- P7.7 Dual-build (build:native / build:web / build:all) — **DONE**
- P7.8 Cross-compilation (5 targets + CI) — **DONE**
- P7.9 Parity tests (6 physics verifications) — **DONE**

57 tests PASS. 13 WGSL shaders. VelocityComputer: CPU/GPU auto-detect.
Splash: Native CPU+GPU (platform) / WebGPU / CPU. Dual-codebase sync rule.
Cross-compile: macOS arm64/x64/universal, Linux x64/arm64.
Build: `npm run build:all` → 4 артефакта (web HTML + 3 native).

### Phase 8 — Distributed Compute (Network) — TODO
Распределённые вычисления по сети (требует Phase 7):
- P8.1 Network protocol + domain decomposition — TODO
- P8.2 Single-machine multi-GPU — TODO
- P8.3 LAN distributed compute (server/worker/observer) — TODO
- P8.4 FMM distributed (multipole exchange вместо ghost particles) — TODO
- P8.5 Conservation validation + fault tolerance — TODO
- P8.6 Headless server mode (CLI, без Tauri/UI) — TODO

### Dual-build архитектура
```
torus-core/          ← Rust crate (native engine: torus-physics, torus-gpu, torus-fmm, torus-net, torus-bridge)
src/                 ← JS engine (web mode, как сейчас)
src-tauri/           ← Tauri app shell (подключает torus-bridge ИЛИ проксирует в WebView)
```
- `npm run build:native` → Rust core + Vite UI + Tauri bundle
- `npm run build:web` → JS core + Vite UI + Tauri bundle
- `npm run build:all` → оба параллельно

Convergence: 8/8 PASS. Emergence: 15/15 PASS (8.7/10). GPU parity: PASS.

## 3) Ключевые файлы

| Файл | Что |
|------|-----|
| `RULES.md` | Правила + scaffold/stub таблицы |
| `docs/ROADMAP_V2.md` | Roadmap (5 фаз) |
| `src/simulation/physics/vpm/pipeline.js` | VPM pipeline |
| `src/simulation/runtime/simulationRuntime.js` | Main runtime loop |
| `src/simulation/scaling/nondimensionalScaling.js` | Scale physics (P5.1) |
| `src/simulation/adaptive/resolutionController.js` | Adaptive resolution (P5.2) |
| `src/simulation/stability/stabilityMonitor.js` | Stability monitor (P5.5) |
| `audit-runner/convergenceTest.mjs` | 8 physics tests |
| `audit-runner/emergenceAudit.mjs` | 15 emergence tests (P6.2+P6.6) |
| `audit-runner/gpuParityAudit.mjs` | CPU/GPU parity test (P3.3) |

## 4) Governance

- Все 71 задач (TT-001..TT-070) закрыты.
- Governance контур: `benchmark:governance[:ci|:freshness:ci]` — 20 validation contours, 5 tiers, 3 profiles.
- Runbook: `docs/VALIDATION_GOVERNANCE_RUNBOOK.md`.

## 5) Новый чат

1. Открыть этот контекст.
2. `docs/ROADMAP_V2.md` → Phase 7-8 status (native core + distributed).
3. Phase 1-7 полностью завершены. Проект: research-ready + native compute core.
4. Следующий этап: Phase 8 — Distributed compute (network, multi-GPU).
