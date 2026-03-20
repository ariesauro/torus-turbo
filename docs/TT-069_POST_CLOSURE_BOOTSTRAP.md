# TT-069 — Post-Closure Roadmap Phase Bootstrap

Цель: после закрытия `TT-001..TT-068` сформировать новый top-level контур работ без потери воспроизводимости и синхронности проектных трекеров.

## 1. Scope

- Зафиксировать стартовые правила для новых top-level задач (`TT-07x`).
- Ввести единый intake-процесс для новых инициатив с обязательным acceptance contract.
- Удержать синхронность `TASKS/ROADMAP/PROGRESS/dev/dashboard` как hard requirement.

## 2. Acceptance Contract

`TT-069` считается завершенным, если выполнены все пункты:

1. Создан и утвержден bootstrap-документ с правилами phase intake.
2. В `TASKS` есть подзадачи `TT-069A/B/C` с явными статусами и зависимостями.
3. Для первой новой инициативы после closure сформирован top-level draft:
   - описание,
   - зависимости,
   - критерии приемки,
   - статус в dashboard и docs.
4. Выполнена проверка консистентности:
   - одинаковый статус `TT-069*` в `TASKS/ROADMAP/PROGRESS/dev/dashboard`,
   - нет конфликтов по active task marker.

## 3. Execution Steps

- `TT-069A` — bootstrap contract/spec (этот документ).
- `TT-069B` — intake template для новых top-level задач (`objective/dependencies/acceptance/gates`).
- `TT-069C` — first candidate queue draft и синхронизация trackers.

## 4. Current Status

- `TT-069A`: `DONE` (bootstrap spec зафиксирован).
- `TT-069B`: `DONE`.
- `TT-069C`: `DONE`.
