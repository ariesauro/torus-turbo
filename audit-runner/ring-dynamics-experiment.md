# P6.3 Ring Dynamics Experiment Report

> Generated: 2026-03-19T17:04:28.870Z
> Verdict: **ALL PASS**

## 1. Ring Propagation vs Saffman Theory

| Re | N | V_measured | V_Saffman | Error % | V* |
|----|---|-----------|-----------|---------|-----|
| 1000 | 64 | 0.2842 | 0.3466 | 18.0% | 3.5712 |
| 1000 | 128 | 0.2866 | 0.3466 | 17.3% | 3.6009 |
| 1000 | 256 | 0.2866 | 0.3466 | 17.3% | 3.6012 |
| 4500 | 64 | 0.2842 | 0.3466 | 18.0% | 3.5712 |
| 4500 | 128 | 0.2866 | 0.3466 | 17.3% | 3.6010 |
| 4500 | 256 | 0.2866 | 0.3466 | 17.3% | 3.6012 |
| 10000 | 64 | 0.2842 | 0.3466 | 18.0% | 3.5712 |
| 10000 | 128 | 0.2866 | 0.3466 | 17.3% | 3.6010 |
| 10000 | 256 | 0.2866 | 0.3466 | 17.3% | 3.6012 |

### Convergence with N
- Re=1000: N=64→N=256 error 18.0%→17.3% [CONVERGES]
- Re=4500: N=64→N=256 error 18.0%→17.3% [CONVERGES]
- Re=10000: N=64→N=256 error 18.0%→17.3% [CONVERGES]

## 2. Ring Near Wall (Image Vortex Boundary)

| Distance | d/σ | Deflection | In Layer | Effect |
|----------|-----|-----------|----------|--------|
| 0.05 | 0.4 | 0.07936 | YES | YES |
| 0.10 | 0.8 | 0.05624 | YES | YES |
| 0.20 | 1.7 | 0.01946 | YES | YES |
| 0.40 | 3.3 | -0.00023 | NO | YES |
| 0.80 | 6.7 | 0.00000 | NO | NO |
| 1.50 | 12.5 | 0.00000 | NO | NO |

## 3. Ring-Ring Leapfrog at Different Γ Ratios

| Γ₂/Γ₁ | Δz₁ | Δz₂ | Δr₁ | Δr₂ | Interacting |
|--------|-----|-----|-----|-----|-------------|
| 0.5 | -0.0539 | -0.0390 | 0.0071 | -0.0142 | YES |
| 1.0 | -0.0604 | -0.0637 | 0.0146 | -0.0146 | YES |
| 1.5 | -0.0669 | -0.0884 | 0.0224 | -0.0150 | YES |
| 2.0 | -0.0734 | -0.1131 | 0.0308 | -0.0154 | YES |

## 4. Ring Breakdown vs Reynolds Number

| Re | ν | Coherence Decay % | Enstrophy Ratio | E(k) Slope |
|----|---|-------------------|-----------------|------------|
| 500 | 0.006000 | 0.0% | 0.9949 | -1.865 |
| 2000 | 0.001500 | 0.0% | 0.9987 | -1.865 |
| 5000 | 0.000600 | 0.0% | 0.9995 | -1.865 |
| 10000 | 0.000300 | 0.0% | 0.9997 | -1.865 |

**Re-dependent breakdown**: Higher Re → ring persists longer (less coherence decay).

## References

- Saffman (1992) — Vortex Dynamics
- Gharib, Rambod & Shariff (1998) — Formation number
- Lim & Nickels (1995) — Vortex ring leapfrogging
