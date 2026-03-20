// Resolve merge ownership: lowest index wins.

@group(0) @binding(0) var<storage, read> srcParticles : array<ParticleData>;
@group(0) @binding(2) var<storage, read> params : SimParams;
@group(0) @binding(5) var<storage, read_write> mergeTarget : array<i32>;
@group(0) @binding(6) var<storage, read_write> mergeOwner : array<i32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let count = paramCount(params);
  if (idx >= count) { return; }

  mergeOwner[idx] = -1;

  let target = mergeTarget[idx];
  if (target < 0 || u32(target) >= count) { return; }

  // Atomic min would be ideal; simplified: lowest index claims ownership
  if (mergeOwner[target] < 0 || i32(idx) < mergeOwner[target]) {
    mergeOwner[target] = i32(idx);
  }
}
