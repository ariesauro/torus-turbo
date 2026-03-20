# GuidedPhysics Audit Package

This package defines a repeatable validation flow for `guidedPhysics` on both backends:

- CPU (`executionMode=cpu`)
- GPU (`executionMode=gpu`)

Supported representation for this audit: `vortexRepresentation=particles`.

## Global Preconditions

1. Open Control Panel.
2. Set:
   - `Dynamics mode` = `Natural`
   - `Vortex representation` = `Particles`
3. Click `Apply Natural preset`.
4. Confirm:
   - Runtime diagnostics show no backend error.
   - `runtimeGpuDispatchPending` is not stuck forever (`yes` may appear transiently, then recover).

## Test Matrix

Run all scenarios on both backends:

1. Single pulse
2. Pulse train
3. Long run

## Scenario A: Single Pulse

### Steps

1. Press `Reset particles`.
2. Select backend (`CPU` or `GPU`).
3. Click `Single pulse`.
4. Observe for 20-30 seconds.

### Checklist

- No runtime error in diagnostics.
- Ring forms and remains coherent (no immediate collapse into noise).
- Vector field tilt changes when `alpha` is changed (e.g. `-45` to `+45`).
- `circulationDriftPercent` remains bounded.
- `sigmaOverR` stays in a physically plausible corridor.

### Pass/Fail Criteria

- **Pass**:
  - No runtime error.
  - Visible alpha-dependent tilt response.
  - `|circulationDriftPercent| <= 7%`.
  - `0.03 <= sigmaOverR <= 0.35`.
- **Fail**:
  - Runtime error.
  - No visible response to alpha change.
  - Drift/sigma outside limits for >5 seconds.

## Scenario B: Pulse Train

### Steps

1. Press `Reset particles`.
2. Select backend (`CPU` or `GPU`).
3. Click `Start train`.
4. Observe for 60 seconds.
5. Click `Stop train`.

### Checklist

- Stable operation without backend resets.
- No runaway velocity artifacts after several pulses.
- Ring train keeps expected directional behavior under alpha changes.
- Runtime counters advance monotonically (`simulation time`, steps).

### Pass/Fail Criteria

- **Pass**:
  - No runtime error.
  - No persistent explosive artifacts.
  - `|circulationDriftPercent| <= 12%`.
  - `0.03 <= sigmaOverR <= 0.40`.
- **Fail**:
  - Backend error / stuck state.
  - Persistent divergence or severe shape breakdown.
  - Drift/sigma outside bounds for >10 seconds.

## Scenario C: Long Run

### Steps

1. Press `Reset particles`.
2. Select backend (`CPU` or `GPU`).
3. Click `Start train`.
4. Let simulation run for 3-5 minutes.
5. Click `Stop train`.

### Checklist

- Backend remains healthy for entire run.
- No permanent `gpuDispatchPending` lock.
- No progressive degradation to NaN-like behavior.
- Alpha changes still affect tilt direction late in the run.

### Pass/Fail Criteria

- **Pass**:
  - No runtime error for entire run.
  - No hard lock in GPU dispatch state.
  - `|circulationDriftPercent| <= 18%`.
  - `0.02 <= sigmaOverR <= 0.45`.
- **Fail**:
  - Runtime/dispatch lock or repeated backend fallback.
  - Loss of controllable alpha response.
  - Drift/sigma persistently outside limits.

## CPU vs GPU Consistency Gate

After completing all six runs (3 scenarios x 2 backends):

- Compare qualitative behavior:
  - Ring coherence.
  - Alpha tilt response direction.
- Compare diagnostics:
  - `circulationDriftPercent` difference between CPU and GPU should be within ~8 percentage points for matching scenario.
  - `sigmaOverR` should stay in the same qualitative regime (stable / warning / unstable).

### Consistency Pass/Fail

- **Pass**: No major qualitative mismatch, diagnostics remain in comparable bands.
- **Fail**: One backend is systematically unstable while the other is stable under same setup.

## Reporting Template

For each run, capture:

- Backend:
- Scenario:
- Duration:
- Runtime backend status:
- Final `circulationDriftPercent`:
- Final `sigmaOverR`:
- Alpha response check (`PASS/FAIL`):
- Notes:
