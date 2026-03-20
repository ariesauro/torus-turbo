# Research Preset Policy Integrity Audit

Generated: 2026-03-18T17:39:03.998Z

| Check | Result |
|---|---|
| case_policy_exists | PASS |
| trend_policy_exists | PASS |
| case_policy_schema_valid | PASS |
| trend_policy_schema_valid | PASS |
| policy_profiles_complete | PASS |
| policy_default_profiles_valid | PASS |
| policy_profile_sets_aligned | PASS |
| case_policy_preset_coverage | PASS |
| artifact_json_exists | PASS |
| artifact_policy_meta_present | FAIL |
| artifact_policy_profiles_known | FAIL |
| artifact_case_thresholds_complete | FAIL |

## Details

- PASS case_policy_exists: case policy file is readable
- PASS trend_policy_exists: trend policy file is readable
- PASS case_policy_schema_valid: case policy schema version matches tt052 v1
- PASS trend_policy_schema_valid: trend policy schema version matches tt044 v1
- PASS policy_profiles_complete: smoke/standard/nightly are present in both policies
- PASS policy_default_profiles_valid: default profiles are valid
- PASS policy_profile_sets_aligned: case/trend profile sets are aligned
- PASS case_policy_preset_coverage: all profiles define perPreset thresholds for expected presets
- PASS artifact_json_exists: research preset audit artifact exists
- FAIL artifact_policy_meta_present: artifact policy meta is missing
- FAIL artifact_policy_profiles_known: unknown artifact profiles case=n/a trend=standard
- FAIL artifact_case_thresholds_complete: artifact missing preset thresholds: vortex_ring_collision,vortex_leapfrogging,jet_instability,turbulence_cascade,helmholtz_shear,kelvin_wave_train,reconnection_pair

Overall gate: FAIL
