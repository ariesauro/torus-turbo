import { getNaturalBiotSavartModulationWgsl } from './naturalBiotSavartModulation'

const FLOATS_PER_PARTICLE = 24
const BYTES_PER_PARTICLE = FLOATS_PER_PARTICLE * 4
const WORKGROUP_SIZE = 64
const PARAM_VEC4_COUNT = 11
const PARAM_BUFFER_SIZE = PARAM_VEC4_COUNT * 4 * 4
const UINT_BYTES = 4
const EMPTY_INDEX = 0xffffffff
const DEFAULT_FULL_READBACK_INTERVAL = 4
const DEFAULT_DIAGNOSTICS_INTERVAL = 2
const DEFAULT_DIAGNOSTICS_SAMPLE_LIMIT = 192
const MAX_DYNAMIC_BUCKET_CAPACITY = 256
const MAX_DYNAMIC_HASH_TABLE_SIZE = 1 << 20
const OVERFLOW_ADAPT_COOLDOWN_STEPS = 24
const MIN_LOW_PRESSURE_STREAK_FOR_SHRINK = 40
const COUNTER_FIELD_COUNT = 8
const COUNTER_BUFFER_SIZE = UINT_BYTES * COUNTER_FIELD_COUNT
const COUPLING_QUERY_POINT_STRIDE_FLOATS = 4
const COUPLING_QUERY_BYTES_PER_POINT = COUPLING_QUERY_POINT_STRIDE_FLOATS * 4
const COUPLING_QUERY_WORKGROUP_SIZE = 64

function normalizeCouplingQueryPoints(pointsInput, pointStrideFloats = COUPLING_QUERY_POINT_STRIDE_FLOATS) {
  const stride = Math.max(3, Math.floor(pointStrideFloats))
  if (pointsInput instanceof Float32Array) {
    const count = Math.floor(pointsInput.length / stride)
    if (count <= 0) {
      return { packedPoints: new Float32Array(0), count: 0, stride }
    }
    const packedPoints = new Float32Array(count * stride)
    packedPoints.set(pointsInput.subarray(0, count * stride))
    return { packedPoints, count, stride }
  }

  if (!Array.isArray(pointsInput) || pointsInput.length === 0) {
    return { packedPoints: new Float32Array(0), count: 0, stride }
  }

  const packedPoints = new Float32Array(pointsInput.length * stride)
  for (let i = 0; i < pointsInput.length; i += 1) {
    const base = i * stride
    const point = pointsInput[i] ?? {}
    packedPoints[base + 0] = Number.isFinite(point.x) ? point.x : 0
    packedPoints[base + 1] = Number.isFinite(point.y) ? point.y : 0
    packedPoints[base + 2] = Number.isFinite(point.z) ? point.z : 0
    if (stride > 3) {
      packedPoints[base + 3] = Number.isFinite(point.w) ? point.w : 0
    }
  }
  return { packedPoints, count: pointsInput.length, stride }
}

function createCouplingQueryShader() {
  return `
struct ParticleData {
  positionLife : vec4<f32>,
  velocityAge : vec4<f32>,
  angleState : vec4<f32>,
  vorticityGamma : vec4<f32>,
  coreFlow : vec4<f32>,
  identity : vec4<f32>,
}

struct SimParams {
  values : array<vec4<f32>, ${PARAM_VEC4_COUNT}>,
}

@group(0) @binding(0) var<storage, read> srcParticles : array<ParticleData>;
@group(0) @binding(1) var<storage, read> simParams : SimParams;
@group(0) @binding(2) var<storage, read_write> gridCounts : array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> gridIndices : array<u32>;
@group(0) @binding(4) var<storage, read> queryPoints : array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> queryVelocities : array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> querySampleCounts : array<u32>;

fn particleCount() -> u32 { return u32(simParams.values[0].y); }
fn minCoreRadius() -> f32 { return simParams.values[5].z; }
fn gridCellSize() -> f32 { return simParams.values[6].z; }
fn neighborCellRadius() -> i32 { return i32(simParams.values[6].w); }
fn hashTableSize() -> u32 { return u32(simParams.values[7].x); }
fn bucketCapacity() -> u32 { return u32(simParams.values[7].y); }
fn interactionRadius() -> f32 { return simParams.values[7].z; }

fn positionToCell(position : vec3<f32>) -> vec3<i32> {
  let scale = max(gridCellSize(), 1e-4);
  return vec3<i32>(
    i32(floor(position.x / scale)),
    i32(floor(position.y / scale)),
    i32(floor(position.z / scale))
  );
}

fn sameCell(a : vec3<i32>, b : vec3<i32>) -> bool {
  return a.x == b.x && a.y == b.y && a.z == b.z;
}

fn hashCell(cell : vec3<i32>) -> u32 {
  let x = u32(bitcast<u32>(cell.x)) * 73856093u;
  let y = u32(bitcast<u32>(cell.y)) * 19349663u;
  let z = u32(bitcast<u32>(cell.z)) * 83492791u;
  return (x ^ y ^ z) & (hashTableSize() - 1u);
}

@compute @workgroup_size(${COUPLING_QUERY_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  let pointIndex = globalId.x;
  let pointCount = arrayLength(&queryPoints);
  if (pointIndex >= pointCount) {
    return;
  }

  let particleCountValue = particleCount();
  let point = queryPoints[pointIndex].xyz;
  let baseCell = positionToCell(point);
  let cellRange = neighborCellRadius();
  let radius = max(interactionRadius(), gridCellSize());
  let radius2 = radius * radius;
  var flow = vec3<f32>(0.0, 0.0, 0.0);
  var sampleCount = 0u;

  for (var oz : i32 = -cellRange; oz <= cellRange; oz = oz + 1) {
    for (var oy : i32 = -cellRange; oy <= cellRange; oy = oy + 1) {
      for (var ox : i32 = -cellRange; ox <= cellRange; ox = ox + 1) {
        let neighborCell = baseCell + vec3<i32>(ox, oy, oz);
        let bucket = hashCell(neighborCell);
        let bucketCount = min(atomicLoad(&gridCounts[bucket]), bucketCapacity());

        for (var slot : u32 = 0u; slot < bucketCount; slot = slot + 1u) {
          let particleIndex = gridIndices[bucket * bucketCapacity() + slot];
          if (particleIndex >= particleCountValue) {
            continue;
          }
          let particle = srcParticles[particleIndex];
          if (!sameCell(positionToCell(particle.positionLife.xyz), neighborCell)) {
            continue;
          }

          let r = point - particle.positionLife.xyz;
          let r2 = dot(r, r);
          if (r2 > radius2) {
            continue;
          }

          let sigma = max(particle.coreFlow.x, max(minCoreRadius(), 1e-4));
          let denom = pow(r2 + sigma * sigma, 1.5);
          if (denom <= 1e-8) {
            continue;
          }

          let factor = particle.vorticityGamma.w / (4.0 * 3.141592653589793 * denom);
          flow = flow + cross(r, particle.vorticityGamma.xyz) * factor;
          sampleCount = sampleCount + 1u;
        }
      }
    }
  }

  queryVelocities[pointIndex] = vec4<f32>(flow, f32(sampleCount));
  querySampleCounts[pointIndex] = sampleCount;
}`
}

function nextPowerOfTwo(value) {
  let result = 1
  while (result < value) {
    result <<= 1
  }
  return result
}

function getBucketCapacity(params) {
  return Math.max(
    16,
    Math.min(MAX_DYNAMIC_BUCKET_CAPACITY, Math.floor((params.gpuChunkSize ?? 96) / 2)),
  )
}

function getGridCellSize(params) {
  const sigma = Math.max(params.coreRadiusSigma ?? params.minCoreRadius ?? 0.03, 1e-4)
  const multiplier = Math.max(params.cellSizeMultiplier ?? 4, 1)
  return Math.max(sigma * multiplier, 0.01)
}

function getNeighborCellRadius(params) {
  return Math.max(1, Math.floor(params.neighborCellRange ?? 1))
}

function getHashTableSize(capacity) {
  return nextPowerOfTwo(Math.max(1024, capacity * 4))
}

function shouldRunNaturalGuidancePass(params) {
  if (params.dynamicsMode !== 'guidedPhysics') {
    return true
  }

  // Priority rule: in Natural mode with Biot-Savart+VPM, guidance comes
  // from circulation-direction control inside computeFlow, not position pull.
  return !(params.vpmEnabled && params.useBiotSavart)
}

function createCommonShaderPrelude() {
  return `
struct ParticleData {
  positionLife : vec4<f32>,
  velocityAge : vec4<f32>,
  angleState : vec4<f32>,
  vorticityGamma : vec4<f32>,
  coreFlow : vec4<f32>,
  identity : vec4<f32>,
}

struct SimParams {
  values : array<vec4<f32>, ${PARAM_VEC4_COUNT}>,
}

struct CounterData {
  value : atomic<u32>,
  overflow : atomic<u32>,
  collisions : atomic<u32>,
  occupiedBuckets : atomic<u32>,
  diagEnergyFP : atomic<u32>,
  diagEnstrophyFP : atomic<u32>,
  diagCirculationFP : atomic<u32>,
  diagMaxSpeedFP : atomic<u32>,
}

@group(0) @binding(0) var<storage, read> srcParticles : array<ParticleData>;
@group(0) @binding(1) var<storage, read_write> dstParticles : array<ParticleData>;
@group(0) @binding(2) var<storage, read> simParams : SimParams;
@group(0) @binding(3) var<storage, read_write> gridCounts : array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> gridIndices : array<u32>;
@group(0) @binding(5) var<storage, read_write> mergeTarget : array<u32>;
@group(0) @binding(6) var<storage, read_write> mergeOwner : array<u32>;
@group(0) @binding(7) var<storage, read_write> aliveFlags : array<u32>;
@group(0) @binding(8) var<storage, read_write> counter : CounterData;

fn dt() -> f32 { return simParams.values[0].x; }
fn particleCount() -> u32 { return u32(simParams.values[0].y); }
fn pulseDuration() -> f32 { return simParams.values[0].z; }
fn timeScale() -> f32 { return simParams.values[0].w; }
fn nozzleX() -> f32 { return simParams.values[1].x; }
fn alpha() -> f32 { return simParams.values[1].y; }
fn thetaSpeed() -> f32 { return simParams.values[1].z; }
fn ringMajor() -> f32 { return simParams.values[1].w; }
fn ringMinor() -> f32 { return simParams.values[2].x; }
fn viscosity() -> f32 { return simParams.values[2].y; }
fn gammaParam() -> f32 { return simParams.values[2].z; }
fn useBiotSavart() -> bool { return simParams.values[2].w > 0.5; }
fn twistCoreRadius() -> f32 { return simParams.values[3].x; }
fn twistAxialDecay() -> f32 { return simParams.values[3].y; }
fn twistToRingCoupling() -> f32 { return simParams.values[3].z; }
fn jetSpeed() -> f32 { return simParams.values[3].w; }
fn jetTwist() -> f32 { return simParams.values[4].x; }
fn spinSign() -> f32 { return simParams.values[4].y; }
fn flipSign() -> f32 { return simParams.values[4].z; }
fn reverseFactor() -> f32 { return simParams.values[4].w; }
fn stretchingStrength() -> f32 { return simParams.values[5].x; }
fn reconnectionDistance() -> f32 { return simParams.values[5].y; }
fn minCoreRadius() -> f32 { return simParams.values[5].z; }
fn diffusionViscosity() -> f32 { return simParams.values[5].w; }
fn maxVelocity() -> f32 { return simParams.values[6].x; }
fn maxVorticity() -> f32 { return simParams.values[6].y; }
fn gridCellSize() -> f32 { return simParams.values[6].z; }
fn neighborCellRadius() -> i32 { return i32(simParams.values[6].w); }
fn hashTableSize() -> u32 { return u32(simParams.values[7].x); }
fn bucketCapacity() -> u32 { return u32(simParams.values[7].y); }
fn interactionRadius() -> f32 { return simParams.values[7].z; }
fn vpmEnabled() -> bool { return simParams.values[7].w > 0.5; }
fn scriptedDynamics() -> bool { return simParams.values[8].x > 0.5; }
fn reconnectionMinAge() -> f32 { return simParams.values[8].y; }
fn autoCoreRadiusEnabled() -> bool { return simParams.values[8].z >= 0.0; }
fn sigmaRatio() -> f32 { return abs(simParams.values[8].z); }
fn maxSigmaRatio() -> f32 { return simParams.values[8].w; }
fn guidedDynamics() -> bool { return simParams.values[9].x > 0.5; }
fn guidedStrength() -> f32 { return simParams.values[9].y; }
fn vorticityConfinementStrength() -> f32 { return simParams.values[9].z; }
fn coreRadiusSigmaParam() -> f32 { return simParams.values[9].w; }
fn lesEnabled() -> bool { return simParams.values[10].x > 0.5; }
fn lesSmagorinskyCs() -> f32 { return simParams.values[10].y; }
fn emptyIndex() -> u32 { return ${EMPTY_INDEX}u; }

fn injectedVelocityWeight(age : f32) -> f32 {
  let duration = max(pulseDuration(), 1e-4);
  if (age >= duration) {
    return 0.0;
  }

  return max(0.0, 1.0 - age / duration);
}

fn copyParticle(index : u32) -> ParticleData {
  return srcParticles[index];
}

fn positionToCell(position : vec3<f32>) -> vec3<i32> {
  let scale = max(gridCellSize(), 1e-4);
  return vec3<i32>(
    i32(floor(position.x / scale)),
    i32(floor(position.y / scale)),
    i32(floor(position.z / scale))
  );
}

fn sameCell(a : vec3<i32>, b : vec3<i32>) -> bool {
  return a.x == b.x && a.y == b.y && a.z == b.z;
}

fn hashCell(cell : vec3<i32>) -> u32 {
  let x = u32(bitcast<u32>(cell.x)) * 73856093u;
  let y = u32(bitcast<u32>(cell.y)) * 19349663u;
  let z = u32(bitcast<u32>(cell.z)) * 83492791u;
  return (x ^ y ^ z) & (hashTableSize() - 1u);
}

fn clampMagnitude(vector : vec3<f32>, maxValue : f32) -> vec3<f32> {
  if (maxValue <= 0.0) {
    return vector;
  }

  let lengthValue = length(vector);
  if (lengthValue <= maxValue || lengthValue <= 1e-8) {
    return vector;
  }

  return vector * (maxValue / lengthValue);
}
${getNaturalBiotSavartModulationWgsl()}
`
}

