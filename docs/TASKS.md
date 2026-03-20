# TASKS

Формат: `ID | Описание | Зависимости | Сложность | Статус`

Сложность: `S/M/L/XL`

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-001 | Полный аудит архитектуры и pipeline | - | L | DONE |
| TT-002 | Формализация иерархии Amer->Newtonium | TT-001 | M | DONE |
| TT-003 | Архитектура detection системы структур | TT-001, TT-002 | L | DONE |
| TT-004 | Turbulence/energy cascade архитектура | TT-001, TT-002 | L | DONE |
| TT-005 | Базовый roadmap по 10 ветвям | TT-001 | M | DONE |
| TT-006 | PM task registry с зависимостями | TT-005 | M | DONE |
| TT-007 | Progress tracking система | TT-006 | S | DONE |
| TT-008 | Persistent project context документ | TT-005, TT-006, TT-007 | M | DONE |
| TT-009 | Rule-set для постоянного обновления roadmap/tasks/progress | TT-005, TT-006, TT-007 | M | DONE |
| TT-010 | Dev dashboard (roadmap + task tree + progress + dependency graph) | TT-006, TT-007 | L | DONE |
| TT-011 | GPU coupling offload design (particle->filament) | TT-001, TT-002 | XL | DONE |
| TT-012 | Prototype partial readback/delta sync для hybrid strict mode | TT-001, TT-011 | XL | DONE |
| TT-013 | Filament->particle batching acceleration | TT-001, TT-011 | XL | DONE |
| TT-014 | Detection MVP implementation (alignment + PCA + loops) | TT-003 | XL | DONE |
| TT-015 | Newtonium classifier + temporal tracker | TT-003, TT-014 | L | DONE |
| TT-016 | Energy spectrum diagnostics (k-bin + flux proxy) | TT-004 | L | DONE |
| TT-017 | Long-run stability benchmark suite (CPU/GPU/Hybrid/Hybrid+) | TT-001, TT-004 | L | DONE |
| TT-018 | Hybrid+ operators expansion (topology + BH + scheduling) | TT-001, TT-012 | XL | DONE |
| TT-019 | Scientific visualization overlays for detected structures | TT-014, TT-015 | M | DONE |
| TT-020 | RU/EN i18n audit for new PM and diagnostics UI | TT-010 | M | DONE |
| TT-021 | Vortex sheet architecture (model + numerics + coupling contracts) | TT-002, TT-003, TT-004 | XL | DONE |
| TT-022 | Vortex transitions system (state machine + invariants + hysteresis) | TT-021, TT-014, TT-015 | L | DONE |
| TT-023 | Vortex ring scientific model + validation protocol | TT-021, TT-022 | L | DONE |
| TT-024 | Vortex jet scientific model (shear layer + ring train + turbulent wake) | TT-021, TT-022, TT-023 | L | DONE |
| TT-025 | Structure detector extension (sheet/ring/tube confidence fusion) | TT-021, TT-022, TT-014 | XL | DONE |
| TT-026 | Rendering architecture for sheets/filaments/particles | TT-021, TT-023, TT-024, TT-025 | L | DONE |
| TT-027 | Representation-performance policy (particles/filaments/sheets) | TT-021, TT-017, TT-025 | L | DONE |
| TT-028 | Topological vortex tracking system (events + graph + export) | TT-022, TT-025, TT-015 | XL | DONE |
| TT-029 | Fast multipole vortex solver (Amer acceleration + validation) | TT-017, TT-030 | XL | DONE |
| TT-030 | Numerical stability system (adaptive dt + guards + monitor) | TT-004, TT-013, TT-016 | XL | DONE |
| TT-031 | Advanced vortex visualization system (scientific modes + export) | TT-025, TT-028, TT-030 | XL | DONE |
| TT-032 | Physical realism modules (viscosity/stretching/boundaries/wake) | TT-030, TT-021, TT-013 | XL | DONE |
| TT-033 | Simulation Lab Mode (experiment orchestration + reproducible batch runs) | TT-017, TT-030, TT-032 | XL | DONE |
| TT-034 | Scale Physics Mode (nondimensional scaling + applicability envelope) | TT-023A, TT-024A, TT-033 | L | DONE |
| TT-035 | Adaptive Resolution System (error-bounded dynamic discretization) | TT-030, TT-034, TT-021B | XL | DONE |
| TT-036 | Remote-render streaming feasibility study (latency envelope + scientific reproducibility + fallback policy) | TT-017, TT-033, TT-020 | M | DONE |
| TT-037 | Research experiment matrix + instability protocol + publishable metrics mapping | TT-033, TT-034, TT-035 | L | DONE |
| TT-038 | Executable research runbook (preset pack + artifact naming contract) | TT-037, TT-033D | M | DONE |
| TT-039 | Research preset pack mini-acceptance audit (CLI + gate artifacts + smoke CI) | TT-038, TT-017 | M | DONE |
| TT-040 | Research preset pack full-duration baseline recheck (`DURATION_SCALE=1`) + verdict lock | TT-039 | S | DONE |
| TT-041 | Research preset pack aggregate baseline report (`smoke` vs `full`) + reproducibility notes | TT-039, TT-040 | S | DONE |
| TT-042 | Research preset pack rolling trend/history + regress flags | TT-039, TT-040, TT-041 | M | DONE |
| TT-043 | Trend-regress envelope calibration + baseline snapshot policy hardening (strict CI false-positive reduction) | TT-042 | M | DONE |
| TT-044 | Versioned trend policy profiles (`smoke/standard/nightly`) + policy-driven strict trend CI | TT-043 | M | DONE |
| TT-045 | Trend baseline segmentation by policy profile (`durationScale + profile` comparability) | TT-044 | S | DONE |
| TT-046 | Strict trend baseline sufficiency gate (fail on insufficient history) | TT-045 | S | DONE |
| TT-047 | Hybrid filament/particle sync invariant hardening across `hybrid` and `hybrid_plus` | TT-016C | M | DONE |
| TT-048 | Hybrid sync diagnostic CI hardening (strict thresholds + invariant counters + runbook) | TT-047 | S | DONE |
| TT-049 | Hybrid sync soak audit (intermittent regression detection across repeated strict runs) | TT-048 | S | DONE |
| TT-050 | Research preset audit bridge for hybrid sync invariant (`unsafe unsynced delta = 0`) | TT-047, TT-049 | S | DONE |
| TT-051 | Hybrid sync soak trend/history + regress flags | TT-049 | S | DONE |
| TT-052 | Versioned case-gate policy profiles for research preset audit (`drift/stepP95` policy externalization) | TT-044, TT-051 | S | DONE |
| TT-053 | Policy integrity audit bridge (cross-check case/trend policy profiles + artifact consistency gate) | TT-052 | S | DONE |
| TT-054 | Dashboard roadmap sync v2 (future tasks lane + backlog visibility invariants) | TT-010, TT-053 | S | DONE |
| TT-055 | Research preset policy CLI (auto-generate per-profile threshold templates from baseline artifacts) | TT-052, TT-053 | M | DONE |
| TT-056 | Research preset policy drift CI (detect threshold drift against historical envelope) | TT-055 | M | DONE |
| TT-057 | Policy drift adaptive envelope tuning (profile-aware delta bands + staged strictness) | TT-056 | M | DONE |
| TT-058 | Dashboard data-mode telemetry badge (`LIVE DOCS`/`FALLBACK`) + sync-source clarity hardening | TT-054 | S | DONE |
| TT-059 | Dashboard sync diagnostics panel v2 (error taxonomy + source freshness timers) | TT-058 | S | DONE |
| TT-060 | Dashboard sync diagnostics UX polish (event compaction + severity grouping + operator hints) | TT-059 | S | DONE |
| TT-061 | Dashboard source-health action widgets (one-click re-sync + stale-source highlighting policy) | TT-060 | S | DONE |
| TT-062 | Dashboard external-validation policy profile + top-level progress cross-check normalization | TT-060 | S | DONE |
| TT-063 | Dashboard source-health remediation policy presets + operator quick-actions | TT-061, TT-062 | S | DONE |
| TT-064 | Dashboard source-health per-source remediation actions + cooldown guardrails | TT-063 | S | DONE |
| TT-065 | Dashboard source-health action audit trail + policy explainability panel | TT-064 | S | DONE |
| TT-066 | Scientific validation partition hardening (`internal validity` vs `external eligibility`) across `ring/jet/detector/topology` + artifact/report propagation | TT-062 | M | DONE |
| TT-067 | Natural external-validation future track: distributed/server-client reproducibility envelope + compute-split parity protocol (post-classic phase) | TT-066, TT-068 | L | DONE |
| TT-067A | Distributed contour protocol spec v1 (`network envelope + deterministic replay + parity matrix`) | TT-067 | M | DONE |
| TT-067B | Distributed validation artifact contract v1 (machine-readable schema for placement/network/determinism/parity fields) | TT-067A | M | DONE |
| TT-067C | Distributed validation contract audit CLI (gate checks for contract schema + artifact field coverage + eligible/parity rule) | TT-067B | M | DONE |
| TT-067D | Strict distributed parity CI contour (`triad parity audit + eligible envelope gate + strict aggregate CI command`) | TT-067C | M | DONE |
| TT-067E | Runtime parity artifact pipeline (`build -> audit`) without static fixture dependency | TT-067D, TT-068C | M | DONE |
| TT-067F | Real triad input ingestion contract + CI gate (`local/server/distributed` runtime payload validation before parity build) | TT-067E | M | DONE |
| TT-067G | Strict chain reordering to runtime artifact source-of-truth (`triad-audit -> parity-build -> contract-audit -> parity-audit`) | TT-067F | M | DONE |
| TT-067H | Policy-driven distributed parity profiles (`smoke/standard/nightly`) + trend/regress CI | TT-067G | M | DONE |
| TT-067I | Distributed parity policy integrity audit (`policy<->artifact` profile/schema/limits consistency gate + CI command) | TT-067H | S | DONE |
| TT-068 | Classic external validation closure pack (local compute finalization + reproducible evidence + independent classic replication protocol) | TT-062, TT-066 | L | DONE |
| TT-069 | Post-closure roadmap phase bootstrap (next top-level queue + acceptance contracts + tracker synchronization baseline) | TT-067, TT-068 | M | DONE |
| TT-070 | Continuous validation governance (periodic revalidation cadence + escalation policy + strict governance gate) | TT-067, TT-068, TT-069 | L | DONE |

