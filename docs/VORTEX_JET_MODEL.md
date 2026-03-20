# Vortex Jet Model (TT-024A)

Цель: описать vortex jet как многостадийную структуру:

- shear layer,
- vortex ring train,
- turbulent wake.

## 1) Структурная декомпозиция

1. Near-nozzle shear layer:
   - формируется профиль сдвига скорости.
2. Roll-up stage:
   - сдвиговой слой сворачивается в ring-like структуры.
3. Ring interaction stage:
   - rings взаимодействуют, сливаются/деформируются.
4. Far-wake turbulence:
   - распад в кластеры/филаменты/частицы.

## 2) Режимные параметры

- `Re` (или proxy через velocity/length/viscosity params),
- `St` (пульсация/частота возбуждения),
- `L/D` (геометрическая масштабность).

Эти параметры определяют доминирующий режим переходов.

### 2.1) Jet regime map (`TT-024B`)

Нормализованные прокси (runtime):

- `Re_proxy = clamp01((jetSpeed * coreRadiusSigma) / (physicalViscosityNu * 12000))`
- `St_proxy = clamp01((1 / pulseDuration) / 4.5)`
- `L/D_proxy = clamp01((pulseInterval + pulseDuration) / max(0.25, coreRadiusSigma * 4))`

Классификация режима:

1. `turbulent_wake`: `Re_proxy >= 0.62` и `wakeIndex >= 0.58`
2. `ring_train`: `ringDominance >= 0.56` и `St_proxy ∈ [0.35, 0.75]`
3. `shear_layer`: `L/D_proxy <= 0.4` или `St_proxy >= 0.8`
4. иначе: `interaction` (или `ring_train`, если `wakeIndex` низкий)

Где:

- `ringDominance = ringCount / totalStructures`
- `wakeIndex = 0.55 * clusterShare + 0.25 * filamentShare + 0.2 * Re_proxy`

## 3) Coupling с существующей архитектурой

- emission subsystem задает forcing (`pulseDuration`, `jetSpeed`).
- detector выделяет ring train и onset breakdown.
- transitions system определяет когда jet представлять как ring-chain vs filament-cloud.

## 4) Критерии переходов в jet

- shear layer -> rings:
  - рост азимутальной когерентности + closed-loop признаки.
- rings -> turbulent wake:
  - падение ring confidence + рост multi-scale enstrophy proxy.

## 5) Диагностика для jet

- ring count/time,
- inter-ring spacing stability,
- onset time turbulent wake,
- energy/enstrophy flux proxies.

Runtime contract (`tt024b.jet_regime.v1`) публикует:

- `version`, `valid`, `verdict`, `regime`, `acceptanceScore`,
- `gatePassCount/gateTotal`,
- proxies: `re/st/ld/ringDominance/wakeIndex`.

Гейты:

- `confidence`,
- `ringTrainSignal`,
- `wakeBreakdownSignal`,
- `transitionHealth` (по drift из `TT-022` инвариантов).

## 6) Validation scenarios

1. short pulse jet (ring-dominant),
2. sustained jet (shear + wake dominant),
3. pulsed train (ring interaction dominant).

## 7) Научные оговорки

- Без явных boundary conditions jet-валидация ограничена относительными метриками.
- Для публикабельных сравнений нужны одинаковые nondimensional settings между прогонами.
