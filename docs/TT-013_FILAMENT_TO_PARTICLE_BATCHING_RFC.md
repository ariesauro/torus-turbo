> Status: DONE — TT-013A through TT-013D implemented.

# TT-013 RFC: Filament -> Particle Batching Acceleration

Статус: DONE (Implemented)  
Дата: 2026-03-16

## Цель

Ускорить ветку `filament -> particle coupling` в `applyHybridCoupling`, где сейчас используется per-particle вызов `sampleFilamentVelocityAtPoint(...)`.

## Текущее состояние

- Для каждой частицы выполняется sampling филаментов с доступом к segment grid.
- Логика корректна, но CPU стоимость линейно растет с `Np`.
- Отсутствует явный batch path и SIMD-friendly SoA представление результата.

## Предлагаемая архитектура

## 1) Batch API на filament solver стороне

Добавить в `biotSavartFilament.js` новый интерфейс:

- `sampleFilamentVelocityAtPointsBatch(pointsPacked, solverContext, options)`

Вход:

- `Float32Array` точек (x,y,z,w), batch-чанк.

Выход:

- `Float32Array` скоростей (vx,vy,vz,w)
- статистика по batch.

## 2) Интеграция в hybridCoupling

- собирать частицы в batch (stride 4),
- вызывать batch sampling вместо N одиночных вызовов,
- применять clamp и merge flow как сейчас (без изменения физики).

## 3) Fallback и безопасность

- feature flag: `hybridFilamentToParticleBatchingEnabled`.
- fallback на текущий per-particle path при любых ошибках.

## 4) Этапы

1. `TT-013A`: API контракт и адаптер batch->legacy (без ускорения).
2. `TT-013B`: батчевый CPU traversal по segment grid.
3. `TT-013C`: интеграция в `applyHybridCoupling`.
4. `TT-013D`: diagnostics (batch size, ms, speedup, fallback count).

## KPI

- снижение `filament->particle` части coupling времени на 20-35% для больших `Np`.
- нулевая регрессия по стабильности и циркуляции.
