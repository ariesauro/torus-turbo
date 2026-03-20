const CUSTOM_PROFILE_STORAGE_KEY = 'torusTurboCustomPerfProfilesV1'

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function safeProfileId(input) {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
}

export const BUILTIN_PERFORMANCE_PROFILES = [
  {
    id: 'auto_balanced',
    labelKey: 'perf_profile_auto_balanced',
    descriptionKey: 'perf_profile_auto_balanced_desc',
    paramsPatch: {
      performanceAutoProfileEnabled: true,
      executionMode: 'hybrid',
      vortexRepresentation: 'hybrid',
      particleCount: 12000,
      velocityComputationMode: 'spatialGrid',
      gpuAutoQualityGuardEnabled: true,
      gpuAutoQualityGuardMode: 'minimal',
      gpuChunkSize: 512,
      energyDiagnosticsMaxSamples: 6000,
      structureDetectionMaxSamples: 4500,
      performanceSheetWorkloadBudget: 0.55,
      performanceMaxSheetPanels: 1800,
      performanceRepresentationSwitchCooldown: 10,
    },
  },
  {
    id: 'quality',
    labelKey: 'perf_profile_quality',
    descriptionKey: 'perf_profile_quality_desc',
    paramsPatch: {
      performanceAutoProfileEnabled: false,
      executionMode: 'hybrid',
      vortexRepresentation: 'hybrid',
      particleCount: 22000,
      velocityComputationMode: 'spatialGrid',
      gpuAutoQualityGuardEnabled: false,
      gpuChunkSize: 512,
      energyDiagnosticsMaxSamples: 10000,
      structureDetectionMaxSamples: 8000,
      hybridPlusEnabled: true,
      performanceSheetWorkloadBudget: 0.8,
      performanceMaxSheetPanels: 3200,
      performanceRepresentationSwitchCooldown: 8,
    },
  },
  {
    id: 'quality_explorer',
    labelKey: 'perf_profile_quality_explorer',
    descriptionKey: 'perf_profile_quality_explorer_desc',
    paramsPatch: {
      performanceAutoProfileEnabled: false,
      executionMode: 'hybrid',
      vortexRepresentation: 'hybrid',
      particleCount: 32000,
      velocityComputationMode: 'spatialGrid',
      gpuAutoQualityGuardEnabled: false,
      gpuAutoQualityGuardScope: 'monitor_only',
      gpuAutoQualityGuardMode: 'minimal',
      gpuChunkSize: 512,
      energyDiagnosticsMaxSamples: 18000,
      structureDetectionMaxSamples: 14000,
      hybridPlusEnabled: true,
      hybridPlusAssistBudgetMs: 3.5,
      performanceSheetWorkloadBudget: 1,
      performanceMaxSheetPanels: 7000,
      performanceRepresentationSwitchCooldown: 6,
    },
  },
  {
    id: 'balanced',
    labelKey: 'perf_profile_balanced',
    descriptionKey: 'perf_profile_balanced_desc',
    paramsPatch: {
      performanceAutoProfileEnabled: false,
      executionMode: 'hybrid',
      vortexRepresentation: 'hybrid',
      particleCount: 14000,
      velocityComputationMode: 'spatialGrid',
      gpuAutoQualityGuardEnabled: true,
      gpuAutoQualityGuardMode: 'minimal',
      gpuChunkSize: 512,
      energyDiagnosticsMaxSamples: 8000,
      structureDetectionMaxSamples: 5000,
      hybridPlusEnabled: false,
      performanceSheetWorkloadBudget: 0.55,
      performanceMaxSheetPanels: 1800,
      performanceRepresentationSwitchCooldown: 10,
    },
  },
  {
    id: 'performance',
    labelKey: 'perf_profile_performance',
    descriptionKey: 'perf_profile_performance_desc',
    paramsPatch: {
      performanceAutoProfileEnabled: false,
      executionMode: 'gpu',
      vortexRepresentation: 'particles',
      particleCount: 8000,
      velocityComputationMode: 'spatialGrid',
      gpuAutoQualityGuardEnabled: true,
      gpuAutoQualityGuardMode: 'moderate',
      gpuChunkSize: 768,
      energyDiagnosticsMaxSamples: 3000,
      structureDetectionMaxSamples: 2000,
      hybridPlusEnabled: false,
      performanceSheetWorkloadBudget: 0.35,
      performanceMaxSheetPanels: 900,
      performanceRepresentationSwitchCooldown: 12,
    },
  },
]

const BUILTIN_PROFILE_BY_ID = new Map(BUILTIN_PERFORMANCE_PROFILES.map((profile) => [profile.id, profile]))

export function getBuiltinPerformanceProfile(profileId) {
  return BUILTIN_PROFILE_BY_ID.get(profileId) ?? null
}

export function getRepresentationPolicyPatchForHardwareClass(hardwareClass) {
  if (hardwareClass === 'high') {
    return {
      performanceSheetWorkloadBudget: 0.8,
      performanceMaxSheetPanels: 3200,
      performanceRepresentationSwitchCooldown: 8,
    }
  }
  if (hardwareClass === 'mid') {
    return {
      performanceSheetWorkloadBudget: 0.55,
      performanceMaxSheetPanels: 1800,
      performanceRepresentationSwitchCooldown: 10,
    }
  }
  if (hardwareClass === 'entry_gpu') {
    return {
      performanceSheetWorkloadBudget: 0.35,
      performanceMaxSheetPanels: 900,
      performanceRepresentationSwitchCooldown: 12,
    }
  }
  return {
    performanceSheetWorkloadBudget: 0.2,
    performanceMaxSheetPanels: 500,
    performanceRepresentationSwitchCooldown: 14,
  }
}

