# Long-run Stability Benchmark Suite (TT-017)

Скрипт: `audit-runner/longRunBenchmarkSuite.mjs`.

Цель: воспроизводимый прогон режимов `CPU/GPU/Hybrid/Hybrid+` с одинаковой нагрузкой и единым набором метрик:

- latency: `step median/p95`
- throughput proxy: `activeCount / stepMs`
- stability drift: `energyProxy` и `enstrophyProxy` (%)
- sync pressure: `runtimeGpuSyncViolationCount`, `full/skipped readback`
- structure dynamics: `runtimeNewtoniumTransitions`
- representation policy health:
  - `policy_override_count_by_reason` (`fallback_storm/timeout_burst/invariant_guard`)
  - `render_policy_drift_severity_p95`

Дополнительно: в приложении добавлена first-run hardware auto-calibration (короткий startup benchmark без UI-ручных действий) с прогрессом и summary-метриками в `ControlPanel`.

## Запуск

1. Запустить приложение в dev-режиме:

`npm run dev`

2. В отдельном терминале запустить suite:

`npm run benchmark:longrun`

## Параметры окружения

- `TORUS_BASE_URL` (default: `http://localhost:5173/`)
- `LONGRUN_PARTICLE_COUNT` (default: `30000`)
- `LONGRUN_WARMUP_SEC` (default: `6`)
- `LONGRUN_DURATION_SEC` (default: `45`)
- `LONGRUN_SAMPLE_MS` (default: `500`)
- `PLAYWRIGHT_EXECUTABLE_PATH` (опционально для кастомного браузера)
- `PLAYWRIGHT_HEADLESS` (default: `false`, рекомендуется оставить `false` для стабильного GPU/WebGL)
- `PLAYWRIGHT_BROWSER_CHANNEL` (например `chrome`, с fallback на bundled chromium)
- `LONGRUN_BASELINE_PATH` (default: `./audit-runner/long-run-baseline.json`)
- `LONGRUN_PROFILE` (`standard` | `smoke` | `nightly`, default: `standard`)
- `LONGRUN_RUNNER_MODE` (`default` | `controlled`, default: `default`; `controlled` применяет profile-aware runner minimums для более воспроизводимого strict-gating)
- `LONGRUN_HARDWARE_CLASS` (`low` | `entry_gpu` | `mid` | `high`, default: `unknown`; при `unknown` suite auto-detect hardware-class в браузере по `hardwareConcurrency/deviceMemory/WebGPU`, env используется как manual override)
- `LONGRUN_UPDATE_BASELINE` (`true` чтобы записать baseline из текущего прогона)
- `LONGRUN_FAIL_ON_GATE` (`true` чтобы завершать run с ошибкой при регрессии относительно baseline)
- `LONGRUN_ADAPTIVE_MATRIX` (`true|false`, default `true`; генерировать adaptive matrix после longrun suite)
- `LONGRUN_ADAPTIVE_MATRIX_FAIL_ON_SCENARIO` (например `adaptive.mid`; при `LONGRUN_FAIL_ON_GATE=true` default profile-aware: `adaptive.low` для `smoke/standard`, `adaptive.mid` для `nightly`)
- `LONGRUN_ADAPTIVE_MATRIX_MIN_PASS_RATIO` (default `1.0`; для strict `standard/nightly` по умолчанию `0.667` (2/3), минимум pass ratio для выбранного adaptive scenario)
- `LONGRUN_PHYSICAL_BASELINE` (`true|false`, default `false`; запускать physical realism baseline workflow после longrun suite)
- `LONGRUN_PHYSICAL_BASELINE_FAIL_ON_GATE` (`true|false`, default наследует `LONGRUN_FAIL_ON_GATE`; фейлить suite при fail physical baseline gate)
- `LONGRUN_EXTENDED_PHYSICS_MATRIX` (`true|false`, default `false`; запускать extended physics matrix workflow после longrun suite)
- `LONGRUN_HYBRIDPLUS_SCHEDULER_AUDIT` (`true|false`, default `false`; запускать Hybrid+ scheduler audit workflow после longrun suite)
- `LONGRUN_CASE_TIMEOUT_SEC` (wall-clock timeout на 1 mode-case; защищает от зависших прогонов)
- `LONGRUN_MODES` (опционально, csv mode-filter: `cpu,gpu,hybrid,hybrid_plus`)
- `LONGRUN_POLICY_GATE_TREND_PATH` (default: `./audit-runner/policy-gate-trend.json`; history для mode-level policy verdict)
- `LONGRUN_BASELINE_PATH` / `LONGRUN_POLICY_GATE_TREND_PATH`: relative paths корректно резолвятся как при запуске из repo root, так и из директории `audit-runner`
- `LONGRUN_POLICY_GATE_TREND_MAX` (default: `180`; max snapshots в policy-gate trend history)
- `LONGRUN_RETUNE_HEADROOM_PCT` (default: `12`; запас для auto-suggest retuning limits в секции `Threshold Retuning Hints`)
- `LONGRUN_RETUNE_INCLUDE_NEAR_PASS` (`true|false`, default `false`; добавлять ли near-pass checks в retuning hints, кроме fail)
- `LONGRUN_APPLY_RETUNING_HINTS` (`true|false`, default `false`; автоматически применяет `thresholdRetuningHints.baselinePatchTemplate` в baseline)
- `LONGRUN_CPU_PARTICLE_COUNT` (опциональный override particle count только для `CPU` mode-case)
- `LONGRUN_CPU_WARMUP_SEC` (опциональный override warmup только для `CPU` mode-case)
- `LONGRUN_CPU_DURATION_SEC` (опциональный override duration только для `CPU` mode-case)
- `LONGRUN_CPU_SAMPLE_MS` (опциональный override sample interval только для `CPU` mode-case)
- `LONGRUN_DRIFT_SEVERITY_REGRESS_BASELINE_FLOOR` (default `0.05`; минимальный baseline для `% regress` check по `driftSeverityP95`, чтобы избежать шума от деления на near-zero baseline; при baseline ниже floor используется только `driftSeverityP95AbsMax` gate)
- `LONGRUN_AUTOCORRECTION_REGRESS_BASELINE_FLOOR` (default `1`; минимальный baseline для `% regress` check по `autoCorrectionPer1kSteps`, чтобы near-zero baseline не давал искусственно огромный regress%; при baseline ниже floor используется только `autoCorrectionPer1kStepsAbsMax` gate)

