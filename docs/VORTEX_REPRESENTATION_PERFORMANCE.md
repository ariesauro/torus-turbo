# Representation Performance Policy (TT-027A)

Цель: формализовать научно-обоснованный и hardware-aware выбор между `particles`, `filaments`, `sheets`, чтобы решение о representation было воспроизводимым, диагностируемым и пригодным для acceptance-проверок.

## 1) Problem statement

Нет "универсально лучшего" представления: оптимум зависит от режима течения, структуры, budget и требуемой точности.

Без строгого policy возникают типовые ошибки:

- визуально быстрый, но физически нестабильный switching;
- drift инвариантов из-за агрессивных переходов;
- невоспроизводимость выбора между машинами/hardware-профилями.

## 2) Comparative matrix

| Representation | Сильные стороны | Слабые стороны | Рекомендуемые режимы |
|---|---|---|---|
| particles | универсальность, GPU-friendly instancing, стабильный fallback | шум, высокая `N` для гладких поверхностей | турбулентный wake, dispersed structures |
| filaments | компактность для 1D coherent vortices, хорошая трассировка core lines | reconnection/топология, CPU cost при больших node counts | ring/tube spine, coherent cores |
| sheets | физически адекватно для shear layers и interface dynamics | сложный Biot-Savart/panel quality, высокие требования к numerics | jet shear layer, wake interface |

## 3) Runtime decision contract

Для каждого representation вводится score:

- `S_particles`
- `S_filaments`
- `S_sheets`

### 3.1 Score decomposition

`S_rep = w_m * M_rep + w_e * (1 - E_rep) + w_c * (1 - C_rep) + w_mem * (1 - P_rep)`

Где:

- `M_rep` - morphology alignment (detector + class confidence),
- `E_rep` - normalized error estimate (physics/geometry mismatch),
- `C_rep` - normalized compute cost estimate (`step p95` + queue contention),
- `P_rep` - normalized memory pressure (`VRAM/RAM` headroom).

Нормализация: все компоненты в диапазоне `[0..1]`.

### 3.2 Hard gates (must-pass)

Переход разрешен только если одновременно:

1. `score margin` выполнен: `S_target - S_current >= delta_switch`,
2. выполнены transition gates (`TT-022`: hysteresis + confidence),
3. `bounded invariant drift` не нарушен (`Gamma`, energy envelope, impulse bounds),
4. `runtime health` не в деградации (нет active fallback storm / timeout burst).

### 3.3 Hysteresis

- Для предотвращения "ping-pong" вводится окно удержания `hold_steps_min`.
- Обратный переход возможен только при `delta_back > delta_switch`.
- Любой emergency fallback bypass-ит score, но фиксируется в diagnostics как policy override.

## 4) Hardware-aware policy tiers

- `low_end`: приоритет `particles/filaments`, `sheets` только локально и с capped resolution.
- `mid_gpu`: `sheets` разрешены для confidence-verified shear zones.
- `high_gpu`: разрешен расширенный sheet budget при прохождении invariant gates.

Auto-profile обязан публиковать representation budget:

- `sheetWorkloadBudget`,
- `maxSheetPanels`,
- `representationSwitchCooldown`.

## 5) Diagnostics contract (for UI/export)

Минимальные runtime поля policy:

- `runtime.representationPolicy.mode`,
- `runtime.representationPolicy.score.{particles,filaments,sheets}`,
- `runtime.representationPolicy.margin`,
- `runtime.representationPolicy.hysteresis.{holdSteps,remaining}`,
- `runtime.representationPolicy.overrideReason` (nullable),
- `runtime.representationPolicy.health.{fallbackRate,timeoutRate,driftSeverity}`,
- `runtime.representationPolicy.sheetDiscretization.{profileId,panelCount,coverage,demandCoverage,quadratureOrder,quadratureProfile,desingularizationEpsilon}`,
- `runtime.representationPolicy.sheetDiscretization.meshPlan.{seed,topology,patchCount,panelAspectP95}`,
- `runtime.representationPolicy.sheetDiscretization.meshLayout.{deterministic,digest,patchPanelMin,patchPanelMax,patchPanelImbalance}`,
- `runtime.representationPolicy.sheetDiscretization.qualityGates.{passCount,total,verdict,penalty}`,
- `runtime.representationPolicy.sheetDiscretization.meshBuilderContract.{version,profileId,valid,issueCount,gatePassCount,gateTotal,verdict,penalty,envelope.patchAreaMean,envelope.patchAreaCv,envelope.edgeLengthRatioP95,envelope.curvatureProxyP95}`.
- `runtime.representationPolicy.sheetDiscretization.couplingContracts.{version,valid,verdict,penalty,amer.{state,transferBudget,invariantDriftCapPct},filament.{state,nodeTransferCap,load},rollupStabilityGuard}`.

Научный export должен сериализовать эти поля в snapshot/sequence metadata, чтобы решение о representation было аудитируемым post-factum.

## 6) Acceptance criteria (machine-checkable baseline)

| ID | Критерий | PASS condition |
|---|---|---|
| `TT027A_SCORE_NORMALIZATION` | Компоненты score корректны | `M/E/C/P in [0..1]`, `S_rep in [0..1]` |
| `TT027A_GATE_ENFORCEMENT` | Переходы не обходят gates | ни одного switch при нарушенных transition/invariant gates |
| `TT027A_HYSTERESIS_STABILITY` | Нет дребезга representation | switch-rate <= configured threshold и нет ping-pong window violations |
| `TT027A_HARDWARE_TIER_SAFETY` | Low-end не уходит в sheet overload | memory/latency guard не нарушен, sheet caps соблюдены |
| `TT027A_EXPORT_REPRODUCIBILITY` | Решение воспроизводимо | export содержит policy scores/gates/override metadata |
| `TT027A_SHEET_QUALITY_GATES` | Sheet mesh quality под контролем | `qualityGates.verdict != fail`, `passCount/total >= 0.5`, penalty в допустимом диапазоне baseline |
| `TT027A_SHEET_MESH_CONTRACT_VALID` | Panel mesh builder contract консистентен | `meshBuilderContract.valid=true`, issueCount=0, envelope в допустимых baseline-диапазонах |
| `TT027A_SHEET_COUPLING_CONTRACT_VALID` | Coupling contracts безопасны | `couplingContracts.valid=true`, verdict != `fail`, rollup guard активируется при fail-path |

## 7) Integration with long-run suite (TT-017D bridge)

Representation-aware checks должны войти в long-run gate-table:

- `switch_rate_per_min`,
- `representation_residency_ratio`,
- `policy_override_count`,
- `drift_vs_switch_correlation`.

Fail-fast условия:

- burst switches + растущий drift,
- frequent overrides без recovery,
- sheet budget violations на low-end профилях.

## 8) Implementation phases

- `P0` (DONE): score-less safe baseline (rule-based switching).
- `P1` (DONE): policy contract doc + acceptance baseline (`TT-027A`).
- `P2` (DONE): runtime score publication + hardware-aware hooks (`TT-027B`).
- `P3` (DONE): representation-aware long-run gates + policy verdict/reporting (`override-count`, `driftSeverity`, baseline gates, verdict summary, trend history).