function sanitizeCustomProfile(rawProfile, index) {
  if (!rawProfile || typeof rawProfile !== 'object') {
    return null
  }
  const id = safeProfileId(rawProfile.id || rawProfile.name || `custom_${index + 1}`)
  const name = String(rawProfile.name ?? '').trim()
  const paramsPatch =
    rawProfile.paramsPatch && typeof rawProfile.paramsPatch === 'object' ? rawProfile.paramsPatch : null
  if (!id || !name || !paramsPatch) {
    return null
  }
  return {
    id,
    name,
    paramsPatch: { ...paramsPatch },
    custom: true,
  }
}

export function loadCustomPerformanceProfiles() {
  if (typeof window === 'undefined') {
    return []
  }
  const raw = window.localStorage.getItem(CUSTOM_PROFILE_STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .map((profile, index) => sanitizeCustomProfile(profile, index))
      .filter((profile) => profile != null)
  } catch {
    return []
  }
}

export function saveCustomPerformanceProfiles(profiles) {
  if (typeof window === 'undefined') {
    return
  }
  const sanitized = Array.isArray(profiles)
    ? profiles.map((profile, index) => sanitizeCustomProfile(profile, index)).filter((profile) => profile != null)
    : []
  window.localStorage.setItem(CUSTOM_PROFILE_STORAGE_KEY, JSON.stringify(sanitized))
}

export async function detectHardwareProfile() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      hardwareClass: 'unknown',
      recommendedProfileId: 'balanced',
      summary: 'unknown',
    }
  }

  const cpuThreads = clampInt(navigator.hardwareConcurrency, 1, 256, 4)
  const memoryGb = clampInt(navigator.deviceMemory, 1, 256, 8)
  let gpuTier = 'none'
  let gpuLabel = 'none'

  if (navigator.gpu && typeof navigator.gpu.requestAdapter === 'function') {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) {
        const adapterInfo = typeof adapter.requestAdapterInfo === 'function'
          ? await adapter.requestAdapterInfo().catch(() => null)
          : null
        const vendor = String(adapterInfo?.vendor ?? '').trim()
        const architecture = String(adapterInfo?.architecture ?? '').trim()
        const device = String(adapterInfo?.device ?? '').trim()
        const description = [vendor, architecture, device].filter((v) => v.length > 0).join(' ')
        gpuLabel = description || 'webgpu'
        gpuTier = 'discrete_or_unified'
      }
    } catch {
      gpuTier = 'none'
      gpuLabel = 'none'
    }
  }

  let hardwareClass = 'low'
  if (gpuTier !== 'none' && memoryGb >= 16 && cpuThreads >= 8) {
    hardwareClass = 'high'
  } else if (gpuTier !== 'none' && memoryGb >= 8 && cpuThreads >= 6) {
    hardwareClass = 'mid'
  } else if (gpuTier !== 'none' && memoryGb >= 6 && cpuThreads >= 4) {
    hardwareClass = 'entry_gpu'
  }

  const recommendedProfileId =
    hardwareClass === 'high'
      ? 'quality'
      : hardwareClass === 'mid'
        ? 'balanced'
        : hardwareClass === 'entry_gpu'
          ? 'performance'
          : 'performance'

  const summary = `cpu:${cpuThreads} threads, mem:${memoryGb}GB, gpu:${gpuLabel}`
  const representationPolicyPatch = getRepresentationPolicyPatchForHardwareClass(hardwareClass)
  return {
    hardwareClass,
    recommendedProfileId,
    summary,
    cpuThreads,
    memoryGb,
    gpuLabel,
    representationPolicyPatch,
  }
}

export function createCustomProfileFromParams(name, params) {
  const profileName = String(name ?? '').trim()
  if (!profileName) {
    return null
  }
  const id = safeProfileId(`custom_${profileName}`)
  if (!id) {
    return null
  }
  return {
    id,
    name: profileName,
    paramsPatch: {
      executionMode: params.executionMode,
      vortexRepresentation: params.vortexRepresentation,
      particleCount: params.particleCount,
      velocityComputationMode: params.velocityComputationMode,
      gpuChunkSize: params.gpuChunkSize,
      gpuAutoQualityGuardEnabled: params.gpuAutoQualityGuardEnabled,
      gpuAutoQualityGuardMode: params.gpuAutoQualityGuardMode,
      hybridPlusEnabled: params.hybridPlusEnabled,
      hybridPlusAssistBudgetMs: params.hybridPlusAssistBudgetMs,
      hybridPlusAssistCadenceSteps: params.hybridPlusAssistCadenceSteps,
      structureDetectionMaxSamples: params.structureDetectionMaxSamples,
      energyDiagnosticsMaxSamples: params.energyDiagnosticsMaxSamples,
      performanceSheetWorkloadBudget: params.performanceSheetWorkloadBudget,
      performanceMaxSheetPanels: params.performanceMaxSheetPanels,
      performanceRepresentationSwitchCooldown: params.performanceRepresentationSwitchCooldown,
    },
    custom: true,
  }
}
