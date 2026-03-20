// Compact live particles + accumulate diagnostics (energy, enstrophy, circulation, maxSpeed).

@group(0) @binding(0) var<storage, read> srcParticles : array<ParticleData>;
@group(0) @binding(1) var<storage, read_write> dstParticles : array<ParticleData>;
@group(0) @binding(2) var<storage, read> params : SimParams;
@group(0) @binding(7) var<storage, read_write> aliveFlags : array<u32>;
@group(0) @binding(8) var<storage, read_write> counter : CounterData;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let count = paramCount(params);
  if (idx >= count) { return; }

  let p = srcParticles[idx];
  let alive = p.positionLife.w > 0.0 && aliveFlags[idx] != 0u;

  if (alive) {
    let outIdx = atomicAdd(&counter.activeCount, 1u);
    dstParticles[outIdx] = p;

    // Diagnostics (fixed-point ×1000)
    let flow = p.coreFlow.yzw;
    let speed = length(flow);
    let energy = u32(0.5 * dot(flow, flow) * 1000.0);
    let omega = p.vorticityGamma.xyz;
    let enstrophy = u32(dot(omega, omega) * 1000.0);
    let circulation = u32(abs(p.vorticityGamma.w) * 1000.0);
    let speedFP = u32(speed * 1000.0);

    atomicAdd(&counter.diagEnergyFP, energy);
    atomicAdd(&counter.diagEnstrophyFP, enstrophy);
    atomicAdd(&counter.diagCirculationFP, circulation);
    atomicMax(&counter.diagMaxSpeedFP, speedFP);
  }
}
