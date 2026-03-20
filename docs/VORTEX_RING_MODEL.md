# Vortex Ring Model (TT-023A)

Цель: научно строгая модель vortex ring для валидации и runtime-классификации.

## 1) Параметры кольца

- `R` - ring radius
- `a` - core radius
- `Gamma` - circulation
- `U` - translation velocity

Дополнительно:

- `Re_Gamma` proxy
- `slenderness = R / a`

## 2) Базовые уравнения/аппроксимации

Для тонкого ядра (`R >> a`) в несжимаемом приближении:

- `U` оценивается через классическую зависимость от `Gamma`, `R`, `a` (log-коррекция).
- В runtime использовать как reference envelope, не как абсолютный ground truth.

## 3) Жизненный цикл

- `forming`: generation from sheet roll-up / pulse emission
- `stable`: ring coherence поддерживается
- `deforming`: elliptic distortion, interaction-driven stretch
- `breakdown`: переход в filament/cluster/turbulent wake

## 4) Связь с переходами

- `sheet -> filament -> ring` (через loop closure и circulation coherence)
- `ring -> tube/newtonium object` при устойчивой морфологии
- `ring -> turbulent structures` при превышении instability thresholds

## 5) Детекторные критерии ring

- closed circulation loop,
- радиусная согласованность (`std(R_local) < threshold`),
- temporal persistence (`N` шагов),
- confidence fusion из topology + kinematics.

## 6) Валидационный протокол

Сценарии:

1. одиночное ring emission,
2. coaxial ring interaction,
3. ring-wall/wake interaction (если есть boundary approximation).

Метрики:

- drift `Gamma`,
- ошибка `U_reference vs U_runtime`,
- loop closure stability,
- lifetime before breakdown.

## 7) Практические ограничения

- При `R/a` близком к 1 тонкоядерная формула теряет точность.
- В сильной турбулентности ring-identity должна быть вероятностной (confidence-based), а не бинарной.
