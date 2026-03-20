# Torus Turbo Roadmap (Legacy PM)

> **Physics-first roadmap**: см. `docs/ROADMAP_V2.md` — 4 фазы, 17 задач, Emergence Score 6.75/10.  
> Этот файл сохранён для PM task tracking (TT-xxx). Для физического направления используйте ROADMAP_V2.

Горизонт: научный vortex solver (CPU / GPU / Hybrid / Hybrid+), с устойчивой архитектурой и воспроизводимыми экспериментами.

## Приоритет и порядок (строгий)

- `P0` (numerical correctness first): закрыть `TT-017D`, затем `TT-030` (Numerical Stability System, базовые guards + мониторинг).
- `P1` (representation foundations): `TT-021` + `TT-022` + `TT-023` + `TT-024` закрыты.
- `P2` (solver acceleration + physical realism): `TT-029` (FMM) + `TT-032` (Physical Realism Modules) закрыты.
- `P3` (scientific object models): `TT-023` (ring) + `TT-024` (jet) + `TT-025` (detector fusion) закрыты.
- `P4` (analysis + advanced visualization): `TT-026` + `TT-019` + `TT-028` + `TT-031` закрыты.
- `P5` (research infrastructure, reproducibility-first): `TT-033` (Simulation Lab Mode) -> `TT-034` (Scale Physics Mode) -> `TT-035` (Adaptive Resolution System).

## Строгие уточнения addendum

- Consolidated audit: `ADDENDUM_LAB_SCALE_ADAPTIVE_STRICT_ANALYSIS.md`.
- Vortex sheet нельзя описывать только как "mesh с velocity в вершинах": нужна surface strength density (`gamma_s`) + панельная квадратура интеграла Биота-Савара.
- Переходы между представлениями не должны быть детерминированы одним триггером: нужны hysteresis, confidence gates и контроль инвариантов (`Gamma`, импульс, bounded drift энергии).
- `sheet -> filament` и `sheet -> particles` должны трактоваться как оператор дискретизации/редукции с оценкой погрешности, а не как "автоматическое мгновенное преобразование".
- Для ring/jet необходимо фиксировать безразмерные режимные параметры (`Re`, `St`, `L/D`) и валидационные критерии, иначе модель будет эвристической, а не научной.
- Для FMM недостаточно формулы "много частиц -> один кластер": нужен явный контроль ошибки аппроксимации и проверка conservation bounds.
- Topology модуль должен быть аналитическим (read-only) и асинхронным, чтобы не влиять на физический шаг.
- Q-criterion нужно трактовать как диагностический инвариант поля скорости, а не как единственный детектор вихря.
- Boundary realism (no-slip, image vortices, shedding) требует явной модели границ и валидации по сценариям; без этого возможны нефизичные артефакты.

## Physics Engine

- Формализовать единый физический контракт Amer/Filament/Tube/Newtonium.
- Стабилизировать циркуляцию и инварианты при длинном прогоне.
- Расширить физические тест-кейсы для ring/jet/turbulence сценариев.
- Промежуточные шаги:
  - DONE: базовая архитектура и контракты объектов (`TT-001..TT-004`).
  - DONE: длинные drift-бенчмарки и gate-пороговая валидация (`TT-017D`).

## GPU Compute

- Вынести coupling-критичные операции в compute-пассы.
- Снизить стоимость readback через delta/partial sync.
- Добавить профилировочные метрики по pass-level bandwidth.
- Завершено: `TT-011` (RFC + API + MVP query kernel + интеграция + diagnostics).
- Промежуточные шаги:
  - DONE: query-aware cadence + delta-proto sync (`TT-012`).
  - DONE: runtime diagnostics counters для readback/sync/hash.
  - DONE: GPU parity test — CPU/GPU produce same results (|δx|/h = 0.00038, P3.3).

## Hybrid Solver

- Укрепить strict/relaxed sync policies.
- Реализовать coupling offload roadmap (particle->filament затем filament->particle batching).
- Расширить Hybrid+ assist operators (топология + far-field).
- Завершено: `TT-013` filament->particle batching acceleration.
- Закрытый deliverable: `TT-018` Hybrid+ operators expansion.
- Промежуточные шаги:
  - DONE: базовый Hybrid+ runtime diagnostics и operators plumbing.
  - DONE: расширение topology/BH scheduling (`TT-018`).
  - DONE: adaptive assist scheduler (budget-aware cadence + runtime counters, `TT-018A`).
  - DONE: operator prioritization / anti-thrash policy (`TT-018B`) + audit protocol (`TT-018C`).

## Vortex Structures

- Внедрить detection pipeline (alignment/PCA/loop/topology).
- Добавить tracking структур между кадрами.
- Сопоставить структуры с Newtonium-классами.
- Завершено: `TT-014` detection MVP в runtime с adaptive calibration.
- Завершено: `TT-015` Newtonium classifier + temporal tracking.
- Закрытый deliverable: `TT-028` topology tracking + view/export.
- Промежуточные шаги:
  - DONE: detection metrics + confidence smoothing/autocalibration.
  - DONE: detector extension на `sheet/ring/tube/filament` fusion (`TT-025`): sheet features (`surfaceCoherence/curvatureAnisotropy`) + multiclass fusion contract (`tt025b.detector_fusion.v1`) в runtime/UI/snapshot.
  - DONE: визуальные overlays для detected structures (`TT-019`) с uncertainty composition coupling + class-aware glyphs, confidence-threshold фильтрацией и sheet scientific layer path.

