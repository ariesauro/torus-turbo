# Validation Governance Audit

Generated: 2026-03-19T09:50:27.770Z
Profile: standard
Escalation level: 0 (PASS)

## Gate Checks

| Check | Result |
|---|---|
| policy_schema_valid | PASS |
| required_profiles_present | PASS |
| default_profile_valid | PASS |
| contour_registry_complete | PASS |
| profile_smoke_staleness_complete | PASS |
| profile_smoke_escalation_complete | PASS |
| profile_standard_staleness_complete | PASS |
| profile_standard_escalation_complete | PASS |
| profile_nightly_staleness_complete | PASS |
| profile_nightly_escalation_complete | PASS |
| profile_smoke_staleness_monotonic | PASS |
| profile_standard_staleness_monotonic | PASS |
| profile_nightly_staleness_monotonic | PASS |
| contour_fields_complete | PASS |
| freshness_present_if_required | PASS |
| no_stale_contours | PASS |
| no_unresolved_failures | PASS |
| escalation_level_acceptable | PASS |

## Contour Status

| ID | Name | Tier | Status | Stale | Last PASS |
|---|---|---|---|---|---|
| C01 | Convergence tests | 1 | PASS | no | 2026-03-19T00:00:00.000Z |
| C02 | Long-run benchmark (smoke) | 1 | PASS | no | 2026-03-19T00:00:00.000Z |
| C03 | Long-run benchmark (standard) | 1 | PASS | no | 2026-03-19T00:00:00.000Z |
| C04 | Long-run benchmark (nightly) | 1 | PASS | no | 2026-03-19T00:00:00.000Z |
| C05 | Research preset pack (smoke) | 2 | PASS | no | 2026-03-19T00:00:00.000Z |
| C06 | Research preset pack (nightly) | 2 | PASS | no | 2026-03-19T00:00:00.000Z |
| C07 | Research policy integrity | 2 | PASS | no | 2026-03-19T00:00:00.000Z |
| C08 | Research policy drift | 2 | PASS | no | 2026-03-19T00:00:00.000Z |
| C09 | Hybrid sync diagnostic | 3 | PASS | no | 2026-03-19T00:00:00.000Z |
| C10 | Hybrid sync soak | 3 | PASS | no | 2026-03-19T00:00:00.000Z |
| C11 | Distributed strict chain | 4 | PASS | no | 2026-03-19T00:00:00.000Z |
| C12 | Distributed parity trend | 4 | PASS | no | 2026-03-19T00:00:00.000Z |
| C13 | Distributed policy integrity | 4 | PASS | no | 2026-03-19T00:00:00.000Z |
| C14 | Classic evidence pack | 4 | PASS | no | 2026-03-19T00:00:00.000Z |
| C15 | Classic replication | 4 | PASS | no | 2026-03-19T00:00:00.000Z |
| C16 | FMM benchmark matrix | 5 | PASS | no | 2026-03-19T00:00:00.000Z |
| C17 | Turbulence breakdown | 5 | PASS | no | 2026-03-19T00:00:00.000Z |
| C18 | Physical realism baseline | 5 | PASS | no | 2026-03-19T00:00:00.000Z |
| C19 | Adaptive resolution matrix | 5 | PASS | no | 2026-03-19T00:00:00.000Z |
| C20 | Extended physics matrix | 5 | PASS | no | 2026-03-19T00:00:00.000Z |

## Details

- PASS policy_schema_valid: policy schema version matches v1
- PASS required_profiles_present: required profiles present (smoke/standard/nightly)
- PASS default_profile_valid: default profile valid (standard)
- PASS contour_registry_complete: 20 contours registered (>= 20)
- PASS profile_smoke_staleness_complete: profile smoke: all tier staleness thresholds present
- PASS profile_smoke_escalation_complete: profile smoke: escalation policy complete
- PASS profile_standard_staleness_complete: profile standard: all tier staleness thresholds present
- PASS profile_standard_escalation_complete: profile standard: escalation policy complete
- PASS profile_nightly_staleness_complete: profile nightly: all tier staleness thresholds present
- PASS profile_nightly_escalation_complete: profile nightly: escalation policy complete
- PASS profile_smoke_staleness_monotonic: profile smoke: tier staleness monotonic (tier1 <= tier2 <= ... <= tier5)
- PASS profile_standard_staleness_monotonic: profile standard: tier staleness monotonic (tier1 <= tier2 <= ... <= tier5)
- PASS profile_nightly_staleness_monotonic: profile nightly: tier staleness monotonic (tier1 <= tier2 <= ... <= tier5)
- PASS contour_fields_complete: all contours have required fields (id, name, tier, cadence, command)
- PASS freshness_present_if_required: freshness log present
- PASS no_stale_contours: all contours within freshness bounds
- PASS no_unresolved_failures: no confirmed (Level 2+) failures
- PASS escalation_level_acceptable: escalation level 0 (PASS) is acceptable

**Overall gate: PASS**
