# Validation Governance Runbook v1

> Generated: 2026-03-19  
> Parent: TT-070 (Continuous Validation Governance)  
> Step: TT-070A

---

## 1. Purpose

After closure of the classic (TT-068) and distributed (TT-067) validation contours, all CI chains must operate under a unified governance regime. This runbook defines:

- Which validation contours exist and what they verify.
- How often each contour must be re-run (cadence).
- What happens when a gate fails (escalation policy).
- How baselines and policies are updated (update protocol).
- Freshness requirements for each contour's artifacts.

---

## 2. Validation Contours

### 2.1 Tier 1 — Physics Core (critical)

| ID | Contour | CI Command | What it verifies |
|----|---------|------------|------------------|
| `C01` | Convergence tests | `npm run test:convergence` | 8 analytic physics tests (PSE, stretching, ring propagation, KH, leapfrog, E(k)) |
| `C02` | Long-run benchmark (smoke) | `benchmark:longrun:smoke` | Runtime stability across CPU/GPU/Hybrid/Hybrid+ (short) |
| `C03` | Long-run benchmark (standard) | `benchmark:longrun:standard:controlled` | Runtime stability (medium duration, controlled browser) |
| `C04` | Long-run benchmark (nightly) | `benchmark:longrun:nightly:controlled` | Runtime stability (full duration, controlled browser) |

### 2.2 Tier 2 — Research & Presets

| ID | Contour | CI Command | What it verifies |
|----|---------|------------|------------------|
| `C05` | Research preset pack (smoke) | `benchmark:research:presetpack:trend:smoke:ci` | 7 preset scenarios, case gates + trend (fast) |
| `C06` | Research preset pack (nightly) | `benchmark:research:presetpack:trend:nightly:strict-baseline:ci` | 7 preset scenarios, case gates + trend + baseline sufficiency |
| `C07` | Research policy integrity | `benchmark:research:presetpack:policy:integrity:ci` | Case/trend policy consistency |
| `C08` | Research policy drift | `benchmark:research:presetpack:policy:drift:smoke:ci` | Threshold drift vs suggested template |

### 2.3 Tier 3 — Hybrid Sync

| ID | Contour | CI Command | What it verifies |
|----|---------|------------|------------------|
| `C09` | Hybrid sync diagnostic | `benchmark:hybrid:syncdiag:ci` | Frozen ratio, decoupled streak, blocked-unsync |
| `C10` | Hybrid sync soak | `benchmark:hybrid:syncdiag:soak:trend:ci` | Intermittent sync regressions (4x repeated) |

### 2.4 Tier 4 — Distributed & Classic Closure

| ID | Contour | CI Command | What it verifies |
|----|---------|------------|------------------|
| `C11` | Distributed strict chain | `benchmark:distributed:strict:ci` | Triad input + parity build + contract + parity audit |
| `C12` | Distributed parity trend | `benchmark:distributed:parity:trend:ci` | Parity trend/regress |
| `C13` | Distributed policy integrity | `benchmark:distributed:policy:integrity:ci` | Policy schema + artifact limits |
| `C14` | Classic evidence pack | `benchmark:classic:evidencepack:ci` | Classic external validation evidence |
| `C15` | Classic replication | `benchmark:classic:replication:ci` | Independent replication protocol |

### 2.5 Tier 5 — Solver & Physics Modules

| ID | Contour | CI Command | What it verifies |
|----|---------|------------|------------------|
| `C16` | FMM benchmark matrix | `benchmark:fmm:matrix:ci` | FMM accuracy + performance |
| `C17` | Turbulence breakdown | `benchmark:turbulence:breakdown:ci` | Turbulence breakdown gate thresholds |
| `C18` | Physical realism baseline | `benchmark:physical:baseline:ci` | Conservation + boundary/wake protocol |
| `C19` | Adaptive resolution matrix | `benchmark:adaptive:matrix:ci` | Adaptive resolution scenario verdicts |
| `C20` | Extended physics matrix | `benchmark:physics:matrix:ci` | Ring/jet/turbulence physics gates |

---

## 3. Cadence Policy

### 3.1 Schedule

| Cadence | Frequency | Max wall-clock | Contours |
|---------|-----------|----------------|----------|
| **On-commit** | Every code change | 5 min | `C01` |
| **Smoke** | Daily or on-demand | 15 min | `C02`, `C05`, `C07`, `C08` |
| **Standard** | Weekly | 60 min | `C03`, `C09`, `C16`–`C20` |
| **Nightly** | Weekly (deep) | 120 min | `C04`, `C06`, `C10`–`C15` |

### 3.2 Freshness Requirements

Each contour has a maximum staleness period — the time since last successful PASS after which the contour is considered stale.

