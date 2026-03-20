# Torus Turbo — Project Full Audit

> **Note**: This audit predates the Physics-First Redesign (2026-03-19). For current state see `ROADMAP_V2.md`.

Дата аудита: 2026-03-16  
Область: runtime симуляции вихревой динамики (Amer particles, filaments, tubes, hybrid/hybrid+), визуализация, GPU compute.

## 1.1 Структура проекта

### Верхний уровень (инвентарь директорий)

- `src` — основной frontend/runtime код симуляции.
- `src/simulation` — физика и численные решатели:
  - `physics` (VPM, Biot-Savart, FMM, WebGPU, emission),
  - `filaments` (LIA, reconnection, topology adaptation),
  - `runtime` (fixed-step scheduler, hybrid+, orchestration),
  - `tubes` (vortex tube projection),
  - `params` (default/normalize/storage).
- `src/scene` — Three.js сцена, render loop, GPU snapshot adapter.
- `src/ui` — control panel, i18n messages (`ru`/`en`), diagnostics VM.
- `src/state` — Zustand store.
- `src-tauri` — desktop shell (Tauri Rust app + generated artifacts).
- `docs` — технические заметки/аудиты.
- `scripts`, `public`, `dist`, `dist-app`, `audit-runner` — tooling/build/test artifacts.
- Также присутствуют служебные корневые файлы: `README.md`, `RULES.md`, `package.json`, `vite.config.js`, `eslint.config.js`, `index.html`.

### Детализация директорий `src`

- `src/scene`
  - `src/scene/helpers`
- `src/simulation`
  - `src/simulation/filaments`
  - `src/simulation/runtime`
  - `src/simulation/params`
  - `src/simulation/tubes`
  - `src/simulation/physics`
    - `src/simulation/physics/vpm`
    - `src/simulation/physics/fmm`
    - `src/simulation/physics/emission`
    - `src/simulation/physics/webgpu`
    - `src/simulation/physics/runtime`
    - `src/simulation/physics/spatialAcceleration`
      - `src/simulation/physics/spatialAcceleration/shaders`
- `src/ui`
  - `src/ui/i18n`
  - `src/ui/controls`
- `src/state`
- `src/dev`

### Ключевые модули (по runtime-пайплайну)

- `src/scene/VortexScene.jsx` — главный кадр: `beginFrame`, `stepSimulationRuntime`, `render`.
- `src/simulation/runtime/frameScheduler.js` — fixed-step аккумулятор.
- `src/simulation/runtime/simulationRuntime.js` — orchestration CPU/GPU/hybrid/hybrid+.
- `src/simulation/physics/updateParticles.js` — particle-side шаг (CPU/GPU).
- `src/simulation/filaments/hybridCoupling.js` — частицы <-> филаменты.
- `src/simulation/filaments/filamentSolver.js` — filament substeps, LIA, smoothing, reconnection.
- `src/simulation/physics/webgpu/hashGridParticleComputeManager.js` — WebGPU hash-grid pipeline.
- `src/simulation/runtime/hybridPlusPlanner.js`, `hybridPlusOperators.js` — assist-операторы Hybrid+.

### Module inventory (основные файлы домена)

- Scene/runtime:
  - `src/scene/VortexScene.jsx`
  - `src/scene/helpers/*`
  - `src/simulation/runtime/{frameScheduler,simulationRuntime,hybridPlusPlanner,hybridPlusOperators,barnesHutAssist}.js`
- Particle physics:
  - `src/simulation/physics/updateParticles.js`
  - `src/simulation/physics/vpm/*`
  - `src/simulation/physics/fmm/*`
  - `src/simulation/physics/spatialAcceleration/*`
  - `src/simulation/physics/webgpu/hashGridParticleComputeManager.js`
  - `src/simulation/physics/emission/*`
- Filament/tube:
  - `src/simulation/filaments/*`
  - `src/simulation/tubes/*`
- Params/store/ui:
  - `src/simulation/params/*`
  - `src/state/simulationStore.js`
  - `src/ui/*`, `src/ui/i18n/*`

### Зависимости (package.json)

Runtime:

- `react`, `react-dom`
- `three`, `@react-three/fiber`, `@react-three/drei`
- `zustand`
- `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-fs`
- `@tensorflow/tfjs`
- `playwright`, `pngjs`

Dev/tooling:

- `vite`, `@vitejs/plugin-react`, `vite-plugin-singlefile`
- `eslint` + `@eslint/js` + react plugins
- `tailwindcss`, `@tailwindcss/vite`
- `@tauri-apps/cli`

## 1.2 Simulation Pipeline

