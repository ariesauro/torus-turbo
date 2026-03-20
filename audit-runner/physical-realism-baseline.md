# Physical realism baseline report

Generated: 2026-03-17T05:27:40.010Z

## Scenario rows

| Case | profile | nu | stretch | stepP95 | energyDrift | circulationDrift | enstrophyEnd | criticalRatio | unexpectedWarnings |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| order.canonical | canonical | 0.000300 | 1.000 | 181.300 | 0.000 | 0.000 | 0.037 | 1.000 | - |
| order.boundary_first | boundary_first | 0.000300 | 1.000 | 153.400 | 0.000 | 0.000 | 0.000 | 1.000 | - |
| order.diffusion_first | diffusion_first | 0.000300 | 1.000 | 138.900 | 0.000 | 0.000 | 0.000 | 1.000 | - |
| diffusion.nu_1e-4 | canonical | 0.000100 | 1.000 | 136.000 | 0.000 | 0.000 | 0.000 | 1.000 | - |
| diffusion.nu_5e-4 | canonical | 0.000500 | 1.000 | 136.800 | 0.000 | 0.000 | 0.000 | 1.000 | - |
| diffusion.nu_1e-3 | canonical | 0.001000 | 1.000 | 137.000 | 0.000 | 0.000 | 0.000 | 1.000 | - |
| stretching.gain_0_5 | canonical | 0.000300 | 0.500 | 141.400 | 0.000 | 0.000 | 0.000 | 1.000 | - |
| stretching.gain_1_0 | canonical | 0.000300 | 1.000 | 137.300 | 0.000 | 0.000 | 0.000 | 1.000 | - |
| stretching.gain_1_5 | canonical | 0.000300 | 1.500 | 137.600 | 0.000 | 0.000 | 0.000 | 1.000 | - |

## Checks

### Order sensitivity

- status: PASS
- order_energy_pair_delta: PASS (value=0, threshold=12)
- order_circulation_pair_delta: PASS (value=0, threshold=6)
- order_unexpected_warnings: PASS (value=0, threshold=0)

### Diffusion monotonicity

- status: PASS
- diffusion_enstrophy_monotonic: PASS (value=0 -> 0 -> 0, threshold=non-increasing)
- diffusion_finite_metrics: PASS (value=0, threshold=0)

### Stretching boundedness

- status: PASS
- stretching_step_p95_guard: PASS (value=141.4000000357628, threshold=400)
- stretching_finite_metrics: PASS (value=0, threshold=0)

Overall gate: PASS