## Активная задача

- Нет активных задач. Все `TT-001..TT-070` закрыты.

## TT-068 подзадачи (рабочий план)

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-068A | Classic-mode closure gate: формальный lock `external_validation_eligible=true` только для classic runs + checklist локальной вычислительной готовности | TT-068 | M | DONE |
| TT-068B | External validation evidence pack v1: reproducible artifacts bundle + runbook + acceptance table для classic physics | TT-068A | M | DONE |
| TT-068C | Independent classic replication protocol v1: solver-agnostic replay/compare contract + PASS criteria | TT-068B | M | DONE |

## TT-069 подзадачи (рабочий план)

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-069A | Bootstrap spec: post-closure phase contract + acceptance criteria (`docs/TT-069_POST_CLOSURE_BOOTSTRAP.md`) | TT-069 | S | DONE |
| TT-069B | Intake template для новых top-level задач (`objective/dependencies/acceptance/gates`) + tracker wiring | TT-069A | M | DONE |
| TT-069C | First candidate queue draft (`TT-07x`) + full tracker synchronization check | TT-069B | M | DONE |

## TT-070 подзадачи (рабочий план)

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-070A | Governance runbook/spec v1 (cadence + escalation policy + update protocol) | TT-070 | M | DONE |
| TT-070B | Governance policy contract + audit CLI (machine-checkable cadence/freshness/escalation checks) | TT-070A | L | DONE |
| TT-070C | Strict governance CI gate + closure synchronization report | TT-070B | M | DONE |

