# Classic External Validation Closure Checklist (TT-068A)

Goal: lock external scientific validation to `classic physics` runs and define local-compute closure prerequisites before any scaling work.

## 1. Hard lock policy

External validation is accepted only if all are true:
- `externalValidationEligible === true` for `ring/jet/detector/topology`,
- `profile === classic` for `ring/jet/detector/topology`,
- `modifierStrength <= 1e-6` for `ring/jet/detector/topology`,
- no active `Natural` guided modifiers (`guidedPhysics` with non-zero effective modifiers).

If any condition fails, run is internal/exploratory only and must not be counted as external validation evidence.

## 2. Local compute closure prerequisites

Before external validation pack generation:
- strict local CI for validation gates is green,
- deterministic artifact schema checks are green,
- latest classic artifacts include full runtime + topology + detector + render diagnostics,
- runbook and acceptance table are updated to current policy versions.

## 3. Required gate commands (classic closure)

- `npm run benchmark:distributed:contract:ci`
- `npm run benchmark:distributed:parity:ci`
- `npm run benchmark:distributed:strict:ci`

These commands are treated as closure integrity checks for the current contour.

## 4. Evidence quality bar (classic-only)

For each evidence candidate run:
- validation report has `pass=true`,
- no failed checks related to classic profile/modifier lock,
- parity verdict (if present) is `parity_pass`,
- network envelope class (if present) is `eligible`.

## 5. Post-classic boundary

Distributed/server-client scaling work stays in `post-classic` queue until:
- classic closure prerequisites are satisfied,
- classic evidence pack is published and reviewed,
- independent classic replication protocol is finalized.
