# Fast Multipole Vortex Solver (TT-029A)

Цель: ускорить расчет Biot-Savart взаимодействий Amer с `O(N^2)` к `O(N log N)` (treecode) и целевому `O(N)` в FMM-режиме.

## 1) Научно корректная постановка

Для вихревых частиц "далекие группы -> multipole approximation" применимо только при явном контроле ошибки:

- opening criterion (`theta`),
- order multipole expansion,
- periodic accuracy checks против reference naive block.

## 2) Spatial Hierarchy

Используем `octree`:

- node fields: `center`, `radius`, `particleCount`, `totalCirculation`, `multipoleCoeffs`.
- leaf criterion: `maxLeafSize` или `maxDepth`.

## 3) Build Strategy

На каждый major step:

1. build/update tree,
2. assign particles,
3. upward pass for multipole coefficients.

Оптимизация: incremental rebuild допустим для малого displacement.

## 4) Multipole Orders

Минимально:

- monopole,
- dipole,
- quadrupole.

Order выбирается profile-aware (quality/performance modes).

## 5) Interaction Traversal

Для target particle:

1. traverse tree,
2. если `theta = nodeSize / distance < thetaMax` -> multipole evaluate,
3. иначе open node,
4. leaf-near interactions считаем direct.

## 6) Near/Far Split

- near-field: direct sum (GPU-friendly path),
- far-field: multipole traversal (CPU или GPU compute).

В гибридном режиме избегать лишних readback: считать near/far в согласованном memory domain.

## 7) Runtime Integration

Новый solver режим:

- `velocityComputationMode = exact | spatialGrid | fmm | auto`,
- runtime diagnostics публикуют `runtimeSolverMode` (resolved) и `runtimeSolverModeRequested` (requested).

Adaptive policy (`auto`):

- small `N` -> `exact`,
- medium `N` -> `spatialGrid`,
- large `N` -> `fmm`,
- thresholds управляются runtime params: `velocityAutoExactMaxParticles`, `velocityAutoSpatialMaxParticles`.
- anti-flap guards: `velocityAutoHysteresisParticles`, `velocityAutoSwitchEnterSteps`, `velocityAutoSwitchCooldownSteps`.

## 8) Accuracy and Stability Gates

Метрики:

- velocity relative error vs reference subset,
- circulation drift bounds,
- energy drift bounds,
- step latency (`median/p95`).

## 9) Benchmark Matrix

Обязательные точки:

- `10k`, `50k`, `100k`, `500k`.

Сравнение:

- naive vs treecode/fmm,
- accuracy vs speedup tradeoff curves.

## 10) Filament Interaction

Filament far-field можно аппроксимировать multipole source blocks только после отдельной валидации:

- сперва Amer-only FMM,
- затем optional filament far-field extension (phase 2).

## 11) Diagrams (документационные артефакты)

- octree build,
- traversal decision flow,
- multipole pass pipeline.

## 12) Benchmark matrix artifacts (`TT-029C`)

Run:

- `cd audit-runner && npm run benchmark:fmm:matrix`

Artifacts:

- `audit-runner/fmm-benchmark-matrix.json`
- `audit-runner/fmm-benchmark-matrix.md`

Contract:

- matrix points: `10k/50k/100k/500k`,
- full-step performance is executed inside practical runtime limits (`exact/spatial/fmm` full limits are encoded in the artifact config),
- accuracy is evaluated for every matrix point via exact reference block (`relRMSE`, `MAE`, `maxAbsErr`),
- gate verdict (`PASS/FAIL`) is included in JSON/MD output.