## Приоритетный порядок (строгий)

1. `P0` (численная корректность): `TT-017D` -> `TT-030`.
2. `P1` (представления и переходы): `TT-021` + `TT-022` + `TT-023` + `TT-024` закрыты.
3. `P2` (ускорение solver + physical realism): `TT-029` + `TT-032` закрыты.
4. `P3` (объектные модели и детектор): `TT-023` + `TT-024` + `TT-025` закрыты.
5. `P4` (топология и продвинутая визуализация): `TT-026` + `TT-019` + `TT-028` + `TT-031` закрыты.
6. `P5` (research infrastructure): `TT-033` -> `TT-034` -> `TT-035`.

## TT-011 подзадачи (рабочий план)

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-011A | RFC и data contract для GPU query path | TT-011 | M | DONE |
| TT-011B | API plumbing в WebGPU manager (`sampleParticleVelocityAtPoints`) | TT-011A | L | DONE |
| TT-011C | WGSL query kernel MVP + readback буферы | TT-011B | XL | DONE |
| TT-011D | Интеграция в `applyHybridCoupling` с fallback CPU | TT-011C | L | DONE |
| TT-011E | Query diagnostics + runtime counters | TT-011D | M | DONE |
| TT-011F | Query-aware strict hybrid sync policy | TT-011E | L | DONE |