function createClearGridShader() {
  return `${createCommonShaderPrelude()}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  let index = globalId.x;
  if (index >= hashTableSize()) {
    return;
  }
  atomicStore(&gridCounts[index], 0u);
}`
}

function createBinParticlesShader() {
  return `${createCommonShaderPrelude()}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  let index = globalId.x;
  let count = particleCount();
  if (index >= count) {
    return;
  }

  let particle = srcParticles[index];
  let bucket = hashCell(positionToCell(particle.positionLife.xyz));
  let slot = atomicAdd(&gridCounts[bucket], 1u);
  if (slot == 0u) {
    atomicAdd(&counter.occupiedBuckets, 1u);
  } else {
    atomicAdd(&counter.collisions, 1u);
  }
  if (slot < bucketCapacity()) {
    gridIndices[bucket * bucketCapacity() + slot] = index;
  } else {
    atomicAdd(&counter.overflow, 1u);
  }
}`
}

function createBaseUpdateShader() {
  return `${createCommonShaderPrelude()}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  let index = globalId.x;
  let count = particleCount();
  if (index >= count) {
    return;
  }
  if (index == 0u) {
    atomicStore(&counter.overflow, 0u);
    atomicStore(&counter.collisions, 0u);
    atomicStore(&counter.occupiedBuckets, 0u);
  }

  var particle = copyParticle(index);
  let dtValue = dt();
  let oldPos = particle.positionLife.xyz;
  var newPos = oldPos;
  var life = particle.positionLife.w + dtValue * reverseFactor();
  var age = particle.velocityAge.w + dtValue;
  var theta = particle.angleState.x;
  var phi = particle.angleState.y;
  var jetPsi = particle.angleState.z;
  var hasInjected = particle.angleState.w;
  var vorticity = particle.vorticityGamma.xyz;
  let gamma = particle.vorticityGamma.w;
  let minCore = max(minCoreRadius(), 1e-4);
  let coreRadius = max(particle.coreFlow.x, minCore);

  if (scriptedDynamics()) {
    if (life < max(pulseDuration(), 1e-4)) {
      let dx = oldPos.x;
      let dy = oldPos.y;
      let r = max(sqrt(dx * dx + dy * dy), 1e-4);
      let psi = atan2(dy, dx);
      let rc = max(twistCoreRadius(), 1e-4);
      let beta = max(twistAxialDecay(), 0.0);
      let zOffset = max(oldPos.z - nozzleX(), 0.0);
      let profile = 1.0 - exp(-pow(r / rc, 2.0));
      let vtBase = (jetTwist() / (2.0 * 3.141592653589793 * r)) * profile;
      let vt = vtBase * exp(-beta * zOffset);

      newPos.x = oldPos.x + (-vt * sin(psi)) * dtValue;
      newPos.y = oldPos.y + (vt * cos(psi)) * dtValue;
      newPos.z = oldPos.z + jetSpeed() * dtValue;

      let angularRate = vt / r;
      jetPsi = jetPsi + angularRate * dtValue;
      vorticity.z = angularRate * 2.0;
    } else {
      if (hasInjected < 0.5) {
        phi = phi + twistToRingCoupling() * jetPsi;
        hasInjected = 1.0;
      }

      let omega = thetaSpeed();
      let vTheta = omega * cos(alpha());
      let vPhi = omega * sin(alpha());

      theta = theta + vTheta * spinSign();
      phi = phi + vPhi * flipSign();

      let rt = ringMajor() + ringMinor() * cos(phi);
      let tx = rt * cos(theta);
      let ty = rt * sin(theta);
      let tz = ringMinor() * sin(phi);

      newPos.x = oldPos.x + (tx - oldPos.x) * (1.0 - viscosity());
      newPos.y = oldPos.y + (ty - oldPos.y) * (1.0 - viscosity());
      newPos.z = oldPos.z + (tz - oldPos.z) * (1.0 - viscosity());

      if (useBiotSavart()) {
        let R = max(ringMajor(), 1e-4);
        let a = max(ringMinor(), 1e-4);
        let logArg = (8.0 * R) / a;
        if (logArg > 0.0) {
          let U = (gammaParam() / (4.0 * 3.141592653589793 * R)) * (log(logArg) - 0.25);
          newPos.z = newPos.z + U;
        }
      }
    }
  }

  particle.positionLife = vec4<f32>(newPos, life);
  if (scriptedDynamics()) {
    particle.velocityAge = vec4<f32>(newPos - oldPos, age);
  } else {
    particle.velocityAge = vec4<f32>(particle.velocityAge.xyz, age);
  }
  particle.angleState = vec4<f32>(theta, phi, jetPsi, hasInjected);
  particle.vorticityGamma = vec4<f32>(vorticity, gamma);
  particle.coreFlow = vec4<f32>(coreRadius, 0.0, 0.0, 0.0);
  dstParticles[index] = particle;
}`
}

function createComputeFlowShader() {
  return `${createCommonShaderPrelude()}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  let index = globalId.x;
  let count = particleCount();
  if (index >= count) {
    return;
  }

  var particle = copyParticle(index);
  let injectionWeight = injectedVelocityWeight(particle.velocityAge.w);
  var flow = vec3<f32>(
    particle.identity.y,
    particle.identity.z,
    particle.identity.w,
  ) * injectionWeight;

  if (useBiotSavart()) {
    let pos = particle.positionLife.xyz;
    let baseCell = positionToCell(pos);
    let radius = max(interactionRadius(), gridCellSize());
    let radius2 = radius * radius;
    let cellRange = neighborCellRadius();

    for (var oz : i32 = -cellRange; oz <= cellRange; oz = oz + 1) {
      for (var oy : i32 = -cellRange; oy <= cellRange; oy = oy + 1) {
        for (var ox : i32 = -cellRange; ox <= cellRange; ox = ox + 1) {
          let neighborCell = baseCell + vec3<i32>(ox, oy, oz);
          let bucket = hashCell(neighborCell);
          let bucketCount = min(atomicLoad(&gridCounts[bucket]), bucketCapacity());

          for (var slot : u32 = 0u; slot < bucketCount; slot = slot + 1u) {
            let candidateIndex = gridIndices[bucket * bucketCapacity() + slot];
            if (candidateIndex == index || candidateIndex >= count) {
              continue;
            }

            let other = srcParticles[candidateIndex];
            if (!sameCell(positionToCell(other.positionLife.xyz), neighborCell)) {
              continue;
            }

            let r = pos - other.positionLife.xyz;
            let r2 = dot(r, r);
            if (r2 > radius2) {
              continue;
            }

            let sigma = max(other.coreFlow.x, minCoreRadius());
            let denom = pow(r2 + sigma * sigma, 1.5);
            if (denom <= 1e-8) {
              continue;
            }

            let controlledOmega = controlNaturalCirculationDirection(
              other.positionLife.xyz,
              other.vorticityGamma.xyz
            );
            let factor = other.vorticityGamma.w / (4.0 * 3.141592653589793 * denom);
            flow = flow + cross(r, controlledOmega) * factor;
          }
        }
      }
    }
  } else {
    flow = flow + particle.velocityAge.xyz / max(timeScale(), 1e-4);
  }

  particle.coreFlow = vec4<f32>(particle.coreFlow.x, flow.x, flow.y, flow.z);
  dstParticles[index] = particle;
}`
}

function createVorticityConfinementShader() {
  return `${createCommonShaderPrelude()}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  let index = globalId.x;
  let count = particleCount();
  if (index >= count) {
    return;
  }

  var particle = copyParticle(index);
  let strength = vorticityConfinementStrength();
  if (abs(strength) <= 1e-6 || count <= 1u) {
    dstParticles[index] = particle;
    return;
  }

  let pos = particle.positionLife.xyz;
  let omega = particle.vorticityGamma.xyz;
  let omegaMag = length(omega);
  if (omegaMag <= 1e-6) {
    dstParticles[index] = particle;
    return;
  }

  let baseCell = positionToCell(pos);
  let radius = max(interactionRadius(), gridCellSize());
  let radius2 = radius * radius;
  let cellRange = neighborCellRadius();
  var grad = vec3<f32>(0.0, 0.0, 0.0);

  for (var oz : i32 = -cellRange; oz <= cellRange; oz = oz + 1) {
    for (var oy : i32 = -cellRange; oy <= cellRange; oy = oy + 1) {
      for (var ox : i32 = -cellRange; ox <= cellRange; ox = ox + 1) {
        let neighborCell = baseCell + vec3<i32>(ox, oy, oz);
        let bucket = hashCell(neighborCell);
        let bucketCount = min(atomicLoad(&gridCounts[bucket]), bucketCapacity());

        for (var slot : u32 = 0u; slot < bucketCount; slot = slot + 1u) {
          let candidateIndex = gridIndices[bucket * bucketCapacity() + slot];
          if (candidateIndex == index || candidateIndex >= count) {
            continue;
          }

          let other = srcParticles[candidateIndex];
          if (!sameCell(positionToCell(other.positionLife.xyz), neighborCell)) {
            continue;
          }

          let r = other.positionLife.xyz - pos;
          let r2 = dot(r, r);
          if (r2 > radius2) {
            continue;
          }

          let rLen = sqrt(r2 + 1e-6);
          if (rLen <= 1e-6) {
            continue;
          }

          let sigma = max(other.coreFlow.x, max(coreRadiusSigmaParam(), minCoreRadius()));
          let influence = exp(-r2 / (2.0 * sigma * sigma));
          if (influence < 1e-4) {
            continue;
          }

          let domega = (length(other.vorticityGamma.xyz) - omegaMag) * influence;
          grad = grad + (r / rLen) * domega;
        }
      }
    }
  }

  let gradLen = length(grad);
  if (gradLen <= 1e-6) {
    dstParticles[index] = particle;
    return;
  }

  let normal = grad / gradLen;
  let confinement = cross(normal, omega);
  let scale = strength * max(gridCellSize(), 1e-4);
  let flow = vec3<f32>(particle.coreFlow.y, particle.coreFlow.z, particle.coreFlow.w) + confinement * scale;
  particle.coreFlow = vec4<f32>(particle.coreFlow.x, flow.x, flow.y, flow.z);
  dstParticles[index] = particle;
}`
}

function createStabilityShader() {
  return `${createCommonShaderPrelude()}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  let index = globalId.x;
  let count = particleCount();
  if (index >= count) {
    return;
  }

  var particle = copyParticle(index);
  let flow = clampMagnitude(vec3<f32>(particle.coreFlow.y, particle.coreFlow.z, particle.coreFlow.w), maxVelocity());
  let omega = clampMagnitude(particle.vorticityGamma.xyz, maxVorticity());
  let ringBasedSigma = max(ringMajor() * sigmaRatio(), minCoreRadius());
  let sigmaMax = max(ringMajor() * maxSigmaRatio(), minCoreRadius());
  var sigma = max(particle.coreFlow.x, minCoreRadius());
  if (autoCoreRadiusEnabled()) {
    sigma = ringBasedSigma;
  }
  sigma = min(max(sigma, minCoreRadius()), sigmaMax);
  particle.coreFlow = vec4<f32>(sigma, flow.x, flow.y, flow.z);
  particle.vorticityGamma = vec4<f32>(omega, particle.vorticityGamma.w);
  dstParticles[index] = particle;
}`
}

