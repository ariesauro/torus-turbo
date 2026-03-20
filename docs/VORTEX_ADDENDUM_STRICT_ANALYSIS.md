# Strict Analysis of Vortex Sheet Addendum

Этот документ фиксирует неточности исходного addendum и их исправления в научно-строгой форме.

## 1) Обнаруженные неточности

1. "Sheet как mesh surface c velocity в вершинах" недостаточно:
   - отсутствует surface circulation density (`gamma_s`);
   - не определен способ вычисления интеграла по поверхности.
2. "Автоматическое преобразование sheet -> filaments" переопределено:
   - без confidence gates это нестабильно и порождает фальш-переходы.
3. Отсутствует инвариантный контроль переходов:
   - нет явных ограничений по `Gamma`/impulse/energy drift.
4. Ring/Jet разделы без режимных безразмерных параметров:
   - без `Re/St/L/D` валидация остается эвристической.
5. Performance раздел не задает policy:
   - нужно не только "оценить когда выгодно", а формально определить критерий выбора.

## 2) Корректировки, принятые в проекте

- Добавлены отдельные архитектурные документы:
  - `VORTEX_SHEET_MODEL`
  - `VORTEX_TRANSITIONS`
  - `VORTEX_RING_MODEL`
  - `VORTEX_JET_MODEL`
  - `VORTEX_RENDERING_STRATEGY`
  - `VORTEX_REPRESENTATION_PERFORMANCE`
- В roadmap/tasks введен строгий порядок `P0 -> P3` с зависимостями.
- Переходы формализованы как gated operators с hysteresis и audit метриками.

## 3) Нерешенные риски

- Высокая стоимость sheet quadrature в near-field.
- Потенциальная деградация качества mesh при roll-up.
- Риск ложной классификации ring/jet без robust uncertainty fusion.

## 4) План снижения рисков

- Применить adaptive quadrature + fast far-field approximation.
- Ввести mesh quality guards и controlled resampling в particles.
- Использовать temporal confidence и transition hysteresis для детектора.