Примечание: для `LONGRUN_PROFILE=nightly`, если CPU override-параметры не заданы, suite автоматически использует CPU-safe профиль (`particleCount <= 6000`, `warmup <= 2s`, `duration <= 25s`, `sample >= 500ms`) для предотвращения case-timeout на laptop/mid-tier hardware при сохранении CPU coverage.

Режим `LONGRUN_RUNNER_MODE=controlled`:
- `standard`: минимум `warmup=8s`, `duration=60s`, `sample=600ms`, `case-timeout=360s`,
- `nightly`: минимум `warmup=10s`, `duration=150s`, `sample=600ms`, `case-timeout=720s`,
- если явно задать `LONGRUN_WARMUP_SEC/LONGRUN_DURATION_SEC/LONGRUN_SAMPLE_MS/LONGRUN_CASE_TIMEOUT_SEC`, то эти override имеют приоритет.
- при недоступном `PLAYWRIGHT_BROWSER_CHANNEL` suite автоматически падает на bundled chromium и фиксирует это в payload (`config.browserChannelFallbackUsed`, `config.browserChannelFallbackReason`).
- для adaptive matrix gate в strict `standard/nightly` default pass ratio снижен до `2/3` (`adaptive.low`/`adaptive.mid`), чтобы единичный mode-outlier не ронял весь run при стабильных остальных режимах.
- internal case-timeout timers теперь очищаются после завершения mode-case (`clearTimeout` + `unref`), чтобы `PASS`-прогоны корректно завершались без зависания процесса.
- при transient browser context loss (`Execution context was destroyed`) mode-case автоматически перезапускается один раз после reload страницы.

Пример:

`LONGRUN_DURATION_SEC=90 LONGRUN_PARTICLE_COUNT=40000 npm run benchmark:longrun`

`PLAYWRIGHT_BROWSER_CHANNEL=chrome PLAYWRIGHT_HEADLESS=false npm run benchmark:longrun`

`LONGRUN_UPDATE_BASELINE=true npm run benchmark:longrun`

`npm run benchmark:longrun:smoke`

`npm run benchmark:longrun:nightly:ci`

`npm run benchmark:longrun:hybridplus`

`npm run benchmark:longrun:standard:controlled`

`npm run benchmark:longrun:nightly:controlled`

`LONGRUN_PROFILE=nightly LONGRUN_MODES=gpu,hybrid,hybrid_plus LONGRUN_CASE_TIMEOUT_SEC=120 node ./audit-runner/longRunBenchmarkSuite.mjs`

`LONGRUN_HARDWARE_CLASS=high npm run benchmark:longrun` (manual override, если нужно зафиксировать класс для CI/серверного раннера)

`npm run benchmark:adaptive:matrix`

`npm run benchmark:adaptive:matrix:ci`

`npm run benchmark:physical:baseline`

`npm run benchmark:physical:baseline:ci`

`npm run benchmark:physics:matrix`

`npm run benchmark:physics:matrix:ci`

`npm run benchmark:hybridplus:scheduler`

`npm run benchmark:hybridplus:scheduler:ci`

Опциональные переменные для adaptive matrix script:
- `ADAPTIVE_MATRIX_INPUT` (default: `./long-run-benchmark-results.json`; можно передать Lab artifact JSON),
- `ADAPTIVE_MATRIX_OUTPUT_JSON` (default: `./adaptive-baseline-matrix.json`),
- `ADAPTIVE_MATRIX_OUTPUT_MD` (default: `./adaptive-baseline-matrix.md`),
- `ADAPTIVE_MATRIX_TREND_PATH` (default: `./adaptive-baseline-trend.json`),
- `ADAPTIVE_MATRIX_FAIL_ON_SCENARIO` (опционально, например `adaptive.mid`),
- `ADAPTIVE_MATRIX_MIN_PASS_RATIO` (default: `1.0`),
- `ADAPTIVE_MATRIX_TREND_MAX` (default: `120`; максимальное число snapshot в trend history).

Примечание по adaptive scenarios:
- envelope thresholds откалиброваны под browser-runtime long-run telemetry (`stepP95`/`energy drift`) и предназначены для сравнительного gating между `low/mid/high`, а не для offline micro-benchmark latency.

Опциональные переменные для physical baseline script:
- `PHYSICAL_BASELINE_OUTPUT_JSON` (default: `./physical-realism-baseline.json`),
- `PHYSICAL_BASELINE_OUTPUT_MD` (default: `./physical-realism-baseline.md`),
- `PHYSICAL_BASELINE_FAIL_ON_GATE` (`true|false`, default `false`),
- `PHYSICAL_BASELINE_PARTICLE_COUNT` (default `9000`),
- `PHYSICAL_BASELINE_WARMUP_SEC` (default `2`),
- `PHYSICAL_BASELINE_DURATION_SEC` (default `8`),
- `PHYSICAL_BASELINE_SAMPLE_MS` (default `400`).

## Артефакты

Скрипт создает:

- `audit-runner/long-run-benchmark-results.json`
- `audit-runner/long-run-benchmark-results.md`
- `audit-runner/adaptive-baseline-matrix.json`
- `audit-runner/adaptive-baseline-matrix.md`
- `audit-runner/adaptive-baseline-trend.json`
- `audit-runner/physical-realism-baseline.json`
- `audit-runner/physical-realism-baseline.md`
- `audit-runner/extended-physics-matrix.json`
- `audit-runner/extended-physics-matrix.md`
- `audit-runner/hybridplus-scheduler-audit.json`
- `audit-runner/hybridplus-scheduler-audit.md`
- `audit-runner/policy-gate-trend.json`

Для in-app calibration hardware-specific baseline сохраняется в browser localStorage.

## Интерпретация

Столбец `Stability` вычисляется эвристикой:

- `PASS`: низкий риск (latency/sync/drift в норме)
- `WARN`: умеренный риск (нужна локальная калибровка)
- `FAIL`: высокий риск (нужен tuning sync/physics/operators)

Для regression tracking важно сравнивать результаты по одинаковым параметрам (`N`, длительность, sample interval).

В `summaryRows`/console/MD теперь также публикуются policy-сигналы:

- `renderPolicyOverrideCount` и `renderPolicyOverrideCountByReason`,
- `renderPolicyDriftSeverityP95` и `renderPolicyDriftSeverityAvg`.
- `stabilityAutoCorrectionPer1kSteps` (интенсивность auto-correction относительно числа runtime шагов).

Suite содержит health-gate: если рантайм не стартовал (не растет simulation time или нет активных частиц), прогон завершится ошибкой вместо "ложно успешного" отчета.

Для `Hybrid/Hybrid+` health-gate выполняется с коротким retry-окном после warmup (включая повторный `startTrain` pulse), чтобы исключить ложные ранние срабатывания на transient startup лаге.

Примечание по short-window drift: runtime enstrophy diagnostics использует robust proxy (winsorized vorticity, параметр `energyDiagnosticsMaxVorticityForProxy`, default `12`) для снижения влияния одиночных vorticity-spikes на коротких `smoke` окнах.

## Baseline gates (TT-017D)

Если baseline-файл существует, suite сравнивает текущие mode-метрики с baseline:

- `stepP95RegressPct` (default limit: `25%`)
- `throughputDropPct` (default limit: `20%`)
- `energyDriftAbsPct` (default limit: `35%`)
- `enstrophyDriftAbsPct` (default limit: `40%`)
- `driftSeverityP95RegressPct` (relative to baseline; mode/profile-aware)
- `driftSeverityP95AbsMax`
- `autoCorrectionPer1kStepsRegressPct` (relative to baseline)
- `autoCorrectionPer1kStepsAbsMax`
- `overrideFallbackStormCountMax`
- `overrideTimeoutBurstCountMax`
- `overrideInvariantGuardCountMax`

Поддерживаются 3 уровня порогов:

- `thresholds` — глобальные значения по умолчанию
- `thresholdsByMode` — override на конкретный режим (`cpu`, `gpu`, `hybrid`, `hybrid_plus`)
- `thresholdsByHardwareClass` — override на класс железа (`low`, `entry_gpu`, `mid`, `high`)

И дополнительно profile-specific overrides:

- `thresholdsProfiles.<profile>`
- `thresholdsByModeProfiles.<profile>.<mode>`
- `thresholdsByHardwareClassProfiles.<profile>.<hardwareClass>`
- `thresholdsByModeHardwareClassProfiles.<profile>.<hardwareClass>.<mode>`

где `profile` — `standard|smoke|nightly`, `hardwareClass` — `low|entry_gpu|mid|high`.

При `LONGRUN_UPDATE_BASELINE=true` suite автоматически заполняет/обновляет шаблоны для всех профилей (`standard/smoke/nightly`) и hardware-классов на базе встроенных default thresholds, сохраняя уже существующие ручные override-значения.

Результаты пишутся в `gateResults` (JSON) и секцию **Baseline Gates** (MD).

Дополнительно в MD-отчете формируется секция **Policy Gates** с PASS/FAIL по policy-check IDs:

- `driftSeverityP95RegressPct`
- `driftSeverityP95AbsMax`
- `overrideFallbackStormCountMax`
- `overrideTimeoutBurstCountMax`
- `overrideInvariantGuardCountMax`

Также формируется секция **Threshold Retuning Hints (TT-017D)**:

- строит предложения по обновлению лимитов на уровнях `mode`, `hardwareClass` и `mode+hardwareClass` для failed checks (и optional near-pass checks),
- учитывает активные `profile + hardwareClass`,
- дублирует patch template в JSON (`thresholdRetuningHints.baselinePatchTemplate`) для быстрого переноса в baseline.

Опционально можно включить controlled auto-apply:

