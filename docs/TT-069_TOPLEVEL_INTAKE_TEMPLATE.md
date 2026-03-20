# TT-069 — Top-Level Intake Template

Шаблон используется для запуска новой top-level инициативы (`TT-07x`) после closure.

## 1. Identity

- `ID`: `TT-07x`
- `Title`: краткое имя инициативы
- `Owner`: ответственный контур
- `Status`: `TODO | IN_PROGRESS | DONE`

## 2. Purpose

- Проблема (1-2 пункта, без общих формулировок).
- Цель (измеримая, проверяемая).
- Non-goals (что явно не входит в scope).

## 3. Dependencies

- Upstream зависимости (`TT-xxx`/документы/артефакты).
- Блокирующие условия старта.
- Явный порядок выполнения при нескольких зависимостях.

## 4. Acceptance Contract

Инициатива может перейти в `DONE` только при выполнении всех пунктов:

1. Реализован рабочий контур (не scaffold-only).
2. Добавлены проверяемые gate-checks (CLI/контрактные проверки/инварианты).
3. Получен reproducible результат (`PASS`) с артефактами.
4. Обновлены `TASKS/ROADMAP/PROGRESS/dev/dashboard`.
5. Обновлены runbook/context документы, если изменился workflow.

## 5. Execution Plan

- `TT-07xA`: первый исполнимый шаг.
- `TT-07xB`: расширение/интеграция.
- `TT-07xC`: strict validation + tracker sync.

Для каждого шага:
- scope,
- expected artifacts,
- command(s),
- PASS/FAIL criteria.

## 6. Tracker Wiring Checklist

- Добавлена top-level строка в `docs/TASKS.md`.
- Добавлены подзадачи `TT-07xA/B/C` в `docs/TASKS.md`.
- Добавлен/обновлен блок в `docs/ROADMAP.md`.
- Добавлены записи в `docs/PROGRESS.md`.
- Добавлена задача в `dev/dashboard.html`.
- Обновлен `docs/PROJECT_CONTEXT.md` (текущий активный шаг).

## 7. Validation Record

- Команды валидации:
  - `...`
- Артефакты:
  - `...`
- Вердикт:
  - `PASS | FAIL`
