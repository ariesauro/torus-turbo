// Вычисление индекса ячейки для каждой частицы
// cellSize, gridOrigin, gridResolution передаются через bindgroup

@group(0) @binding(0) var<uniform> cellSize: f32;
@group(0) @binding(1) var<uniform> gridResolution: u32;
@group(0) @binding(2) var<uniform> gridOrigin: vec3<f32>;

@group(0) @binding(3) var<storage, read> particles: array<Particle>;
@group(0) @binding(4) var<storage, read_write> cellIndices: array<i32>;

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

@compute @workgroup_size(64)
fn computeCellIndexFn(@builtin(global_invocation_id) global_id : vec3<u32>) {
  let particleIdx = global_id.x;
  
  let particle = particles[particleIdx];
  let localPos = particle.xyz - gridOrigin;
  
  let cellX = i32(floor(localPos.x / cellSize));
  let cellY = i32(floor(localPos.y / cellSize));
  let cellZ = i32(floor(localPos.z / cellSize));
  
  let resolution = i32(gridResolution);
  var cellIndex: i32 = -1;
  
  if (cellX >= 0 && cellX < resolution &&
      cellY >= 0 && cellY < resolution &&
      cellZ >= 0 && cellZ < resolution) {
    cellIndex = cellX + cellY * resolution + cellZ * resolution * resolution;
  }
  
  cellIndices[particleIdx] = cellIndex;
}