Целевой порядок:

1. `beginFrame`
2. `simulationRuntime`
3. `updateParticles`
4. `applyHybridCoupling`
5. `stepFilaments`
6. `render`

### 1) beginFrame (`frameScheduler.beginFrame`)

- Читает: `lastFrameTime`, `maxFrameDelta`.
- Меняет: `lastFrameTime`, `accumulator`.
- Сложность: `O(1)`.
- CPU/GPU: CPU-only.

### 2) simulationRuntime (`stepSimulationRuntime`)

- Читает: scheduler, runtime status, params, backend flags, hybrid/tube states.
- Меняет: runtime counters, policy sync/readback, quality guards, hybrid contexts, tube stats.
- Сложность: `O(K * (particle_step + filament_step))`, где `K <= maxCatchUpSteps`.
- CPU/GPU:
  - CPU: orchestration, diagnostics, filament/tube path.
  - GPU: диспатч particle compute (через manager), async readback.

### 3) updateParticles (`updateParticles`)

- Читает: particles, params, `webgpuManager`, pulse/emission state.
- Меняет: particle positions/velocities/vorticity, circulation normalization, emission append queue.
- Сложность:
  - CPU exact Biot-Savart: до `O(N^2)`.
  - CPU spatial grid: около `O(N * k)`.
  - CPU FMM: около `O(N log N)`.
  - GPU hash-grid: примерно `O(N * k)` в compute passes.
- CPU/GPU:
  - CPU path: полный апдейт в JS.
  - GPU path: poll/submit/readback, CPU side-effects только при синхронизации snapshot.

### 4) applyHybridCoupling (`hybridCoupling.applyHybridCoupling`)

- Читает: particles, filaments, filament solver context, hybrid params.
- Меняет:
  - у частиц: `crossFlow*`, `selfFlow*`, `flow*`;
  - у filament nodes: `couplingVelocity`;
  - hybrid stats buckets.
- Сложность:
  - build particle grid: `O(Np)`,
  - sampling nodes по соседям: `O(Nf_nodes * k)`,
  - filament->particle coupling: `O(Np * local_segments)` (через segment grid в filament context).
- CPU/GPU: сейчас CPU-only (до GPU не вынесено).

### 5) stepFilaments (`filamentSolver.stepFilaments`)

- Читает: filament topology, params, coupling velocities, particle hints.
- Меняет: node positions/velocities, topology (split/merge/reconnect), quality stats.
- Сложность:
  - self-induced velocity sampling: от `O(Nf_nodes * local_segments)` до выше при плотной геометрии,
  - substeps: множитель `S` (`filamentMaxSubsteps`),
  - adapt/reconnect: зависит от локальной геометрии, обычно `O(Nf_nodes)` до `O(Nf_nodes log Nf_nodes)`.
- CPU/GPU: CPU-only.

### 6) render (`VortexScene animate -> renderer.render`)

- Читает: runtime particles/filaments/tubes, GPU snapshot render source policy.
- Меняет: Three.js buffers/material state, UI runtime params.
- Сложность:
  - particle draw/update: `O(Nrender)`,
  - filament/tube visuals: `O(Nf_nodes + Nt_nodes)`.
- CPU/GPU:
  - CPU: scene graph update.
  - GPU (graphics): final rasterization by WebGL renderer.

## 1.3 GPU Pipeline (WebGPU)

Файл: `src/simulation/physics/webgpu/hashGridParticleComputeManager.js`

### Compute kernels / passes

Основные passes:

- `baseUpdate`
- `clearGrid` + `binParticles` (hash build)
- `computeFlow`
- `confinement`
- `stability`
- `guidance` (для Natural/guided path)
- `advect`
- опционально: `stretching`, `diffusion`, `merge pipeline` (`findMergeTarget`, `resolveMergeOwner`, `mergeParticles`, `compact`)

### Hash grid

- Хеширование cell -> bucket (`power-of-two table`).
- `bucketCapacity` адаптивно меняется при overflow/collision pressure.
- Таблица и bucket capacity растут/сжимаются по диагностике.

### Memory layout

- `FLOATS_PER_PARTICLE = 24` (`vec4`-пакет данных: position/life, velocity/age, vorticity/gamma, flow/id...).
- Double-buffer state (`src/dst`) для ping-pong compute.
- Доп. буферы:
  - `gridCounts`, `gridIndices`,
  - `mergeTarget`, `mergeOwner`, `aliveFlags`,
  - `counterBuffer`,
  - readback buffers (full + diagnostics sample).

### Buffer synchronization

