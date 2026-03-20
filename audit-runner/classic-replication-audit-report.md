# Classic Replication Audit

Generated: 2026-03-18T21:03:15.517Z

| Check | Result |
|---|---|
| contract_schema_valid | PASS |
| input_schema_valid | PASS |
| input_required_root_fields_present | PASS |
| input_required_run_fields_present | PASS |
| required_check_rows_present | PASS |
| required_checks_pass | PASS |
| verdict_allowed | PASS |
| verdict_required_value | PASS |
| config_hash_match | PASS |
| classic_profile_lock | PASS |
| contract_verdict_alignment | PASS |
| invariant_drift_delta_within_limit | PASS |
| timing_envelope_within_limit | PASS |

## Details

- PASS contract_schema_valid: replication contract schema version is valid
- PASS input_schema_valid: replication input schema version is valid
- PASS input_required_root_fields_present: all required root fields are present
- PASS input_required_run_fields_present: required run fields are present for both reference and replica
- PASS required_check_rows_present: all required check rows are present
- PASS required_checks_pass: all required checks have PASS status
- PASS verdict_allowed: verdict is allowed by contract
- PASS verdict_required_value: verdict matches required value (replication_pass)
- PASS config_hash_match: reference and replica scenario hash match
- PASS classic_profile_lock: classic profile lock is active for both runs
- PASS contract_verdict_alignment: ring/jet/detector/topology verdicts are aligned
- PASS invariant_drift_delta_within_limit: invariant drift delta 0.740 <= 2.000
- PASS timing_envelope_within_limit: timing delta 7.643% <= 10.000%

Overall gate: PASS
