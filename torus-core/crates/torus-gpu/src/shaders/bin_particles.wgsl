@group(0) @binding(0) var<storage, read> srcParticles : array<ParticleData>;
@group(0) @binding(2) var<storage, read> params : SimParams;
@group(0) @binding(3) var<storage, read_write> gridCounts : array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> gridIndices : array<u32>;
@group(0) @binding(8) var<storage, read_write> counter : CounterData;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let count = paramCount(params);
  if (idx >= count) { return; }

  let particle = srcParticles[idx];
  if (particle.positionLife.w <= 0.0) { return; }

  let cellSize = paramGridCellSize(params);
  let hashTableSize = paramHashTableSize(params);
  let bucketCapacity = paramBucketCapacity(params);
  let cell = positionToCell(particle.positionLife.xyz, cellSize);
  let hash = hashCell(cell, hashTableSize);

  let slot = atomicAdd(&gridCounts[hash], 1u);
  if (slot < bucketCapacity) {
    gridIndices[hash * bucketCapacity + slot] = idx;
  } else {
    atomicAdd(&counter.overflow, 1u);
  }
}
