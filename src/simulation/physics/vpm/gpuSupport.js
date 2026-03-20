export async function detectGpuPhysicsSupport() {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return false
  }

  try {
    const adapter = await navigator.gpu.requestAdapter()
    return Boolean(adapter)
  } catch {
    return false
  }
}