## TT-012 подзадачи (рабочий план)

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-012A | Конфигурируемый query-aware readback interval | TT-012 | M | DONE |
| TT-012B | Runtime counters для coupling query sync | TT-012A | M | DONE |
| TT-012C | Delta-only sync policy prototype (без full readback в безопасных окнах) | TT-012B | XL | DONE |

## TT-013 подзадачи (рабочий план)

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-013A | RFC и batch API контракт filament->particle | TT-013 | M | DONE |
| TT-013B | CPU batch traversal на segment grid | TT-013A | XL | DONE |
| TT-013C | Интеграция batch sampling в `applyHybridCoupling` | TT-013B | L | DONE |
| TT-013D | Batch diagnostics + speedup counters | TT-013C | M | DONE |

## TT-014 подзадачи (рабочий план)

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-014A | Detection module scaffold + feature toggles | TT-014 | L | DONE |
| TT-014B | Runtime integration + metrics publication | TT-014A | L | DONE |
| TT-014C | Accuracy tuning and threshold calibration | TT-014B | L | DONE |

## TT-015/TT-016 подзадачи (рабочий план)

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-015A | Newtonium classifier module | TT-015 | M | DONE |
| TT-015B | Temporal tracker state machine | TT-015A | M | DONE |
| TT-015C | Runtime publication of Newtonium metrics | TT-015B | S | DONE |
| TT-016A | Energy/enstrophy diagnostics module | TT-016 | M | DONE |
| TT-016B | Runtime publication of energy bins | TT-016A | S | DONE |
| TT-016C | Turbulence breakdown audit matrix (`cpu/gpu` x `single_pulse/pulse_train/long_run`) + gate artifacts | TT-016A, TT-017D | M | DONE |

## TT-017 подзадачи (рабочий план)

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-017A | CLI benchmark suite scaffold (`audit-runner/longRunBenchmarkSuite.mjs`) | TT-017 | M | DONE |
| TT-017B | Metric extraction (latency/throughput/drift/sync/newtonium transitions) | TT-017A, TT-015, TT-016 | M | DONE |
| TT-017C | Export artifacts JSON+MD and runbook doc | TT-017B | S | DONE |
| TT-017D | Baseline runs + threshold tuning by mode/hardware class | TT-017C | M | DONE |
| TT-017E | Runtime API hardening + Chrome fallback for automation | TT-017A | M | DONE |
| TT-017F | First-run hardware auto-calibration + UI progress/metrics | TT-017D, TT-020 | L | DONE |
| TT-017G | Auto-generate `thresholdsProfiles` templates on baseline update | TT-017D | S | DONE |
| TT-017H | Per-case timeout + mode filter for long-run suite | TT-017D | S | DONE |
| TT-017I | Extended physics matrix workflow (`ring/jet/turbulence`) + long-run hook | TT-017D, TT-032C | M | DONE |
| TT-017J | Hybrid+ scheduler audit workflow + long-run hook | TT-017D, TT-018C | M | DONE |
| TT-017K | Near-zero baseline guards for regress checks (`driftSeverity/autoCorrection`) | TT-017D | S | DONE |
| TT-017L | Adaptive matrix envelope calibration + profile-aware strict scenario defaults | TT-017D | S | DONE |
| TT-017M | Controlled runner mode (`standard/nightly`) for reproducible strict gates | TT-017D | M | DONE |
| TT-017N | Controlled browser-channel reproducibility telemetry in long-run payload | TT-017M | S | DONE |
| TT-017O | Case-timeout timer cleanup (`Promise.race` timeout clear/unref) to prevent PASS-run hangs | TT-017M | S | DONE |
| TT-017P | Transient browser-context recovery (`Execution context was destroyed` -> reload + retry) | TT-017M | S | DONE |

## TT-018 подзадачи (рабочий план)

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-018A | Adaptive assist scheduler + budget-aware cadence for Hybrid+ | TT-018 | M | DONE |
| TT-018B | Topology/BH operator prioritization + anti-thrash policy | TT-018A | L | DONE |
| TT-018C | Hybrid+ operator benchmark protocol (quality/cost envelopes) | TT-018B, TT-017I | L | DONE |

