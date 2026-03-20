# TT-070 — Continuous Validation Governance

Цель: после закрытия `TT-067/TT-068` перевести validation контуры в регулярный governance-режим, где стабильность и воспроизводимость подтверждаются по расписанию и с явной политикой реакции на regress.

## 1. Scope

- Ввести единый governance-контур для periodic revalidation ключевых CI-цепочек.
- Формализовать policy escalation при regress (`warning -> strict gate -> freeze`).
- Зафиксировать runbook обновления baseline/policy только через явные audited шаги.

## 2. Dependencies

- `TT-067` (distributed strict/trend/policy-integrity closure).
- `TT-068` (classic external validation closure pack).
- `TT-069` (post-closure bootstrap + intake template).

## 3. Acceptance Contract

`TT-070` закрывается при выполнении:

1. Есть формальный governance runbook v1 с cadences и escalation policy.
2. Есть machine-checkable governance policy contract для cadence/escalation.
3. Есть audit CLI, который валидирует governance policy + свежесть/результаты регулярных revalidation запусков.
4. Есть CI-команда strict governance gate.
5. `TASKS/ROADMAP/PROGRESS/dev/dashboard` синхронизированы по статусам и артефактам.

## 4. Planned Steps

- `TT-070A` — governance runbook/spec v1.
- `TT-070B` — policy contract + audit CLI + artifacts.
- `TT-070C` — strict CI gate + tracker synchronization + closure report.

## 5. Artifacts

| Artifact | Path |
|----------|------|
| Governance runbook | `docs/VALIDATION_GOVERNANCE_RUNBOOK.md` |
| Policy contract | `audit-runner/validation-governance-policy.v1.json` |
| Freshness log | `audit-runner/validation-governance-freshness.json` |
| Audit CLI | `audit-runner/validationGovernanceAudit.mjs` |
| Audit result (JSON) | `audit-runner/validation-governance-audit.json` |
| Audit result (MD) | `audit-runner/validation-governance-audit.md` |

## 6. CI Commands

| Command | Description |
|---------|-------------|
| `benchmark:governance` | Run governance audit (no fail gate) |
| `benchmark:governance:ci` | Run with `GOVERNANCE_FAIL_ON_GATE=true` |
| `benchmark:governance:freshness:ci` | Run with freshness required + fail gate |

## 7. Status

- `TT-070A`: `DONE` — runbook v1 published (`docs/VALIDATION_GOVERNANCE_RUNBOOK.md`)
- `TT-070B`: `DONE` — policy contract + audit CLI + CI scripts (18 checks, all PASS)
- `TT-070C`: `DONE` — strict CI gate verified, tracker sync complete
