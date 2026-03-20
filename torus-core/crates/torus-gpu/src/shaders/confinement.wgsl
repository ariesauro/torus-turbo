// Vorticity confinement: gradient |ω| + N×ω velocity correction.

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

  let strength = paramVorticityConfinementStrength(params);
  if (abs(strength) <= 1e-6) {
    dstParticles[idx] = particle;
    return;
  }

  let pos = particle.positionLife.xyz;
  let omega = particle.vorticityGamma.xyz;
  let omegaMag = length(omega);
  if (omegaMag <= 1e-6) {
    dstParticles[idx] = particle;
    return;
  }

  let cellSize = paramGridCellSize(params);
  let neighborRadius = paramNeighborCellRadius(params);
  let hashTableSize = paramHashTableSize(params);
  let bucketCapacity = paramBucketCapacity(params);
  let interactionRadius = paramInteractionRadius(params);
  let interactionRadius2 = interactionRadius * interactionRadius;
  let useInteraction = interactionRadius > 0.0;
  let minCore = paramMinCoreRadius(params);
  let baseCore = max(paramCoreRadiusSigma(params), minCore);
  let myCell = positionToCell(pos, cellSize);

  var grad = vec3<f32>(0.0);

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
          let r = other.positionLife.xyz - pos;
          let r2 = dot(r, r);
          if (useInteraction && r2 > interactionRadius2) { continue; }

          let rLen = sqrt(r2 + 1e-6);
          if (rLen <= 1e-6) { continue; }

          let sigma = max(other.coreFlow.x, baseCore);
          let influence = exp(-r2 / (2.0 * sigma * sigma));
          if (influence < 1e-4) { continue; }

          let neighborOmegaMag = length(other.vorticityGamma.xyz);
          let domega = (neighborOmegaMag - omegaMag) * influence;
          grad += (r / rLen) * domega;
        }
      }
    }
  }

  let gradLen = length(grad);
  if (gradLen <= 1e-6) {
    dstParticles[idx] = particle;
    return;
  }

  let n = grad / gradLen;
  let conf = cross(n, omega) * strength;

  particle.coreFlow = vec4<f32>(
    particle.coreFlow.x,
    particle.coreFlow.y + conf.x,
    particle.coreFlow.z + conf.y,
    particle.coreFlow.w + conf.z
  );

  dstParticles[idx] = particle;
}
