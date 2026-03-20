@group(0) @binding(2) var<storage, read> params : SimParams;
@group(0) @binding(3) var<storage, read_write> gridCounts : array<atomic<u32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let hashTableSize = paramHashTableSize(params);
  if (idx >= hashTableSize) { return; }
  atomicStore(&gridCounts[idx], 0u);
}
