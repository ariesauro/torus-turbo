# Research Preset Policy Integrity Audit

Generated: 2026-03-18T17:38:30.285Z

| Check | Result |
|---|---|
| case_policy_exists | FAIL |
| trend_policy_exists | FAIL |
| case_policy_schema_valid | FAIL |
| trend_policy_schema_valid | FAIL |
| policy_profiles_complete | FAIL |
| policy_default_profiles_valid | FAIL |
| policy_profile_sets_aligned | FAIL |
| case_policy_preset_coverage | PASS |
| artifact_json_exists | FAIL |
| artifact_policy_meta_present | PASS |
| artifact_policy_profiles_known | PASS |
| artifact_case_thresholds_complete | PASS |

## Details

- FAIL case_policy_exists: case policy file not found: /Users/auroboros/Code/Torus Turbo/research-preset-pack-case-policy.v1.json
- FAIL trend_policy_exists: trend policy file not found: /Users/auroboros/Code/Torus Turbo/research-preset-pack-trend-policy.v1.json
- FAIL case_policy_schema_valid: unexpected case schema version: n/a
- FAIL trend_policy_schema_valid: unexpected trend schema version: n/a
- FAIL policy_profiles_complete: missing profiles case=smoke,standard,nightly trend=smoke,standard,nightly
- FAIL policy_default_profiles_valid: invalid default profiles case=n/a trend=n/a
- FAIL policy_profile_sets_aligned: profile mismatch case=[] trend=[]
- PASS case_policy_preset_coverage: all profiles define perPreset thresholds for expected presets
- FAIL artifact_json_exists: audit artifact not found: /Users/auroboros/Code/Torus Turbo/research-preset-pack-audit.json
- PASS artifact_policy_meta_present: artifact policy meta is present
- PASS artifact_policy_profiles_known: artifact policy profiles are recognized
- PASS artifact_case_thresholds_complete: artifact case thresholds include all expected presets

Overall gate: FAIL
