# Strict Analysis: Advanced Visualization + Physical Realism

Фиксирует неточности исходного addendum и корректировки для научно-строгого результата.

## 1) Visualization Addendum - неточности

- Q-criterion обозначен как режим обнаружения:
  - это сильный диагностический индикатор, но не полноценный детектор.
- Streamlines и pathlines смешаны по смыслу:
  - streamlines мгновенные, pathlines лагранжевы во времени.
- Экспорт `MP4/PNG` без metadata делает результаты нерепродуцируемыми.

Коррекция:

- введена строгая роль Q как диагностики,
- разделены streamlines/pathlines,
- добавлен snapshot bundle with metadata.

## 2) Physical Models Addendum - неточности

- No-slip на вихревом particle solver без boundary layer model не тривиален:
  - нужна аппроксимация и явные ограничения применимости.
- Image vortices применимы для ограниченного класса геометрий:
  - planes/spheres в phase 1, mesh boundaries в phase 2.
- Stretching/viscosity без integration order и stability guards может дать нефизичный рост ошибок.

Коррекция:

- задан порядок интеграции в шаге,
- добавлены conservation/stability acceptance criteria.

## 3) Рекомендуемый порядок внедрения

1. Завершить `TT-030B/C` (stability monitor + corrections).
2. Запустить `TT-032B` runtime hooks для physical models.
3. После валидной физики расширять `TT-031B/C` advanced visualization.

## 4) Научные acceptance критерии

- reproducibility при фиксированных params/seed,
- bounded drift для circulation/energy,
- explicit uncertainty tags в визуализации и exports,
- documented validity range для boundary/viscosity approximations.