| Tier | Max staleness | Action on stale |
|------|--------------|-----------------|
| Tier 1 (Physics Core) | 7 days | Escalation Level 1 |
| Tier 2 (Research) | 14 days | Escalation Level 1 |
| Tier 3 (Hybrid Sync) | 14 days | Escalation Level 1 |
| Tier 4 (Closure) | 30 days | Escalation Level 1 |
| Tier 5 (Solver) | 30 days | Escalation Level 1 |

---

## 4. Escalation Policy

### 4.1 Levels

```
Level 0: PASS        — All gates green. No action required.
Level 1: WARNING     — Single contour FAIL or staleness exceeded.
                       → Re-run contour within 24h.
                       → If re-run PASS: back to Level 0.
                       → If re-run FAIL: escalate to Level 2.
Level 2: STRICT      — Confirmed FAIL after retry.
                       → Block merges touching affected module.
                       → File investigation task.
                       → Fix + re-run within 72h.
                       → If fixed: back to Level 0.
                       → If not fixed in 72h: escalate to Level 3.
Level 3: FREEZE      — Multiple Tier 1/2 contours FAIL, or single Tier 1 FAIL > 72h.
                       → Freeze all non-fix changes.
                       → Root-cause analysis required.
                       → Unfreeze only after all Tier 1 contours PASS.
```

### 4.2 Escalation Matrix

| Condition | Level |
|-----------|-------|
| All contours PASS, all fresh | 0 (PASS) |
| 1 contour FAIL (first occurrence) | 1 (WARNING) |
| 1+ contour stale beyond max | 1 (WARNING) |
| 1 contour FAIL after retry | 2 (STRICT) |
| Tier 1 contour FAIL > 72h | 3 (FREEZE) |
| 2+ Tier 1/2 contours confirmed FAIL | 3 (FREEZE) |

### 4.3 Notification

- Level 1: log warning in governance audit report.
- Level 2: mark contour as `BLOCKED` in dashboard; add task to `TASKS.md`.
- Level 3: dashboard banner `GOVERNANCE FREEZE`; all work paused until resolved.

---

## 5. Baseline & Policy Update Protocol

### 5.1 When to update baselines

- After a **physics operator change** that intentionally shifts metrics.
- After a **hardware class retune** (new threshold calibration).
- After a **policy version bump** (new envelope definitions).

### 5.2 Update procedure

1. **Announce**: document the reason for baseline update in a commit message.
2. **Run full chain**: execute the affected contour at `nightly` level.
3. **Verify PASS**: all gates must pass at the new baseline.
4. **Commit artifacts**: updated baseline JSON + MD artifacts committed together.
5. **Verify trend**: run trend CI to confirm no false regress against new baseline.
6. **Sync trackers**: update `ROADMAP/TASKS/PROGRESS/dashboard` if the update changes contour status.

### 5.3 Policy version bumps

- Policy contracts are versioned files (e.g. `research-preset-pack-trend-policy.v1.json`).
- Version bumps (`v1` → `v2`) require:
  1. New file with updated schema.
  2. Migration note in commit.
  3. All contours using the policy re-run at nightly level.
  4. Old version preserved for 1 cycle (backward compatibility).

---

## 6. Governance Audit Contract

The governance audit CLI (`TT-070B`) will check:

| Check ID | What | PASS condition |
|----------|------|----------------|
| `contour_registry_complete` | All 20 contours registered | All C01–C20 present in policy |
| `freshness_within_bounds` | No stale contours | Last PASS timestamp within max staleness |
| `no_unresolved_failures` | No Level 2+ failures open | All contours PASS or Level ≤ 1 |
| `escalation_state_consistent` | Escalation level matches reality | Computed level = recorded level |
| `baseline_update_audited` | Recent baseline updates have audit trail | Update commits reference contour + reason |
| `policy_versions_current` | No deprecated policy versions in use | All active policies at latest version |

---

## 7. Artifact Registry

| Artifact | Path | Updated by |
|----------|------|------------|
| Governance policy contract | `audit-runner/validation-governance-policy.v1.json` | TT-070B |
| Governance audit result (JSON) | `audit-runner/validation-governance-audit.json` | TT-070B CLI |
| Governance audit result (MD) | `audit-runner/validation-governance-audit.md` | TT-070B CLI |
| Contour freshness log | `audit-runner/validation-governance-freshness.json` | TT-070B CLI |

---

## 8. Integration with Existing Infrastructure

- **Dashboard** (`dev/dashboard.html`): governance status badge + escalation level indicator.
- **PROGRESS.md**: governance audit results referenced in latest updates.
- **CI scripts**: `benchmark:governance:ci` and `benchmark:governance:freshness:ci` added in TT-070C.

---

## 9. Validation Record (TT-070A)

- **Deliverable**: This runbook document.
- **Acceptance**: Runbook covers cadence, escalation, update protocol, contour registry.
- **Verdict**: `PASS` — all sections complete, ready for TT-070B implementation.