## Turbulence Physics

- Kelvin wave + instability model calibration.
- Ввести energy spectrum diagnostics.
- Реализовать controlled breakdown сценарии.
- Завершено: `TT-016` energy/enstrophy spectrum diagnostics в runtime.
- Промежуточные шаги:
  - DONE: energy/enstrophy bins в runtime diagnostics.
  - DONE: turbulence breakdown audit matrix (`cpu/gpu x single_pulse/pulse_train/long_run`) + gate thresholds (`circulationDriftPercent`, `sigmaOverR`, GPU dispatch lock) в `audit-runner/turbulenceBreakdownAudit.mjs`.
  - DONE: controlled instability scenarios и reproducible artifacts (`turbulence-breakdown-audit.{json,md}`) + CI fail mode.

## Numerical Stability

- Расширить CFL/substep адаптацию.
- Добавить автоматический guard на pathological topology.
- Ввести long-run drift отчеты.
- Текущий deliverable: `TT-017` long-run stability benchmark suite.
- Промежуточные шаги:
  - DONE: benchmark profiles `standard/smoke/nightly`.
  - DONE: baseline gates (global + mode-specific + CI fail mode).
  - DONE: first-run hardware auto-calibration (startup benchmark + best-profile apply).
  - DONE: auto-template generation for `thresholdsProfiles` / `thresholdsByModeProfiles` / `thresholdsByHardwareClassProfiles` on baseline update.
  - DONE: suite safety guards (`LONGRUN_CASE_TIMEOUT_SEC`, `LONGRUN_MODES`) для устойчивых прогонов.
  - DONE: tuning порогов под разные hardware классы (`TT-017D`) — hardware-class baseline layer (`low/entry_gpu/mid/high`) + mode+hardwareClass layer + controlled auto-apply retuning hints.
  - DONE: extended physics matrix workflow (`ring/jet/turbulence`) + optional post-suite hook (`LONGRUN_EXTENDED_PHYSICS_MATRIX`).
  - DONE: Hybrid+ scheduler audit workflow + optional post-suite hook (`LONGRUN_HYBRIDPLUS_SCHEDULER_AUDIT`).
  - DONE: near-zero baseline guards for regress checks (`LONGRUN_DRIFT_SEVERITY_REGRESS_BASELINE_FLOOR`, `LONGRUN_AUTOCORRECTION_REGRESS_BASELINE_FLOOR`), чтобы исключить noise-only regress spikes.
  - DONE: adaptive matrix envelope calibration + profile-aware strict defaults (`smoke/standard -> adaptive.low`, `nightly -> adaptive.mid`).
  - DONE: controlled runner mode (`LONGRUN_RUNNER_MODE=controlled`) + dedicated scripts for reproducible strict `standard/nightly` validation.
  - DONE: browser channel reproducibility telemetry в artifacts (`browserChannelRequested/browserChannelResolved/browserChannelFallbackUsed/browserChannelFallbackReason`) + nightly controlled baseline refresh.
  - DONE: case-timeout cleanup (`clearTimeout`/`unref` в `Promise.race`) для устранения PASS-run hang в long-run suite.
  - DONE: transient browser-context recovery (`reload + single retry`) для mode-case при `Execution context was destroyed`.
  - DONE: strict `nightly:controlled` stabilization (`gate PASS/PASS/PASS`, `policy PASS/PASS/PASS`, adaptive/hybridplus post-workflows PASS) после mid-class retune.
  - DONE: strict `standard:controlled` retune finalized (gates/policy PASS в controlled baseline контуре).

## Numerical Stability System

