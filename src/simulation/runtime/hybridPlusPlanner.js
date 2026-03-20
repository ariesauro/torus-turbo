const DEFAULT_REASON = 'disabled'

function clampFinite(value, min, max, fallback) {
  const next = Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, next))
}

function getBaseBackend(params, runtimeStatus) {
  // Use requested backend from params to avoid one-frame lag
  // when switching CPU <-> GPU in runtime diagnostics and planner decisions.
  if (runtimeStatus?.backend === 'gpu_error') {
    return params?.physicsBackend === 'cpu' ? 'cpu' : 'gpu'
  }
  return params?.physicsBackend === 'cpu' ? 'cpu' : 'gpu'
}

function getAssistBackend(baseBackend, params) {
  const naturalHybridFilamentMode =
    params?.dynamicsMode === 'guidedPhysics' && params?.vortexRepresentation === 'hybrid'
  if (naturalHybridFilamentMode) {
    return 'cpu'
  }
  if (baseBackend === 'cpu') {
    return params?.hybridPlusCpuBaseAssistBackend === 'cpu' ? 'cpu' : 'gpu'
  }
  return 'cpu'
}

function isNaturalHybridPlusMode(params) {
  if (params?.dynamicsMode !== 'guidedPhysics') {
    return false
  }
  return params?.vortexRepresentation === 'particles' || params?.vortexRepresentation === 'hybrid'
}

function shouldEnableBarnesHut(params, runtimeStatus) {
  if (params?.hybridPlusBarnesHutEnabled !== true) {
    return false
  }

  if (params?.hybridPlusBarnesHutAuto !== true) {
    return true
  }

  const particleCount = Math.max(0, Math.floor(params?.particleCount ?? 0))
  const stepMs = Number.isFinite(runtimeStatus?.stepMs)
    ? runtimeStatus.stepMs
    : params?.runtimeGpuStepMs ?? 0
  const particleThreshold = Math.max(
    64,
    Math.floor(clampFinite(params?.hybridPlusBarnesHutAutoParticleThreshold, 64, 50000, 1200)),
  )
  const stepThresholdMs = clampFinite(
    params?.hybridPlusBarnesHutAutoStepMsThreshold,
    1,
    100,
    10,
  )

  return particleCount >= particleThreshold || stepMs >= stepThresholdMs
}

function selectAssistOperators(params, runtimeStatus, operatorRegistry, assistBackend) {
  if (!Array.isArray(operatorRegistry) || operatorRegistry.length === 0) {
    return []
  }

  return operatorRegistry
    .filter((operator) => operator?.supports?.includes(assistBackend))
    .filter((operator) => {
      if (operator.id === 'topology_deformation') {
        return params?.hybridPlusTopologyCorrectionEnabled !== false
      }
      if (operator.id === 'barnes_hut_farfield') {
        return shouldEnableBarnesHut(params, runtimeStatus)
      }
      return true
    })
    .map((operator) => operator.id)
}

function getSyncPolicy(params) {
  const budgetMs = clampFinite(params?.hybridPlusAssistBudgetMs, 0.1, 12, 2)
  const cadenceSteps = Math.max(
    1,
    Math.floor(clampFinite(params?.hybridPlusAssistCadenceSteps, 1, 32, 1)),
  )
  return {
    mode: 'delta',
    cadenceSteps,
    assistBudgetMs: budgetMs,
  }
}

