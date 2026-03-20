// Biot-Savart velocity via hash grid neighbor search.

@group(0) @binding(0) var<storage, read> srcParticles : array<ParticleData>;
@group(0) @binding(1) var<storage, read_write> dstParticles : array<ParticleData>;
@group(0) @binding(2) var<storage, read> params : SimParams;
@group(0) @binding(3) var<storage, read_write> gridCounts : array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> gridIndices : array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let count = paramCount(params);
  if (idx >= count) { return; }

  var particle = srcParticles[idx];
  if (particle.positionLife.w <= 0.0) {
    dstParticles[idx] = particle;
    return;
  }

  let pos = particle.positionLife.xyz;
  let cellSize = paramGridCellSize(params);
  let neighborRadius = paramNeighborCellRadius(params);
  let hashTableSize = paramHashTableSize(params);
  let bucketCapacity = paramBucketCapacity(params);
  let interactionRadius = paramInteractionRadius(params);
  let interactionRadius2 = interactionRadius * interactionRadius;
  let useInteraction = interactionRadius > 0.0;
  let myCell = positionToCell(pos, cellSize);

  var vx = 0.0;
  var vy = 0.0;
  var vz = 0.0;

  let nri = i32(neighborRadius);
  for (var dx = -nri; dx <= nri; dx++) {
    for (var dy = -nri; dy <= nri; dy++) {
      for (var dz = -nri; dz <= nri; dz++) {
        let neighborCell = myCell + vec3<i32>(dx, dy, dz);
        let hash = hashCell(neighborCell, hashTableSize);
        let bucketCount = min(atomicLoad(&gridCounts[hash]), bucketCapacity);

        for (var s = 0u; s < bucketCount; s++) {
          let j = gridIndices[hash * bucketCapacity + s];
          if (j == idx) { continue; }

          let other = srcParticles[j];
          let rx = pos.x - other.positionLife.x;
          let ry = pos.y - other.positionLife.y;
          let rz = pos.z - other.positionLife.z;
          let r2 = rx * rx + ry * ry + rz * rz;

          if (useInteraction && r2 > interactionRadius2) { continue; }

          let sigma = max(other.coreFlow.x, paramMinCoreRadius(params));
          let denom = pow(r2 + sigma * sigma, 1.5);
          if (denom <= 1e-8) { continue; }

          let omega = other.vorticityGamma.xyz;
          let gamma = other.vorticityGamma.w;
          let cx = ry * omega.z - rz * omega.y;
          let cy = rz * omega.x - rx * omega.z;
          let cz2 = rx * omega.y - ry * omega.x;
          let factor = gamma / (FOUR_PI * denom);

          vx += cx * factor;
          vy += cy * factor;
          vz += cz2 * factor;
        }
      }
    }
  }

  particle.coreFlow = vec4<f32>(particle.coreFlow.x, vx, vy, vz);
  dstParticles[idx] = particle;
}
