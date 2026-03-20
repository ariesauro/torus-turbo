// Common WGSL definitions shared across all compute shaders.
// Must match torus-physics GpuParticle (96B) and GpuSimParams (176B).

struct ParticleData {
  positionLife    : vec4<f32>,   // x, y, z, life
  velocityAge     : vec4<f32>,   // vx, vy, vz, age
  angleState      : vec4<f32>,   // theta, phi, jetPsi, hasInjectedTwist
  vorticityGamma  : vec4<f32>,   // ωx, ωy, ωz, γ
  coreFlow        : vec4<f32>,   // σ, flowVx, flowVy, flowVz
  identity        : vec4<f32>,   // id, injectVx, injectVy, injectVz
}

struct SimParams {
  values : array<vec4<f32>, 11>,
}

struct CounterData {
  activeCount      : atomic<u32>,
  overflow         : atomic<u32>,
  collisions       : atomic<u32>,
  occupiedBuckets  : atomic<u32>,
  diagEnergyFP     : atomic<u32>,
  diagEnstrophyFP  : atomic<u32>,
  diagCirculationFP: atomic<u32>,
  diagMaxSpeedFP   : atomic<u32>,
}

// --- SimParams accessors ---

fn paramDt(p: SimParams) -> f32 { return p.values[0].x; }
fn paramCount(p: SimParams) -> u32 { return u32(p.values[0].y); }
fn paramPulseDuration(p: SimParams) -> f32 { return p.values[0].z; }
fn paramTimeScale(p: SimParams) -> f32 { return p.values[0].w; }
fn paramViscosity(p: SimParams) -> f32 { return p.values[2].y; }
fn paramGamma(p: SimParams) -> f32 { return p.values[2].z; }
fn paramUseBiotSavart(p: SimParams) -> bool { return p.values[2].w > 0.5; }
fn paramStretchingStrength(p: SimParams) -> f32 { return p.values[5].x; }
fn paramReconnectionDistance(p: SimParams) -> f32 { return p.values[5].y; }
fn paramMinCoreRadius(p: SimParams) -> f32 { return p.values[5].z; }
fn paramMaxVelocity(p: SimParams) -> f32 { return p.values[6].x; }
fn paramMaxVorticity(p: SimParams) -> f32 { return p.values[6].y; }
fn paramGridCellSize(p: SimParams) -> f32 { return p.values[6].z; }
fn paramNeighborCellRadius(p: SimParams) -> u32 { return u32(p.values[6].w); }
fn paramHashTableSize(p: SimParams) -> u32 { return u32(p.values[7].x); }
fn paramBucketCapacity(p: SimParams) -> u32 { return u32(p.values[7].y); }
fn paramInteractionRadius(p: SimParams) -> f32 { return p.values[7].z; }
fn paramVpmEnabled(p: SimParams) -> bool { return p.values[7].w > 0.5; }
fn paramReconnectionMinAge(p: SimParams) -> f32 { return p.values[8].y; }
fn paramVorticityConfinementStrength(p: SimParams) -> f32 { return p.values[9].z; }
fn paramCoreRadiusSigma(p: SimParams) -> f32 { return p.values[9].w; }
fn paramLesEnabled(p: SimParams) -> bool { return p.values[10].x > 0.5; }
fn paramLesSmagorinskyCs(p: SimParams) -> f32 { return p.values[10].y; }

// --- Hash grid ---

fn positionToCell(pos: vec3<f32>, cellSize: f32) -> vec3<i32> {
  return vec3<i32>(floor(pos / cellSize));
}

fn hashCell(cell: vec3<i32>, hashTableSize: u32) -> u32 {
  let h = u32(cell.x) * 73856093u
        ^ u32(cell.y) * 19349663u
        ^ u32(cell.z) * 83492791u;
  return h & (hashTableSize - 1u);
}

// --- Utility ---

const FOUR_PI: f32 = 12.566370614359172;