- Ввести runtime guards против exploding velocities, clustering и loss of circulation.
- Реализовать adaptive timestep (`CFL`, min spacing, filament curvature constraints).
- Добавить stability monitor + auto-correction operators как post-step аналитико-коррекционный контур.
- Текущий deliverable: `TT-030` numerical stability architecture + integration plan.
- Промежуточные шаги:
  - DONE: `NUMERICAL_STABILITY.md` (строгая постановка + acceptance criteria).
  - DONE: monitor metrics schema (`energy/circulation/divergence/spacing/curvature`) + runtime hooks.
  - DONE: expanded threshold-based auto-correction hooks (`timeScale/spawnRate` + split/merge guidance + filament remesh refine/coarsen guardrail actions).
  - DONE: Stability Debug runtime panel integration (auto-correction timeline + action counters in diagnostics UI).
  - DONE: post-integration long-run validation (`TT-017D`) + threshold retuning by hardware class.
  - DONE: smoke profile gate calibration for `gpu/hybrid/hybrid_plus` + drift metric fix for short-run delayed diagnostics in benchmark suite.
  - DONE: standard and shortened-nightly gate calibration for `gpu/hybrid/hybrid_plus` (hardware-aware threshold retuning).
  - DONE: full nightly validation for `gpu/hybrid/hybrid_plus` with passing gate-table.
  - DONE: mode-aware benchmark stability classifier tuning (GPU readback policy aware) with full-nightly `PASS` stability.
  - DONE: full nightly validation restored with `CPU` coverage via CPU-safe nightly case defaults.
  - DONE: drift-aware conservation auto-correction hooks (`guided/stretching/vorticity confinement` downscale) integrated into runtime.
  - DONE: filament legacy cleanup in UI/runtime (retain working center-lock/speed controls, remove nonfunctional legacy branches).
  - DONE: emergency semantics for filament center lock + UI wording cleanup.
  - DONE: emergency controls hidden by default behind explicit UI reveal toggle.
  - DONE: unified `Fallback / Recovery` runtime diagnostics subsection (active mechanisms + compact counters).
  - DONE: scientific filament UI split (physical knobs in main flow, recovery-only knobs in `Advanced/Fallback` block).
  - DONE: adaptive drift coefficients in runtime auto-correction (severity/streak-aware downscale instead of fixed multipliers).
  - DONE: long-run validation protocol update for adaptive drift diagnostics (`severity/scale/streak` checks).
  - DONE: long-run health-start probe hardened for `Hybrid/Hybrid+` (retry + re-pulse; no false early `advancing=false/time=0` fails).
  - DONE: production startup backend gate with splash/progress and hidden main UI until backend probe completion.
  - DONE: `Hybrid+` adaptive-drift retuning (runtime coefficient softening + smoke threshold sync) with `standard/smoke` gate `PASS`.
  - DONE: post-retune cross-mode regression check (`standard gpu/hybrid/hybrid_plus`, `smoke gpu`) with gate `PASS`.
  - DONE: robust enstrophy proxy update (winsorized vorticity) for better short-window GPU stability diagnostics without gate loosening.
  - DONE: long-run bridge for TT-030 intervention pressure (`stabilityAutoCorrectionPer1kSteps`) with baseline gates (`regress/abs`) in benchmark suite.
  - DONE: post-PASS hardening auto-correction operators (cross-hardware robustness + edge-case coverage) и Stability Debug ergonomics polish, включая saturation guard (`/1k steps` window) против correction thrash.
  - DONE: Stability Debug ergonomics pass — auto-correction pressure metric (`per1k steps`) + tone/status indicator in runtime diagnostics; metric exported in scientific snapshot runtime block.

## FMM Vortex Solver

- Ввести ускорение Biot-Savart на Amer через tree/multipole approximation.
- Разделить near-field и far-field с контролем ошибки.
- Сравнить accuracy/performance против naive solver на матрице `N`.
- Закрытый deliverable: `TT-029` FMM architecture and benchmark protocol.
- Промежуточные шаги:
  - DONE: `FMM_VORTEX_SOLVER.md` (octree + traversal + multipole error bounds).
  - DONE: runtime mode `fmm` + adaptive solver switching policy (runtime solver diagnostics contract + `velocityComputationMode=auto` + hysteresis/enter/cooldown rollout guards).
  - DONE: benchmark matrix `10k/50k/100k/500k` + accuracy/performance report (`audit-runner/fmm-benchmark-matrix.{json,md}`) с exact-reference block верификацией и gate verdict.
  - Закрытый deliverable: `TT-029` FMM solver mode integration + validation matrix.

## Vortex Topology

- Построить событийный граф эволюции вихрей (`birth/merge/split/reconnect/decay`).
- Привязать topology objects к detector output и transition system.
- Реализовать scientific export (`CSV/JSON`) без влияния на физику.
- Закрытый deliverable: `TT-028` topological vortex tracking system.
- Промежуточные шаги:
  - DONE: `VORTEX_TOPOLOGY.md` (event schema + graph model + metrics).
  - DONE: runtime topology tracking contract (`tt028b.topology_tracking.v1`) с lineage events (`birth/merge/split/reconnect/decay`) и graph snapshot (`nodes/edges`).
  - DONE: Topology View runtime counters в HUD + latest-event diagnostics.
  - DONE: reproducible export (`topology JSON/CSV`) из ControlPanel.

## Advanced Vortex Visualization

- Реализовать научные режимы визуализации: vorticity field, Q-criterion, streamlines/pathlines, core lines.
- Связать визуализацию с detector/topology overlays и uncertainty indicators.
- Добавить reproducible export pipeline (`PNG`, `MP4`, snapshots + metadata).
- Закрытый deliverable: `TT-031` advanced scientific visualization architecture.
- Промежуточные шаги:
  - DONE: `VORTEX_VISUALIZATION.md` (модель + ограничения применимости).
  - DONE: Visualization panel in ControlPanel + mode toggles + scene hook-up for `viz*` overlays (`vorticity/Q/streamlines/pathlines`) + scientific runtime HUD (detector/topology/energy).
  - DONE: Visualization Tools section in `dev/dashboard.html`.
  - DONE: scientific snapshot export baseline (`PNG` frame + JSON metadata bundle) with formal bundle schema (`torus.viz.snapshot.bundle.v2`), bounded runtime timeline sampling, sequence manifest export, FFmpeg transcode plan pre-step, and machine-checkable export validation report (`bundle + sequence + ffmpeg` consistency checks).
  - DONE: `TT-026`/`TT-026B` render runtime architecture завершена: formal representation-policy contract (`particles/filaments/sheets/tubes`, `LOD tier`, confidence/uncertainty diagnostics), sheet readiness gating, uncertainty decomposition (`detectorGap/renderFallback/topologyVolatility`) и runtime publication/export.
  - DONE: `TT-019` scientific overlays доведены до class-aware runtime path (`ring/tube/filament/sheet/cluster`) с confidence threshold, labels и sheet-layer scientific rendering path (без placeholder-only режима).
  - DONE: automated MP4 capture wiring в Visualization Tools (auto frame capture + sequence manifest + ffmpeg plan + validation package export).

## Physical Realism Modules

- Добавить физические модули: viscosity diffusion (core spreading/PSE), vortex stretching, boundary interaction, wake simulation.
- Встроить физический порядок операций в simulation step с контролем инвариантов.
- Ввести runtime controls и validation cases для reproducible realism.
- Текущий deliverable: `TT-032` physical realism architecture + runtime hooks.
- Промежуточные шаги:
  - DONE: `PHYSICAL_MODELS.md` (строгая постановка и порядок интеграции).
  - DONE: runtime params + integration-order profiles/hooks (canonical/boundary-first/diffusion-first) wired to VPM operator order (`TT-032B`).
  - DONE: boundary/wake validation baseline protocol (`TT-032C` phase-0 runbook + automated benchmark script + gate report artifacts).

## Visualization

- Разделить render policy для CPU fallback и GPU snapshot.
- Добавить режимы отображения структур (ring/tube/cluster overlays).
- Подготовить scientific export графиков/метрик.
- Промежуточные шаги:
  - DONE: runtime render backend diagnostics в UI.
  - DONE: structure overlays + export pipeline.

## Vortex Sheets

- Ввести surface-level представление вихрей для shear/wake сценариев.
- Реализовать sheet numerics: panel mesh, desingularized Biot-Savart, regularization.
- Ввести контролируемые переходы в filaments/particles с bounded-error редукцией.
- Текущий deliverable: `TT-021` vortex sheet architecture.
- Промежуточные шаги:
  - DONE: `VORTEX_SHEET_MODEL` (модель + ограничения применимости).
  - DONE: runtime sheet discretization scaffold (`panel demand/budget`, quadrature order, desingularization epsilon, readiness/coverage diagnostics) опубликован в render policy + scientific snapshot.
  - DONE: deterministic sheet mesh-plan scaffold (`seed/topology/patching/panel-aspect p95`) + quadrature profile presets интегрированы в runtime diagnostics и scientific snapshot.
  - DONE: sheet mesh quality-gates scaffold (`aspect/coverage/demandCoverage/epsilonBand` + `pass/warn/fail` verdict и quality penalty) интегрирован в runtime diagnostics/policy/snapshot.
  - DONE: deterministic panel-layout contract (`layout digest`, `patch min/max`, `patch imbalance`) интегрирован в runtime diagnostics/policy/snapshot.
  - DONE: panel mesh builder contract v1 (`valid/issueCount` + envelope proxies `patchAreaMean/areaCv/edgeRatioP95/curvatureProxyP95`) интегрирован в runtime diagnostics/policy/snapshot.
  - DONE: `TT-021B` numerics hardening (`panel mesh + quadrature + desingularization`) доведен до production-ready diagnostics contract (profiles/gates/layout/mesh-builder contract v1).
  - DONE: `TT-021C` coupling contracts `sheet<->amer`, `sheet<->filament` (runtime contract + diagnostics/snapshot/UI publication + roll-up stability guard).
  - DONE: stability guards для sheet roll-up (contract-based rollup guard and fail-safe placeholder gating).

## Vortex Transitions

- Текущий deliverable: `TT-022` transition system (`state machine + invariants + hysteresis`).
- Промежуточные шаги:
  - DONE: `TT-022A` transition table + invariants (`Gamma/impulse/energy bounds`).
  - DONE: `TT-022B` runtime transition state machine (`candidate/pending_confirm/committed/rejected`) + confidence/invariant/hysteresis gates + diagnostics/snapshot publication.

## Vortex Rings

- Формализовать ring dynamics: self-induced translation, core growth, stretching limits.
- Связать ring-сценарии с transitions и detector confidence.
- Текущий deliverable: `TT-023` ring scientific model.
- Промежуточные шаги:
  - DONE: `VORTEX_RING_MODEL` + analytical reference formulas.
  - DONE: ring validation cases + acceptance thresholds (`TT-023B`) в runtime contract + diagnostics/snapshot validation checks.

## Vortex Jets

- Описать jet как chain: shear layer -> ring train -> turbulent wake.
- Ввести режимные карты (по `Re/St/L/D`) и критерии смены режима.
- Текущий deliverable: `TT-024` jet scientific model.
- Промежуточные шаги:
  - DONE: `VORTEX_JET_MODEL` базовая модель.
  - DONE: jet regime map (`Re/St/L-D`) + transition hooks/runtime diagnostics contract (`tt024b.jet_regime.v1`).

## UI

- Сохранить полную двуязычность RU/EN.
- Улучшить диагностику backend/sync/coupling в панели.
- Добавить PM dashboard в `dev/dashboard.html`.
- Завершено: hardware-aware performance profiles + custom profile management в UI.
- Промежуточные шаги:
  - DONE: hardware detection summary + recommended profile apply.
  - DONE: built-in performance profiles (`auto/quality/balanced/performance`).
  - DONE: custom profile save/apply flow в ControlPanel.
  - DONE: re-run hardware calibration + clone profile + progress/metrics panel.
  - DONE: `dev/dashboard.html` синхронизирован с новыми research infrastructure контурами (`TT-033..TT-035`).
  - DONE: project rule закреплен: `dev/dashboard.html` обновляется синхронно с `ROADMAP/TASKS`.
  - DONE: RU/EN audit для новых UI сущностей (`TT-020`).

