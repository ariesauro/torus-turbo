# P6.5 Performance Benchmark Report

> Generated: 2026-03-19T17:05:05.359Z

## 1. Biot-Savart Scaling

| N | Direct (ms) | FMM (ms) | Speedup |
|---|------------|----------|---------|
| 64 | 1.38 | 1.75 | 0.8× |
| 128 | 1.10 | 1.21 | 0.9× |
| 256 | 4.53 | 4.42 | 1.0× |
| 512 | 19.01 | 21.20 | 0.9× |
| 1024 | 76.28 | 52.77 | 1.4× |
| 2048 | 295.71 | 88.20 | 3.4× |

Scaling exponent: **2.04** (expected 2.0 for O(N²))

## 2. Pipeline Component Breakdown (N=512)

| Component | Time (ms) | Fraction |
|-----------|----------|----------|
| Biot-Savart (N²) | 26.43 | 48.1% |
| Advection | 0.11 | 0.2% |
| Stretching | 3.59 | 6.5% |
| PSE Diffusion | 24.80 | 45.2% |
| **Total** | **54.93** | 100% |

## 3. Throughput

| N | Step (ms) | Steps/s | Realtime 30fps? |
|---|----------|---------|-----------------|
| 128 | 17.7 | 56 | YES |
| 256 | 32.0 | 31 | YES |
| 512 | 53.6 | 19 | NO |
| 1024 | 1062.5 | 1 | NO |
| 2048 | 1200.0 | 1 | NO |

Max N at 30fps (CPU): **256**

## 4. Memory Scaling

| N | Memory (MB) | Bytes/particle |
|---|------------|---------------|
| 1000 | 0.34 | 361 |
| 5000 | 0.00 | 0 |
| 10000 | 1.61 | 169 |
| 20000 | 3.25 | 170 |
| 50000 | 6.43 | 135 |