function resolveAdaptiveCadence({
  params,
  syncPolicy,
  selectedOperatorIds,
  previousState,
}) {
  const adaptiveEnabled = params?.hybridPlusAssistAdaptiveCadenceEnabled !== false
  const maxCadenceSteps = Math.max(
    syncPolicy.cadenceSteps,
    Math.floor(
      clampFinite(
        params?.hybridPlusAssistAdaptiveMaxCadenceSteps,
        syncPolicy.cadenceSteps,
        64,
        Math.max(4, syncPolicy.cadenceSteps),
      ),
    ),
  )
  const overBudgetTolerancePct = clampFinite(
    params?.hybridPlusAssistOverBudgetTolerancePct,
    0,
    200,
    15,
  )
  const idleDeltaThreshold = Math.max(
    0,
    Math.floor(clampFinite(params?.hybridPlusAssistIdleDeltaThreshold, 0, 4096, 12)),
  )
  const previousAssistCostMs = Number(previousState?.assistCostMs ?? 0) || 0
  const previousProducedDeltaCount = Math.max(
    0,
    Math.floor(Number(previousState?.producedDeltaCount ?? 0) || 0),
  )
  const budgetMs = syncPolicy.assistBudgetMs
  const overBudgetLimit = budgetMs * (1 + overBudgetTolerancePct / 100)
  const overBudget = previousAssistCostMs > overBudgetLimit
  const idle = previousProducedDeltaCount <= idleDeltaThreshold
  const prevOverBudgetStreak = Math.max(
    0,
    Math.floor(Number(previousState?.assistOverBudgetStreak ?? 0) || 0),
  )
  const prevIdleStreak = Math.max(
    0,
    Math.floor(Number(previousState?.assistIdleStreak ?? 0) || 0),
  )
  const overBudgetStreak = overBudget ? prevOverBudgetStreak + 1 : Math.max(0, prevOverBudgetStreak - 1)
  const idleStreak = !overBudget && idle ? prevIdleStreak + 1 : Math.max(0, prevIdleStreak - 1)
  const pressureRaw = budgetMs > 1e-6 ? previousAssistCostMs / budgetMs : 0
  const budgetPressure = clampFinite(pressureRaw, 0, 10, 0)

  let cadenceStepsRuntime = syncPolicy.cadenceSteps
  if (adaptiveEnabled) {
    if (overBudgetStreak >= 2) {
      cadenceStepsRuntime += Math.max(1, Math.floor(overBudgetStreak / 2))
    }
    if (idleStreak >= 3) {
      cadenceStepsRuntime += 1
    }
    if (previousProducedDeltaCount >= Math.max(8, idleDeltaThreshold * 4)) {
      cadenceStepsRuntime = Math.max(syncPolicy.cadenceSteps, cadenceStepsRuntime - 1)
    }
    cadenceStepsRuntime = Math.min(maxCadenceSteps, cadenceStepsRuntime)
  }

  const canShedBarnesHut =
    selectedOperatorIds.includes('topology_deformation') &&
    selectedOperatorIds.includes('barnes_hut_farfield')
  const shedBarnesHut =
    adaptiveEnabled &&
    canShedBarnesHut &&
    overBudgetStreak >= 3 &&
    previousAssistCostMs > budgetMs * 1.25

  return {
    adaptiveEnabled,
    maxCadenceSteps,
    cadenceStepsRuntime,
    overBudgetTolerancePct,
    idleDeltaThreshold,
    overBudgetStreak,
    idleStreak,
    overBudget,
    budgetPressure,
    shedBarnesHut,
  }
}

export function createHybridPlusState() {
  return {
    enabled: false,
    active: false,
    reason: DEFAULT_REASON,
    baseBackend: 'cpu',
    assistBackend: 'gpu',
    syncMode: 'none',
    selectedOperatorCount: 0,
    assistBudgetMs: 0,
    assistCostMs: 0,
    producedDeltaCount: 0,
    appliedDeltaCount: 0,
    rejectedDeltaCount: 0,
    topologyProducedCount: 0,
    barnesHutProducedCount: 0,
    topologyCostMs: 0,
    barnesHutCostMs: 0,
    applyCostMs: 0,
    assistCadenceBaseSteps: 1,
    assistCadenceRuntimeSteps: 1,
    assistCadenceAdaptive: true,
    assistCadenceMaxSteps: 4,
    assistOverBudgetStreak: 0,
    assistIdleStreak: 0,
    assistOverBudget: false,
    assistBudgetPressure: 0,
    assistSkipCadenceCount: 0,
    assistSkipBudgetCount: 0,
    assistRunCount: 0,
  }
}

