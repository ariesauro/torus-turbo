export function resolveParticleRenderSource(params, runtimeStatus, webgpuManager) {
  const wantsGpuSource = params.physicsBackend === 'webgpu'
  if (!wantsGpuSource) {
    return {
      policy: 'cpu_backend',
      requested: 'cpu',
      active: 'cpu',
      gpuPrepared: false,
      descriptor: null,
      reason: 'cpu_backend',
    }
  }

  const assistCpuRequired = params.runtimeHybridPlusActive === true
  const naturalCpuGuidanceRequired = params.dynamicsMode === 'guidedPhysics'
  if (assistCpuRequired || naturalCpuGuidanceRequired) {
    return {
      policy: 'conservative_hybrid',
      requested: 'gpu',
      active: 'cpu_conservative',
      gpuPrepared: false,
      descriptor: null,
      reason: assistCpuRequired ? 'assist_cpu_required' : 'natural_cpu_guidance_required',
    }
  }

  const canQueryGpuState =
    runtimeStatus?.backend === 'gpu' &&
    webgpuManager &&
    typeof webgpuManager.getGpuRenderState === 'function'
  if (!canQueryGpuState) {
    return {
      policy: 'gpu_primary',
      requested: 'gpu',
      active: 'cpu',
      gpuPrepared: false,
      descriptor: null,
      reason: 'gpu_snapshot_pending',
    }
  }

  const descriptor = webgpuManager.getGpuRenderState()
  if (!descriptor?.buffer || (descriptor.activeCount ?? 0) <= 0) {
    return {
      policy: 'gpu_primary',
      requested: 'gpu',
      active: 'cpu',
      gpuPrepared: false,
      descriptor: null,
      reason: 'gpu_not_prepared',
    }
  }

  return {
    policy: 'gpu_primary',
    requested: 'gpu',
    active: 'gpu_prepared',
    gpuPrepared: true,
    descriptor,
    reason: 'gpu_snapshot',
  }
}
