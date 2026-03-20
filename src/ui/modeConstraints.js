const MODE_EXECUTION_MATRIX = {
  scripted: ['cpu', 'gpu'],
  fullPhysics: ['cpu', 'gpu', 'hybrid'],
  guidedPhysics: ['cpu', 'gpu', 'hybrid'],
}

export function getExecutionOptionsForMode(dynamicsMode, t) {
  const allowed = MODE_EXECUTION_MATRIX[dynamicsMode] ?? MODE_EXECUTION_MATRIX.scripted
  return allowed.map((mode) =>
    mode === 'hybrid'
      ? { value: mode, label: t('hybrid_gpu_plus_cpu') }
      : { value: mode, label: mode.toUpperCase() },
  )
}

export function getRepresentationOptionsForMode(dynamicsMode, executionMode, t) {
  if (dynamicsMode === 'scripted') {
    return [{ value: 'particles', label: t('particles') }]
  }

  if (executionMode === 'gpu') {
    return [{ value: 'particles', label: t('particles') }]
  }

  if (executionMode === 'hybrid') {
    return [{ value: 'hybrid', label: t('hybrid') }]
  }

  return [
    { value: 'particles', label: t('particles') },
    { value: 'filaments', label: t('filaments') },
    { value: 'hybrid', label: t('hybrid') },
    ...(dynamicsMode === 'guidedPhysics' ? [{ value: 'tubes', label: t('tubes') }] : []),
  ]
}

export function getRepresentationRestrictionHintKey(dynamicsMode, executionMode) {
  if (dynamicsMode === 'scripted') {
    return 'filament_solver_supported_only_in_classic_and_natural'
  }

  if (executionMode === 'gpu') {
    return 'in_gpu_mode_only_particles_are_available_filaments_on_cpu'
  }

  if (executionMode === 'hybrid') {
    return 'hybrid_mode_fixes_representation_and_runs_gpu_plus_cpu'
  }

  return null
}

export function getExecutionRestrictionHintKeys(dynamicsMode) {
  if (dynamicsMode === 'scripted') {
    return ['scripted_mode_hybrid_backend_is_disabled']
  }

  return []
}
