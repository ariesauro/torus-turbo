# Vortex Rendering Strategy (TT-026A)

Цель: визуализация `sheet surfaces`, `filaments`, `particles` с научной читаемостью и runtime-устойчивостью.

## 1) Принципы

- Render = диагностика, а не только эстетика.
- В каждом кадре можно одновременно показывать:
  - representation geometry,
  - confidence/uncertainty,
  - transition hints.

## 2) Render layers

1. Particles layer:
   - density/speed colormap,
   - optional glyph vectors для sparse sampling.
2. Filament layer:
   - spline/segment tubes,
   - curvature and circulation encoded width/color.
3. Sheet layer:
   - semi-transparent surface with curvature shading,
   - panel quality overlay (`aspect ratio`, stretch).

## 3) LOD политика

- Far field: агрегация в density/iso-surfaces.
- Mid field: filament/sheet simplified mesh.
- Near field: full detail + diagnostics overlays.

## 4) Scientific overlays

- structure class label + confidence,
- transition state (`candidate/committed/rejected`),
- local invariant drift indicators.

## 5) Performance constraints

- ограничить draw-call budget;
- использовать instancing для particles;
- для sheets применять chunked mesh updates (не полная пересборка каждый кадр).

## 6) Acceptance критерии

- визуально различимы sheet/filament/particle структуры в mixed scene;
- overlays не скрывают базовую геометрию;
- render path не рушит realtime budget в стандартном профиле.

## 7) Runtime policy bootstrap (`TT-026B`, phase-0)

- runtime публикует policy-метрики: `runtimeRenderPolicyMode`, `runtimeRenderLodTier`, `runtimeRenderParticleLayerVisible`, `runtimeRenderFilamentLayerVisible`, `runtimeRenderSheetLayerVisible`.
- scientific diagnostics публикует `runtimeRenderDiagnosticsConfidence` и `runtimeRenderDiagnosticsUncertainty` для текущего representation-policy решения.
- uncertainty decomposition фиксируется в runtime как `runtimeRenderUncertaintyDetectorGap`, `runtimeRenderUncertaintyFallback`, `runtimeRenderUncertaintyTopologyVolatility`.
- overlay-coupled uncertainty для `TT-019` публикуется как `runtimeOverlayConfidenceComposite`, `runtimeOverlayUncertaintyComposite`, `runtimeOverlayUncertaintyDetector`, `runtimeOverlayUncertaintyTopology`, `runtimeOverlayUncertaintyRender`.
- detected-structures scene overlay использует class-aware glyph policy (`ring/tube/filament/cluster`) и confidence-threshold (`vizOverlayMinConfidence`) для подавления low-confidence визуального шума.
- optional label policy (`vizOverlayShowLabels`) добавляет компактные class/confidence labels над structure markers для inspection-сценариев.
- anti-overlap label policy ограничивает labels по бюджету (`vizOverlayLabelMaxCount`) и camera-distance (`vizOverlayLabelMaxDistance`).
- sheet-layer теперь управляется readiness/quality/coupling gates и detector sheet-signal; при fail-path автоматически откатывается в placeholder-safe режим (`visible=false`).
- `TT-021B` runtime scaffold публикует sheet-discretization diagnostics: panel demand/budget, quadrature/desingularization, mesh plan (`seed/topology/patching`), quality gates (`aspect/coverage/demandCoverage/epsilonBand`) и deterministic layout contract (`digest/min-max/imbalance`).
- дополнительно публикуется `meshBuilderContract v1` (`valid/issueCount` + gates `pass/warn/fail` + penalty + envelope proxies area/cv/edge/curvature) как pre-coupling readiness signal, используемый в `TT-021C` coupling contracts.
- `TT-021C` добавляет coupling contracts (`sheet<->amer`, `sheet<->filament`) с verdict/penalty и rollup stability guard; при fail-path sheet layer остается в placeholder-safe режиме.