## Performance

- Таргет: стабильный realtime при высоком `particleCount`.
- Локализовать узкие места Biot-Savart / filament solver / readback.
- Внедрить benchmark matrix по backend режимам.
- DONE: benchmark suite `audit-runner/longRunBenchmarkSuite.mjs` + baseline artifacts.
- DONE: baseline gates + CI fail mode (`benchmark:longrun:ci`).
- DONE: representation-performance policy contract + acceptance baseline (`TT-027A`, `VORTEX_REPRESENTATION_PERFORMANCE`).
- DONE: runtime score publication и hardware-aware switching hooks (`TT-027B`) — phase-0 bootstrap wired into runtime diagnostics/export + phase-1 override-reason triggers (`fallback_storm/timeout_burst/invariant_guard`) + phase-2 drift-trend severity signal in policy health + phase-3 long-run aggregates (`policy_override_count_by_reason`, `render_policy_drift_severity_p95`) + phase-4 baseline gates for policy metrics + phase-5 dedicated markdown Policy Gates section + phase-6 mode-level Policy Gate Verdict summary + phase-7 trend snapshots + phase-8 hardware-aware sheet budgets/cooldown hooks.
- DONE: `TT-027` branch consolidated (`TT-027A + TT-027B`) as reproducible representation-performance contour with hardware-aware profile integration.
- Промежуточные шаги:
  - DONE: runtime test API bypass UI (`__torusTestApi`) + health checks.
  - DONE: fallback launch path для Chrome-channel benchmark.
  - DONE: hardware-aware gate calibration (mode + hardware-class threshold layers wired + auto-apply retuning hints).
  - DONE: `Quality Explorer` profile + one-click fallback to hardware-recommended profile for low-FPS high-detail stress preview on weaker devices.
  - DONE: photo-frame workflow for weak hardware: single-step capture + scientific-mode supersample render scale for quality-first PNG export.
  - DONE: `Photo burst xN + best frame` workflow (single-step burst + heuristic best-shot selection/export) for fast quality scouting on weak hardware.
  - DONE: auto retuning hints for `TT-017D` gates (mode/hardwareClass/mode+hardwareClass suggested limits + baseline patch template in JSON/MD artifacts) + controlled auto-apply (`LONGRUN_APPLY_RETUNING_HINTS`).
  - DONE: remote-render streaming feasibility study с формальным go/no-go критерием и fallback envelope (`docs/REMOTE_RENDER_STREAMING_FEASIBILITY.md`), текущий verdict: `NO-GO/defer`.

## Research

