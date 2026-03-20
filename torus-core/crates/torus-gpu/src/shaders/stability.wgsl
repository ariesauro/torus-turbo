// Stability clamps: velocity/vorticity magnitude limits + core radius bounds.

@group(0) @binding(0) var<storage, read> srcParticles : array<ParticleData>;
@group(0) @binding(1) var<storage, read_write> dstParticles : array<ParticleData>;
@group(0) @binding(2) var<storage, read> params : SimParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let count = paramCount(params);
  if (idx >= count) { return; }

  var p = srcParticles[idx];
  if (p.positionLife.w <= 0.0) {
    dstParticles[idx] = p;
    return;
  }

  let maxVel = paramMaxVelocity(params);
  let maxVort = paramMaxVorticity(params);
  let minSigma = paramMinCoreRadius(params);

  // Clamp flow velocity
  if (maxVel > 0.0) {
    let flow = p.coreFlow.yzw;
    let speed = length(flow);
    if (speed > maxVel && speed > 1e-8) {
      let scale = maxVel / speed;
      p.coreFlow = vec4<f32>(p.coreFlow.x, flow * scale);
    }
  }

  // Clamp vorticity
  if (maxVort > 0.0) {
    let omega = p.vorticityGamma.xyz;
    let omegaMag = length(omega);
    if (omegaMag > maxVort && omegaMag > 1e-8) {
      let scale = maxVort / omegaMag;
      p.vorticityGamma = vec4<f32>(omega * scale, p.vorticityGamma.w);
    }
  }

  // Clamp core radius
  if (p.coreFlow.x < minSigma) {
    p.coreFlow.x = minSigma;
  }

  dstParticles[idx] = p;
}
