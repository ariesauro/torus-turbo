function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function toFinite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toVerdict(pass, warn) {
  if (pass) return 'pass'
  if (warn) return 'warn'
  return 'fail'
}

function resolveDriftCapByHardwareClass(hardwareClass) {
  if (hardwareClass === 'high') return 3
  if (hardwareClass === 'mid') return 4
  if (hardwareClass === 'entry_gpu') return 5
  return 6
}

export function buildSheetCouplingContracts(params = {}, sheetDiscretization = {}) {
  const workloadBudget = clamp01(params?.performanceSheetWorkloadBudget ?? 0.35)
  const hardwareClass = String(params?.performanceHardwareClass ?? 'unknown').toLowerCase()
  const detectedFilaments = Math.max(0, Math.floor(toFinite(params?.runtimeDetectedFilamentCount, 0)))
  const driftSeverity = clamp01(params?.runtimeStabilityAdaptiveDriftSeverity ?? 0)
  const readiness = clamp01(sheetDiscretization?.readiness ?? 0)
  const demandCoverage = clamp01(sheetDiscretization?.demandCoverage ?? 0)
  const meshContractValid = sheetDiscretization?.meshBuilderContract?.valid === true
  const qualityVerdict = String(sheetDiscretization?.qualityVerdict ?? 'fail')
  const qualityFactor = qualityVerdict === 'pass' ? 1 : qualityVerdict === 'warn' ? 0.72 : 0.38
  const admissibility = clamp01(readiness * 0.6 + demandCoverage * 0.25 + qualityFactor * 0.15)

  const amerTransferBudget = clamp01(0.22 + workloadBudget * 0.62)
  const amerInvariantDriftCapPct = resolveDriftCapByHardwareClass(hardwareClass)
  const amerPass = meshContractValid && admissibility >= 0.72 && driftSeverity <= 0.45
  const amerWarn = meshContractValid && admissibility >= 0.5 && driftSeverity <= 0.72
  const amerState = toVerdict(amerPass, amerWarn)

  const filamentNodeTransferCap = Math.max(
    24,
    Math.floor(toFinite(params?.performanceMaxSheetPanels, 900) * (0.06 + workloadBudget * 0.18)),
  )
  const filamentLoad = clamp01(detectedFilaments / Math.max(1, filamentNodeTransferCap))
  const filamentPass = meshContractValid && admissibility >= 0.68 && filamentLoad <= 0.8
  const filamentWarn = meshContractValid && admissibility >= 0.45 && filamentLoad <= 1.05
  const filamentState = toVerdict(filamentPass, filamentWarn)

  const rollupStabilityGuard =
    amerState === 'fail' || filamentState === 'fail' || driftSeverity > 0.72 ? 'engaged' : 'clear'
  const verdict =
    amerState === 'fail' || filamentState === 'fail'
      ? 'fail'
      : amerState === 'warn' || filamentState === 'warn'
        ? 'warn'
        : 'pass'
  const valid = verdict !== 'fail'
  const penalty =
    verdict === 'pass' ? 0 : verdict === 'warn' ? 0.18 + (rollupStabilityGuard === 'engaged' ? 0.1 : 0) : 0.45

  return {
    version: 'tt021c.sheet_coupling.v1',
    valid,
    verdict,
    penalty: clamp01(penalty),
    amer: {
      state: amerState,
      transferBudget: amerTransferBudget,
      invariantDriftCapPct: amerInvariantDriftCapPct,
    },
    filament: {
      state: filamentState,
      nodeTransferCap: filamentNodeTransferCap,
      load: filamentLoad,
    },
    rollupStabilityGuard,
  }
}