- Поддержка тематик: rings, jets, turbulence, Helmholtz instabilities, Kelvin waves, reconnection.
- Вести протоколы экспериментов и сравнение гипотез.
- Сопоставлять численные режимы с публикабельными метриками.
- Текущий deliverable: `TT-070` continuous validation governance.
- Промежуточные шаги:
  - DONE: unified experiment matrix v1 (`rings/jets/turbulence/Helmholtz/Kelvin/reconnection`) в `docs/RESEARCH_EXPERIMENT_MATRIX.md`.
  - DONE: instability protocol v1 (repeatability envelope + sweep rules + unsupported-policy).
  - DONE: publishable metric mapping v1 (runtime/audit signals -> publication-oriented metrics).
  - DONE: executable research preset pack v1 (`7` presets) + deterministic artifact naming contract v1 в `docs/RESEARCH_EXECUTABLE_RUNBOOK.md`.
  - DONE: mini acceptance audit suite `audit-runner/researchPresetPackAudit.mjs` + artifacts/runbook (`docs/RESEARCH_PRESET_PACK_AUDIT.md`), smoke CI pass (`RESEARCH_PRESET_AUDIT_DURATION_SCALE=0.25`).
  - DONE: full-duration baseline recheck (`RESEARCH_PRESET_AUDIT_DURATION_SCALE=1 npm run benchmark:research:presetpack:ci`) -> all preset gates `PASS`.
  - DONE: aggregate baseline report (`smoke` vs `full`) с comparative table и reproducibility notes в `docs/RESEARCH_PRESET_PACK_BASELINE_REPORT.md`.
  - DONE: rolling trend/history (`research-preset-pack-trend.json`) + per-preset regress flags (`stepP95/sampleCount`), включая strict trend CI mode (`benchmark:research:presetpack:trend:ci`).
  - DONE: calibrated trend policy (`TT-043`) — baseline строится по окну последних успешных same-scale snapshots (median/p90), regress по `stepP95` требует одновременно relative overflow и absolute overflow, плюс минимум baseline points для сравнения.
  - DONE: versioned trend policy contract (`TT-044`) в `audit-runner/research-preset-pack-trend-policy.v1.json` + policy profiles `smoke/standard/nightly`; `researchPresetPackAudit.mjs` теперь использует policy-driven resolver (`env override > policy profile > defaults`) и отдельные strict CI scripts для `smoke/nightly`.
  - DONE: profile-segmented trend baseline (`TT-045`) — history snapshot сохраняет `trendPolicyProfile`, compare выполняется по `durationScale + profile` (с backward-compatible fallback для legacy snapshot без profile).
  - DONE: baseline sufficiency strict mode (`TT-046`) — добавлен fail-gate `RESEARCH_PRESET_AUDIT_FAIL_ON_INSUFFICIENT_BASELINE` и nightly strict script `benchmark:research:presetpack:trend:nightly:strict-baseline:ci`; режим гарантирует, что strict trend CI не проходит при недостаточной истории baseline.
  - DONE: hybrid sync invariant hardening (`TT-047`) — filament step gate расширен на `executionMode={hybrid,hybrid_plus}` при `gpu` backend, добавлены runtime counters (`blocked/unsafe unsynced filament steps`) и multi-mode diagnostics (`benchmark:hybrid:syncdiag`) с проверками streak/unsafe invariants.
  - DONE: hybrid sync CI hardening (`TT-048`) — `hybridSyncDiagnostic` переведен на параметризуемые пороги, добавлен strict CI profile (`benchmark:hybrid:syncdiag:ci`) и runbook `docs/HYBRID_SYNC_DIAGNOSTIC.md` с контрактом checks/env/artifacts.
  - DONE: hybrid sync soak audit (`TT-049`) — добавлен repeated strict-run агрегатор `benchmark:hybrid:syncdiag:soak:ci` (`hybridSyncSoakAudit.mjs`) и mode-aware threshold policy (`HYBRID_SYNC_DIAG_MAX_FROZEN_RATIO_HYBRID_PLUS`) для устойчивого детекта интермиттентных рассинхронов.
  - DONE: preset audit hybrid-sync bridge (`TT-050`) — в `researchPresetPackAudit.mjs` добавлен case-gate `no_unsafe_unsynced_filament_steps` и вывод per-case `unsafe/block` deltas в CI table, чтобы основной preset CI напрямую ловил unsafe hybrid sync regressions.
  - DONE: soak trend/history (`TT-051`) — добавлен rolling trend файл `hybrid-sync-soak-trend.json`, regress flags (`fail_run_count`, `unsafe_unsynced_total`, `hybrid_plus_frozen_p95`) и strict trend CI mode `benchmark:hybrid:syncdiag:soak:trend:ci`.
  - DONE: versioned case-gate policy (`TT-052`) — `drift/stepP95` thresholds вынесены в `audit-runner/research-preset-pack-case-policy.v1.json` (`smoke/standard/nightly`), `researchPresetPackAudit.mjs` переключен на profile-aware resolver с публикацией policy meta в audit artifacts.
  - DONE: `TT-053` policy integrity audit bridge — добавлен `researchPresetPolicyIntegrityAudit.mjs` с CI gate по согласованности `case/trend` policy profiles и policy-meta/artifact coverage checks.
  - DONE: `TT-054` dashboard roadmap sync v2 — добавлена отдельная `Future Tasks Lane` + backlog visibility invariants и integrity-check для future task статусов в `dev/dashboard.html`.
  - DONE: `TT-055` policy CLI templates — добавлен `researchPresetPolicyTemplateGenerator.mjs` и script `benchmark:research:presetpack:policy:template` для генерации suggested per-profile thresholds из baseline/trend artifacts.
  - DONE: `TT-056` policy drift CI — добавлен `researchPresetPolicyDriftAudit.mjs` + CI script `benchmark:research:presetpack:policy:drift:ci` с fail-gate по threshold drift относительно suggested template envelope.
  - DONE: `TT-057` policy drift adaptive envelope tuning — drift gate переведен на versioned envelope policy (`smoke/standard/nightly`, `lenient/default/strict`) и staged CI scripts.
  - DONE: `TT-058` dashboard data-mode telemetry badge — добавлена явная индикация `LIVE DOCS/FALLBACK` и source-level sync telemetry (`TASKS/ROADMAP/PROGRESS + error`) в header UX.
  - DONE: `TT-059` dashboard sync diagnostics panel v2 — добавлены source-health diagnostics rows, error taxonomy и recent sync events history с freshness timers.
  - DONE: `TT-060` dashboard sync diagnostics UX polish — добавлены event compaction, severity grouping и operator hints в sync diagnostics UX.
  - DONE: `TT-061` dashboard source-health action widgets — добавлены one-click re-sync и stale-source highlighting policy в diagnostics.
  - DONE: `TT-062` external-validation policy profile + progress cross-check normalization — критерии external validation вынесены в `docs/dashboard-external-validation-policy.v1.json`, а сверка `TASKS vs PROGRESS` нормализована до top-level `TT-xxx`.
  - DONE: `TT-063` dashboard source-health remediation presets + operator quick-actions — добавлены policy presets (`strict/balanced/lenient`) с persistence и quick-actions (`apply preset`, `clear diagnostics`).
  - DONE: `TT-064` dashboard source-health per-source remediation actions + cooldown guardrails — добавлены target-кнопки `TASKS/ROADMAP/PROGRESS` с cooldown guardrails и source-level retry events.
  - DONE: `TT-065` dashboard source-health action audit trail + policy explainability panel.
  - DONE: `TT-066` scientific validation partition hardening — во всех контурах `ring/jet/detector/topology` внедрено явное разделение `internal diagnostics validity` vs `external validation eligibility`, с пробросом eligibility/reason в runtime UI и scientific export validation report.
  - DONE: `TT-068` classic closure contour — local compute closure + external validation evidence для `classic physics` закрыты, включая reproducible artifacts и независимый replication protocol.
  - DONE: `TT-068A` classic closure gate — strict classic-only lock внедрен в scientific export validation (`profile=classic`, `modifierStrength<=1e-6`, `externalValidationEligible=true`) + checklist `docs/CLASSIC_EXTERNAL_VALIDATION_CLOSURE_CHECKLIST.md`.
  - DONE: `TT-068B` evidence pack v1 — добавлен CLI `audit-runner/classicExternalValidationEvidencePack.mjs`, runbook `docs/CLASSIC_EXTERNAL_VALIDATION_EVIDENCE_PACK.md`, artifacts `classic-external-validation-evidence-pack.{json,md}` и strict gate script `benchmark:classic:evidencepack:ci`.
  - DONE: `TT-068C` independent replication protocol v1 — добавлены `docs/CLASSIC_REPLICATION_PROTOCOL.md`, contract draft `audit-runner/classic-replication-protocol.contract.v1.json`, audit CLI `audit-runner/classicReplicationAudit.mjs` и strict gate `benchmark:classic:replication:ci` (`PASS`).
  - DONE (post-classic): `TT-067` future distributed contour — Natural external-validation track для server/client/participant network закрыт: reproducibility envelope (`RTT/jitter/loss`), compute-split policy (`local/server/distributed`) и parity-audit покрыты end-to-end (`TT-067A..TT-067I`).
  - DONE: `TT-067A` protocol spec v1 — добавлен `docs/DISTRIBUTED_VALIDATION_CONTOUR.md` (network envelope, deterministic replay, compute-split policy, parity matrix, Natural eligibility boundary).
  - DONE: `TT-067B` artifact contract v1 — добавлен machine-readable schema `docs/distributed-validation-artifact.contract.v1.json` для placement/network/determinism/parity полей.
  - DONE: `TT-067C` contract audit CLI — добавлен `audit-runner/distributedValidationContractAudit.mjs` + scripts `benchmark:distributed:contract` и `benchmark:distributed:contract:ci`.
  - DONE: `TT-067D` strict parity CI contour — добавлен `audit-runner/distributedParityAudit.mjs`, baseline parity artifact fixture и aggregate strict gate `benchmark:distributed:strict:ci` (`contract + parity`).
  - DONE: `TT-067E` runtime parity pipeline — добавлен `audit-runner/distributedParityArtifactBuilder.mjs`; parity scripts переведены на `build -> audit` pipeline (`benchmark:distributed:parity:build|parity|parity:ci`) и strict gate подтвержден `PASS`; runbook: `docs/DISTRIBUTED_PARITY_PIPELINE.md`.
  - DONE: `TT-067F` triad input ingestion gate — добавлены contract/input artifacts (`audit-runner/distributed-triad-run-input.contract.v1.json`, `audit-runner/distributed-triad-run-input.json`) и CI audit `audit-runner/distributedTriadInputAudit.mjs`; strict contour расширен triad-input gate перед parity stage.
  - DONE: `TT-067G` strict chain reorder — contract audit переведен на runtime parity artifact (`distributed-validation-parity-audit.runtime.json`), strict sequence теперь `triad-input-audit -> parity-build -> contract-audit -> parity-audit` с подтвержденным `PASS`.
  - DONE: `TT-067H` policy/trend contour — добавлен policy contract `audit-runner/distributed-parity-policy.v1.json` (`smoke/standard/nightly`), parity audit переключен на profile-aware envelope thresholds, добавлен trend audit `audit-runner/distributedParityTrendAudit.mjs` + scripts `benchmark:distributed:parity:trend[:ci]`, strict/trend gates `PASS`.
  - DONE: `TT-067I` policy integrity gate — добавлен `audit-runner/distributedParityPolicyIntegrityAudit.mjs` и CI script `benchmark:distributed:policy:integrity:ci` для проверки согласованности `policy schema/defaultProfile/profiles` и соответствия runtime artifact limits активному profile.
  - DONE: post-closure revalidation — повторный full chain (`strict:ci + parity:trend:ci + policy:integrity:ci`) пройден `PASS`; контур `TT-067` подтвержден как стабильный в закрытом состоянии.
  - DONE: `TT-069` phase bootstrap — новый top-level queue после closure (`TT-001..TT-068`) сформирован, acceptance contracts и синхронизация `TASKS/ROADMAP/PROGRESS/dev/dashboard` зафиксированы.
  - DONE: `TT-069A` bootstrap spec — опубликован `docs/TT-069_POST_CLOSURE_BOOTSTRAP.md` с scope, acceptance contract и execution steps.
  - DONE: `TT-069B` intake template — опубликован `docs/TT-069_TOPLEVEL_INTAKE_TEMPLATE.md` с формальным шаблоном запуска `TT-07x` инициатив и tracker wiring checklist.
  - DONE: `TT-069C` first candidate queue draft — сформирован первый top-level кандидат `TT-070` и выполнен полный tracker synchronization check.
  - DONE: `TT-069` phase bootstrap closure — bootstrap-контур закрыт после публикации spec/template и запуска первой инициативы новой очереди.
  - DONE: `TT-070` continuous validation governance — governance-контур закрыт: runbook v1 (`docs/VALIDATION_GOVERNANCE_RUNBOOK.md`), policy contract (`audit-runner/validation-governance-policy.v1.json`), audit CLI (`audit-runner/validationGovernanceAudit.mjs`, 18 checks, all PASS), CI scripts (`benchmark:governance[:ci|:freshness:ci]`).
  - DONE: `TT-070A` governance runbook/spec v1 — cadence/escalation/update protocol формализованы в `docs/VALIDATION_GOVERNANCE_RUNBOOK.md`.
  - DONE: `TT-070B` governance policy contract + audit CLI — 20 contours, 5 tiers, 3 profiles, escalation levels 0–3, freshness tracking.
  - DONE: `TT-070C` strict governance CI gate — `benchmark:governance:freshness:ci` verified PASS; tracker sync complete.