- Async submit + `mapAsync` readback.
- Полный readback не каждый кадр (`fullReadbackInterval`, forced sync modes).
- Diagnostics readback с отдельной частотой.
- Snapshot epoch + stale-drop защита.

### Оценка производительности

- Bandwidth: высокий поток global memory из-за множества storage buffer passes и нескольких grid rebuild за шаг.
- Readback cost: значимый; смягчается cadence-политикой и частичным diagnostics readback.
- Parallelization: хороший SIMD-parallel потенциал на particle-level; узкое место в atomics (`gridCounts`, collisions/overflow counters).

## 1.4 CPU Physics Audit

### Biot-Savart

- Реализации:
  - точная (`vpm/biotSavart`) — `O(N^2)`,
  - spatial grid (`spatialAcceleration/biotSavartSpatial`) — близко к `O(N * k)`,
  - filament-side sampling (`biotSavartFilament`) — локально-ускоренная.

### FMM / Tree

- `physics/fmm/{octree,multipole,biotSavartFmm}.js`.
- Типичная сложность: `O(N log N)` (построение дерева + обход с multipole accept criterion).

### Spatial grid

- Particle uniform grid + aggregated distant cells.
- Цель: перейти от `O(N^2)` к `O(N * k)` при ограниченном neighbor radius.

### Filament solver

- `filamentSolver`:
  - self-induced velocity + LIA,
  - adaptive substeps (CFL-like),
  - smoothing + regularization,
  - adapt split/merge,
  - reconnection.
- Сложность: условно `O(S * Nf_nodes * k_local) + topology_overhead`.

### Reconnection / stretching

- Reconnection: пороги расстояния/угла, cooldown, multi reconnect budget.
- Stretching (VPM / GPU pass): analytic (ω·∇)u (default); legacy neighbor-driven Gaussian-weighted Δv available as fallback (`stretchingMethod: 'legacy'`).
- Сложность: обычно `O(N * k)`, но может деградировать при сильной локальной плотности.

## 1.5 Hybrid Pipeline (particles ↔ filaments)

Главный файл: `src/simulation/filaments/hybridCoupling.js`

### Текущее взаимодействие

- Particle -> Filament:
  - строится particle grid,
  - для каждого filament node берется локальная particle-induced velocity,
  - применяются clamps (magnitude / outward / center drift guards),
  - пишется `node.couplingVelocity`.
- Filament -> Particle:
  - для каждой частицы sampling filament velocity,
  - merge в `flowV*` через `crossFlow*`.

### Где оптимизировать CPU/GPU баланс

1. **Particle->Filament sampling на GPU**
   - Сейчас CPU-bound (`Np` grid уже есть в GPU path, но coupling отдельно на CPU).
   - Кандидат: compute pass, который пишет coupling velocity для filament nodes в отдельный storage buffer.

2. **Filament->Particle coupling batching**
   - Сейчас per-particle CPU sampling.
   - Возможен batched grid traversal с SIMD-friendly layout (SoA для filament segments).

3. **Readback minimization в strict hybrid**
   - Hybrid требует частых sync, что съедает FPS.
   - Ввести partial readback только для coupling-relevant subset (не весь particle buffer).

4. **Unified acceleration structure**
   - Сейчас particle hash-grid (GPU) и filament segment grid (CPU) живут раздельно.
   - Нужен общий контракт spatial index metadata для уменьшения rebuild cost.

5. **Hybrid+ operator offload**
   - Topology/BH assist уже есть.
   - Следующий шаг: перенос части assist в compute kernels с delta-application без полного CPU round-trip.

## 12. Performance Audit (критичные узкие места)

1. Biot-Savart exact path (`O(N^2)`) для больших `N`.
2. Particle interactions в computeFlow при высоком collision/hash pressure.
3. Filament solver substeps + reconnection spikes при сложной топологии.
4. GPU full readback при strict sync/hybrid scenarios.
5. Double grid rebuild в GPU pass (при stretching/merge path).

## 13. CPU/GPU оптимальный баланс (текущее заключение)

- **GPU mode**: particles на GPU, filament/tube функции ограничены.
- **CPU mode**: хорошо для отладки физики, но масштабируется хуже.
- **Hybrid**: лучший физический компромисс сейчас, но sync/readback overhead остается главным риском.
- **Hybrid+**: правильное направление (assist operators + delta sync), требует дальнейшей декомпозиции coupling и topology на частичные GPU-задачи.

Рекомендованная целевая стратегия:

- Particles + near-field interactions: GPU.
- Filament topology/reconnection: CPU (пока).
- Coupling transport layer: гибридный mixed path с минимальным readback и delta-only sync.
