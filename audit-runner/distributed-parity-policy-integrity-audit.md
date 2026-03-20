# Distributed Parity Policy Integrity Audit

Generated: 2026-03-18T23:56:12.210Z

| Check | Result |
|---|---|
| policy_schema_valid | PASS |
| required_profiles_present | PASS |
| default_profile_present | PASS |
| profile_thresholds_monotonic | PASS |
| trend_regress_policy_present | PASS |
| artifact_present_if_required | PASS |
| artifact_schema_valid | PASS |
| artifact_policy_schema_matches | PASS |
| artifact_policy_profile_known | PASS |
| artifact_required_checks_present | PASS |
| artifact_limits_match_profile_thresholds | PASS |

## Details

- PASS policy_schema_valid: policy schema version matches v1
- PASS required_profiles_present: required profiles are present (smoke/standard/nightly)
- PASS default_profile_present: default profile is valid (standard)
- PASS profile_thresholds_monotonic: profile strictness is monotonic (smoke >= standard >= nightly)
- PASS trend_regress_policy_present: trend regress policy block is present
- PASS artifact_present_if_required: runtime artifact is present
- PASS artifact_schema_valid: runtime artifact schema matches expected parity artifact schema
- PASS artifact_policy_schema_matches: artifact policy schema matches (tt067.distributed_parity_policy.v1)
- PASS artifact_policy_profile_known: artifact profile is known (standard)
- PASS artifact_required_checks_present: artifact contains required parity checks
- PASS artifact_limits_match_profile_thresholds: artifact check limits match active profile thresholds

Overall gate: PASS