## TT-020 подзадачи (рабочий план)

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-020A | RU/EN messages for performance profile UX | TT-020 | S | DONE |
| TT-020B | Hardware-aware profile selector in ControlPanel | TT-020A | M | DONE |
| TT-020C | Custom performance profile save/apply flow | TT-020B | M | DONE |

## TT-021..TT-027 подзадачи (addendum: vortex sheets/rings/jets)

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-021A | Документ `VORTEX_SHEET_MODEL` (геометрия, физика, ограничения применимости) | TT-021 | M | DONE |
| TT-021B | Дискретизация sheet: panel mesh + quadrature + desingularization | TT-021A | XL | DONE |
| TT-021C | Coupling контракты `sheet<->amer`, `sheet<->filament` | TT-021B, TT-013 | L | DONE |
| TT-022A | Таблица переходов + инварианты (`Gamma`, импульс, энергия bounds) | TT-022 | M | DONE |
| TT-022B | Runtime state machine переходов с hysteresis и confidence gates | TT-022A, TT-015 | L | DONE |
| TT-023A | Документ `VORTEX_RING_MODEL` (тонкое/толстое ядро, self-induced speed) | TT-023 | M | DONE |
| TT-023B | Набор ring validation-кейсов и acceptance thresholds | TT-023A, TT-017 | M | DONE |
| TT-024A | Документ `VORTEX_JET_MODEL` (shear layer instability + ring train) | TT-024 | M | DONE |
| TT-024B | Jet regime map (`Re`, `St`, `L/D`) и критерии переходов | TT-024A | M | DONE |
| TT-025A | Расширение detection признаков для sheets (surface coherence + curvature) | TT-025 | L | DONE |
| TT-025B | Мультиклассовый detector fusion: sheet/ring/tube/filament | TT-025A, TT-014C | XL | DONE |
| TT-026A | Render policy: sheet surface LOD + filament/tube overlays | TT-026 | M | DONE |
| TT-026B | Scientific diagnostics overlay (confidence + uncertainty) | TT-026A, TT-019 | M | DONE |
| TT-027A | Cost model и auto-representation switching policy | TT-027 | L | DONE |
| TT-027B | Hardware-aware profile hooks для sheet-heavy сценариев | TT-027A, TT-020 | M | DONE |

## TT-028..TT-030 подзадачи (topology + FMM + stability)

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-028A | Документ `VORTEX_TOPOLOGY.md` (event model + graph schema) | TT-028 | M | DONE |
| TT-028B | Runtime object lineage (`parents/children`, birth/decay events) | TT-028A, TT-015 | L | DONE |
| TT-028C | Topology View + CSV/JSON export | TT-028B, TT-026 | L | DONE |
| TT-029A | Документ `FMM_VORTEX_SOLVER.md` (octree, multipole orders, error control) | TT-029 | M | DONE |
| TT-029B | FMM solver mode integration + adaptive switch (`naive`/`fmm`) | TT-029A, TT-030 | XL | DONE |
| TT-029C | Benchmark matrix with accuracy/performance report | TT-029B, TT-017D | L | DONE |
| TT-030A | Документ `NUMERICAL_STABILITY.md` (adaptive dt + guards + monitor) | TT-030 | M | DONE |
| TT-030B | Stability monitor schema and post-step diagnostics hooks | TT-030A, TT-016 | L | DONE |
| TT-030C | Auto-correction operators (`dt downscale`, split/merge, remesh hooks) | TT-030B, TT-013 | XL | DONE |

