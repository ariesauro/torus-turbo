# Physical Realism Modules (TT-032A)

Цель: повысить физическую достоверность solver через controlled viscosity/stretching/boundary/wake модели.

## 1) Viscosity Model

Поддерживаем два механизма:

1. Particle Strength Exchange (PSE) — **default**:
   - диффузионный обмен вихревости между соседями.
2. Core spreading — **fallback** (`diffusionMethod: 'coreSpread'`):
   - `sigma(t) = sqrt(sigma0^2 + 4 * nu * t)` (или эквивалент для `coreRadius`).

Требование:

- bounded conservation drift при выбранном `nu`.

## 2) Vortex Stretching

Базовый член:

- `d(omega)/dt = (omega . grad) u`

Интеграция:

- analytic (ω·∇)u vortex stretching (default; legacy Gaussian-weighted Δv via `stretchingMethod: 'legacy'`),
- filament stretching (geometry update),
- tube radius response при сохранении циркуляции.

## 3) Boundary Interaction

Поддержка:

- planes,
- spheres,
- mesh obstacles (phase 2).

Механизмы:

- no-slip/no-penetration approximation,
- image vortices (для простых геометрий),
- boundary-induced vorticity generation (shear).

## 4) Wake Simulation

Сценарии:

- cylinder wake,
- wing-like trailing wake (proxy setup).

Метрики:

- shedding frequency proxy,
- wake coherence/lifetime,
- energy transfer to turbulent structures.

## 5) Integration Order (runtime)

Рекомендуемый canonical порядок в шаге:

1. velocity computation,
2. stretching,
3. diffusion (core spreading/PSE),
4. boundary interaction,
5. diagnostics and stability checks.

Runtime profile hooks (`TT-032B`):

- `canonical`: `stretching -> diffusion -> boundary_interaction -> wake_forcing`,
- `boundary_first`: `boundary_interaction -> stretching -> diffusion -> wake_forcing`,
- `diffusion_first`: `diffusion -> stretching -> boundary_interaction -> wake_forcing`.

Примечание: на текущем этапе boundary/wake hooks подключены как controlled no-op placeholders (чтобы фиксировать порядок/контракт), а не как полноценные физические операторы.

## 6) UI Controls

Параметры:

- viscosity (`nu`),
- stretching strength,
- boundary effects toggles,
- wake forcing presets.

## 7) Visualization Hooks

Показывать:

- boundary layers,
- vortex shedding,
- wake structures.

## 8) Scientific Validation

Acceptance:

- controlled drift for circulation/energy,
- reproducible behavior at fixed params/seed,
- qualitative agreement with canonical wake/shear scenarios.

### TT-032C baseline protocol (phase-0)

Минимальный валидационный набор до full boundary/wake physics:

1. **Order sensitivity check**  
   Один и тот же seed/профиль/параметры прогоняется в `canonical`, `boundary_first`, `diffusion_first`.
   Проверяем:
   - `|ΔE| <= 12%` между профилями на одинаковом окне времени,
   - `|ΔΓ| <= 6%` между профилями,
   - отсутствие роста `runtimePhysicalWarnings` кроме ожидаемых proxy-warning IDs.

2. **Diffusion monotonicity check**  
   Для фиксированного сценария (ring/jet) запуски с `physicalViscosityNu = [0.0001, 0.0005, 0.001]`.
   Проверяем:
   - монотонный рост `coreRadius` median,
   - отсутствие неограниченного роста enstrophy proxy.

3. **Stretching gain boundedness check**  
   Для `physicalStretchingStrength = [0.5, 1.0, 1.5]` при фиксированном остальном:
   - `runtimeStabilityLevel != critical`,
   - no NaN/Inf в ключевых runtime proxies,
   - bounded drift по energy/circulation в рамках профиля железа.

Артефакты baseline (`Lab`/benchmark post-analysis):

- сводка по профилям интеграции (`runtimePhysicalStepOrder`, `runtimePhysicalIntegrationOrderProfile`),
- таблица drift-метрик (`energy/circulation/enstrophy`),
- список warnings с долей ожидаемых proxy-warning.