- `LONGRUN_APPLY_RETUNING_HINTS=true` применяет предложенный patch в baseline до `LONGRUN_UPDATE_BASELINE` стадии,
- итог фиксируется в JSON/MD (`retuningApplyResult`, секция `Retuning Auto-Apply`).

Также добавлена сводная секция **Policy Gate Verdict** (mode-level):

- `PASS` - все policy-checks прошли,
- `FAIL` - есть policy-checks с fail,
- `WARN` - отсутствует baseline для режима.

## Physical realism baseline (TT-032C)

Скрипт: `audit-runner/physicalRealismBaseline.mjs`.

Phase-0 validation matrix:
- order sensitivity (`canonical`, `boundary_first`, `diffusion_first`),
- diffusion monotonicity (`physicalViscosityNu` sweep),
- stretching boundedness (`physicalStretchingStrength` sweep).

Скрипт учитывает текущий scope runtime:
- PSE diffusion is fully implemented and is the default method,
- boundary/wake hooks пока proxy placeholders (ожидаемые warning IDs).

Отчет:
- JSON gate payload + check details,
- Markdown таблица по кейсам и check verdicts.

## Extended physics matrix (TT-017 extension)

Скрипт: `audit-runner/extendedPhysicsMatrix.mjs`.

Цель:
- расширенная проверка physics envelope для `ring/jet/turbulence-wake` сценариев,
- case-level gate для latency/drift/critical-ratio,
- отдельные JSON/MD артефакты для трассировки regressions вне core long-run таблицы.

Переменные:
- `EXTENDED_PHYSICS_MATRIX_OUTPUT_JSON` (default: `./extended-physics-matrix.json`),
- `EXTENDED_PHYSICS_MATRIX_OUTPUT_MD` (default: `./extended-physics-matrix.md`),
- `EXTENDED_PHYSICS_MATRIX_FAIL_ON_GATE` (`true|false`, default `false`).

## Hybrid+ scheduler audit (TT-018C)

Скрипт: `audit-runner/hybridPlusSchedulerAudit.mjs`.

Цель:
- валидация anti-thrash поведения `Hybrid+` scheduler (cadence scaling + budget guards),
- проверка operator prioritization (`topology` vs `barnes_hut` under pressure),
- machine-checkable gate по сценариям `balanced`, `budget_guard`, `idle_throttle`.

Переменные:
- `HYBRIDPLUS_SCHEDULER_OUTPUT_JSON` (default: `./hybridplus-scheduler-audit.json`),
- `HYBRIDPLUS_SCHEDULER_OUTPUT_MD` (default: `./hybridplus-scheduler-audit.md`),
- `HYBRIDPLUS_SCHEDULER_FAIL_ON_GATE` (`true|false`, default `false`).

Long-run hook:
- `LONGRUN_HYBRIDPLUS_SCHEDULER_AUDIT=true` запускает этот audit автоматически в конце `longRunBenchmarkSuite`.

## Validation protocol (TT-030C)

Для проверки перехода с fixed multipliers на adaptive drift coefficients в runtime:

1. Запустить `standard` профиль на `gpu,hybrid,hybrid_plus` (и `cpu` отдельно при необходимости):

`LONGRUN_PROFILE=standard LONGRUN_MODES=gpu,hybrid,hybrid_plus npm run benchmark:longrun`

2. Проверить, что gate-статусы не деградировали относительно baseline (`PASS/WARN/FAIL` на уровне ожидаемой калибровки).

3. В runtime diagnostics (`ControlPanel -> Runtime GPU diagnostics -> Runtime stability`) проверить адаптивные поля:

- `Adaptive drift severity/scale/streak`:
  - `severity` в диапазоне `[0..1]`,
  - `scale` в диапазоне `[0..1]`,
  - `streak` растет только при последовательных `conservation_drift` warnings и сбрасывается после восстановления.

4. Проверить timeline auto-correction:

- при умеренном drift коэффициенты снижаются мягко (без резких скачков),
- при повторяющемся drift (`streak`) усиливается downscale для `guided/stretching/vorticity confinement`,
- после нормализации метрик интенсивность адаптации возвращается к низкому уровню.
