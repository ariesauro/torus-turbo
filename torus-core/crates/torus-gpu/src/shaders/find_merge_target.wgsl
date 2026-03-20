// Find closest merge target within reconnection distance.

@group(0) @binding(0) var<storage, read> srcParticles : array<ParticleData>;
@group(0) @binding(2) var<storage, read> params : SimParams;
@group(0) @binding(3) var<storage, read_write> gridCounts : array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> gridIndices : array<u32>;
@group(0) @binding(5) var<storage, read_write> mergeTarget : array<i32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let count = paramCount(params);
  if (idx >= count) { return; }

  mergeTarget[idx] = -1;

  let particle = srcParticles[idx];
  if (particle.positionLife.w <= 0.0) { return; }

  let reconnDist = paramReconnectionDistance(params);
  if (reconnDist <= 0.0) { return; }

  let minAge = paramReconnectionMinAge(params);
  if (particle.velocityAge.w < minAge) { return; }

  let reconnDist2 = reconnDist * reconnDist;
  let pos = particle.positionLife.xyz;
  let cellSize = paramGridCellSize(params);
  let neighborRadius = paramNeighborCellRadius(params);
  let hashTableSize = paramHashTableSize(params);
  let bucketCapacity = paramBucketCapacity(params);
  let myCell = positionToCell(pos, cellSize);

  var bestDist2 = reconnDist2;
  var bestIdx = -1;

  let nri = i32(neighborRadius);
  for (var dx = -nri; dx <= nri; dx++) {
    for (var dy = -nri; dy <= nri; dy++) {
      for (var dz = -nri; dz <= nri; dz++) {
        let neighborCell = myCell + vec3<i32>(dx, dy, dz);
        let hash = hashCell(neighborCell, hashTableSize);
        let bucketCount = min(atomicLoad(&gridCounts[hash]), bucketCapacity);

        for (var s = 0u; s < bucketCount; s++) {
          let j = gridIndices[hash * bucketCapacity + s];
          if (j <= idx) { continue; }

          let other = srcParticles[j];
          if (other.positionLife.w <= 0.0) { continue; }
          if (other.velocityAge.w < minAge) { continue; }

          let r = pos - other.positionLife.xyz;
          let d2 = dot(r, r);
          if (d2 < bestDist2) {
            bestDist2 = d2;
            bestIdx = i32(j);
          }
        }
      }
    }
  }

  mergeTarget[idx] = bestIdx;
}
