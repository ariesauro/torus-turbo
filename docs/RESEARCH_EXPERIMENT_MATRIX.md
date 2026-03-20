# RESEARCH_EXPERIMENT_MATRIX

Последнее обновление: 2026-03-18

## Цель

Сформировать единый исследовательский контур для тем `rings/jets/turbulence/Helmholtz/Kelvin/reconnection` с reproducible запуском, сопоставимыми метриками и publish-ready mapping.

## Scope (`TT-037`)

- `TT-037A`: матрица экспериментов (сценарии, sweep-оси, seeds, acceptance windows).
- `TT-037B`: протокол изучения неустойчивостей (Helmholtz/Kelvin/reconnection) с повторяемой процедурой.
- `TT-037C`: mapping численных/диагностических сигналов в publishable показатели.

## Experiment Matrix (v1)

| Family | Scenario IDs | Sweep axes | Fixed controls | Primary outputs |
|---|---|---|---|---|
| Rings | `ring_single`, `ring_pair`, `ring_leapfrog` | `Gamma`, `R/r`, viscosity, separation | seed set, profile, backend policy | propagation speed, ring coherence, drift envelope |
| Jets | `jet_pulse_train`, `jet_multi_emitter`, `jet_twist_breakdown` | `St`, `Re`, emitter phase lag, twist | nozzle geometry, seed set | structure train persistence, wake transition score |
| Turbulence | `turb_decay`, `turb_forced`, `turb_breakdown` | forcing amplitude, reconnection thresholds, filter policy | same logging cadence | cascade proxy trend, enstrophy flux proxy, cluster fragmentation |
| Helmholtz | `kh_interface_shear`, `kh_filament_shell` | shear gradient, curvature threshold | same sampling window | growth rate proxy, deformation onset time |
| Kelvin waves | `kelvin_pulse`, `kelvin_train`, `kelvin_damped` | excitation amplitude/frequency, damping knobs | same reconnection policy | wave persistence, wave-energy coupling |
| Reconnection | `reconnect_pair`, `reconnect_cluster` | distance/angle thresholds, annihilation window | conservation guards fixed | circulation retention, topology event stability |

## Instability Study Protocol

1. Зафиксировать `seed/profile/backend policy` и reproducibility metadata envelope.
2. Выполнить baseline run + minimum 3 повторов для каждого scenario ID.
3. Выполнить sweep только по одной оси за прогон (one-factor-at-a-time), затем cross-term pass.
4. На каждом шаге валидировать conservation/diagnostics guards (`TT-030`, `TT-017`).
5. При выходе за acceptance window помечать результат как `unsupported` вместо ретюна "по месту".

## Publishable Metric Mapping (v1)

| Runtime / Audit signal | Publishable metric | Aggregation | Notes |
|---|---|---|---|
| `circulationDriftPercent` | circulation stability envelope | median + p95 + max abs | сравнение между backend и sweep |
| `energyBins / flux proxy` | cascade transfer signature | slope window + regime labels | применимо для turbulence/jet wake |
| detector confidence (`sheet/ring/tube/filament`) | structure persistence index | confidence-weighted dwell time | с uncertainty band |
| topology events (`birth/split/merge/reconnect`) | topology transition rate | events per 1k steps | отдельно по сценарным семействам |
| runtime cost (`step median/p95`) | computational cost envelope | p50/p95 + fail ratio | публикуется рядом с физическими метриками |
| instability onset markers | instability growth proxy | onset lag + normalized growth | для Helmholtz/Kelvin карт режимов |

## Acceptance Rules

- Любой candidate-result без reproducibility envelope (seed/profile/build/hash) считается непригодным для comparative analysis.
- Сравнение между режимами допустимо только при совпадающем sampling cadence.
- Publish таблицы строятся только из run-пакетов без `gate FAIL` по критичным checks.

## Artifacts

- Primary: `lab` artifacts (`JSON/CSV`) с metadata envelope.
- Secondary: benchmark snapshots (`long-run`, `turbulence breakdown`) как контроль численной устойчивости.

## Executable Runbook Bridge

- `TT-038` закрывает исполнимую связку matrix -> runtime presets -> deterministic artifact naming.
- Детали: `docs/RESEARCH_EXECUTABLE_RUNBOOK.md`.

Этот документ задает baseline-рамку для исследовательских серий; расширения допускаются только через versioned update (v2+).
