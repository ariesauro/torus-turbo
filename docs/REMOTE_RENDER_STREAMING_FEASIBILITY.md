# REMOTE_RENDER_STREAMING_FEASIBILITY

Последнее обновление: 2026-03-18

## Цель

Оценить реализуемость remote-render streaming для `Torus Turbo` как опционального performance-контура без потери научной воспроизводимости и UX-предсказуемости.

## Контекст

- Текущий baseline ориентирован на локальный runtime (`cpu/gpu/hybrid/hybrid+`) с reproducible audit-контуром (`TT-017`, `TT-016C`).
- Для scientific workflow критичны: deterministic diagnostics window, stable sampling cadence, строгий artifact trail.
- Remote-render может улучшить слабые клиенты, но добавляет сетевую вариативность (RTT/jitter/loss), не контролируемую локальными benchmark-gates.

## Feasibility criteria (go/no-go)

Remote-render допустим только если одновременно выполняются условия:

1. **Network envelope (P95):**
   - RTT <= 18 ms,
   - jitter <= 4 ms,
   - packet loss <= 0.3%.
2. **Interaction budget:**
   - end-to-end control latency <= 45 ms (P95),
   - frame delivery cadence >= 50 FPS (P95) для interactive режимов.
3. **Scientific integrity:**
   - удаленный и локальный режимы дают сопоставимые diagnostics traces в пределах существующих benchmark envelopes,
   - artifacts содержат remote session metadata (network envelope + encoder profile + server build fingerprint).
4. **Fallback safety:**
   - мгновенный переход на local render без потери runtime control,
   - degraded-network режим автоматически отключает remote stream при выходе за envelope.

## Риски

- **Latency drift risk:** плавающий RTT ломает стабильность sampling windows и усложняет интерпретацию drift/throughput gates.
- **Reproducibility risk:** результаты становятся зависимыми от сети и server-side encoding pipeline.
- **Operational risk:** требуется отдельный серверный runtime/queue/isolation слой и политика версионирования remote images.
- **Complexity risk:** высокая стоимость поддержки для фичи, не дающей гарантированного выигрыша на обычных потребительских сетях.

## Decision

**Текущий вердикт: NO-GO (defer implementation).**

Причина: при текущем product-envelope невозможно гарантировать одновременно low-latency interactive UX и scientific-grade reproducibility на массовых сетях без существенного роста архитектурной сложности.

## Revisit trigger

Переоценка допустима, когда доступны:

- подтвержденный low-latency network tier (edge/region pinned),
- стабильный remote runtime isolation layer,
- автоматизированный parity-audit: remote vs local traces в CI для репрезентативной матрицы сценариев.

## Minimum architecture sketch (future)

- `RemoteSessionController` (client): health monitor + auto-fallback.
- `RemoteRuntimeGateway` (server): versioned runtime image + deterministic config lock.
- `RemoteArtifactEnvelope`: расширение artifact schema полями network/encoder/server-build metadata.

До выполнения критериев из раздела **Feasibility criteria** remote-render остаётся исследовательским направлением и не входит в production roadmap.
