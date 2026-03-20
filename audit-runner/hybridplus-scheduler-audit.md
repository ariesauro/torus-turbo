# Hybrid+ scheduler audit

Generated: 2026-03-17T23:25:07.709Z

| Case | cadence base/max | runΔ | skipCadenceΔ | skipBudgetΔ | overBudgetMax | idleMax | pressureMax | Gate |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| balanced | 1/1 | 150 | 0 | 0 | 0 | 42 | 0.25 | PASS |
| budget_guard | 1/3 | 198 | 0 | 0 | 2 | 31 | 9.20 | PASS |
| idle_throttle | 1/3 | 238 | 0 | 0 | 2 | 352 | 0.00 | PASS |

## Gate checks

### balanced
- status: PASS
- active_seen: PASS
- assist_engaged: PASS

### budget_guard
- status: PASS
- over_budget_detected: PASS
- scheduler_response: PASS
- bh_shed_or_guard: PASS

### idle_throttle
- status: PASS
- idle_detected: PASS
- idle_cadence_scale: PASS

Overall gate: PASS
