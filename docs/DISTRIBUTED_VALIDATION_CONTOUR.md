# Distributed Validation Contour (TT-067)

Goal: define a strict scientific protocol for server/client/distributed execution so results remain reproducible and comparable to local baselines.

## 1. Scope and intent

This contour is a research protocol, not a production scaling claim.

It defines:
- network reproducibility envelope (`RTT`, jitter, packet loss, clock skew),
- deterministic replay contract across compute placements,
- compute-split policy (`local`, `server`, `distributed`),
- parity acceptance checks against local reference runs.

It does not define:
- global matchmaking/federation architecture,
- trustless verification or blockchain consensus,
- arbitrary internet-scale volunteer computing without deterministic controls.

## 2. Validation modes

The system distinguishes three execution placements:
- `local`: all physics operators run on one machine; reference baseline mode.
- `server`: authoritative physics on server, client receives synchronized snapshots/deltas.
- `distributed`: physics partitioned across multiple participant nodes plus coordinator.

For scientific claims, each placement must be evaluated against the same scenario envelope and artifact contract.

## 3. Reproducibility envelope

Each run must record:
- requested and resolved placement mode,
- transport profile and protocol version,
- measured `rtt_ms_p50/p95`, `jitter_ms_p95`, `packet_loss_pct`,
- synchronization cadence and clock alignment diagnostics.

Default envelope classes:
- `eligible`:
  - `rtt_p95 <= 20 ms`
  - `jitter_p95 <= 5 ms`
  - `loss_pct <= 0.1%`
- `approximate`:
  - `rtt_p95 <= 45 ms`
  - `jitter_p95 <= 12 ms`
  - `loss_pct <= 0.5%`
- `unsupported`:
  - any metric beyond `approximate` thresholds.

Outside `eligible`, runs may be useful for exploratory behavior checks but cannot be used as strict external validation evidence.

## 4. Deterministic replay contract

Distributed/scaled runs must provide deterministic reconstruction inputs:
- scenario ID and configuration hash,
- random seed policy (global seed + partition seeds),
- operator-order schedule hash per step window,
- snapshot epoch chain hash,
- merge/reduction ordering contract for partition outputs.

Replay check:
- `local replay` from distributed artifacts must reproduce bounded divergence envelopes for all declared invariants.

## 5. Compute-split policy

Allowed split dimensions:
- spatial partitioning (tiles/domains),
- representation partitioning (particles/filaments/sheets),
- operator partitioning (far-field assist vs near-field core).

For each split, the run must publish:
- partition map hash,
- ownership transitions and migration quotas,
- synchronization points and reduction order,
- dropped/deferred operator counters.

Untracked or adaptive split changes without artifact publication invalidate strict parity.

## 6. Parity protocol (local vs server vs distributed)

Every scenario in this contour must run as a triad:
- `A`: local reference,
- `B`: server placement,
- `C`: distributed placement.

Required parity checks:
- invariant drift deltas (`Gamma`, energy proxy, topology-event consistency),
- regime and detection contract parity (`ring/jet/detector/topology`),
- statistical timing parity (`step_p95`, backlog, skipped operators).

Verdict levels:
- `parity_pass`: all checks within strict bounds,
- `parity_warn`: bounded but outside strict target,
- `parity_fail`: invariant or contract violation.

Only `parity_pass` + `eligible` network envelope is accepted for external scientific scaling claims.

## 7. Natural mode rule

If `Natural` (`guidedPhysics`) has active modifiers (`guidedStrength`, `alpha`, or future guided operators), then:
- internal diagnostics validity remains available,
- external validation eligibility is `not eligible` by policy.

This rule applies to local, server, and distributed placements equally.

## 8. Artifact contract additions (v1 draft)

Each run artifact should include:
- `placement.mode` (`local|server|distributed`),
- `network.envelope.class` (`eligible|approximate|unsupported`),
- `network.metrics` (`rtt/jitter/loss` stats),
- `determinism.hashes` (scenario/schedule/epoch chain),
- `computeSplit.policy` and `partitionMapHash`,
- `parity.referenceRunId` and parity verdict/check table.

Machine-readable draft contract: `docs/distributed-validation-artifact.contract.v1.json`.

## 9. Security and trust boundaries

For participant-network runs, treat remote outputs as untrusted until validated by:
- protocol-level checksums,
- deterministic replay consistency checks,
- invariant-gate verification at coordinator.

Unsigned or unverifiable partition contributions must be marked `excluded_from_external_validation`.

## 10. Implementation phases

Phase `067A` — DONE:
- define protocol and acceptance matrix (this document).

Phase `067B` — DONE:
- add runtime telemetry schema for network envelope and determinism hashes.
- status: initial schema draft added (`docs/distributed-validation-artifact.contract.v1.json`).

Phase `067C` — DONE:
- add parity-run orchestration in audit runner (`local/server/distributed` triad).
- status: initial contract audit CLI added (`audit-runner/distributedValidationContractAudit.mjs`)
  with scripts:
  - `npm run benchmark:distributed:contract`
  - `npm run benchmark:distributed:contract:ci`

Phase `067D` — DONE:
- enable strict CI gate for distributed parity (`eligible + parity_pass` required).
- status: strict parity CI contour wired:
  - `audit-runner/distributedParityAudit.mjs`
  - `npm run benchmark:distributed:parity:ci`
  - aggregate strict gate: `npm run benchmark:distributed:strict:ci`
  - baseline artifact fixture: `audit-runner/distributed-validation-parity-audit.json`

Phase `067E` — DONE:
- migrate parity flow from fixture-only artifact to runtime pipeline.
- status: `audit-runner/distributedParityArtifactBuilder.mjs` added; parity scripts now run `build -> audit` against `distributed-validation-parity-audit.runtime.json`.

Phase `067F` — DONE:
- add real triad runtime payload ingestion contract and gate.
- status: `audit-runner/distributed-triad-run-input.contract.v1.json` + `audit-runner/distributed-triad-run-input.json` added;
  CI gate `audit-runner/distributedTriadInputAudit.mjs` integrated into strict contour before parity build.

Phase `067G` — DONE:
- reorder strict CI chain so runtime parity artifact is the source-of-truth for both contract and parity audits.
- status: strict chain now runs `triad-input audit -> parity build -> contract audit -> parity audit`.

Phase `067H` — DONE:
- add profile-driven parity thresholds and trend/regress CI.
- status: policy file `audit-runner/distributed-parity-policy.v1.json` added (`smoke/standard/nightly`);
  trend audit `audit-runner/distributedParityTrendAudit.mjs` and scripts `benchmark:distributed:parity:trend[:ci]` added.

Phase `067I` — DONE:
- Policy integrity audit.
