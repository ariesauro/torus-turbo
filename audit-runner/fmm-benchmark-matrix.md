# FMM benchmark matrix

Generated: 2026-03-17T13:21:16.524Z

## Full-step performance

| N | Solver | repeats | step median/p95 (ms) | throughput median (pps) | speedup vs exact | note |
|---:|---|---:|---:|---:|---:|---|
| 10000 | exact | 3 | 8466.29/10034.77 | 1181 | 1.00 |  |
| 10000 | spatialGrid | 3 | 1752.80/1785.13 | 5705 | 4.83 |  |
| 10000 | fmm | 3 | 662.49/671.74 | 15095 | 12.78 |  |
| 50000 | exact | 0 | NaN/NaN | NaN | - | skipped_exact_full_above_10000 |
| 50000 | spatialGrid | 2 | 19258.36/19280.38 | 2596 | - |  |
| 50000 | fmm | 2 | 9023.23/9495.34 | 5556 | - |  |
| 100000 | exact | 0 | NaN/NaN | NaN | - | skipped_exact_full_above_10000 |
| 100000 | spatialGrid | 2 | 58752.11/66574.59 | 1733 | - |  |
| 100000 | fmm | 2 | 31948.50/35339.84 | 3166 | - |  |
| 500000 | exact | 0 | NaN/NaN | NaN | - | skipped_exact_full_above_10000 |
| 500000 | spatialGrid | 1 | 2402272.69/2402272.69 | 208 | - |  |
| 500000 | fmm | 1 | 703111.95/703111.95 | 711 | - |  |

## Accuracy on exact reference block

| N | block size | targets | Solver | rel RMSE | MAE | max abs err | ref speedup vs exact (block) |
|---:|---:|---:|---|---:|---:|---:|---:|
| 10000 | 4096 | 256 | spatialGrid | 0.2176 | 1.611e+2 | 2.673e+2 | 1.00 |
| 10000 | 4096 | 256 | fmm | 0.0613 | 4.070e+1 | 1.074e+2 | 1.94 |
| 50000 | 4096 | 256 | spatialGrid | 0.2202 | 1.642e+2 | 2.795e+2 | 1.65 |
| 50000 | 4096 | 256 | fmm | 0.0640 | 4.251e+1 | 1.988e+2 | 5.32 |
| 100000 | 4096 | 256 | spatialGrid | 0.2196 | 1.614e+2 | 2.773e+2 | 1.63 |
| 100000 | 4096 | 256 | fmm | 0.0636 | 4.242e+1 | 1.071e+2 | 5.26 |
| 500000 | 4096 | 256 | spatialGrid | 0.2184 | 1.631e+2 | 2.824e+2 | 1.56 |
| 500000 | 4096 | 256 | fmm | 0.0640 | 4.252e+1 | 1.066e+2 | 5.17 |

## Gates

- spatial relRMSE <= 0.42
- fmm relRMSE <= 0.38
- fmm speedup vs exact (for N<=10000) >= 1.15

Gate verdict: PASS