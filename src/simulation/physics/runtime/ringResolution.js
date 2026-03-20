export const RING_RESOLUTION_OPTIONS = [60, 120, 180, 240, 300, 360]

export function normalizeRingResolutionToUi(value) {
  const candidate = Math.floor(Number(value))
  if (RING_RESOLUTION_OPTIONS.includes(candidate)) {
    return candidate
  }

  if (!Number.isFinite(candidate)) {
    return 120
  }

  return RING_RESOLUTION_OPTIONS.reduce((closest, option) =>
    Math.abs(option - candidate) < Math.abs(closest - candidate) ? option : closest,
  )
}

export function getRingResolutionMultiplier(params) {
  const candidate = Math.floor(Number(params?.ringResolutionMultiplier ?? 1))
  return candidate === 3 || candidate === 6 || candidate === 9 ? candidate : 1
}

export function getEffectiveRingResolution(params) {
  const baseResolution = normalizeRingResolutionToUi(params?.ringResolution ?? 120)
  const multiplier = getRingResolutionMultiplier(params)
  return Math.max(8, baseResolution * multiplier)
}
