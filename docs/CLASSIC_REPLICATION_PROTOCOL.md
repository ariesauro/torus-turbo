# Independent Classic Replication Protocol (TT-068C)

Protocol goal: verify that classic-physics evidence is reproducible across independent solver implementations or execution stacks.

## 1. Scope

This protocol applies only to `classic` profile runs used for external validation.

Out of scope:
- Natural-mode exploratory runs,
- distributed scaling claims (post-classic phase),
- non-reproducible ad-hoc experiments without artifact contract.

## 2. Input pair

Each replication check compares two independent runs:
- `referenceRun` (primary classic evidence run),
- `replicaRun` (independent solver/stack replication).

Both runs must include:
- same scenario contract hash,
- same classic profile requirements (`profile=classic`, no active modifiers),
- same acceptance metric definitions.

## 3. Required comparability constraints

To be comparable, pair must satisfy:
- identical scenario/config hash,
- compatible sampling window policy,
- explicit solver independence metadata (`implementationId`, `version`, execution stack).

## 4. Core checks

Replication gate checks:
- `config_hash_match`,
- `classic_profile_lock`,
- `invariant_drift_delta_within_limit`,
- `contract_verdict_alignment` (`ring/jet/detector/topology`),
- `timing_envelope_within_limit`.

## 5. Verdicts

- `replication_pass`: all core checks pass,
- `replication_warn`: no hard fail, but soft tolerance exceeded,
- `replication_fail`: at least one hard check fails.

Only `replication_pass` may be used for external classic-validation evidence closure.

## 6. Artifact contract

Machine-readable contract draft:
- `audit-runner/classic-replication-protocol.contract.v1.json`

It defines mandatory fields, checks, thresholds, and verdict semantics.

## 7. CI path

Current contour step:
- protocol and contract definition (this phase).

Implemented audit CLI:
- `audit-runner/classicReplicationAudit.mjs`
- `npm run benchmark:classic:replication`
- `npm run benchmark:classic:replication:ci`

Input fixture for contract checks:
- `audit-runner/classic-replication-audit.input.json`
