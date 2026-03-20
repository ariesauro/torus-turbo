# Vortex Transitions System (TT-022A)

Цель: задать строгую систему переходов между представлениями:

- `particles -> clusters`
- `clusters -> filaments`
- `filaments -> tubes`
- `tubes -> macro vortex objects`
- `sheet -> filaments`
- `sheet -> particles`

## 1) Принципы

- Переход - это оператор с условиями применимости, а не мгновенный эвристический switch.
- На каждом переходе контролируются инварианты:
  - total circulation (`Gamma`) drift,
  - impulse drift,
  - bounded energy drift (с учетом регуляризации).
- Вводится hysteresis (enter/exit thresholds), чтобы исключить флип-флоп на границе режимов.

## 2) Формальная схема transition gate

Для каждого кандидата перехода:

1. `detect` (кандидат найден detector'ом),
2. `score` (confidence + quality metrics),
3. `gate` (physics constraints + thresholds),
4. `commit` (применить оператор),
5. `audit` (записать drift и confidence в runtime diagnostics).

## 3) Таблица переходов

| Transition | Trigger signals | Must-hold invariants | Notes |
|---|---|---|---|
| particles -> clusters | density coherence, vorticity alignment | `Gamma` local/global | только если кластер устойчив `T_enter` |
| clusters -> filaments | PCA anisotropy (1D dominance) | `Gamma`, impulse | требуется continuity skeleton |
| filaments -> tubes | filament stability, shell coherence | `Gamma`, bounded energy drift | tube projection с quality check |
| tubes -> macro objects | persistent morphology | semantic consistency | tracked в newtonium tracker |
| sheet -> filaments | sheet ridge extraction + roll-up score | `Gamma`, impulse | только при high-confidence ridges |
| sheet -> particles | mesh quality degradation, high curvature breakup | `Gamma` | controlled resampling с error bound |

## 4) Runtime state machine

Состояния для каждого перехода:

- `candidate`
- `pending_confirm`
- `committed`
- `rejected`

Параметры:

- `T_enter`, `T_exit` (hysteresis windows),
- `C_min` (minimum confidence),
- `I_max` (max allowed invariant drift per transition).

## 5) Диагностика

Публикуемые поля:

- `runtimeTransitionCandidates`
- `runtimeTransitionCommitted`
- `runtimeTransitionRejected`
- `runtimeTransitionGammaDriftPct`
- `runtimeTransitionImpulseDriftPct`
- `runtimeTransitionEnergyDriftPct`
- `runtimeTransitionState` (`idle/candidate/pending_confirm/committed/rejected`)
- `runtimeTransitionGateConfidenceOk`, `runtimeTransitionGateInvariantOk`, `runtimeTransitionGateHysteresisOk`
- `runtimeTransitionGateReason`, `runtimeTransitionEnterFrames`, `runtimeTransitionConfidenceEnterMin`, `runtimeTransitionConfidenceExitMin`

## 6) Связь с детектором

`detectVortexStructures` должен возвращать не только класс, но и transition-relevant признаки:

- temporal confidence,
- morphology stability,
- uncertainty interval.

## 7) Научная строгость

- Любой новый transition rule должен иметь reference scenario и acceptance bounds.
- При превышении drift bounds переход считается недопустимым даже при высоком confidence.
