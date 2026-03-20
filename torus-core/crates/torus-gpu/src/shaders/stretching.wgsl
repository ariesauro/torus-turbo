// Analytic vortex stretching: (ω·∇)u via hash grid neighbor search.

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

  let strength = paramStretchingStrength(params);
  if (strength <= 0.0) {
    dstParticles[idx] = particle;
    return;
  }

  let pos = particle.positionLife.xyz;
  let omega_i = particle.vorticityGamma.xyz;
  let omegaMag = length(omega_i);
  if (omegaMag <= 1e-8) {
    dstParticles[idx] = particle;
    return;
  }

  let dt = paramDt(params);
  let cellSize = paramGridCellSize(params);
  let neighborRadius = paramNeighborCellRadius(params);
  let hashTableSize = paramHashTableSize(params);
  let bucketCapacity = paramBucketCapacity(params);
  let interactionRadius = paramInteractionRadius(params);
  let interactionRadius2 = interactionRadius * interactionRadius;
  let useInteraction = interactionRadius > 0.0;
  let minCore = paramMinCoreRadius(params);
  let myCell = positionToCell(pos, cellSize);

  var dOmegaX = 0.0;
  var dOmegaY = 0.0;
  var dOmegaZ = 0.0;

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

          let sigma = max(other.coreFlow.x, minCore);
          let sigma2 = sigma * sigma;
          let r2s2 = r2 + sigma2;
          if (r2s2 <= 1e-16) { continue; }

          let gammaJ = other.vorticityGamma.w;
          if (abs(gammaJ) <= 1e-12) { continue; }

          let omega_j = other.vorticityGamma.xyz;
          let r2s2_15 = pow(r2s2, 1.5);
          let r2s2_25 = r2s2_15 * r2s2;

          let crossX = omega_i.y * omega_j.z - omega_i.z * omega_j.y;
          let crossY = omega_i.z * omega_j.x - omega_i.x * omega_j.z;
          let crossZ = omega_i.x * omega_j.y - omega_i.y * omega_j.x;

          let omegaDotR = omega_i.x * rx + omega_i.y * ry + omega_i.z * rz;

          let rCrossX = ry * omega_j.z - rz * omega_j.y;
          let rCrossY = rz * omega_j.x - rx * omega_j.z;
          let rCrossZ = rx * omega_j.y - ry * omega_j.x;

          let f3 = gammaJ / (FOUR_PI * r2s2_15);
          let f5 = -3.0 * gammaJ * omegaDotR / (FOUR_PI * r2s2_25);

          dOmegaX += f3 * crossX + f5 * rCrossX;
          dOmegaY += f3 * crossY + f5 * rCrossY;
          dOmegaZ += f3 * crossZ + f5 * rCrossZ;
        }
      }
    }
  }

  let factor = dt * strength;
  particle.vorticityGamma = vec4<f32>(
    particle.vorticityGamma.x + dOmegaX * factor,
    particle.vorticityGamma.y + dOmegaY * factor,
    particle.vorticityGamma.z + dOmegaZ * factor,
    particle.vorticityGamma.w
  );

  dstParticles[idx] = particle;
}
