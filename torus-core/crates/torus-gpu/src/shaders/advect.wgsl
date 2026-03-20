// Forward Euler advection: position += flow * dt.

@group(0) @binding(0) var<storage, read> srcParticles : array<ParticleData>;
@group(0) @binding(1) var<storage, read_write> dstParticles : array<ParticleData>;
@group(0) @binding(2) var<storage, read> params : SimParams;

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

  let dt = paramDt(params);
  let flow = particle.coreFlow.yzw;

  particle.positionLife = vec4<f32>(
    particle.positionLife.xyz + flow * dt,
    particle.positionLife.w
  );

  particle.velocityAge = vec4<f32>(
    flow * dt,
    particle.velocityAge.w + dt
  );

  dstParticles[idx] = particle;
}