function createAdvectShader() {
  return `${createCommonShaderPrelude()}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  let index = globalId.x;
  let count = particleCount();
  if (index >= count) {
    return;
  }

  var particle = copyParticle(index);
  let flow = vec3<f32>(particle.coreFlow.y, particle.coreFlow.z, particle.coreFlow.w);
  let displacement = flow * dt();
  particle.positionLife = vec4<f32>(particle.positionLife.xyz + displacement, particle.positionLife.w);
  particle.velocityAge = vec4<f32>(displacement, particle.velocityAge.w);
  dstParticles[index] = particle;
}`
}

function createGuidanceShader() {
  return `${createCommonShaderPrelude()}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  let index = globalId.x;
  let count = particleCount();
  if (index >= count) {
    return;
  }

  var particle = copyParticle(index);
  if (!guidedDynamics() || guidedStrength() <= 0.0) {
    dstParticles[index] = particle;
    return;
  }

  let oldPos = particle.positionLife.xyz;
  let radial = max(length(oldPos.xy), 1e-4);
  let theta = atan2(oldPos.y, oldPos.x) + thetaSpeed() * cos(alpha()) * dt() * spinSign();
  let phi = atan2(oldPos.z, radial - max(ringMajor(), 1e-4)) +
    thetaSpeed() * sin(alpha()) * dt() * flipSign();
  let targetRt = ringMajor() + ringMinor() * cos(phi);
  let targetPos = vec3<f32>(
    targetRt * cos(theta),
    targetRt * sin(theta),
    ringMinor() * sin(phi)
  );
  let blend = min(guidedStrength() * dt() * 8.0, 1.0);
  let newPos = oldPos + (targetPos - oldPos) * blend;

  particle.positionLife = vec4<f32>(newPos, particle.positionLife.w);
  particle.velocityAge = vec4<f32>(newPos - oldPos, particle.velocityAge.w);
  dstParticles[index] = particle;
}`
}

function createStretchingShader() {
  return `${createCommonShaderPrelude()}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  let index = globalId.x;
  let count = particleCount();
  if (index >= count) {
    return;
  }

  let strength = max(stretchingStrength(), 0.0);
  var particle = copyParticle(index);
  if (strength <= 0.0 || count <= 1u) {
    dstParticles[index] = particle;
    return;
  }

  let FOUR_PI = 4.0 * 3.14159265358979;
  let pos = particle.positionLife.xyz;
  let omega = particle.vorticityGamma.xyz;
  let baseCell = positionToCell(pos);
  let radius = max(interactionRadius(), gridCellSize());
  let radius2 = radius * radius;
  let cellRange = neighborCellRadius();
  var dStretch = vec3<f32>(0.0, 0.0, 0.0);

  for (var oz : i32 = -cellRange; oz <= cellRange; oz = oz + 1) {
    for (var oy : i32 = -cellRange; oy <= cellRange; oy = oy + 1) {
      for (var ox : i32 = -cellRange; ox <= cellRange; ox = ox + 1) {
        let neighborCell = baseCell + vec3<i32>(ox, oy, oz);
        let bucket = hashCell(neighborCell);
        let bucketCount = min(atomicLoad(&gridCounts[bucket]), bucketCapacity());

        for (var slot : u32 = 0u; slot < bucketCount; slot = slot + 1u) {
          let candidateIndex = gridIndices[bucket * bucketCapacity() + slot];
          if (candidateIndex == index || candidateIndex >= count) {
            continue;
          }

          let other = srcParticles[candidateIndex];
          if (!sameCell(positionToCell(other.positionLife.xyz), neighborCell)) {
            continue;
          }

          let r = pos - other.positionLife.xyz;
          let r2 = dot(r, r);
          if (r2 > radius2) {
            continue;
          }

          let sigma = max(other.coreFlow.x, minCoreRadius());
          let sigma2 = sigma * sigma;
          let r2s2 = r2 + sigma2;
          if (r2s2 <= 1e-12) {
            continue;
          }

          let gammaJ = other.vorticityGamma.w;
          if (abs(gammaJ) <= 1e-10) {
            continue;
          }

          let otherOmega = other.vorticityGamma.xyz;
          let r2s2_15 = pow(r2s2, 1.5);
          let r2s2_25 = r2s2_15 * r2s2;

          let crossOmega = cross(omega, otherOmega);
          let omegaDotR = dot(omega, r);
          let rCrossOmega = cross(r, otherOmega);

          let f3 = gammaJ / (FOUR_PI * r2s2_15);
          let f5 = -3.0 * gammaJ * omegaDotR / (FOUR_PI * r2s2_25);

          dStretch = dStretch + f3 * crossOmega + f5 * rCrossOmega;
        }
      }
    }
  }

  particle.vorticityGamma = vec4<f32>(omega + dt() * strength * dStretch, particle.vorticityGamma.w);
  dstParticles[index] = particle;
}`
}

function createDiffusionShader() {
  return `${createCommonShaderPrelude()}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  let index = globalId.x;
  let count = particleCount();
  if (index >= count) {
    return;
  }

  let nuMol = diffusionViscosity();
  var particle = copyParticle(index);
  let useLes = lesEnabled();
  if (nuMol <= 0.0 && !useLes || count <= 1u) {
    dstParticles[index] = particle;
    return;
  }

  let pos = particle.positionLife.xyz;
  let omega = particle.vorticityGamma.xyz;
  let eps = max(coreRadiusSigmaParam(), minCoreRadius());
  let eps2 = eps * eps;
  let fourEps2 = 4.0 * eps2;
  let volume = eps * eps * eps;
  let kernelNorm = 1.0 / pow(4.0 * 3.14159265358979 * eps2, 1.5);

  // LES: estimate local strain rate for eddy viscosity
  var nuSgs : f32 = 0.0;
  if (useLes) {
    let cs = lesSmagorinskyCs();
    let csDelta2 = cs * eps * cs * eps;
    var sumS2 : f32 = 0.0;
    var wSum : f32 = 0.0;
    let fv = particle.velocityExtra.xyz;
    let cutoff2 = 16.0 * eps2;

    let sBaseCell = positionToCell(pos);
    let sCellRange = neighborCellRadius();
    for (var sz : i32 = -sCellRange; sz <= sCellRange; sz = sz + 1) {
      for (var sy : i32 = -sCellRange; sy <= sCellRange; sy = sy + 1) {
        for (var sx : i32 = -sCellRange; sx <= sCellRange; sx = sx + 1) {
          let sn = sBaseCell + vec3<i32>(sx, sy, sz);
          let sb = hashCell(sn);
          let sbc = min(atomicLoad(&gridCounts[sb]), bucketCapacity());
          for (var ss : u32 = 0u; ss < sbc; ss = ss + 1u) {
            let si = gridIndices[sb * bucketCapacity() + ss];
            if (si == index || si >= count) { continue; }
            let so = srcParticles[si];
            if (!sameCell(positionToCell(so.positionLife.xyz), sn)) { continue; }
            let sr = pos - so.positionLife.xyz;
            let sr2 = dot(sr, sr);
            if (sr2 > cutoff2 || sr2 < 1e-10) { continue; }
            let srl = sqrt(sr2);
            let dv = so.velocityExtra.xyz - fv;
            let dvdr = length(dv) / srl;
            let sw = exp(-sr2 / (2.0 * eps2));
            sumS2 += dvdr * dvdr * sw;
            wSum += sw;
          }
        }
      }
    }
    let strainRate = select(0.0, sqrt(sumS2 / wSum), wSum > 1e-8);
    nuSgs = csDelta2 * strainRate;
  }

  let viscosity = nuMol + nuSgs;
  let prefactor = 2.0 * viscosity * volume * kernelNorm / eps2;

  let baseCell = positionToCell(pos);
  let radius = max(interactionRadius(), gridCellSize());
  let radius2 = radius * radius;
  let cellRange = neighborCellRadius();
  var dOmega = vec3<f32>(0.0, 0.0, 0.0);

  for (var cz : i32 = -cellRange; cz <= cellRange; cz = cz + 1) {
    for (var cy : i32 = -cellRange; cy <= cellRange; cy = cy + 1) {
      for (var cx : i32 = -cellRange; cx <= cellRange; cx = cx + 1) {
        let neighborCell = baseCell + vec3<i32>(cx, cy, cz);
        let bucket = hashCell(neighborCell);
        let bucketCount = min(atomicLoad(&gridCounts[bucket]), bucketCapacity());

        for (var slot : u32 = 0u; slot < bucketCount; slot = slot + 1u) {
          let candidateIndex = gridIndices[bucket * bucketCapacity() + slot];
          if (candidateIndex == index || candidateIndex >= count) {
            continue;
          }

          let other = srcParticles[candidateIndex];
          if (!sameCell(positionToCell(other.positionLife.xyz), neighborCell)) {
            continue;
          }

          let r = pos - other.positionLife.xyz;
          let r2 = dot(r, r);
          if (r2 > radius2) {
            continue;
          }

          let expVal = exp(-r2 / fourEps2);
          if (expVal < 1e-6) {
            continue;
          }

          let otherOmega = other.vorticityGamma.xyz;
          let factor = prefactor * expVal;
          dOmega = dOmega + factor * (otherOmega - omega);
        }
      }
    }
  }

  particle.vorticityGamma = vec4<f32>(omega + dt() * dOmega, particle.vorticityGamma.w);
  dstParticles[index] = particle;
}`
}

function createFindMergeTargetShader() {
  return `${createCommonShaderPrelude()}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  let index = globalId.x;
  let count = particleCount();
  if (index >= count) {
    return;
  }

  let threshold = max(reconnectionDistance(), 0.0);
  if (threshold <= 0.0) {
    mergeTarget[index] = emptyIndex();
    return;
  }

  let particle = srcParticles[index];
  if (particle.velocityAge.w < reconnectionMinAge()) {
    mergeTarget[index] = emptyIndex();
    return;
  }

  let pos = particle.positionLife.xyz;
  let baseCell = positionToCell(pos);
  let threshold2 = threshold * threshold;
  let cellRange = max(1, i32(ceil(threshold / max(gridCellSize(), 1e-4))));
  var bestIndex = emptyIndex();
  var bestDistance = threshold2;

  for (var oz : i32 = -cellRange; oz <= cellRange; oz = oz + 1) {
    for (var oy : i32 = -cellRange; oy <= cellRange; oy = oy + 1) {
      for (var ox : i32 = -cellRange; ox <= cellRange; ox = ox + 1) {
        let neighborCell = baseCell + vec3<i32>(ox, oy, oz);
        let bucket = hashCell(neighborCell);
        let bucketCount = min(atomicLoad(&gridCounts[bucket]), bucketCapacity());

        for (var slot : u32 = 0u; slot < bucketCount; slot = slot + 1u) {
          let candidateIndex = gridIndices[bucket * bucketCapacity() + slot];
          if (candidateIndex <= index || candidateIndex >= count) {
            continue;
          }

          let other = srcParticles[candidateIndex];
          if (other.velocityAge.w < reconnectionMinAge()) {
            continue;
          }
          if (!sameCell(positionToCell(other.positionLife.xyz), neighborCell)) {
            continue;
          }

          let delta = other.positionLife.xyz - pos;
          let distance2 = dot(delta, delta);
          if (distance2 >= bestDistance) {
            continue;
          }

          bestDistance = distance2;
          bestIndex = candidateIndex;
        }
      }
    }
  }

  mergeTarget[index] = bestIndex;
}`
}

function createResolveMergeOwnerShader() {
  return `${createCommonShaderPrelude()}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  let index = globalId.x;
  let count = particleCount();
  if (index >= count) {
    return;
  }

  let particle = srcParticles[index];
  if (particle.velocityAge.w < reconnectionMinAge()) {
    mergeOwner[index] = emptyIndex();
    return;
  }
  let pos = particle.positionLife.xyz;
  let baseCell = positionToCell(pos);
  let threshold = max(reconnectionDistance(), 0.0);
  let cellRange = max(1, i32(ceil(threshold / max(gridCellSize(), 1e-4))));
  var owner = emptyIndex();

  for (var oz : i32 = -cellRange; oz <= cellRange; oz = oz + 1) {
    for (var oy : i32 = -cellRange; oy <= cellRange; oy = oy + 1) {
      for (var ox : i32 = -cellRange; ox <= cellRange; ox = ox + 1) {
        let neighborCell = baseCell + vec3<i32>(ox, oy, oz);
        let bucket = hashCell(neighborCell);
        let bucketCount = min(atomicLoad(&gridCounts[bucket]), bucketCapacity());

        for (var slot : u32 = 0u; slot < bucketCount; slot = slot + 1u) {
          let candidateIndex = gridIndices[bucket * bucketCapacity() + slot];
          if (candidateIndex >= index || candidateIndex >= count) {
            continue;
          }

          let other = srcParticles[candidateIndex];
          if (other.velocityAge.w < reconnectionMinAge()) {
            continue;
          }
          if (!sameCell(positionToCell(other.positionLife.xyz), neighborCell)) {
            continue;
          }

          if (mergeTarget[candidateIndex] != index) {
            continue;
          }

          if (owner == emptyIndex() || candidateIndex < owner) {
            owner = candidateIndex;
          }
        }
      }
    }
  }

  mergeOwner[index] = owner;
}`
}

