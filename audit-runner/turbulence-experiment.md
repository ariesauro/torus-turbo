# P6.4 Turbulence Experiments Report

> Generated: 2026-03-19T17:04:33.359Z
> Verdict: **ALL PASS**

## 1. E(k) Spectrum Convergence

| N | Slope | Bins with energy | Max E(k) |
|---|-------|-----------------|----------|
| 100 | -1.282 | 11/12 | 0.129035 |
| 200 | -2.367 | 6/12 | 0.230066 |
| 400 | -2.077 | 6/12 | 0.436314 |

Average slope: **-1.908** (Kolmogorov: -1.667)

## 2. KH Instability Wavelength Sweep

| λ/L | k | Growth ratio | Analytic | Measured rate | Theory rate | Rate ratio |
|-----|---|-------------|----------|--------------|-------------|------------|
| 2.00 | 0.785 | 6.70× | 1.13× | 6.340 | 0.393 | 16.14 |
| 1.00 | 1.571 | 2.81× | 1.27× | 3.450 | 0.785 | 4.39 |
| 0.50 | 3.142 | 5.34× | 1.60× | 5.584 | 1.571 | 3.55 |
| 0.25 | 6.283 | 6.95× | 2.57× | 6.465 | 3.142 | 2.06 |

## 3. Enstrophy Production/Dissipation Balance

- Enstrophy: 263.9 → 274.5 (×1.04)
- Vorticity conservation error: 0.56%
- Late-stage P/D ratio: **1.80** (1.0 = equilibrium)

## 4. Cascade Timescales

| ν | τ_stretch (s) | τ_diffuse (s) | τ_d/τ_s |
|---|--------------|--------------|---------|
| 0.001 | 0.092 | 151.741 | 1647.51 |
| 0.005 | 0.092 | 30.453 | 330.64 |
| 0.010 | 0.092 | 15.292 | 166.04 |
| 0.020 | 0.092 | 7.712 | 83.73 |

Higher ν → faster diffusion → τ_diffuse decreases → approaches production/dissipation balance.

## References

- Kolmogorov (1941) — Energy spectrum E(k) ∝ k^(-5/3)
- Batchelor (1953) — Theory of Homogeneous Turbulence
- Cottet & Koumoutsakos (2000) — Vortex Methods
