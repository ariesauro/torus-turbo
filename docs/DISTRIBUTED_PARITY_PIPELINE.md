# Distributed Parity Runtime Pipeline (TT-067E)

This runbook defines the runtime-oriented parity pipeline so distributed parity no longer depends on a static fixture artifact.

## Commands

From project root:

- `npm run benchmark:distributed:parity:build`
- `npm run benchmark:distributed:parity`
- `npm run benchmark:distributed:parity:ci`
- `npm run benchmark:distributed:parity:trend`
- `npm run benchmark:distributed:parity:trend:ci`
- `npm run benchmark:distributed:policy:integrity`
- `npm run benchmark:distributed:policy:integrity:ci`
- `npm run benchmark:distributed:strict:ci`

## Pipeline flow

1. `benchmark:distributed:triad:input:audit[:ci]`
   - validates `distributed-triad-run-input.json` against
     `distributed-triad-run-input.contract.v1.json`

2. `benchmark:distributed:parity:build`
   - runs `audit-runner/distributedParityArtifactBuilder.mjs`
   - synthesizes `distributed-validation-parity-audit.runtime.json`
   - prefers triad runtime payload (`distributed-triad-run-input.json`)
   - falls back to latest audit signals when triad payload is unavailable
   - source signals:
     - `distributed-validation-contract-audit.json`
     - `classic-external-validation-evidence-pack.json`
     - `classic-replication-audit-report.json`

3. `benchmark:distributed:parity[:ci]`
   - validates the generated runtime artifact with `distributedParityAudit.mjs`

4. `benchmark:distributed:strict:ci`
   - runs `triad-input audit -> parity build -> contract audit -> parity audit` end-to-end.

## Policy and trend

- policy file: `audit-runner/distributed-parity-policy.v1.json`
- profiles: `smoke`, `standard`, `nightly` (selected by `DISTRIBUTED_PARITY_POLICY_PROFILE`)
- trend history: `audit-runner/distributed-parity-trend.json`
- trend markdown report: `audit-runner/distributed-parity-trend.md`
- policy integrity reports:
  - `audit-runner/distributed-parity-policy-integrity-audit.json`
  - `audit-runner/distributed-parity-policy-integrity-audit.md`

## Acceptance

Pipeline is accepted only if strict gate is green and runtime parity artifact reports:

- triad modes complete,
- parity checks pass,
- `parity_verdict = parity_pass`,
- eligible network envelope,
- inactive natural modifiers for this contour.