function createMergeParticlesShader() {
  return `${createCommonShaderPrelude()}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  let index = globalId.x;
  let count = particleCount();
  if (index >= count) {
    return;
  }

  let owner = mergeOwner[index];
  var particle = srcParticles[index];

  if (owner != emptyIndex()) {
    aliveFlags[index] = 0u;
    dstParticles[index] = particle;
    return;
  }

  let targetIndex = mergeTarget[index];
  if (targetIndex != emptyIndex() && targetIndex < count && mergeOwner[targetIndex] == index) {
    let other = srcParticles[targetIndex];
    let selfWeight = abs(particle.vorticityGamma.w) + 1e-6;
    let otherWeight = abs(other.vorticityGamma.w) + 1e-6;
    let totalWeight = selfWeight + otherWeight;

    particle.positionLife = vec4<f32>(
      (particle.positionLife.xyz * selfWeight + other.positionLife.xyz * otherWeight) / totalWeight,
      particle.positionLife.w
    );
    particle.vorticityGamma = vec4<f32>(
      particle.vorticityGamma.xyz + other.vorticityGamma.xyz,
      particle.vorticityGamma.w + other.vorticityGamma.w
    );
    particle.coreFlow.x = (particle.coreFlow.x + other.coreFlow.x) * 0.5;
  }

  aliveFlags[index] = 1u;
  dstParticles[index] = particle;
}`
}

function createClearCounterShader() {
  return `${createCommonShaderPrelude()}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  if (globalId.x == 0u) {
    atomicStore(&counter.value, 0u);
    atomicStore(&counter.diagEnergyFP, 0u);
    atomicStore(&counter.diagEnstrophyFP, 0u);
    atomicStore(&counter.diagCirculationFP, 0u);
    atomicStore(&counter.diagMaxSpeedFP, 0u);
  }
}`
}

function createCompactShader() {
  return `${createCommonShaderPrelude()}

const DIAG_FP_SCALE : f32 = 1000.0;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId : vec3<u32>) {
  let index = globalId.x;
  let count = particleCount();
  if (index >= count) {
    return;
  }

  if (aliveFlags[index] == 0u) {
    return;
  }

  let p = srcParticles[index];
  let dstIndex = atomicAdd(&counter.value, 1u);
  dstParticles[dstIndex] = p;

  let flow = vec3<f32>(p.coreFlow.y, p.coreFlow.z, p.coreFlow.w);
  let speed2 = dot(flow, flow);
  let energy_fp = u32(clamp(0.5 * speed2 * DIAG_FP_SCALE, 0.0, 4294967000.0));
  atomicAdd(&counter.diagEnergyFP, energy_fp);

  let omega = p.vorticityGamma.xyz;
  let enstrophy_fp = u32(clamp(dot(omega, omega) * DIAG_FP_SCALE, 0.0, 4294967000.0));
  atomicAdd(&counter.diagEnstrophyFP, enstrophy_fp);

  let gamma = p.vorticityGamma.w;
  let circ_fp = u32(clamp(abs(gamma) * DIAG_FP_SCALE, 0.0, 4294967000.0));
  atomicAdd(&counter.diagCirculationFP, circ_fp);

  let speed_fp = u32(clamp(sqrt(speed2) * DIAG_FP_SCALE, 0.0, 4294967000.0));
  atomicMax(&counter.diagMaxSpeedFP, speed_fp);
}`
}

function packParticles(particles) {
  const packed = new Float32Array(Math.max(1, particles.length) * FLOATS_PER_PARTICLE)

  for (let i = 0; i < particles.length; i += 1) {
    const particle = particles[i]
    const base = i * FLOATS_PER_PARTICLE

    packed[base + 0] = particle.x
    packed[base + 1] = particle.y
    packed[base + 2] = particle.z
    packed[base + 3] = particle.life ?? 0

    packed[base + 4] = particle.vx ?? 0
    packed[base + 5] = particle.vy ?? 0
    packed[base + 6] = particle.vz ?? 0
    packed[base + 7] = particle.age ?? 0

    packed[base + 8] = particle.theta ?? 0
    packed[base + 9] = particle.phi ?? 0
    packed[base + 10] = particle.jetPsi ?? 0
    packed[base + 11] = particle.hasInjectedTwist ? 1 : 0

    packed[base + 12] = particle.vorticity?.x ?? 0
    packed[base + 13] = particle.vorticity?.y ?? 0
    packed[base + 14] = particle.vorticity?.z ?? 0
    packed[base + 15] = particle.gamma ?? 0

    packed[base + 16] = particle.coreRadius ?? 0
    packed[base + 17] = particle.flowVx ?? 0
    packed[base + 18] = particle.flowVy ?? 0
    packed[base + 19] = particle.flowVz ?? 0

    packed[base + 20] = particle.id ?? i
    packed[base + 21] = particle.injectVx ?? particle.vx ?? 0
    packed[base + 22] = particle.injectVy ?? particle.vy ?? 0
    packed[base + 23] = particle.injectVz ?? particle.vz ?? 0
  }

  return packed
}

function applyParticleFields(target, packed, base) {
  target.px = target.x ?? packed[base + 0]
  target.py = target.y ?? packed[base + 1]
  target.pz = target.z ?? packed[base + 2]

  target.id = packed[base + 20]
  target.x = packed[base + 0]
  target.y = packed[base + 1]
  target.z = packed[base + 2]
  target.life = packed[base + 3]
  target.vx = packed[base + 4]
  target.vy = packed[base + 5]
  target.vz = packed[base + 6]
  target.age = packed[base + 7]
  target.theta = packed[base + 8]
  target.phi = packed[base + 9]
  target.jetPsi = packed[base + 10]
  target.hasInjectedTwist = packed[base + 11] > 0.5
  target.gamma = packed[base + 15]
  target.coreRadius = packed[base + 16]
  target.flowVx = packed[base + 17]
  target.flowVy = packed[base + 18]
  target.flowVz = packed[base + 19]
  target.velocity = { x: target.vx, y: target.vy, z: target.vz }
  target.vorticity = target.vorticity ?? { x: 0, y: 0, z: 0 }
  target.vorticity.x = packed[base + 12]
  target.vorticity.y = packed[base + 13]
  target.vorticity.z = packed[base + 14]
  target.history = Array.isArray(target.history) ? target.history : [{ x: target.x, y: target.y, z: target.z }]
  target.injectVx = packed[base + 21]
  target.injectVy = packed[base + 22]
  target.injectVz = packed[base + 23]
}

function syncParticlesFromPacked(particles, packed, activeCount) {
  const byId = new Map()
  for (let i = 0; i < particles.length; i += 1) {
    byId.set(particles[i].id, particles[i])
  }

  const nextParticles = new Array(activeCount)
  for (let i = 0; i < activeCount; i += 1) {
    const base = i * FLOATS_PER_PARTICLE
    const particleId = packed[base + 20]
    const particle = byId.get(particleId) ?? {}
    applyParticleFields(particle, packed, base)
    nextParticles[i] = particle
  }

  particles.length = 0
  particles.push(...nextParticles)
}

function cloneParticleHistory(history) {
  if (!Array.isArray(history)) {
    return []
  }

  return history.map((point) => ({
    x: point.x ?? 0,
    y: point.y ?? 0,
    z: point.z ?? 0,
  }))
}

function cloneParticleRecord(particle) {
  return {
    ...particle,
    velocity: particle.velocity
      ? {
          x: particle.velocity.x ?? 0,
          y: particle.velocity.y ?? 0,
          z: particle.velocity.z ?? 0,
        }
      : undefined,
    vorticity: particle.vorticity
      ? {
          x: particle.vorticity.x ?? 0,
          y: particle.vorticity.y ?? 0,
          z: particle.vorticity.z ?? 0,
        }
      : undefined,
    history: cloneParticleHistory(particle.history),
  }
}

function cloneParticleSnapshot(particles) {
  return particles.map((particle) => cloneParticleRecord(particle))
}

function applyGammaScale(particles, ratio) {
  if (!(ratio > 0) || Math.abs(ratio - 1) <= 1e-6) {
    return
  }

  for (let i = 0; i < particles.length; i += 1) {
    particles[i].gamma = (particles[i].gamma ?? 0) * ratio
  }
}

function computePackedDiagnostics(packed, sampleCount) {
  if (!(packed instanceof Float32Array) || sampleCount <= 0) {
    return {
      sampleCount: 0,
      avgSpeed: 0,
      avgVorticity: 0,
      avgCoreRadius: 0,
      maxSpeed: 0,
      maxVorticity: 0,
    }
  }

  let totalSpeed = 0
  let totalVorticity = 0
  let totalCoreRadius = 0
  let maxSpeed = 0
  let maxVorticity = 0
  for (let i = 0; i < sampleCount; i += 1) {
    const base = i * FLOATS_PER_PARTICLE
    const flowVx = packed[base + 17] ?? 0
    const flowVy = packed[base + 18] ?? 0
    const flowVz = packed[base + 19] ?? 0
    const vortX = packed[base + 12] ?? 0
    const vortY = packed[base + 13] ?? 0
    const vortZ = packed[base + 14] ?? 0
    const coreRadius = packed[base + 16] ?? 0

    const speed = Math.hypot(flowVx, flowVy, flowVz)
    const vorticity = Math.hypot(vortX, vortY, vortZ)
    totalSpeed += speed
    totalVorticity += vorticity
    totalCoreRadius += coreRadius
    if (speed > maxSpeed) {
      maxSpeed = speed
    }
    if (vorticity > maxVorticity) {
      maxVorticity = vorticity
    }
  }

  const invCount = sampleCount > 0 ? 1 / sampleCount : 0
  return {
    sampleCount,
    avgSpeed: totalSpeed * invCount,
    avgVorticity: totalVorticity * invCount,
    avgCoreRadius: totalCoreRadius * invCount,
    maxSpeed,
    maxVorticity,
  }
}

function writeParams(buffer, device, params, count, dt, hashTableSize, bucketCapacity) {
  const data = new Float32Array(PARAM_VEC4_COUNT * 4)

  data[0] = dt
  data[1] = count
  data[2] = params.pulseDuration ?? 0
  data[3] = params.timeScale ?? 1

  data[4] = params.nozzleZ ?? params.nozzleX ?? 0
  data[5] = ((params.alpha ?? 0) * Math.PI) / 180
  data[6] = params.thetaSpeed ?? 0
  data[7] = params.ringMajor ?? 0

  data[8] = params.ringMinor ?? 0
  data[9] = params.viscosity ?? 0
  data[10] = params.gamma ?? 0
  data[11] = params.useBiotSavart ? 1 : 0

  data[12] = params.twistCoreRadius ?? 0
  data[13] = params.twistAxialDecay ?? 0
  data[14] = params.twistToRingCoupling ?? 0
  data[15] = params.jetSpeed ?? 0

  data[16] = params.jetTwist ?? 0
  data[17] = params.ringSpin ? 1 : -1
  data[18] = params.ringFlip ? -1 : 1
  data[19] = params.reverse ? -1 : 1

  data[20] = params.stretchingStrength ?? 0
  data[21] = params.reconnectionDistance ?? 0
  data[22] = params.minCoreRadius ?? 0
  data[23] = params.viscosity ?? 0

  data[24] = params.maxVelocity ?? 0
  data[25] = params.maxVorticity ?? 0
  data[26] = getGridCellSize(params)
  data[27] = getNeighborCellRadius(params)

  data[28] = hashTableSize
  data[29] = bucketCapacity
  data[30] = params.interactionRadius ?? 0
  data[31] = params.vpmEnabled ? 1 : 0
  data[32] = params.dynamicsMode === 'scripted' ? 1 : 0
  data[33] = params.reconnectionMinAge ?? params.pulseDuration ?? 0
  data[34] = (params.autoCoreRadius ? 1 : -1) * (params.sigmaRatio ?? 0.08)
  data[35] = params.maxSigmaRatio ?? 0.25
  data[36] = params.dynamicsMode === 'guidedPhysics' ? 1 : 0
  data[37] = params.guidedStrength ?? 0.2
  data[38] = params.vorticityConfinementStrength ?? 0
  data[39] = params.coreRadiusSigma ?? params.minCoreRadius ?? 0.02

  data[40] = params.lesEnabled ? 1.0 : 0.0
  data[41] = params.lesSmagorinskyCs ?? 0.15
  data[42] = 0
  data[43] = 0

  device.queue.writeBuffer(buffer, 0, data)
}