## Simulation Lab Mode

- Текущий deliverable: `TT-033` reproducible experiment orchestration layer.
- Почему это в `P5`: модуль должен опираться на уже стабилизированный runtime/diagnostics (`TT-017D`, `TT-030`, `TT-032`), иначе batch-результаты будут плохо воспроизводимы.
- Строгая постановка:
  - `Experiment` как контракт (`initial_conditions`, `sweep`, `metrics`, `seed`, `run_budget`, `acceptance_checks`).
  - Batch execution только с явным deterministic envelope (фиксированный seed, фиксированный profile, зафиксированный backend policy).
  - Экспорт не только `JSON/CSV`, но и метаданные воспроизводимости (git sha/config hash/hardware profile/time window).
- Ошибки исходного плана, исправленные в спецификации:
  - "auto-run после старта" не должен быть always-on: только opt-in preset или CLI flag.
  - "vortex count" без confidence некорректен: использовать detector-confidence-weighted counts + uncertainty fields.
  - "сотни симуляций" без budget control риск OOM/thermal throttling: нужен queue scheduler с wall-clock/VRAM/CPU budget limits.
- Промежуточные шаги:
  - DONE: `SIMULATION_LAB.md` (contract + reproducibility + batch policy).
  - DONE: experiment schema + metadata hash scaffold (`TT-033B`).
  - DONE: budgeted batch runner + artifact sink hardening (`TT-033C`) including storage schema migration/sanitization and artifact index persistence policy.
  - DONE: Lab Panel runtime integration scaffold (`TT-033D`, multi-preset + editable run controls + JSON/schema editor + local persistence/history + run comparison/artifact preview).

