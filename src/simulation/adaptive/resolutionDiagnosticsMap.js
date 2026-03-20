const LEVELS = ['L0', 'L1', 'L2', 'L3']

function levelIndex(level) {
  return Math.max(0, LEVELS.indexOf(level))
}

export function buildResolutionDiagnosticsMap(trace = [], sampleEveryMs = 300) {
  const safeTrace = Array.isArray(trace) ? trace : []
  const occupancy = { L0: 0, L1: 0, L2: 0, L3: 0 }
  const transitions = {
    L0: { L0: 0, L1: 0, L2: 0, L3: 0 },
    L1: { L0: 0, L1: 0, L2: 0, L3: 0 },
    L2: { L0: 0, L1: 0, L2: 0, L3: 0 },
    L3: { L0: 0, L1: 0, L2: 0, L3: 0 },
  }

  let prevLevel = null
  for (let i = 0; i < safeTrace.length; i += 1) {
    const step = safeTrace[i]
    const nextLevel = LEVELS.includes(step?.nextLevel) ? step.nextLevel : 'L1'
    occupancy[nextLevel] += sampleEveryMs
    if (prevLevel) {
      transitions[prevLevel][nextLevel] += 1
    }
    prevLevel = nextLevel
  }

  const totalMs = Object.values(occupancy).reduce((acc, value) => acc + value, 0)
  const occupancyPct = {
    L0: totalMs > 0 ? (occupancy.L0 / totalMs) * 100 : 0,
    L1: totalMs > 0 ? (occupancy.L1 / totalMs) * 100 : 0,
    L2: totalMs > 0 ? (occupancy.L2 / totalMs) * 100 : 0,
    L3: totalMs > 0 ? (occupancy.L3 / totalMs) * 100 : 0,
  }

  let dominantLevel = 'L1'
  let dominantValue = -1
  for (let i = 0; i < LEVELS.length; i += 1) {
    const level = LEVELS[i]
    if (occupancyPct[level] > dominantValue) {
      dominantLevel = level
      dominantValue = occupancyPct[level]
    }
  }

  let transitionCount = 0
  for (let r = 0; r < LEVELS.length; r += 1) {
    for (let c = 0; c < LEVELS.length; c += 1) {
      if (r !== c) transitionCount += transitions[LEVELS[r]][LEVELS[c]]
    }
  }

  const pathComplexity = Math.max(0, transitionCount / Math.max(1, safeTrace.length))

  return {
    levels: LEVELS,
    occupancyMs: occupancy,
    occupancyPct,
    transitions,
    dominantLevel,
    transitionCount,
    pathComplexity,
    averageLevelIndex:
      safeTrace.length > 0
        ? safeTrace.reduce((acc, step) => acc + levelIndex(step?.nextLevel), 0) / safeTrace.length
        : 1,
  }
}