export class WebGPUHashGridParticleComputeManager {
  static async create() {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      throw new Error('WebGPU is unavailable in this environment')
    }

    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      throw new Error('Failed to get WebGPU adapter')
    }

    const requiredStorageBuffers = 9
    const supportedStorageBuffers =
      adapter.limits?.maxStorageBuffersPerShaderStage ?? requiredStorageBuffers

    if (supportedStorageBuffers < requiredStorageBuffers) {
      throw new Error(
        `WebGPU adapter supports only ${supportedStorageBuffers} storage buffers per compute stage; required ${requiredStorageBuffers}`,
      )
    }

    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBuffersPerShaderStage: requiredStorageBuffers,
      },
    })
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    })
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    })
    const createPipeline = (code) =>
      device.createComputePipeline({
        layout: pipelineLayout,
        compute: {
          module: device.createShaderModule({ code }),
          entryPoint: 'main',
        },
      })

    const couplingQueryBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    })
    const couplingQueryPipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [couplingQueryBindGroupLayout],
    })
    const couplingQueryPipeline = device.createComputePipeline({
      layout: couplingQueryPipelineLayout,
      compute: {
        module: device.createShaderModule({ code: createCouplingQueryShader() }),
        entryPoint: 'main',
      },
    })

    return new WebGPUHashGridParticleComputeManager(device, bindGroupLayout, {
      clearGrid: createPipeline(createClearGridShader()),
      binParticles: createPipeline(createBinParticlesShader()),
      baseUpdate: createPipeline(createBaseUpdateShader()),
      computeFlow: createPipeline(createComputeFlowShader()),
      confinement: createPipeline(createVorticityConfinementShader()),
      stability: createPipeline(createStabilityShader()),
      advect: createPipeline(createAdvectShader()),
      guidance: createPipeline(createGuidanceShader()),
      stretching: createPipeline(createStretchingShader()),
      diffusion: createPipeline(createDiffusionShader()),
      findMergeTarget: createPipeline(createFindMergeTargetShader()),
      resolveMergeOwner: createPipeline(createResolveMergeOwnerShader()),
      mergeParticles: createPipeline(createMergeParticlesShader()),
      clearCounter: createPipeline(createClearCounterShader()),
      compact: createPipeline(createCompactShader()),
      couplingQueryParticlesToPoints: couplingQueryPipeline,
    }, couplingQueryBindGroupLayout)
  }

  constructor(device, bindGroupLayout, pipelines, couplingQueryBindGroupLayout = null) {
    this.device = device
    this.bindGroupLayout = bindGroupLayout
    this.couplingQueryBindGroupLayout = couplingQueryBindGroupLayout
    this.pipelines = pipelines
    this.capacity = 0
    this.hashTableSize = 0
    this.bucketCapacity = 0
    this.stateBuffers = [null, null]
    this.activeBufferIndex = 0
    this.readbackBuffer = null
    this.countReadbackBuffer = null
    this.gridCountsBuffer = null
    this.gridIndicesBuffer = null
    this.mergeTargetBuffer = null
    this.mergeOwnerBuffer = null
    this.aliveFlagsBuffer = null
    this.counterBuffer = null
    this.paramsBuffer = this.device.createBuffer({
      size: PARAM_BUFFER_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.pending = null
    this.completedResult = null
    this.lastStepMs = 0
    this.lastCount = 0
    this.stateDirty = true
    this.snapshotVersion = 0
    this.syncedSnapshotVersion = -1
    this.snapshotInitialized = false
    this.snapshotParticles = []
    this.commandQueue = []
    this.syncStaleDropCount = 0
    this.syncResyncCount = 0
    this.fullReadbackInterval = DEFAULT_FULL_READBACK_INTERVAL
    this.diagnosticsInterval = DEFAULT_DIAGNOSTICS_INTERVAL
    this.diagnosticsSampleLimit = DEFAULT_DIAGNOSTICS_SAMPLE_LIMIT
    this.dispatchSerial = 0
    this.lastFullReadbackDispatchSerial = -1
    this.forceFullReadbackNextDispatch = false
    this.fullReadbackCount = 0
    this.skippedFullReadbackCount = 0
    this.lastDispatchHadFullReadback = false
    this.lastFullReadbackReason = 'none'
    this.lastOverflowCount = 0
    this.lastCollisionCount = 0
    this.lastOccupiedBucketCount = 0
    this.lastDispatchCount = 0
    this.lastGridBuildCount = 0
    this.adaptiveBucketCapacity = null
    this.adaptiveHashTableSize = null
    this.overflowAdaptCooldown = 0
    this.lowPressureStreak = 0
    this.lastAdaptiveEventType = 'none'
    this.lastAdaptiveEventReason = 'none'
    this.lastAdaptiveEventDispatchSerial = -1
    this.diagnosticsReadbackBuffer = null
    this.diagnosticsSampleCapacity = 0
    this.latestGpuDiagnostics = null
    this.latestRenderSnapshot = null
    this.couplingQuerySerial = 0
    this.latestCouplingQueryDiagnostics = null
    this.couplingQueryCapacity = 0
    this.couplingQueryPointBuffer = null
    this.couplingQueryVelocityBuffer = null
    this.couplingQuerySampleCountBuffer = null
    this.couplingQueryVelocityReadbackBuffer = null
    this.couplingQuerySampleCountReadbackBuffer = null
    this.couplingQueryPending = null
    this.latestCouplingQueryResult = null
  }

  destroy() {
    this.stateBuffers.forEach((buffer) => buffer?.destroy())
    this.readbackBuffer?.destroy()
    this.countReadbackBuffer?.destroy()
    this.diagnosticsReadbackBuffer?.destroy()
    this.gridCountsBuffer?.destroy()
    this.gridIndicesBuffer?.destroy()
    this.mergeTargetBuffer?.destroy()
    this.mergeOwnerBuffer?.destroy()
    this.aliveFlagsBuffer?.destroy()
    this.counterBuffer?.destroy()
    this.paramsBuffer?.destroy()
    this.couplingQueryPointBuffer?.destroy()
    this.couplingQueryVelocityBuffer?.destroy()
    this.couplingQuerySampleCountBuffer?.destroy()
    this.couplingQueryVelocityReadbackBuffer?.destroy()
    this.couplingQuerySampleCountReadbackBuffer?.destroy()
  }

  hasPendingStep() {
    return Boolean(this.pending)
  }

  replaceSnapshot(particles) {
    this.snapshotParticles = cloneParticleSnapshot(particles)
    this.snapshotInitialized = true
    this.commandQueue = []
    this.stateDirty = true
    this.snapshotVersion += 1
    this.lastCount = this.snapshotParticles.length
  }

  forceResyncSnapshot(particles) {
    if (!Array.isArray(particles)) {
      return false
    }
    this.replaceSnapshot(particles)
    this.syncResyncCount += 1
    return true
  }

  queueAppendParticles(particles) {
    if (!Array.isArray(particles) || particles.length === 0) {
      return
    }

    this.commandQueue.push({
      type: 'append_particles',
      particles: cloneParticleSnapshot(particles),
    })
  }

  queueGammaScale(ratio) {
    if (!(ratio > 0) || Math.abs(ratio - 1) <= 1e-6) {
      return
    }

    this.commandQueue.push({
      type: 'scale_gamma',
      ratio,
    })
  }

  queueParticleDeltas(deltas) {
    if (!Array.isArray(deltas) || deltas.length === 0) {
      return
    }

    const sanitized = []
    for (let i = 0; i < deltas.length; i += 1) {
      const delta = deltas[i]
      if (!Number.isFinite(delta?.id)) {
        continue
      }
      const dx = Number.isFinite(delta?.dx) ? delta.dx : 0
      const dy = Number.isFinite(delta?.dy) ? delta.dy : 0
      const dz = Number.isFinite(delta?.dz) ? delta.dz : 0
      if (Math.abs(dx) <= 1e-12 && Math.abs(dy) <= 1e-12 && Math.abs(dz) <= 1e-12) {
        continue
      }
      sanitized.push({ id: delta.id, dx, dy, dz })
    }
    if (sanitized.length === 0) {
      return
    }

    this.commandQueue.push({
      type: 'apply_particle_deltas',
      deltas: sanitized,
    })
  }

  applyQueuedCommands() {
    if (!this.snapshotInitialized || this.commandQueue.length === 0) {
      return false
    }

    for (let i = 0; i < this.commandQueue.length; i += 1) {
      const command = this.commandQueue[i]
      if (command.type === 'append_particles') {
        this.snapshotParticles.push(...cloneParticleSnapshot(command.particles))
        continue
      }

      if (command.type === 'scale_gamma') {
        applyGammaScale(this.snapshotParticles, command.ratio)
        continue
      }

      if (command.type === 'apply_particle_deltas') {
        const deltasById = new Map()
        for (let i = 0; i < command.deltas.length; i += 1) {
          const delta = command.deltas[i]
          deltasById.set(delta.id, delta)
        }
        for (let i = 0; i < this.snapshotParticles.length; i += 1) {
          const particle = this.snapshotParticles[i]
          const delta = deltasById.get(particle.id)
          if (!delta) {
            continue
          }
          particle.x = (particle.x ?? 0) + (delta.dx ?? 0)
          particle.y = (particle.y ?? 0) + (delta.dy ?? 0)
          particle.z = (particle.z ?? 0) + (delta.dz ?? 0)
        }
      }
    }

    this.commandQueue = []
    this.stateDirty = true
    this.snapshotVersion += 1
    this.lastCount = this.snapshotParticles.length
    return true
  }

  ensureCapacity(count, params) {
    const baseHashTableSize = getHashTableSize(Math.max(1, count))
    const desiredHashTableSize = Math.max(
      baseHashTableSize,
      this.adaptiveHashTableSize ?? baseHashTableSize,
    )
    const baseBucketCapacity = getBucketCapacity(params)
    const desiredBucketCapacity = Math.max(baseBucketCapacity, this.adaptiveBucketCapacity ?? baseBucketCapacity)

    if (
      count <= this.capacity &&
      desiredHashTableSize === this.hashTableSize &&
      desiredBucketCapacity === this.bucketCapacity
    ) {
      return
    }

    this.stateBuffers.forEach((buffer) => buffer?.destroy())
    this.readbackBuffer?.destroy()
    this.countReadbackBuffer?.destroy()
    this.diagnosticsReadbackBuffer?.destroy()
    this.gridCountsBuffer?.destroy()
    this.gridIndicesBuffer?.destroy()
    this.mergeTargetBuffer?.destroy()
    this.mergeOwnerBuffer?.destroy()
    this.aliveFlagsBuffer?.destroy()
    this.counterBuffer?.destroy()

    this.capacity = Math.max(1, count)
    this.hashTableSize = desiredHashTableSize
    this.bucketCapacity = desiredBucketCapacity

    const particleByteSize = this.capacity * BYTES_PER_PARTICLE
    const hashByteSize = this.hashTableSize * UINT_BYTES
    const hashIndicesByteSize = this.hashTableSize * this.bucketCapacity * UINT_BYTES
    const perParticleUIntByteSize = this.capacity * UINT_BYTES

    this.stateBuffers = [0, 1].map(() =>
      this.device.createBuffer({
        size: particleByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      }),
    )
    this.readbackBuffer = this.device.createBuffer({
      size: particleByteSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    this.countReadbackBuffer = this.device.createBuffer({
      size: COUNTER_BUFFER_SIZE,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    this.diagnosticsReadbackBuffer = this.device.createBuffer({
      size: Math.max(1, Math.min(this.capacity, this.diagnosticsSampleLimit) * BYTES_PER_PARTICLE),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    this.diagnosticsSampleCapacity = Math.min(this.capacity, this.diagnosticsSampleLimit)
    this.gridCountsBuffer = this.device.createBuffer({
      size: hashByteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.gridIndicesBuffer = this.device.createBuffer({
      size: hashIndicesByteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.mergeTargetBuffer = this.device.createBuffer({
      size: perParticleUIntByteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.mergeOwnerBuffer = this.device.createBuffer({
      size: perParticleUIntByteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.aliveFlagsBuffer = this.device.createBuffer({
      size: perParticleUIntByteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.counterBuffer = this.device.createBuffer({
      size: COUNTER_BUFFER_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    })

    this.activeBufferIndex = 0
    this.stateDirty = true
  }

  pollCompletedStep(particles = null) {
    if (!this.completedResult) {
      return {
        applied: false,
        stepMs: this.lastStepMs,
        activeCount: this.lastCount,
      }
    }

    if (this.completedResult.version !== this.snapshotVersion) {
      this.syncStaleDropCount += 1
      this.completedResult = null
      return {
        applied: false,
        cpuSynchronized: false,
        stepMs: this.lastStepMs,
        activeCount: this.lastCount,
      }
    }

    const hasParticleReadback =
      this.completedResult.data instanceof Float32Array && this.completedResult.data.length > 0
    if (hasParticleReadback) {
      syncParticlesFromPacked(this.snapshotParticles, this.completedResult.data, this.completedResult.activeCount)
      this.snapshotInitialized = true
      if (Array.isArray(particles)) {
        syncParticlesFromPacked(particles, this.completedResult.data, this.completedResult.activeCount)
      }
    }
    this.lastStepMs = this.completedResult.stepMs
    this.lastCount = this.completedResult.activeCount
    this.completedResult = null
    return {
      applied: true,
      cpuSynchronized: hasParticleReadback,
      stepMs: this.lastStepMs,
      activeCount: this.lastCount,
    }
  }

  readbackSnapshot() {
    return {
      activeCount: this.snapshotParticles.length,
      particles: cloneParticleSnapshot(this.snapshotParticles),
    }
  }

  getSyncDiagnostics() {
    const activeCount = Math.max(0, Math.floor(this.lastCount ?? 0))
    const collisionRatio = activeCount > 0 ? this.lastCollisionCount / activeCount : 0
    const hashLoadFactor = this.hashTableSize > 0 ? this.lastOccupiedBucketCount / this.hashTableSize : 0
    return {
      epoch: this.snapshotVersion,
      currentDispatchSerial: this.dispatchSerial,
      staleDropCount: this.syncStaleDropCount,
      resyncCount: this.syncResyncCount,
      activeCount,
      fullReadbackCount: this.fullReadbackCount,
      skippedFullReadbackCount: this.skippedFullReadbackCount,
      lastDispatchHadFullReadback: this.lastDispatchHadFullReadback,
      lastFullReadbackReason: this.lastFullReadbackReason,
      lastFullReadbackDispatchSerial: this.lastFullReadbackDispatchSerial,
      overflowCount: this.lastOverflowCount,
      collisionCount: this.lastCollisionCount,
      collisionRatio,
      hashLoadFactor,
      dispatchCount: this.lastDispatchCount,
      gridBuildCount: this.lastGridBuildCount,
      occupiedBucketCount: this.lastOccupiedBucketCount,
      hashTableSize: this.hashTableSize,
      adaptiveHashTableSize: this.adaptiveHashTableSize ?? this.hashTableSize ?? 0,
      bucketCapacity: this.bucketCapacity,
      adaptiveBucketCapacity: this.adaptiveBucketCapacity ?? this.bucketCapacity ?? 0,
      overflowAdaptCooldown: this.overflowAdaptCooldown,
      lowPressureStreak: this.lowPressureStreak,
      adaptiveEventType: this.lastAdaptiveEventType,
      adaptiveEventReason: this.lastAdaptiveEventReason,
      adaptiveEventDispatchSerial: this.lastAdaptiveEventDispatchSerial,
      gpuDiagEnergy: this.gpuDiagnostics?.energy ?? 0,
      gpuDiagEnstrophy: this.gpuDiagnostics?.enstrophy ?? 0,
      gpuDiagCirculation: this.gpuDiagnostics?.circulation ?? 0,
      gpuDiagMaxSpeed: this.gpuDiagnostics?.maxSpeed ?? 0,
    }
  }

  getLatestGpuDiagnostics() {
    if (!this.latestGpuDiagnostics) {
      return null
    }
    return { ...this.latestGpuDiagnostics }
  }

  getLatestRenderSnapshot() {
    if (!this.latestRenderSnapshot) {
      return null
    }
    return {
      activeCount: this.latestRenderSnapshot.activeCount,
      dispatchSerial: this.latestRenderSnapshot.dispatchSerial,
      packed: this.latestRenderSnapshot.packed,
    }
  }

  getGpuRenderState() {
    const activeBuffer = this.stateBuffers[this.activeBufferIndex]
    if (!activeBuffer) {
      return null
    }

    return {
      buffer: activeBuffer,
      activeCount: this.lastCount,
      dispatchSerial: this.dispatchSerial,
      particleStrideFloats: FLOATS_PER_PARTICLE,
      positionOffsetFloats: 0,
      velocityOffsetFloats: 4,
      vorticityOffsetFloats: 12,
      flowOffsetFloats: 17,
      idOffsetFloats: 20,
    }
  }

  isCouplingQuerySupported() {
    // TT-011B plumbing only:
    // query kernel/pipeline will be added in TT-011C.
    return Boolean(this.pipelines?.couplingQueryParticlesToPoints)
  }

  getLatestCouplingQueryDiagnostics() {
    if (!this.latestCouplingQueryDiagnostics) {
      return null
    }
    return { ...this.latestCouplingQueryDiagnostics }
  }

  getLatestCouplingQueryResult() {
    if (!this.latestCouplingQueryResult) {
      return null
    }
    return {
      ...this.latestCouplingQueryResult,
      velocitiesPacked: this.latestCouplingQueryResult.velocitiesPacked,
      sampleCountsPacked: this.latestCouplingQueryResult.sampleCountsPacked,
    }
  }

  ensureCouplingQueryCapacity(pointCount) {
    const normalizedPointCount = Math.max(1, Math.floor(pointCount))
    if (normalizedPointCount <= this.couplingQueryCapacity) {
      return
    }
    this.couplingQueryPointBuffer?.destroy()
    this.couplingQueryVelocityBuffer?.destroy()
    this.couplingQuerySampleCountBuffer?.destroy()
    this.couplingQueryVelocityReadbackBuffer?.destroy()
    this.couplingQuerySampleCountReadbackBuffer?.destroy()

    const pointsByteSize = normalizedPointCount * COUPLING_QUERY_BYTES_PER_POINT
    const sampleCountByteSize = normalizedPointCount * UINT_BYTES
    this.couplingQueryPointBuffer = this.device.createBuffer({
      size: pointsByteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.couplingQueryVelocityBuffer = this.device.createBuffer({
      size: pointsByteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
    this.couplingQuerySampleCountBuffer = this.device.createBuffer({
      size: sampleCountByteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
    this.couplingQueryVelocityReadbackBuffer = this.device.createBuffer({
      size: pointsByteSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    this.couplingQuerySampleCountReadbackBuffer = this.device.createBuffer({
      size: sampleCountByteSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    this.couplingQueryCapacity = normalizedPointCount
  }

  createCouplingQueryBindGroup(srcBuffer) {
    return this.device.createBindGroup({
      layout: this.couplingQueryBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: srcBuffer } },
        { binding: 1, resource: { buffer: this.paramsBuffer } },
        { binding: 2, resource: { buffer: this.gridCountsBuffer } },
        { binding: 3, resource: { buffer: this.gridIndicesBuffer } },
        { binding: 4, resource: { buffer: this.couplingQueryPointBuffer } },
        { binding: 5, resource: { buffer: this.couplingQueryVelocityBuffer } },
        { binding: 6, resource: { buffer: this.couplingQuerySampleCountBuffer } },
      ],
    })
  }

  async sampleParticleVelocityAtPoints(pointsInput, options = {}) {
    const requestedStrideFloats = Math.max(
      3,
      Math.floor(options.pointStrideFloats ?? COUPLING_QUERY_POINT_STRIDE_FLOATS),
    )
    const pointStrideFloats = COUPLING_QUERY_POINT_STRIDE_FLOATS
    const normalized = normalizeCouplingQueryPoints(pointsInput, pointStrideFloats)
    const output = {
      velocitiesPacked: new Float32Array(normalized.count * pointStrideFloats),
      sampleCountsPacked: new Uint32Array(normalized.count),
      pointCount: normalized.count,
      pointStrideFloats,
      backend: 'cpu_fallback',
      reason: 'query_not_supported',
      queryMs: 0,
      querySerial: this.couplingQuerySerial + 1,
    }
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()

    if (requestedStrideFloats !== COUPLING_QUERY_POINT_STRIDE_FLOATS) {
      output.reason = 'unsupported_point_stride'
      output.queryMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
      this.couplingQuerySerial = output.querySerial
      this.latestCouplingQueryDiagnostics = {
        querySerial: output.querySerial,
        pointCount: output.pointCount,
        backend: output.backend,
        reason: output.reason,
        queryMs: output.queryMs,
      }
      return output
    }

    if (normalized.count <= 0) {
      output.reason = 'no_points'
      output.backend = 'none'
      output.queryMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
      this.couplingQuerySerial = output.querySerial
      this.latestCouplingQueryDiagnostics = {
        querySerial: output.querySerial,
        pointCount: output.pointCount,
        backend: output.backend,
        reason: output.reason,
        queryMs: output.queryMs,
      }
      return output
    }

    if (this.hasPendingStep()) {
      output.reason = 'dispatch_pending'
      output.queryMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
      this.couplingQuerySerial = output.querySerial
      this.latestCouplingQueryDiagnostics = {
        querySerial: output.querySerial,
        pointCount: output.pointCount,
        backend: output.backend,
        reason: output.reason,
        queryMs: output.queryMs,
      }
      return output
    }

    if (this.couplingQueryPending) {
      output.reason = 'query_pending'
      output.queryMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
      this.couplingQuerySerial = output.querySerial
      this.latestCouplingQueryDiagnostics = {
        querySerial: output.querySerial,
        pointCount: output.pointCount,
        backend: output.backend,
        reason: output.reason,
        queryMs: output.queryMs,
      }
      return output
    }

    if (!this.isCouplingQuerySupported() || !this.couplingQueryBindGroupLayout) {
      output.queryMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
      this.couplingQuerySerial = output.querySerial
      this.latestCouplingQueryDiagnostics = {
        querySerial: output.querySerial,
        pointCount: output.pointCount,
        backend: output.backend,
        reason: output.reason,
        queryMs: output.queryMs,
      }
      return output
    }

    const params = options.params ?? {}
    this.applyQueuedCommands()
    if (this.snapshotParticles.length <= 0) {
      output.reason = 'no_particles'
      output.queryMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
      this.couplingQuerySerial = output.querySerial
      this.latestCouplingQueryDiagnostics = {
        querySerial: output.querySerial,
        pointCount: output.pointCount,
        backend: output.backend,
        reason: output.reason,
        queryMs: output.queryMs,
      }
      return output
    }

    const particleCount = this.snapshotParticles.length
    this.ensureCapacity(particleCount, params)
    if (this.stateDirty || this.lastCount !== particleCount) {
      this.syncStateToGpu(this.snapshotParticles)
    }
    writeParams(
      this.paramsBuffer,
      this.device,
      params,
      particleCount,
      0,
      this.hashTableSize,
      this.bucketCapacity,
    )
    this.ensureCouplingQueryCapacity(normalized.count)
    const pointsByteSize = normalized.count * COUPLING_QUERY_BYTES_PER_POINT
    const sampleCountsByteSize = normalized.count * UINT_BYTES
    this.device.queue.writeBuffer(
      this.couplingQueryPointBuffer,
      0,
      normalized.packedPoints.buffer,
      normalized.packedPoints.byteOffset,
      pointsByteSize,
    )

    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    const activeIndex = this.activeBufferIndex
    const sourceStateBuffer = this.stateBuffers[activeIndex]
    const scratchStateBuffer = this.stateBuffers[1 - activeIndex]
    this.dispatchGridBuild(
      pass,
      sourceStateBuffer,
      scratchStateBuffer,
      particleCount,
      null,
    )
    pass.setPipeline(this.pipelines.couplingQueryParticlesToPoints)
    pass.setBindGroup(0, this.createCouplingQueryBindGroup(sourceStateBuffer))
    pass.dispatchWorkgroups(Math.ceil(normalized.count / COUPLING_QUERY_WORKGROUP_SIZE))
    pass.end()

    encoder.copyBufferToBuffer(
      this.couplingQueryVelocityBuffer,
      0,
      this.couplingQueryVelocityReadbackBuffer,
      0,
      pointsByteSize,
    )
    encoder.copyBufferToBuffer(
      this.couplingQuerySampleCountBuffer,
      0,
      this.couplingQuerySampleCountReadbackBuffer,
      0,
      sampleCountsByteSize,
    )
    this.device.queue.submit([encoder.finish()])

    this.couplingQueryPending = Promise.all([
      this.couplingQueryVelocityReadbackBuffer.mapAsync(GPUMapMode.READ, 0, pointsByteSize),
      this.couplingQuerySampleCountReadbackBuffer.mapAsync(GPUMapMode.READ, 0, sampleCountsByteSize),
    ])
    try {
      await this.couplingQueryPending
      const packedVelocities = this.couplingQueryVelocityReadbackBuffer
        .getMappedRange(0, pointsByteSize)
        .slice(0)
      const packedCounts = this.couplingQuerySampleCountReadbackBuffer
        .getMappedRange(0, sampleCountsByteSize)
        .slice(0)
      this.couplingQueryVelocityReadbackBuffer.unmap()
      this.couplingQuerySampleCountReadbackBuffer.unmap()
      output.backend = 'gpu'
      output.reason = 'ok'
      output.velocitiesPacked = new Float32Array(packedVelocities)
      output.sampleCountsPacked = new Uint32Array(packedCounts)
      this.latestCouplingQueryResult = {
        querySerial: output.querySerial,
        pointCount: output.pointCount,
        pointStrideFloats: output.pointStrideFloats,
        backend: output.backend,
        reason: output.reason,
        velocitiesPacked: output.velocitiesPacked,
        sampleCountsPacked: output.sampleCountsPacked,
      }
      output.queryMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
      this.couplingQuerySerial = output.querySerial
      this.latestCouplingQueryDiagnostics = {
        querySerial: output.querySerial,
        pointCount: output.pointCount,
        backend: output.backend,
        reason: output.reason,
        queryMs: output.queryMs,
      }
      return output
    } catch (error) {
      output.backend = 'cpu_fallback'
      output.reason = 'query_dispatch_failed'
      output.error = error instanceof Error ? error.message : 'Coupling query dispatch failed'
      output.queryMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
      this.couplingQuerySerial = output.querySerial
      this.latestCouplingQueryDiagnostics = {
        querySerial: output.querySerial,
        pointCount: output.pointCount,
        backend: output.backend,
        reason: output.reason,
        queryMs: output.queryMs,
      }
      return output
    } finally {
      this.couplingQueryPending = null
    }
  }

  requestFullReadbackNextDispatch() {
    this.forceFullReadbackNextDispatch = true
  }

  setFullReadbackInterval(interval) {
    const normalized = Math.max(1, Math.floor(interval))
    this.fullReadbackInterval = normalized
  }

  recordAdaptiveEvent(type, reason, dispatchSerial) {
    this.lastAdaptiveEventType = type
    this.lastAdaptiveEventReason = reason
    this.lastAdaptiveEventDispatchSerial = dispatchSerial
  }

  updateAdaptiveBucketCapacity(
    params,
    overflowCount,
    collisionCount,
    occupiedBucketCount,
    activeCount,
    dispatchSerial,
  ) {
    const baseBucketCapacity = getBucketCapacity(params)
    const currentBucketCapacity = Math.max(
      baseBucketCapacity,
      this.adaptiveBucketCapacity ?? baseBucketCapacity,
    )
    const baseHashTableSize = getHashTableSize(Math.max(1, activeCount))
    const currentHashTableSize = Math.max(
      baseHashTableSize,
      this.adaptiveHashTableSize ?? baseHashTableSize,
    )
    const normalizedOverflow = Math.max(0, Math.floor(overflowCount))
    const normalizedCollisions = Math.max(0, Math.floor(collisionCount))
    const normalizedOccupiedBuckets = Math.max(0, Math.floor(occupiedBucketCount))
    const normalizedActiveCount = Math.max(0, Math.floor(activeCount))
    const overflowGrowThreshold = Math.max(4, Math.ceil(normalizedActiveCount * 0.003))
    const collisionGrowThreshold = Math.max(32, Math.ceil(normalizedActiveCount * 0.08))
    const collisionRatio =
      normalizedActiveCount > 0 ? normalizedCollisions / normalizedActiveCount : 0
    const bucketLoadFactor =
      currentHashTableSize > 0 ? normalizedOccupiedBuckets / currentHashTableSize : 0
    const canGrowHashTable = currentHashTableSize < MAX_DYNAMIC_HASH_TABLE_SIZE
    const shouldGrowByOverflow = normalizedOverflow > overflowGrowThreshold
    const shouldGrowByCollisions =
      normalizedCollisions > collisionGrowThreshold &&
      collisionRatio > 0.16 &&
      bucketLoadFactor > 0.5

    if (shouldGrowByOverflow && currentBucketCapacity < MAX_DYNAMIC_BUCKET_CAPACITY) {
      const nextBucketCapacity = Math.min(
        MAX_DYNAMIC_BUCKET_CAPACITY,
        Math.max(currentBucketCapacity + 8, Math.ceil(currentBucketCapacity * 1.25)),
      )
      this.adaptiveBucketCapacity = nextBucketCapacity
      this.overflowAdaptCooldown = OVERFLOW_ADAPT_COOLDOWN_STEPS
      this.lowPressureStreak = 0
      this.recordAdaptiveEvent('grow_bucket', 'overflow', dispatchSerial)
      return
    }
    if ((shouldGrowByOverflow || shouldGrowByCollisions) && canGrowHashTable) {
      const nextHashTableSize = Math.min(
        MAX_DYNAMIC_HASH_TABLE_SIZE,
        nextPowerOfTwo(Math.ceil(currentHashTableSize * 1.5)),
      )
      if (nextHashTableSize > currentHashTableSize) {
        this.adaptiveHashTableSize = nextHashTableSize
        this.overflowAdaptCooldown = OVERFLOW_ADAPT_COOLDOWN_STEPS
        this.lowPressureStreak = 0
        this.recordAdaptiveEvent(
          'grow_hash',
          shouldGrowByOverflow ? 'overflow' : 'collisions',
          dispatchSerial,
        )
        return
      }
    }

    if (this.overflowAdaptCooldown > 0) {
      this.overflowAdaptCooldown -= 1
      this.lowPressureStreak = 0
      return
    }

    const shouldShrink =
      normalizedOverflow === 0 &&
      collisionRatio < 0.04 &&
      bucketLoadFactor < 0.35 &&
      normalizedActiveCount > 0
    if (shouldShrink) {
      this.lowPressureStreak += 1
    } else {
      this.lowPressureStreak = 0
      return
    }
    if (this.lowPressureStreak < MIN_LOW_PRESSURE_STREAK_FOR_SHRINK) {
      return
    }

    if (
      currentBucketCapacity > baseBucketCapacity &&
      this.adaptiveBucketCapacity != null
    ) {
      const nextBucketCapacity = Math.max(
        baseBucketCapacity,
        Math.floor(this.adaptiveBucketCapacity / 1.2),
      )
      this.adaptiveBucketCapacity =
        nextBucketCapacity > baseBucketCapacity ? nextBucketCapacity : null
      this.overflowAdaptCooldown = OVERFLOW_ADAPT_COOLDOWN_STEPS
      this.lowPressureStreak = 0
      this.recordAdaptiveEvent('shrink_bucket', 'low_pressure', dispatchSerial)
      return
    }

    if (currentHashTableSize > baseHashTableSize && this.adaptiveHashTableSize != null) {
      const nextHashTableSize = Math.max(
        baseHashTableSize,
        nextPowerOfTwo(Math.floor(currentHashTableSize / 1.5)),
      )
      this.adaptiveHashTableSize = nextHashTableSize > baseHashTableSize ? nextHashTableSize : null
      this.overflowAdaptCooldown = OVERFLOW_ADAPT_COOLDOWN_STEPS
      this.lowPressureStreak = 0
      this.recordAdaptiveEvent('shrink_hash', 'low_pressure', dispatchSerial)
    }
  }

  getCurrentDispatchSerial() {
    return this.dispatchSerial
  }

  ensureSnapshotMatchesSeed(particles) {
    if (!Array.isArray(particles) || this.hasPendingStep()) {
      return false
    }

    if (!this.snapshotInitialized) {
      this.replaceSnapshot(particles)
      this.syncResyncCount += 1
      return true
    }

    const snapshotCount = this.snapshotParticles.length
    if (snapshotCount === particles.length) {
      return false
    }

    // Recovery path for backend switch / stale snapshot:
    // when local CPU state diverges from GPU snapshot identity, resync.
    const snapshotFirstId = this.snapshotParticles[0]?.id
    const snapshotLastId = this.snapshotParticles[snapshotCount - 1]?.id
    const particleFirstId = particles[0]?.id
    const particleLastId = particles[particles.length - 1]?.id
    const obviousMismatch =
      snapshotCount === 0 ||
      particles.length === 0 ||
      snapshotFirstId !== particleFirstId ||
      snapshotLastId !== particleLastId

    if (obviousMismatch) {
      this.replaceSnapshot(particles)
      this.syncResyncCount += 1
      return true
    }

    return false
  }

  syncStateToGpu(particles) {
    const packed = packParticles(particles)
    const byteSize = particles.length * BYTES_PER_PARTICLE
    this.device.queue.writeBuffer(
      this.stateBuffers[this.activeBufferIndex],
      0,
      packed.buffer,
      0,
      byteSize,
    )
    this.lastCount = particles.length
    this.stateDirty = false
    this.syncedSnapshotVersion = this.snapshotVersion
  }

  createBindGroup(srcBuffer, dstBuffer) {
    return this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: srcBuffer } },
        { binding: 1, resource: { buffer: dstBuffer } },
        { binding: 2, resource: { buffer: this.paramsBuffer } },
        { binding: 3, resource: { buffer: this.gridCountsBuffer } },
        { binding: 4, resource: { buffer: this.gridIndicesBuffer } },
        { binding: 5, resource: { buffer: this.mergeTargetBuffer } },
        { binding: 6, resource: { buffer: this.mergeOwnerBuffer } },
        { binding: 7, resource: { buffer: this.aliveFlagsBuffer } },
        { binding: 8, resource: { buffer: this.counterBuffer } },
      ],
    })
  }

  executePass(pass, pipeline, srcBuffer, dstBuffer, dispatchCount, metrics = null) {
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.createBindGroup(srcBuffer, dstBuffer))
    pass.dispatchWorkgroups(Math.ceil(dispatchCount / WORKGROUP_SIZE))
    if (metrics) {
      metrics.dispatchCount += 1
    }
  }

  dispatchGridBuild(pass, srcBuffer, dstBuffer, count, metrics = null) {
    this.executePass(
      pass,
      this.pipelines.clearGrid,
      srcBuffer,
      dstBuffer,
      this.hashTableSize,
      metrics,
    )
    this.executePass(pass, this.pipelines.binParticles, srcBuffer, dstBuffer, count, metrics)
    if (metrics) {
      metrics.gridBuildCount += 1
    }
  }

  submitStep(params, dt, seedParticles = null) {
    if (!this.snapshotInitialized) {
      if (!Array.isArray(seedParticles)) {
        return {
          reason: 'snapshot_uninitialized',
          stepMs: this.lastStepMs,
          gpuDispatchPending: false,
        }
      }

      this.replaceSnapshot(seedParticles)
    } else {
      this.applyQueuedCommands()
    }

    if (this.snapshotParticles.length === 0) {
      this.lastCount = 0
      this.lastOverflowCount = 0
      this.lastCollisionCount = 0
      this.lastOccupiedBucketCount = 0
      this.lastDispatchCount = 0
      this.lastGridBuildCount = 0
      this.lastDispatchHadFullReadback = false
      this.lastFullReadbackReason = 'none'
      this.lowPressureStreak = 0
      this.stateDirty = true
      return {
        reason: 'no_particles',
        stepMs: 0,
        gpuDispatchPending: false,
      }
    }

    if (this.pending) {
      return {
        reason: 'dispatch_pending',
        stepMs: this.lastStepMs,
        gpuDispatchPending: true,
      }
    }

    const particleCount = this.snapshotParticles.length
    const shouldRunStretchingPass = particleCount > 1 && (params.stretchingStrength ?? 0) > 0
    const shouldRunMergePipeline = particleCount > 1 && (params.reconnectionDistance ?? 0) > 0
    const shouldRunDiffusionPass = (params.viscosity ?? 0) > 0
    const shouldRunSecondaryGridBuild = shouldRunStretchingPass || shouldRunMergePipeline

    this.ensureCapacity(particleCount, params)
    if (this.stateDirty || this.lastCount !== particleCount) {
      this.syncStateToGpu(this.snapshotParticles)
    }

    writeParams(
      this.paramsBuffer,
      this.device,
      params,
      particleCount,
      dt,
      this.hashTableSize,
      this.bucketCapacity,
    )
    const byteSize = particleCount * BYTES_PER_PARTICLE

    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    const passMetrics = {
      dispatchCount: 0,
      gridBuildCount: 0,
    }
    let srcIndex = this.activeBufferIndex
    let dstIndex = 1 - this.activeBufferIndex

    this.executePass(
      pass,
      this.pipelines.baseUpdate,
      this.stateBuffers[srcIndex],
      this.stateBuffers[dstIndex],
      particleCount,
      passMetrics,
    )
    ;[srcIndex, dstIndex] = [dstIndex, srcIndex]

    if (params.vpmEnabled) {
      this.dispatchGridBuild(
        pass,
        this.stateBuffers[srcIndex],
        this.stateBuffers[dstIndex],
        particleCount,
        passMetrics,
      )
      this.executePass(
        pass,
        this.pipelines.computeFlow,
        this.stateBuffers[srcIndex],
        this.stateBuffers[dstIndex],
        particleCount,
        passMetrics,
      )
      ;[srcIndex, dstIndex] = [dstIndex, srcIndex]

      this.executePass(
        pass,
        this.pipelines.confinement,
        this.stateBuffers[srcIndex],
        this.stateBuffers[dstIndex],
        particleCount,
        passMetrics,
      )
      ;[srcIndex, dstIndex] = [dstIndex, srcIndex]

      this.executePass(
        pass,
        this.pipelines.stability,
        this.stateBuffers[srcIndex],
        this.stateBuffers[dstIndex],
        particleCount,
        passMetrics,
      )
      ;[srcIndex, dstIndex] = [dstIndex, srcIndex]

      const shouldRunGuidancePass = shouldRunNaturalGuidancePass(params)
      if (shouldRunGuidancePass) {
        this.executePass(
          pass,
          this.pipelines.guidance,
          this.stateBuffers[srcIndex],
          this.stateBuffers[dstIndex],
          particleCount,
          passMetrics,
        )
        ;[srcIndex, dstIndex] = [dstIndex, srcIndex]
      }

      this.executePass(
        pass,
        this.pipelines.advect,
        this.stateBuffers[srcIndex],
        this.stateBuffers[dstIndex],
        particleCount,
        passMetrics,
      )
      ;[srcIndex, dstIndex] = [dstIndex, srcIndex]

      if (shouldRunSecondaryGridBuild) {
        this.dispatchGridBuild(
          pass,
          this.stateBuffers[srcIndex],
          this.stateBuffers[dstIndex],
          particleCount,
          passMetrics,
        )
      }
      if (shouldRunStretchingPass) {
        this.executePass(
          pass,
          this.pipelines.stretching,
          this.stateBuffers[srcIndex],
          this.stateBuffers[dstIndex],
          particleCount,
          passMetrics,
        )
        ;[srcIndex, dstIndex] = [dstIndex, srcIndex]
      }

      if (shouldRunDiffusionPass) {
        this.executePass(
          pass,
          this.pipelines.diffusion,
          this.stateBuffers[srcIndex],
          this.stateBuffers[dstIndex],
          particleCount,
          passMetrics,
        )
        ;[srcIndex, dstIndex] = [dstIndex, srcIndex]
      }

      if (shouldRunMergePipeline) {
        this.executePass(
          pass,
          this.pipelines.findMergeTarget,
          this.stateBuffers[srcIndex],
          this.stateBuffers[dstIndex],
          particleCount,
          passMetrics,
        )
        this.executePass(
          pass,
          this.pipelines.resolveMergeOwner,
          this.stateBuffers[srcIndex],
          this.stateBuffers[dstIndex],
          particleCount,
          passMetrics,
        )
        this.executePass(
          pass,
          this.pipelines.mergeParticles,
          this.stateBuffers[srcIndex],
          this.stateBuffers[dstIndex],
          particleCount,
          passMetrics,
        )
        ;[srcIndex, dstIndex] = [dstIndex, srcIndex]

        this.executePass(
          pass,
          this.pipelines.stability,
          this.stateBuffers[srcIndex],
          this.stateBuffers[dstIndex],
          particleCount,
          passMetrics,
        )
        ;[srcIndex, dstIndex] = [dstIndex, srcIndex]

        this.executePass(
          pass,
          this.pipelines.clearCounter,
          this.stateBuffers[srcIndex],
          this.stateBuffers[dstIndex],
          1,
          passMetrics,
        )
        this.executePass(
          pass,
          this.pipelines.compact,
          this.stateBuffers[srcIndex],
          this.stateBuffers[dstIndex],
          particleCount,
          passMetrics,
        )
        ;[srcIndex, dstIndex] = [dstIndex, srcIndex]
      }
    }
    pass.end()
    this.lastDispatchCount = passMetrics.dispatchCount
    this.lastGridBuildCount = passMetrics.gridBuildCount

    this.activeBufferIndex = srcIndex
    this.dispatchSerial += 1
    const shouldRunFullReadback =
      this.forceFullReadbackNextDispatch ||
      this.lastFullReadbackDispatchSerial < 0 ||
      this.dispatchSerial - this.lastFullReadbackDispatchSerial >= this.fullReadbackInterval
    const fullReadbackReason = this.forceFullReadbackNextDispatch
      ? 'manual_force'
      : this.lastFullReadbackDispatchSerial < 0
        ? 'bootstrap'
        : 'interval_tick'
    this.lastDispatchHadFullReadback = shouldRunFullReadback
    this.lastFullReadbackReason = shouldRunFullReadback ? fullReadbackReason : 'none'
    if (shouldRunFullReadback) {
      this.forceFullReadbackNextDispatch = false
      this.fullReadbackCount += 1
    } else {
      this.skippedFullReadbackCount += 1
    }
    const shouldReadDiagnostics = this.dispatchSerial % this.diagnosticsInterval === 0
    const diagnosticsByteSize = this.diagnosticsSampleCapacity * BYTES_PER_PARTICLE
    if (shouldRunFullReadback) {
      this.lastFullReadbackDispatchSerial = this.dispatchSerial
      encoder.copyBufferToBuffer(
        this.stateBuffers[this.activeBufferIndex],
        0,
        this.readbackBuffer,
        0,
        byteSize,
      )
    }
    if (shouldReadDiagnostics && diagnosticsByteSize > 0) {
      encoder.copyBufferToBuffer(
        this.stateBuffers[this.activeBufferIndex],
        0,
        this.diagnosticsReadbackBuffer,
        0,
        diagnosticsByteSize,
      )
    }
    if (params.vpmEnabled) {
      encoder.copyBufferToBuffer(this.counterBuffer, 0, this.countReadbackBuffer, 0, COUNTER_BUFFER_SIZE)
    }

    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.device.queue.submit([encoder.finish()])

    this.pending = Promise.all([
      shouldRunFullReadback
        ? this.readbackBuffer.mapAsync(GPUMapMode.READ, 0, byteSize)
        : Promise.resolve(),
      shouldReadDiagnostics && diagnosticsByteSize > 0
        ? this.diagnosticsReadbackBuffer.mapAsync(GPUMapMode.READ, 0, diagnosticsByteSize)
        : Promise.resolve(),
      params.vpmEnabled
        ? this.countReadbackBuffer.mapAsync(GPUMapMode.READ, 0, COUNTER_BUFFER_SIZE)
        : Promise.resolve(),
    ])
      .then(() => {
        let particleCopy = null
        if (shouldRunFullReadback) {
          particleCopy = this.readbackBuffer.getMappedRange(0, byteSize).slice(0)
          this.readbackBuffer.unmap()
        }
        let activeCount = this.snapshotParticles.length
        let overflowCount = 0
        let collisionCount = 0
        let occupiedBucketCount = 0
        if (params.vpmEnabled) {
          const countCopy = this.countReadbackBuffer.getMappedRange(0, COUNTER_BUFFER_SIZE).slice(0)
          this.countReadbackBuffer.unmap()
          const counters = new Uint32Array(countCopy)
          activeCount = shouldRunMergePipeline ? (counters[0] ?? activeCount) : this.snapshotParticles.length
          overflowCount = counters[1] ?? 0
          collisionCount = counters[2] ?? 0
          occupiedBucketCount = counters[3] ?? 0
          const DIAG_FP_SCALE = 1000
          this.gpuDiagnostics = {
            energy: (counters[4] ?? 0) / DIAG_FP_SCALE,
            enstrophy: (counters[5] ?? 0) / DIAG_FP_SCALE,
            circulation: (counters[6] ?? 0) / DIAG_FP_SCALE,
            maxSpeed: (counters[7] ?? 0) / DIAG_FP_SCALE,
          }
        } else {
          overflowCount = 0
          collisionCount = 0
          occupiedBucketCount = 0
        }
        this.lastOverflowCount = overflowCount
        this.lastCollisionCount = collisionCount
        this.lastOccupiedBucketCount = occupiedBucketCount
        this.updateAdaptiveBucketCapacity(
          params,
          overflowCount,
          collisionCount,
          occupiedBucketCount,
          activeCount,
          this.dispatchSerial,
        )
        const collisionRatio = activeCount > 0 ? collisionCount / activeCount : 0
        const hashLoadFactor = this.hashTableSize > 0 ? occupiedBucketCount / this.hashTableSize : 0
        if (shouldReadDiagnostics && diagnosticsByteSize > 0) {
          const diagnosticsCopy = this.diagnosticsReadbackBuffer
            .getMappedRange(0, diagnosticsByteSize)
            .slice(0)
          this.diagnosticsReadbackBuffer.unmap()
          const packed = new Float32Array(diagnosticsCopy)
          const sampleCount = Math.min(activeCount, this.diagnosticsSampleCapacity)
          this.latestGpuDiagnostics = {
            ...computePackedDiagnostics(packed, sampleCount),
            activeCount,
            overflowCount,
            collisionCount,
            occupiedBucketCount,
            collisionRatio,
            hashLoadFactor,
            dispatchCount: this.lastDispatchCount,
            gridBuildCount: this.lastGridBuildCount,
            hashTableSize: this.hashTableSize,
            adaptiveHashTableSize: this.adaptiveHashTableSize ?? this.hashTableSize,
            bucketCapacity: this.bucketCapacity,
            adaptiveBucketCapacity: this.adaptiveBucketCapacity ?? this.bucketCapacity,
            overflowAdaptCooldown: this.overflowAdaptCooldown,
            lowPressureStreak: this.lowPressureStreak,
            adaptiveEventType: this.lastAdaptiveEventType,
            adaptiveEventReason: this.lastAdaptiveEventReason,
            adaptiveEventDispatchSerial: this.lastAdaptiveEventDispatchSerial,
            updatedDispatchSerial: this.dispatchSerial,
          }
        } else if (this.latestGpuDiagnostics) {
          this.latestGpuDiagnostics = {
            ...this.latestGpuDiagnostics,
            activeCount,
            overflowCount,
            collisionCount,
            occupiedBucketCount,
            collisionRatio,
            hashLoadFactor,
            dispatchCount: this.lastDispatchCount,
            gridBuildCount: this.lastGridBuildCount,
            hashTableSize: this.hashTableSize,
            adaptiveHashTableSize: this.adaptiveHashTableSize ?? this.hashTableSize,
            bucketCapacity: this.bucketCapacity,
            adaptiveBucketCapacity: this.adaptiveBucketCapacity ?? this.bucketCapacity,
            overflowAdaptCooldown: this.overflowAdaptCooldown,
            lowPressureStreak: this.lowPressureStreak,
            adaptiveEventType: this.lastAdaptiveEventType,
            adaptiveEventReason: this.lastAdaptiveEventReason,
            adaptiveEventDispatchSerial: this.lastAdaptiveEventDispatchSerial,
            updatedDispatchSerial: this.latestGpuDiagnostics.updatedDispatchSerial,
          }
        }
        const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
        if (particleCopy) {
          this.latestRenderSnapshot = {
            activeCount,
            dispatchSerial: this.dispatchSerial,
            packed: new Float32Array(particleCopy),
          }
        }
        this.completedResult = {
          activeCount,
          overflowCount,
          collisionCount,
          occupiedBucketCount,
          data: particleCopy ? new Float32Array(particleCopy) : null,
          stepMs: finishedAt - startedAt,
          version: this.syncedSnapshotVersion,
        }
      })
      .finally(() => {
        this.pending = null
      })

    return {
      reason: 'dispatch_submitted',
      stepMs: this.lastStepMs,
      gpuDispatchPending: true,
    }
  }

  step(particles, params, dt) {
    const pollResult = this.pollCompletedStep(particles)
    if (this.hasPendingStep()) {
      return {
        applied: true,
        cpuSynchronized: false,
        reason: 'dispatch_pending',
        stepMs: pollResult.stepMs ?? this.lastStepMs,
        completedStep: false,
        gpuDispatchPending: true,
      }
    }

    const submitResult = this.submitStep(params, dt, particles)
    return {
      applied: true,
      cpuSynchronized: Boolean(pollResult.cpuSynchronized),
      reason: submitResult.reason,
      stepMs: pollResult.stepMs ?? submitResult.stepMs ?? this.lastStepMs,
      completedStep: pollResult.applied,
      gpuDispatchPending: submitResult.gpuDispatchPending,
    }
  }
}
