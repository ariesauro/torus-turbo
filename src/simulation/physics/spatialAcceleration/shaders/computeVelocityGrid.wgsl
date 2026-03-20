// Вычисление скорости Biot–Savart с использованием spatial grid
// Точные вычисления для соседних ячеек, агрегация для дальних

@group(0) @binding(0) var<uniform> cellSize: f32;
@group(0) @binding(1) var<uniform> gridResolution: u32;
@group(0) @binding(2) var<uniform> interactionRadius2: f32;
@group(0) @binding(3) var<uniform> coreRadiusSq: f32;

@group(0) @binding(4) var<storage, read> particles: array<Particle>;
@group(0) @binding(5) var<storage, read> cellIndices: array<i32>;
@group(0) @binding(6) var<storage, read> cellStart: array<u32>;
@group(0) @binding(7) var<storage, read> cellCount: array<u32>;
@group(0) @binding(8) var<storage, read> particleIndices: array<u32>;
@group(0) @binding(9) var<storage, read_write> velocities: array<vec3<f32>>;

struct Particle {
  x: f32,
  y: f32,
  z: f32,
  _pad0: f32,
  vx: f32,
  vy: f32,
  vz: f32,
  _pad1: f32,
  gamma: f32,
  age: f32,
  coreRadius: f32,
  _pad2: f32,
  omegaX: f32,
  omegaY: f32,
  omegaZ: f32,
  _pad3: f32,
}

const FOUR_PI: f32 = 12.566370614359172;

fn computeBiotSavartVelocity(
  targetPos: vec3<f32>,
  source: Particle,
) -> vec3<f32> {
  let r = targetPos - source.xyz;
  let r2 = dot(r, r);
  
  if (r2 > interactionRadius2) {
    return vec3<f32>(0.0);
  }
  
  let denom = pow(r2 + coreRadiusSq, 1.5);
  if (denom < 1e-8) {
    return vec3<f32>(0.0);
  }
  
  let omega = vec3<f32>(source.omegaX, source.omegaY, source.omegaZ);
  let crossResult = cross(r, omega);
  let factor = source.gamma / (FOUR_PI * denom);
  
  return crossResult * factor;
}

@compute @workgroup_size(64)
fn computeVelocityGridFn(@builtin(global_invocation_id) global_id : vec3<u32>) {
  let particleIdx = global_id.x;
  let particle = particles[particleIdx];
  let targetPos = particle.xyz;
  
  var velocity = vec3<f32>(0.0);
  let cellIdx = cellIndices[particleIdx];
  
  if (cellIdx < 0) {
    velocities[particleIdx] = velocity;
    return;
  }
  
  let resolution = i32(gridResolution);
  let z = cellIdx / (resolution * resolution);
  let rem = cellIdx % (resolution * resolution);
  let y = rem / resolution;
  let x = rem % resolution;
  
  for (var dz = -1; dz <= 1; dz = dz + 1) {
    for (var dy = -1; dy <= 1; dy = dy + 1) {
      for (var dx = -1; dx <= 1; dx = dx + 1) {
        let nx = x + dx;
        let ny = y + dy;
        let nz = z + dz;
        
        if (nx >= 0 && nx < resolution &&
            ny >= 0 && ny < resolution &&
            nz >= 0 && nz < resolution) {
          
          let neighborIdx = nx + ny * resolution + nz * resolution * resolution;
          let start = cellStart[neighborIdx];
          let count = cellCount[neighborIdx];
          
          for (var i = 0u; i < count; i = i + 1u) {
            let sourceIdx = particleIndices[start + i];
            if (sourceIdx != particleIdx) {
              let source = particles[sourceIdx];
              velocity = velocity + computeBiotSavartVelocity(targetPos, source);
            }
          }
        }
      }
    }
  }
  
  velocities[particleIdx] = velocity;
}
