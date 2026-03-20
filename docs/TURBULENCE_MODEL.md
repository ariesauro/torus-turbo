# Turbulence / Energy Cascade Model

Цель: расширить solver моделями турбулентной эволюции:

- Kelvin waves
- vortex breakdown
- energy cascade

## Модельные уровни

## L1. Filament-scale

- Kelvin-wave perturbations на filament spine.
- Метрики:
  - curvature spectrum,
  - local strain rate,
  - wave amplitude growth.

## L2. Tube-scale

- Деформация tube cross-section.
- Критерии breakdown:
  - резкий рост кривизны,
  - loss of coherence в shell-частицах,
  - reconnection bursts.

## L3. Cluster/Newtonium-scale

- Переход организованной структуры (ring/jet/torus) в turbulent cluster.
- Energy budget tracking:
  - kinetic proxy,
  - enstrophy proxy,
  - dissipation proxy.

## Energy Cascade Architecture

1. **Injection range**
   - энергия вводится эмиссией/пульсами и крупными структурами.
2. **Inertial transfer**
   - stretching + reconnection + filament fragmentation.
3. **Dissipation range**
   - PSE diffusion (default) / core spreading (fallback, `diffusionMethod: 'coreSpread'`) + annihilation criteria.

## Реализация по этапам

### Stage A (уже частично есть)

- cascade toggle (`cascadeEnabled`),
- physical cascade mode (`cascadeMode: 'physical'`): stretching→enstrophy + PSE→dissipation,
- split factor / interval,
- filament instability thresholds.

### Stage B

- spectral diagnostics:
  - coarse k-bins energy spectrum,
  - flux estimate between bins.

### Stage C

- adaptive closure:
  - subgrid viscosity based on local strain/enstrophy,
  - auto-tune reconnection thresholds.

## KPI модели

- Стабильность total circulation drift.
- Controlled growth/decay of enstrophy proxy.
- Reproducible regime transitions (ring -> turbulent breakdown).
- Performance budget: turbulence features <= 20% step overhead.

## CPU/GPU распределение

- GPU: local feature kernels, spectrum bin accumulation.
- CPU: topology-aware breakdown classifier и adaptive policy manager.

## Validation

- Deterministic replay на фиксированном seed.
- Regression tests для:
  - no-cascade baseline,
  - cascade-on energy transfer,
  - high-instability breakdown scenario.