export function planHybridPlusStep({ params, runtimeStatus, operatorRegistry, previousState = null }) {
  const enabled = params?.hybridPlusEnabled === true
  const baseBackend = getBaseBackend(params, runtimeStatus)
  const assistBackend = getAssistBackend(baseBackend, params)

  if (!enabled) {
    return {
      enabled: false,
      active: false,
      reason: DEFAULT_REASON,
      baseBackend,
      assistBackend,
      syncPolicy: { mode: 'none', cadenceSteps: 0, assistBudgetMs: 0 },
      selectedOperatorIds: [],
    }
  }

  if (!isNaturalHybridPlusMode(params)) {
    return {
      enabled: true,
      active: false,
      reason: 'unsupported_mode_matrix',
      baseBackend,
      assistBackend,
      syncPolicy: { mode: 'none', cadenceSteps: 0, assistBudgetMs: 0 },
      selectedOperatorIds: [],
    }
  }

  const syncPolicy = getSyncPolicy(params)
  let selectedOperatorIds = selectAssistOperators(
    params,
    runtimeStatus,
    operatorRegistry,
    assistBackend,
  )
  const adaptiveCadence = resolveAdaptiveCadence({
    params,
    syncPolicy,
    selectedOperatorIds,
    previousState,
  })
  if (adaptiveCadence.shedBarnesHut) {
    selectedOperatorIds = selectedOperatorIds.filter((id) => id !== 'barnes_hut_farfield')
  }
  const active = selectedOperatorIds.length > 0
  const reason = active
    ? adaptiveCadence.shedBarnesHut
      ? 'active_topology_budget_guard'
      : 'active'
    : 'no_assist_operator_enabled'

  return {
    enabled: true,
    active,
    reason,
    baseBackend,
    assistBackend,
    syncPolicy: {
      ...syncPolicy,
      cadenceStepsRuntime: adaptiveCadence.cadenceStepsRuntime,
      adaptiveEnabled: adaptiveCadence.adaptiveEnabled,
      maxCadenceSteps: adaptiveCadence.maxCadenceSteps,
    },
    scheduler: {
      overBudgetTolerancePct: adaptiveCadence.overBudgetTolerancePct,
      idleDeltaThreshold: adaptiveCadence.idleDeltaThreshold,
      overBudgetStreak: adaptiveCadence.overBudgetStreak,
      idleStreak: adaptiveCadence.idleStreak,
      overBudget: adaptiveCadence.overBudget,
      budgetPressure: adaptiveCadence.budgetPressure,
      shedBarnesHut: adaptiveCadence.shedBarnesHut,
    },
    selectedOperatorIds,
  }
}

export function summarizeHybridPlusState(plan, assistResult, previousState = null) {
  const selectedOperatorIds =
    assistResult?.selectedOperatorIds ?? plan?.selectedOperatorIds ?? []
  const assistReason = String(assistResult?.reason ?? '')
  const skipByCadence = assistReason === 'assist_cadence_skip'
  const skipByBudget = assistReason === 'assist_budget_skip'
  const assistRun = assistReason === 'assist_pass_applied' || assistReason === 'assist_pass_no_deltas'
  const previousRunCount = Math.max(0, Math.floor(Number(previousState?.assistRunCount ?? 0) || 0))
  const previousSkipCadenceCount = Math.max(
    0,
    Math.floor(Number(previousState?.assistSkipCadenceCount ?? 0) || 0),
  )
  const previousSkipBudgetCount = Math.max(
    0,
    Math.floor(Number(previousState?.assistSkipBudgetCount ?? 0) || 0),
  )

  return {
    enabled: Boolean(plan?.enabled),
    active: Boolean(plan?.active),
    reason: plan?.reason ?? DEFAULT_REASON,
    baseBackend: plan?.baseBackend ?? 'cpu',
    assistBackend: plan?.assistBackend ?? 'gpu',
    syncMode: plan?.syncPolicy?.mode ?? 'none',
    selectedOperatorCount: selectedOperatorIds.length,
    assistBudgetMs: plan?.syncPolicy?.assistBudgetMs ?? 0,
    assistCostMs: assistResult?.assistCostMs ?? 0,
    producedDeltaCount: assistResult?.producedDeltaCount ?? 0,
    appliedDeltaCount: assistResult?.appliedDeltaCount ?? 0,
    rejectedDeltaCount: assistResult?.rejectedDeltaCount ?? 0,
    topologyProducedCount: assistResult?.topologyProducedCount ?? 0,
    barnesHutProducedCount: assistResult?.barnesHutProducedCount ?? 0,
    topologyCostMs: assistResult?.topologyCostMs ?? 0,
    barnesHutCostMs: assistResult?.barnesHutCostMs ?? 0,
    applyCostMs: assistResult?.applyCostMs ?? 0,
    assistCadenceBaseSteps: plan?.syncPolicy?.cadenceSteps ?? 1,
    assistCadenceRuntimeSteps:
      plan?.syncPolicy?.cadenceStepsRuntime ?? plan?.syncPolicy?.cadenceSteps ?? 1,
    assistCadenceAdaptive: plan?.syncPolicy?.adaptiveEnabled !== false,
    assistCadenceMaxSteps: plan?.syncPolicy?.maxCadenceSteps ?? plan?.syncPolicy?.cadenceSteps ?? 1,
    assistOverBudgetStreak: plan?.scheduler?.overBudgetStreak ?? 0,
    assistIdleStreak: plan?.scheduler?.idleStreak ?? 0,
    assistOverBudget: plan?.scheduler?.overBudget === true,
    assistBudgetPressure: plan?.scheduler?.budgetPressure ?? 0,
    assistSkipCadenceCount: previousSkipCadenceCount + (skipByCadence ? 1 : 0),
    assistSkipBudgetCount: previousSkipBudgetCount + (skipByBudget ? 1 : 0),
    assistRunCount: previousRunCount + (assistRun ? 1 : 0),
  }
}