Примечание по `TT-030C`: реализованы расширенные phase-1/phase-2 шаги:
- threshold-based auto-correction hooks в runtime (`timeScale/spawnRate` + filament remesh refine/coarsen guardrails),
- Stability Debug runtime panel (timeline + counters по auto-corrections в diagnostics UI).
Далее - валидация на long-run наборах и калибровка порогов под hardware-классы:
- DONE (phase calibration): smoke + standard + shortened-nightly gate calibration для `gpu/hybrid/hybrid_plus`,
- DONE: full nightly run (без сокращенного duration) для `gpu/hybrid/hybrid_plus`, gate `PASS/PASS/PASS`,
- DONE: mode-aware benchmark stability classification (GPU full-readback больше не дает ложный `WARN` без sync violations),
- DONE: возврат к full nightly coverage с `CPU` mode (CPU-safe nightly profile + passing gate-table),
- DONE: phase-3 `TT-030C` drift-aware auto-correction (`conservation_drift` -> adaptive downscale guided/stretching/vorticity confinement),
- DONE: filament legacy cleanup (оставлены рабочие center-lock/speed controls; удалены нерабочие legacy align/minSelfRatio/centerPull ветки),
- DONE: filament UI cleanup (emergency recenter semantics + stricter center-lock trigger),
- DONE: emergency controls gating in UI (hidden by default, explicit reveal toggle),
- DONE: unified `Fallback / Recovery` runtime diagnostics section (active mechanisms + compact counters),
- DONE: scientific filament UI split (`physical` vs `Advanced/Fallback` controls for recovery-only knobs),
- DONE: adaptive drift coefficients in runtime auto-correction (replace fixed multipliers) + validation protocol update,
- DONE: debug/fix runtime health-start для `Hybrid/Hybrid+` в long-run suite (`advancing=false/time=0`) через retry + re-pulse health probe,
- DONE: production startup backend check gate (splash + progress, hidden main window until probe complete),
- DONE: retuning `Hybrid+` drift/throughput under adaptive drift (`standard` + `smoke` gate `PASS`),
- DONE: cross-mode regression check (`standard gpu/hybrid/hybrid_plus`, `smoke gpu`) после adaptive/Hybrid+ retune — gates `PASS`,
- DONE: quality-tuning `GPU` smoke short-window stability via robust enstrophy proxy (winsorized vorticity) без ослабления gate-строгости,
- DONE: `dev/dashboard.html` синхронизирован с новыми контурами `TT-033..TT-035`,
- NEXT: перейти к следующему roadmap-блоку после закрытия `TT-017` stabilization (поддерживать периодический health-check `standard/nightly:controlled`).

## TT-031..TT-032 подзадачи (advanced visualization + physical realism)

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-031A | Документ `VORTEX_VISUALIZATION.md` (scientific viz modes + constraints) | TT-031 | M | DONE |
| TT-031B | Visualization panel modes (`vorticity/Q/streamlines/pathlines`) | TT-031A, TT-020 | L | DONE |
| TT-031C | Topology/detection overlays + scientific export (`PNG/MP4/snapshots`) | TT-031B, TT-028 | XL | DONE |
| TT-032A | Документ `PHYSICAL_MODELS.md` (viscosity/stretching/boundary/wake) | TT-032 | M | DONE |
| TT-032B | Runtime params + integration order hooks for physical models | TT-032A, TT-030 | L | DONE |
| TT-032C | Validation protocol for physical realism (conservation + boundary/wake cases) | TT-032B, TT-017D | L | DONE |

## TT-033..TT-035 подзадачи (simulation lab + scaling + adaptive resolution)

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-033A | Документ `SIMULATION_LAB.md` (contract + reproducibility + batch policy) | TT-033 | M | DONE |
| TT-033B | Experiment contract + schema versioning + metadata hash | TT-033A, TT-017 | L | DONE |
| TT-033C | Batch runner queue (budgeted concurrency + retry policy + artifact sink) | TT-033B | XL | DONE |
| TT-033D | Lab Panel UI (experiment editor/run monitor/results + local persistence + compare/preview) | TT-033C, TT-020 | L | DONE |
| TT-034A | Документ `SCALE_PHYSICS.md` (nondimensional framework + validity envelope) | TT-034 | M | DONE |
| TT-034B | Reference scales + nondimensional converter (`Re/St/Ro`) | TT-034A, TT-023A, TT-024A | L | DONE |
| TT-034C | Scale presets + applicability checks + logging integration | TT-034B, TT-033C | L | DONE |
| TT-035A | Документ `ADAPTIVE_RESOLUTION.md` (controller contract + acceptance criteria) | TT-035 | M | DONE |
| TT-035B | Resolution controller core (signals, hysteresis, bounded patches, runtime-safe actuation guards) | TT-035A, TT-030C | XL | DONE |
| TT-035C | Adaptive diagnostics + debug resolution map + lab integration hooks | TT-035B, TT-033D | L | DONE |

## TT-036..TT-051 подзадачи (performance feasibility + research protocol/runbook/audit/report/trend)

