// Particle point rendering — vertex + fragment shaders.
// Reads from compute output buffer directly (zero-copy).

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec4<f32>,
  @location(1) @interpolate(flat) point_size : f32,
}

struct Camera {
  view_proj : mat4x4<f32>,
  eye_pos   : vec3<f32>,
  _pad      : f32,
}

@group(0) @binding(0) var<storage, read> particles : array<ParticleData>;
@group(0) @binding(1) var<uniform> camera : Camera;

@vertex
fn vs_main(@builtin(vertex_index) vertex_id : u32) -> VertexOutput {
  var out : VertexOutput;

  let p = particles[vertex_id];
  let pos = p.positionLife.xyz;
  let life = p.positionLife.w;

  if (life <= 0.0) {
    out.position = vec4<f32>(0.0, 0.0, -10.0, 1.0);
    out.color = vec4<f32>(0.0);
    out.point_size = 0.0;
    return out;
  }

  out.position = camera.view_proj * vec4<f32>(pos, 1.0);

  let omega = p.vorticityGamma.xyz;
  let omegaMag = length(omega);
  let sigma = p.coreFlow.x;

  // Color by vorticity magnitude
  let intensity = clamp(omegaMag * 5.0, 0.0, 1.0);
  out.color = vec4<f32>(
    0.2 + 0.8 * intensity,
    0.6 * (1.0 - intensity) + 0.4,
    1.0 - 0.6 * intensity,
    0.8
  );

  // Size by distance to camera
  let dist = length(pos - camera.eye_pos);
  out.point_size = clamp(sigma * 200.0 / max(dist, 0.1), 1.0, 20.0);

  return out;
}

@fragment
fn fs_main(in : VertexOutput) -> @location(0) vec4<f32> {
  return in.color;
}
