export function createFrameScheduler({
  fixedStep = 1 / 60,
  maxCatchUpSteps = 5,
  maxFrameDelta = 0.05,
  initialTime = typeof performance !== 'undefined' ? performance.now() : Date.now(),
} = {}) {
  return {
    fixedStep,
    maxCatchUpSteps,
    maxFrameDelta,
    accumulator: 0,
    lastFrameTime: initialTime,
  }
}

export function beginFrame(scheduler, now) {
  const frameDelta = Math.min(
    scheduler.maxFrameDelta,
    Math.max(0, (now - scheduler.lastFrameTime) / 1000),
  )
  scheduler.lastFrameTime = now
  scheduler.accumulator += frameDelta
  return frameDelta
}

export function hasPendingSimulationStep(scheduler) {
  return scheduler.accumulator >= scheduler.fixedStep
}

export function consumeSimulationStep(scheduler) {
  scheduler.accumulator -= scheduler.fixedStep
}

export function dropSchedulerOverflow(scheduler) {
  if (scheduler.accumulator > scheduler.fixedStep * scheduler.maxCatchUpSteps) {
    scheduler.accumulator = 0
    return true
  }

  return false
}