| ID | Описание | Зависимости | Сложность | Статус |
|---|---|---|---|---|
| TT-037A | Unified research experiment matrix v1 (`rings/jets/turbulence/Helmholtz/Kelvin/reconnection`) | TT-037 | M | DONE |
| TT-037B | Instability study protocol v1 (repeatability envelope + sweep policy + unsupported criteria) | TT-037A, TT-030 | M | DONE |
| TT-037C | Publishable metric mapping v1 (`runtime/audit` -> publication metrics) | TT-037B, TT-016, TT-028 | M | DONE |
| TT-038A | Research preset pack v1 в runtime lab (`rings/jets/turbulence/Helmholtz/Kelvin/reconnection`) | TT-037A, TT-033D | M | DONE |
| TT-038B | Deterministic artifact naming contract v1 + export wiring (`JSON/CSV/MD`) | TT-038A, TT-033C | M | DONE |
| TT-038C | Executable runbook document (`RESEARCH_EXECUTABLE_RUNBOOK.md`) + sync `ROADMAP/SIMULATION_LAB` | TT-038A, TT-038B | S | DONE |
| TT-039A | CLI audit suite `researchPresetPackAudit.mjs` (`7` presets, gate checks, JSON/MD artifacts) | TT-038A, TT-017A | M | DONE |
| TT-039B | `audit-runner/package.json` scripts (`benchmark:research:presetpack[:ci]`) + smoke CI validation | TT-039A | S | DONE |
| TT-039C | Runbook `RESEARCH_PRESET_PACK_AUDIT.md` + sync `ROADMAP/PROGRESS/dashboard` | TT-039A, TT-039B | S | DONE |
| TT-040A | Full-duration CI baseline recheck (`RESEARCH_PRESET_AUDIT_DURATION_SCALE=1`) | TT-039B | S | DONE |
| TT-040B | Baseline verdict lock в runbook (`RESEARCH_PRESET_PACK_AUDIT.md`) + tracker sync | TT-040A | S | DONE |
| TT-041A | Dedicated smoke/full artifacts (`research-preset-pack-audit-{smoke,full}.{json,md}`) | TT-039B, TT-040A | S | DONE |
| TT-041B | Comparative report (`RESEARCH_PRESET_PACK_BASELINE_REPORT.md`) + sync `ROADMAP/PROGRESS/dashboard` | TT-041A | S | DONE |
| TT-042A | Rolling trend snapshot retention (`research-preset-pack-trend.json`) + same-scale baseline compare | TT-039A, TT-040A | M | DONE |
| TT-042B | Regress flags (`stepP95/sampleCount`) + strict trend CI mode (`benchmark:research:presetpack:trend:ci`) | TT-042A | S | DONE |
| TT-042C | Runbook/report/tracker updates for trend flow and thresholds | TT-042A, TT-042B | S | DONE |
| TT-043A | Multi-snapshot baseline policy (recent successful same-scale window, median/p90 anchors) | TT-042A | M | DONE |
| TT-043B | Dual-threshold trend gate (`stepP95` relative % + absolute ms above baseline p90) + min baseline points | TT-043A, TT-042B | M | DONE |
| TT-043C | Runbook/tracker sync for calibrated trend policy + strict trend CI verification | TT-043A, TT-043B | S | DONE |
| TT-044A | Versioned trend policy contract v1 (`research-preset-pack-trend-policy.v1.json`) + profile schema | TT-043B | S | DONE |
| TT-044B | Policy-driven resolver in `researchPresetPackAudit.mjs` (`profile` + env override precedence) | TT-044A | M | DONE |
| TT-044C | CI scripts/docs/tracker sync for `smoke/nightly` strict trend modes | TT-044A, TT-044B | S | DONE |
| TT-045A | Snapshot schema extension: `trendPolicyProfile` persisted in trend history entries | TT-044B | S | DONE |
| TT-045B | Baseline selector compare contract: same `durationScale` + comparable profile | TT-045A | S | DONE |
| TT-045C | Runbook/tracker sync for profile-segmented trend baseline policy | TT-045A, TT-045B | S | DONE |
| TT-046A | Add `RESEARCH_PRESET_AUDIT_FAIL_ON_INSUFFICIENT_BASELINE` strict gate in audit runner | TT-045B | S | DONE |
| TT-046B | Nightly strict-baseline CI script (`trend:nightly:strict-baseline:ci`) | TT-046A | S | DONE |
| TT-046C | Runbook/tracker sync for baseline sufficiency strict mode | TT-046A, TT-046B | S | DONE |
| TT-047A | Runtime gate broadened: block filament step on unsynced CPU snapshot for `executionMode={hybrid,hybrid_plus}` | TT-016C | M | DONE |
| TT-047B | Sync counters (`blocked/unsafe`) exported to runtime params for invariant auditability | TT-047A | S | DONE |
| TT-047C | Hybrid sync diagnostic upgraded to multi-mode + strict decoupling checks | TT-047A, TT-047B | S | DONE |
| TT-048A | Parametric thresholds in `hybridSyncDiagnostic` + strict CI profile (`benchmark:hybrid:syncdiag:ci`) | TT-047C | S | DONE |
| TT-048B | Hybrid sync runbook (`docs/HYBRID_SYNC_DIAGNOSTIC.md`) with checks/env/artifacts contract | TT-048A | S | DONE |
| TT-048C | Tracker sync for hybrid sync CI hardening (`ROADMAP/PROGRESS/dashboard`) | TT-048A, TT-048B | S | DONE |
| TT-049A | Repeated-run soak runner (`hybridSyncSoakAudit.mjs`) with aggregate PASS/FAIL verdict | TT-048A | S | DONE |
| TT-049B | Strict soak CI script + mode-aware frozen-ratio thresholding for `hybrid_plus` | TT-049A | S | DONE |
| TT-049C | Runbook/tracker sync for soak diagnostics and regression policy | TT-049A, TT-049B | S | DONE |
| TT-050A | Add `no_unsafe_unsynced_filament_steps` check to `researchPresetPackAudit` case gate | TT-047B | S | DONE |
| TT-050B | Wire per-case runtime unsafe/block counters (`delta`) into audit rows and console artifacts | TT-050A | S | DONE |
| TT-050C | Runbook/tracker sync for hybrid-sync invariant in preset CI | TT-050A, TT-050B | S | DONE |
| TT-051A | Rolling soak trend snapshots (`hybrid-sync-soak-trend.json`) with profile comparability (`strict/repeat`) | TT-049A | S | DONE |
| TT-051B | Soak trend regress flags + strict trend CI script (`benchmark:hybrid:syncdiag:soak:trend:ci`) | TT-051A | S | DONE |
| TT-051C | Runbook/tracker sync for soak trend flow and thresholds | TT-051A, TT-051B | S | DONE |
| | | | | |
| **Phase 7 — Native Core (Rust + wgpu)** | | | | |
| TT-071 | Rust workspace + ParticleData/SimParams structs + bytemuck layout | TT-070 | L | DONE |
| TT-072 | wgpu compute pipeline: 6 core WGSL shaders + GpuComputeManager + buffer management | TT-071 | XL | DONE |
| TT-073 | CPU physics on Rust + rayon (Biot-Savart, PSE, stretching, advection, reconnection, CFL, pipeline) | TT-071 | XL | DONE |
| TT-074 | FMM on Rust (octree, P2M, M2M, M2L, tree walk, quadrupole, 9 tests) | TT-071 | L | DONE |
| TT-075 | Tauri bridge: Rust ↔ JS UI IPC (init, step, state, diagnostics, params, backend_info) | TT-071, TT-073 | L | DONE |
| TT-076 | Native rendering: bridge adapter (Three.js IPC) + wgpu render shader foundation | TT-072 | XL | DONE |
| TT-077 | Dual-build system: `build:native` / `build:web` / `build:all` + feature flags + runtime detection | TT-075 | L | DONE |
| TT-078 | Cross-compilation: build scripts (5 targets) + GitHub Actions CI (macOS + Linux) | TT-077 | L | DONE |
| TT-079 | Native parity test: 6 physics tests (ring propagation, circulation, PSE, antisymmetry, bounded error) | TT-073, TT-072 | M | DONE |
| | | | | |
| **Phase 8 — Distributed Compute (Network)** | | | | |
| TT-080 | Network protocol design: binary frames, message types, domain decomposition scheme | TT-071 | L | TODO |
| TT-081 | Single-machine multi-GPU: domain split, shared memory sync, wgpu multi-adapter | TT-072, TT-080 | XL | TODO |
| TT-082 | LAN distributed compute: server/worker/observer architecture (torus-net crate) | TT-075, TT-080 | XL | TODO |
| TT-083 | FMM distributed: multipole exchange, far-field sync, latency-tolerant K-step updates | TT-074, TT-082 | XL | TODO |
| TT-084 | Conservation validation: global Γ/E/Ω checks, ghost extrapolation, fault tolerance | TT-082 | L | TODO |
| TT-085 | Headless server mode: CLI binary (torus-server), gRPC/REST API, coordinator/worker/standalone modes | TT-082 | L | TODO |
