// Merge particle pairs: weighted average position, sum vorticity/gamma, average sigma.

@group(0) @binding(0) var<storage, read> srcParticles : array<ParticleData>;
@group(0) @binding(1) var<storage, read_write> dstParticles : array<ParticleData>;
@group(0) @binding(5) var<storage, read_write> mergeTarget : array<i32>;
@group(0) @binding(6) var<storage, read_write> mergeOwner : array<i32>;
@group(0) @binding(7) var<storage, read_write> aliveFlags : array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let count = arrayLength(&aliveFlags);
  if (idx >= count) { return; }

  aliveFlags[idx] = 1u;

  if (mergeOwner[idx] >= 0) {
    aliveFlags[idx] = 0u;
    return;
  }

  var base = srcParticles[idx];
  let target = mergeTarget[idx];

  if (target >= 0 && mergeOwner[u32(target)] == i32(idx)) {
    let candidate = srcParticles[target];
    let baseWeight = abs(base.vorticityGamma.w) + 1e-6;
    let candidateWeight = abs(candidate.vorticityGamma.w) + 1e-6;
    let weightSum = baseWeight + candidateWeight;

    base.positionLife = vec4<f32>(
      (base.positionLife.xyz * baseWeight + candidate.positionLife.xyz * candidateWeight) / weightSum,
      base.positionLife.w
    );

    base.vorticityGamma = vec4<f32>(
      base.vorticityGamma.xyz + candidate.vorticityGamma.xyz,
      base.vorticityGamma.w + candidate.vorticityGamma.w
    );

    base.coreFlow.x = (base.coreFlow.x + candidate.coreFlow.x) * 0.5;

    aliveFlags[u32(target)] = 0u;
  }

  dstParticles[idx] = base;
}
