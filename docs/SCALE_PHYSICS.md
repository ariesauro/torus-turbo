# Scale Physics Mode (TT-034)

Цель: запускать сравнимые вихревые сценарии на разных масштабах через безразмерные параметры, а не через произвольное масштабирование UI-ползунков.

## 1. Scientific premise

Scale mode основан на reference scales:
- `L_ref` (length),
- `U_ref` (velocity),
- `T_ref = L_ref / U_ref`,
- `nu_ref` (kinematic viscosity).

Model validity должна явно проверяться через applicability envelope.

## 2. Scale Classes

V1 scale classes:
- `micro`,
- `lab`,
- `atmospheric`,
- `astro`.

Каждый класс задает:
- reference ranges,
- expected Reynolds band,
- known missing physics (compressibility, stratification, MHD, buoyancy).

## 3. Dimensionless control

Primary nondimensional groups:
- Reynolds `Re = U_ref * L_ref / nu`,
- Strouhal `St`,
- Rossby `Ro` (optional; только если заданы rotation effects).

Все авто-преобразования параметров должны сохранять целевые группы в пределах tolerance.

## 4. Automatic Scaling Rules

При смене масштаба система:
- пересчитывает dimensional params из nondimensional targets,
- проверяет consistency constraints,
- применяет guards при выходе за допустимые bounds.

Нельзя независимо менять `viscosity/velocity/length/time` без пересчета через nondimensional constraints.

## 5. Amer/Filament/Tube implications

Scale влияет на:
- discretization density targets (numerical resolution),
- interaction radius policy,
- regularization bounds.

Важно: "Amer particle density" трактуется как численный resolution control, не как physical mass density.

## 6. Visualization scaling separation

Разделить:
- `physicsScale` (физика),
- `viewScale` (render/UX).

Изменение `viewScale` не должно менять physics outcome.

## 7. Presets

V1 presets:
- water vortex ring,
- smoke ring,
- atmospheric vortex window,
- astro toy vortex (explicitly marked approximate).

Каждый preset содержит:
- target nondimensional ranges,
- expected qualitative regime,
- limitations and unsupported physics.

## 8. Integration with Simulation Lab

Lab experiments должны поддерживать scale dimension в sweep:
- `scaleClass`,
- optional nondimensional targets (`Re`, `St`).

Artifacts обязательно сохраняют:
- scale class,
- dimensional conversion table,
- final nondimensional check report.

## 9. Logging and validation

Log fields:
- `scaleClass`,
- reference scales,
- nondimensional groups before/after auto-scaling,
- applicability verdict (`valid`, `approximate`, `unsupported`).

Acceptance:
- conversions are deterministic,
- nondimensional error below tolerance,
- invalid configs fail fast with explicit reason.

## 10. Applicability thresholds (V1 calibration)

V1 evaluator использует class-aware окна:

- `micro`:
  - `Re valid: [80, 1.2e4]`, `Re approximate: [20, 8.0e4]`
  - `St valid: [0.08, 1.2]`, `St approximate: [0.02, 2.0]`
  - `Ro guard`: `Ro < 0.1` -> минимум `approximate`
- `lab`:
  - `Re valid: [5.0e2, 3.0e4]`, `Re approximate: [1.0e2, 2.0e5]`
  - `St valid: [0.1, 0.8]`, `St approximate: [0.02, 1.5]`
  - `Ro guard`: `Ro < 0.08` -> минимум `approximate`
- `atmospheric` (toy):
  - `Re valid: [1.0e5, 1.0e7]`, `Re approximate: [1.0e4, 5.0e7]`
  - `St valid: [0.05, 0.5]`, `St approximate: [0.01, 1.0]`
  - `Ro guard`: `Ro < 0.2` -> минимум `approximate`
  - always carries missing-physics reason (stratification/Coriolis closure not modeled)
- `astro` (toy):
  - `Re valid: [5.0e4, 2.0e6]`, `Re approximate: [1.0e4, 1.0e7]`
  - `St valid: [0.01, 0.3]`, `St approximate: [0.005, 0.8]`
  - `Ro guard`: `Ro < 0.5` -> минимум `approximate`
  - always carries missing-physics reason (MHD/compressibility not modeled)

Classification rule:
- outside `approximate` window for `Re`/`St` -> `unsupported`,
- inside `approximate` but outside `valid` window -> at least `approximate`,
- additional missing-physics reasons may keep class at `approximate` even in valid numeric window.

## 11. Runbook notes (Lab integration)

Для каждого run в Lab artifacts сохраняются:
- `scalePresetId`,
- `scaleApplicabilityLevel`,
- `scaleApplicabilityReasons`.

Рекомендованный workflow:
- сначала фильтровать выборку по `scaleApplicabilityLevel=valid`,
- `approximate` использовать для qualitative trend checks, не для строгих количественных выводов,
- `unsupported` исключать из aggregate conclusions и помечать как out-of-envelope.

## 12. Natural mode and external validation boundary

`Natural` (`guidedPhysics`) c активными модификаторами (`guidedStrength`, `alpha` и др.) трактуется как
guided/internal режим для exploratory исследований и runtime diagnostics.

Строгое правило:
- internal contracts (`ring/jet/detector/topology`) могут быть `pass/warn/fail` для контроля устойчивости,
- но external scientific validation eligibility должна быть `not eligible`, пока активен хотя бы один natural modifier.

Это ограничение обязательно для направлений:
- LES/DNS cross-validation,
- Sensitivity/uncertainty (Sobol/local),
- Boundary realism v2 (near-wall quantitative validation).

## 13. Future distributed scaling contour (server/client/participant network)

Масштабирование на сеть участников допускается как future research contour при выполнении условий:
- явный network reproducibility envelope (`RTT`, jitter, packet loss, clock skew),
- deterministic replay / synchronization contract между local and distributed execution,
- formal compute split policy (`local`, `server`, `distributed-participant`) с parity audit,
- scientific parity-check: одинаковые сценарии должны подтверждать bounded divergence между
  local baseline и распределенным контуром.

Без этих условий distributed run считается exploratory-only и не может повышать external validation level.

Formal distributed protocol draft: `docs/DISTRIBUTED_VALIDATION_CONTOUR.md` (`TT-067`).

Roadmap policy note: distributed/server-client scaling remains `post-classic` scope and starts only after classic local-compute closure plus external validation evidence are completed (`TT-068`).
Classic closure checklist: `docs/CLASSIC_EXTERNAL_VALIDATION_CLOSURE_CHECKLIST.md` (`TT-068A`).
