// PSE (Particle Strength Exchange) diffusion via hash grid.
// dω_i/dt = (2ν/ε²) · Σ_j (ω_j − ω_i) · η_ε(r_ij) · V

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

  let viscosity = paramViscosity(params);
  if (viscosity <= 0.0) {
    dstParticles[idx] = particle;
    return;
  }

  let dt = paramDt(params);
  let minCore = paramMinCoreRadius(params);
  let eps = max(paramCoreRadiusSigma(params), minCore);
  let eps2 = eps * eps;
  let fourEps2 = 4.0 * eps2;
  let volume = eps * eps * eps;
  let kernelNorm = 1.0 / (31.006277 * eps2 * eps);
  let prefactor = 2.0 * viscosity * volume * kernelNorm / eps2;

  let pos = particle.positionLife.xyz;
  let omega_i = particle.vorticityGamma.xyz;
  let cellSize = paramGridCellSize(params);
  let neighborRadius = paramNeighborCellRadius(params);
  let hashTableSize = paramHashTableSize(params);
  let bucketCapacity = paramBucketCapacity(params);
  let interactionRadius = paramInteractionRadius(params);
  let interactionRadius2 = interactionRadius * interactionRadius;
  let useInteraction = interactionRadius > 0.0;
  let myCell = positionToCell(pos, cellSize);

  var dOmega = vec3<f32>(0.0);

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
          let r = pos - other.positionLife.xyz;
          let r2 = dot(r, r);

          if (useInteraction && r2 > interactionRadius2) { continue; }

          let expVal = exp(-r2 / fourEps2);
          if (expVal < 1e-8) { continue; }

          let factor = prefactor * expVal;
          let omega_j = other.vorticityGamma.xyz;
          dOmega += (omega_j - omega_i) * factor;
        }
      }
    }
  }

  particle.vorticityGamma = vec4<f32>(
    particle.vorticityGamma.xyz + dOmega * dt,
    particle.vorticityGamma.w
  );

  dstParticles[idx] = particle;
}