## Scale Physics Mode

- Текущий deliverable: `TT-034` nondimensional scaling framework.
- Почему после `TT-033`: эксперименты должны уметь запускаться в scale-aware режиме с одинаковой схемой логирования.
- Строгая постановка:
  - Переход к масштабу через reference scales и безразмерные группы (`Re`, `St`, при необходимости `Ro`).
  - `physicsScale` не равен "косметическому масштабу": UI-scale и physical-scale разделены.
  - Applicability envelope обязателен (где incompressible vortex model валиден, а где нет: compressibility/stratification/MHD).
- Ошибки исходного плана, исправленные в спецификации:
  - Нельзя независимо "крутить viscosity/velocity/length/time": они связаны через nondimensional constraints.
  - "microscopic -> astrophysical" в одной модели без ограничений нефизично; нужен режим "unsupported/approximate".
  - "Amer particle density" - это численная дискретизация, а не физическая плотность среды.
- Промежуточные шаги:
  - DONE: `SCALE_PHYSICS.md` (nondimensional framework + applicability envelope).
  - DONE: runtime nondimensional converter production-ready pass (`TT-034B`) with strict scaling-input validation and conversion consistency-error reporting.
  - DONE: scale presets + applicability checks + logging integration (`TT-034C`) + runbook thresholds calibration notes.

## Adaptive Resolution System

- Текущий deliverable: `TT-035` error-bounded adaptive discretization controller.
- Почему после `TT-034`: адаптация должна управляться не абсолютными, а scale-aware критериями и работать в nondimensional framework.
- Строгая постановка:
  - Цель - bounded error при заданном compute budget, а не фиксированное "1e6 particles realtime" на любом железе.
  - Resolution control через измеряемые индикаторы (`vorticity`, curvature, reconnection proximity, detector uncertainty) + hysteresis.
  - Совместимость с `TT-030` обязательна: адаптация не должна ломать conservation guards и stability monitor.
- Ошибки исходного плана, исправленные в спецификации:
  - Жесткий realtime target заменен hardware-class benchmark matrix.
  - "GPU high-density / CPU large-scale" без transfer budget нефизично по производительности: добавлены sync-budget и migration quotas.
- Sheet adaptive mesh вынесен как conditional scope (после `TT-025` detector readiness и `TT-026` render-path readiness).
- Промежуточные шаги:
  - DONE: `ADAPTIVE_RESOLUTION.md` (controller contract + acceptance criteria).
  - DONE: controller core scaffold (`signals + hysteresis + bounded patches`, `TT-035B`) + Lab trace export hooks + runtime-safe actuation budget guards + stress verification harness.
  - DONE: diagnostics overlays + lab coupling (`TT-035C`) + baseline scenario verdict hooks + transition matrix/acceptance report export.
  - DONE: adaptive baseline matrix workflow integration (`audit-runner` + runbook + CI hooks + trend snapshots).
