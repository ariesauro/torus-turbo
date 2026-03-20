# Hybrid+ Architecture Scaffold

This document describes the foundational runtime hooks for a future `Hybrid+` particle stack where CPU and GPU cooperate on particle methods without duplicating full-step work.

## Goals

- Keep current `Natural + CPU/GPU` behavior stable.
- Add extension points for new particle methods and topology-heavy operators.
- Support adaptive backend policy based on runtime conditions.

## Added Runtime Building Blocks

- `src/simulation/runtime/hybridPlusPlanner.js`
  - Chooses `baseBackend` and `assistBackend`.
  - Activates only when `hybridPlusEnabled=true` and mode matrix is compatible.
  - Emits sync policy (`delta` mode scaffold) and operator selection hints.
  - Adds auto-gating for `barnes_hut_farfield` using `particleCount` and `stepMs` thresholds.

- `src/simulation/runtime/hybridPlusOperators.js`
  - Operator registry with stage/capability metadata.
  - First real assist operator:
    - CPU topology correction in `Natural + Particles`
    - Produces sparse position deltas (`id, dx, dy, dz`)
    - Applies deltas locally and queues them back to GPU snapshot.
  - Added second assist operator:
    - `barnes_hut_farfield` (CPU)
    - Builds octree and approximates far-field Biot-Savart influence
    - Emits sparse deltas and merges with topology correction deltas.

- `src/simulation/runtime/barnesHutAssist.js`
  - CPU Barnes-Hut implementation for assist path.
  - Uses Natural circulation direction modulation for source vorticity alignment.
  - Tunable via `hybridPlusBarnesHut*` params.

- `src/simulation/runtime/simulationRuntime.js`
  - Integrates planner and operator hooks into step loop.
  - Publishes Hybrid+ telemetry fields to params store.
  - Applies assist cadence policy (`hybridPlusAssistCadenceSteps`).

- `src/simulation/physics/webgpu/hashGridParticleComputeManager.js`
  - Added `queueParticleDeltas` for sparse CPU->GPU state correction.
  - Command queue now supports `apply_particle_deltas`.

## Operator Contract (intended)

Each new method should define:

- `id`: stable operator identifier.
- `stage`: `bulk | guidance | topology | correction`.
- `supports`: `cpu`, `gpu`, or both.
- `defaultBackend`: preferred backend.
- `apply(modeContext)`: future execution handler.

## Current Telemetry

Published runtime fields:

- `runtimeHybridPlusActive`
- `runtimeHybridPlusReason`
- `runtimeHybridPlusBaseBackend`
- `runtimeHybridPlusAssistBackend`
- `runtimeHybridPlusSyncMode`
- `runtimeHybridPlusOperatorCount`

## Runtime Controls (UI)

`Backend and diagnostics` now exposes quick controls in Natural mode:

- `hybridPlusEnabled`
- `hybridPlusAssistBudgetMs`
- `hybridPlusAssistCadenceSteps`
- `hybridPlusTopologyCorrectionEnabled`
- `hybridPlusTopologyThreshold`
- `hybridPlusTopologyStrength`
- `hybridPlusBarnesHutEnabled`
- `hybridPlusBarnesHutAuto`
- `hybridPlusBarnesHutTheta`
- `hybridPlusBarnesHutStrength`

Auto-gating thresholds are configurable via:

- `hybridPlusBarnesHutAutoParticleThreshold`
- `hybridPlusBarnesHutAutoStepMsThreshold`

## Next Integration Steps

1. Extend delta payloads beyond position (`velocityDelta`, `vorticityDelta`, `topologyEvents`).
2. Add GPU Barnes-Hut path (or mixed tree traversal) and compare crossover thresholds.
3. Add operator-level diagnostics (cost, delta count, acceptance/reject rates).
4. Add auto-threshold adaptation strategy (online calibration instead of static thresholds).
