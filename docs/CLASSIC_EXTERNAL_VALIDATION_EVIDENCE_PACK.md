# Classic External Validation Evidence Pack (TT-068B)

This runbook defines how to generate and verify a reproducible evidence pack for the external classic-validation contour.

## Purpose

The evidence pack aggregates closure-critical artifacts into one machine-checkable bundle:
- distributed contract gate result,
- distributed parity gate result,
- policy/checklist presence,
- acceptance table for external classic validation.

## Commands

From project root:

- `npm run benchmark:distributed:strict:ci`
- `npm run benchmark:classic:evidencepack`

Strict gate mode:

- `npm run benchmark:classic:evidencepack:ci`

## Output artifacts

Generated in `audit-runner/`:

- `classic-external-validation-evidence-pack.json`
- `classic-external-validation-evidence-pack.md`

Referenced source artifacts:

- `distributed-validation-contract-audit.json`
- `distributed-parity-audit-report.json`
- `docs/dashboard-external-validation-policy.v1.json`
- `docs/CLASSIC_EXTERNAL_VALIDATION_CLOSURE_CHECKLIST.md`

## Acceptance criteria

Evidence pack is accepted only if:

- `gate.pass = true`,
- `parityVerdict = parity_pass`,
- `envelopeClass = eligible`,
- `naturalModifiersActive = false`,
- all required source artifacts and policy/checklist are present.

If any criterion fails, the run is not accepted as external classic-validation evidence.
