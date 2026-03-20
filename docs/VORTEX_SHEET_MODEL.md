# Vortex Sheet Model (TT-021A)

Цель: формализовать surface-представление вихрей для `shear layers`, `jets`, `wake flows`, ранней стадии `ring formation`.

## 1) Научная постановка

Vortex sheet описывает разрыв тангенциальной скорости на поверхности с поверхностной плотностью циркуляции `gamma_s`:

- `gamma_s = n x [u_t]`, где `n` - нормаль поверхности, `[u_t]` - скачок тангенциальной скорости.
- В непрерывной форме скорость задается интегралом Биота-Савара по поверхности.

Важно: sheet не является "просто mesh". Это физический объект с полем интенсивности на поверхности и контролируемой регуляризацией ядра.

## 2) Дискретное представление

Sheet хранится как треугольная или quad-панельная поверхность:

- `vertices[i]`: `position`, `velocity`, `normal`, `areaWeight`
- `panels[j]`: `vertexIds`, `centroid`, `area`, `gamma_s`, `curvature`
- `meta`: `sheetId`, `birthStep`, `confidence`, `regularizationEps`

Рекомендация для TT: panel-centric хранение (`gamma_s` в панели), а не vertex-centric, чтобы снизить численную диффузию.

## 3) Динамика

### 3.1 Advection

- Панели/вершины переносятся локальной скоростью:
  - self-induced contribution (sheet-sheet),
  - external flow contribution (particles/filaments/background).

### 3.2 Biot-Savart по поверхности

- Вводится desingularized kernel с параметром `eps_s`.
- Интеграл считается квадратурой по панелям:
  - ближнее поле: точная/повышенная квадратура,
  - дальнее поле: ускорение через tree/FMM approximation.

### 3.3 Regularization и stability

- Curvature smoothing (ограниченно, чтобы не убить физику roll-up).
- CFL/step guards по максимуму индуцированной скорости и кривизне.

## 4) Переходы и coupling

### 4.1 Sheet -> Amer particles

Использовать как controlled remeshing/discretization:

- оператор: surface sampling -> particle cloud с сохранением `Gamma` в пределах tolerance;
- применять при сильном roll-up и локальной потере качества mesh.

### 4.2 Sheet -> Filaments

Переход через extraction of coherent ridges:

- detector выделяет линии максимальной вихревой когерентности;
- формируются filament seeds с confidence gate.

### 4.3 Filament -> Tube

Переход не прямой из sheet, а через filament stabilization:

- если filament устойчив по времени и геометрии -> tube projection.

## 5) Связь с текущими модулями Torus Turbo

- `detectVortexStructures`: добавить sheet-признаки (surface coherence, curvature anisotropy).
- `newtoniumTracker`: добавить transitions `sheet->filament`, `sheet->particles`.
- `hybridCoupling`: добавить sheet hooks как опциональный backend слой (phase 2).

## 6) Ограничения применимости

- Sheet-модель чувствительна к сеточному качеству; обязательны quality metrics (`aspect ratio`, `area skew`).
- В турбулентном распаде sheet быстро теряет гладкость; там должен включаться controlled conversion в particles/filaments.
- Без регуляризации интеграл плохо обусловлен на близких панелях.

## 7) Acceptance критерии (архитектурные)

- Для тестов `shear layer roll-up`:
  - bounded drift total circulation,
  - отсутствие взрывного роста max velocity на фиксированном `eps_s`,
  - устойчивый переход к filament/ring структурам с confidence > порога.
