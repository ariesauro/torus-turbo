import { computeExperimentConfigHash, validateExperimentContract } from './experimentSchema'

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function toFiniteNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function normalizeBatchBudget(rawBudget = {}) {
  return {
    maxConcurrentRuns: Math.max(1, Math.floor(toFiniteNumber(rawBudget.maxConcurrentRuns, 1))),
    maxWallClockSec: Math.max(1, Math.floor(toFiniteNumber(rawBudget.maxWallClockSec, 1200))),
    maxRetries: Math.max(0, Math.floor(toFiniteNumber(rawBudget.maxRetries, 1))),
    cooldownMsBetweenRuns: Math.max(0, Math.floor(toFiniteNumber(rawBudget.cooldownMsBetweenRuns, 0))),
  }
}

export function createBatchQueue() {
  const state = {
    pending: [],
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: false,
  }

  return {
    state,
    enqueue(task) {
      state.pending.push(task)
    },
    cancel() {
      state.cancelled = true
    },
  }
}

export async function runExperimentBatch({
  experiment,
  runSingle, // async ({ experiment, runIndex, configHash }) => result
  budget = {},
  onProgress = () => {},
} = {}) {
  const validation = validateExperimentContract(experiment)
  if (!validation.valid) {
    return {
      ok: false,
      error: 'invalid_experiment_contract',
      validationErrors: validation.errors,
      runs: [],
    }
  }
  if (typeof runSingle !== 'function') {
    return {
      ok: false,
      error: 'runSingle must be a function',
      validationErrors: [],
      runs: [],
    }
  }

  const normalizedBudget = normalizeBatchBudget({
    ...validation.normalized.runBudget,
    ...budget,
  })
  const queue = createBatchQueue()
  const configHash = computeExperimentConfigHash(validation.normalized)
  const maxRuns = Math.max(1, Math.floor(validation.normalized.runBudget.maxRuns))

  for (let i = 0; i < maxRuns; i += 1) {
    queue.enqueue({
      runIndex: i,
      retriesLeft: normalizedBudget.maxRetries,
    })
  }

  const startedAt = Date.now()
  const deadline = startedAt + normalizedBudget.maxWallClockSec * 1000
  const runResults = []

  async function workerLoop(workerId) {
    while (!queue.state.cancelled) {
      if (Date.now() > deadline) {
        queue.state.cancelled = true
        break
      }
      const task = queue.state.pending.shift()
      if (!task) {
        break
      }
      queue.state.running += 1
      try {
        const result = await runSingle({
          experiment: validation.normalized,
          runIndex: task.runIndex,
          configHash,
          workerId,
        })
        runResults.push({
          runIndex: task.runIndex,
          ok: true,
          result,
        })
        queue.state.completed += 1
      } catch (error) {
        if (task.retriesLeft > 0 && !queue.state.cancelled) {
          queue.state.pending.push({
            runIndex: task.runIndex,
            retriesLeft: task.retriesLeft - 1,
          })
        } else {
          runResults.push({
            runIndex: task.runIndex,
            ok: false,
            error: String(error?.message ?? error ?? 'run_failed'),
          })
          queue.state.failed += 1
        }
      } finally {
        queue.state.running -= 1
        onProgress({
          completed: queue.state.completed,
          failed: queue.state.failed,
          pending: queue.state.pending.length,
          running: queue.state.running,
          total: maxRuns,
          configHash,
        })
        if (normalizedBudget.cooldownMsBetweenRuns > 0) {
          await sleep(normalizedBudget.cooldownMsBetweenRuns)
        }
      }
    }
  }

  const workerCount = Math.min(normalizedBudget.maxConcurrentRuns, maxRuns)
  const workers = []
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(workerLoop(i))
  }
  await Promise.all(workers)

  return {
    ok: queue.state.failed === 0 && queue.state.completed > 0 && !queue.state.cancelled,
    cancelled: queue.state.cancelled,
    budget: normalizedBudget,
    configHash,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    totals: {
      completed: queue.state.completed,
      failed: queue.state.failed,
      total: maxRuns,
    },
    runs: runResults.sort((a, b) => a.runIndex - b.runIndex),
  }
}
