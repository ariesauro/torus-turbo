import { buildBarnesHutFarFieldDeltas } from './barnesHutAssist'

function unique(items) {
  return Array.from(new Set(items))
}

function clampFinite(value, min, max, fallback) {
  const next = Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, next))
}

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function computeParticleCenter(particles) {
  if (!Array.isArray(particles) || particles.length === 0) {
    return { x: 0, y: 0, z: 0 }
  }
  let sx = 0
  let sy = 0
  let sz = 0
  let count = 0
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i]
    const x = p?.x ?? 0
    const y = p?.y ?? 0
    const z = p?.z ?? 0
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue
    }
    sx += x
    sy += y
    sz += z
    count += 1
  }
  if (count <= 0) {
    return { x: 0, y: 0, z: 0 }
  }
  return { x: sx / count, y: sy / count, z: sz / count }
}

function buildTopologyCorrectionDeltas(particles, params, dt = 0.016) {
  const enabled = params?.hybridPlusTopologyCorrectionEnabled !== false
  if (!enabled || !Array.isArray(particles) || particles.length === 0) {
    return []
  }

  const threshold = clampFinite(params?.hybridPlusTopologyThreshold, 0.01, 4, 0.18)
  const strength = clampFinite(params?.hybridPlusTopologyStrength, 0, 1, 0.25)
  const maxDelta = clampFinite(params?.hybridPlusTopologyMaxDelta, 0.001, 4, 0.12)
  const maxDeltas = Math.max(
    8,
    Math.floor(clampFinite(params?.hybridPlusTopologyMaxDeltas, 8, 4096, 512)),
  )
  if (strength <= 0 || maxDelta <= 0) {
    return []
  }

  const center = computeParticleCenter(particles)
  const ringMajor = Math.max(params?.ringMajor ?? 0, 1e-4)
  const ringMinor = Math.max(params?.ringMinor ?? 0, 1e-4)
  const dtScale = clampFinite(dt / 0.016, 0.25, 2.5, 1)
  const stride = Math.max(1, Math.floor(particles.length / maxDeltas))
  const deltas = []
  for (let index = 0; index < particles.length && deltas.length < maxDeltas; index += stride) {
    const particle = particles[index]
    if (!Number.isFinite(particle?.id)) {
      continue
    }

    // Co-moving correction: project to particle-center frame first.
    // This prevents topology correction from pinning the torus to world origin.
    const lx = (particle.x ?? 0) - center.x
    const ly = (particle.y ?? 0) - center.y
    const lz = (particle.z ?? 0) - center.z
    const theta = Math.atan2(ly, lx)
    const tubeCenterX = ringMajor * Math.cos(theta)
    const tubeCenterY = ringMajor * Math.sin(theta)
    const tubeCenterZ = 0
    const rx = lx - tubeCenterX
    const ry = ly - tubeCenterY
    const rz = lz - tubeCenterZ
    const localMinorRadius = Math.hypot(rx, ry, rz)
    if (localMinorRadius <= 1e-8) {
      continue
    }

    const radiusError = localMinorRadius - ringMinor
    const absError = Math.abs(radiusError)
    if (absError <= threshold) {
      continue
    }

    const correctionMagnitude = Math.min(maxDelta, (absError - threshold) * strength * dtScale)
    const sign = radiusError > 0 ? -1 : 1
    const ratio = (correctionMagnitude * sign) / localMinorRadius
    deltas.push({
      id: particle.id,
      dx: rx * ratio,
      dy: ry * ratio,
      dz: rz * ratio,
    })
  }
  return deltas
}

function applyParticleDeltasLocal(particles, deltas, dt) {
  if (!Array.isArray(particles) || !Array.isArray(deltas) || deltas.length === 0) {
    return 0
  }

  const byId = new Map()
  for (let i = 0; i < particles.length; i += 1) {
    byId.set(particles[i].id, particles[i])
  }

  let appliedCount = 0
  const invDt = 1 / Math.max(dt ?? 0.016, 1e-4)
  for (let i = 0; i < deltas.length; i += 1) {
    const delta = deltas[i]
    const particle = byId.get(delta.id)
    if (!particle) {
      continue
    }

    const dx = delta.dx ?? 0
    const dy = delta.dy ?? 0
    const dz = delta.dz ?? 0
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) {
      continue
    }

    particle.x = (particle.x ?? 0) + dx
    particle.y = (particle.y ?? 0) + dy
    particle.z = (particle.z ?? 0) + dz
    particle.vx = dx * invDt
    particle.vy = dy * invDt
    particle.vz = dz * invDt
    particle.velocity = { x: particle.vx, y: particle.vy, z: particle.vz }
    particle.flowVx = Number.isFinite(particle.flowVx) ? particle.flowVx + dx * invDt : dx * invDt
    particle.flowVy = Number.isFinite(particle.flowVy) ? particle.flowVy + dy * invDt : dy * invDt
    particle.flowVz = Number.isFinite(particle.flowVz) ? particle.flowVz + dz * invDt : dz * invDt
    appliedCount += 1
  }

  return appliedCount
}

function mergeDeltas(...groups) {
  const map = new Map()
  for (let gi = 0; gi < groups.length; gi += 1) {
    const group = groups[gi]
    if (!Array.isArray(group)) {
      continue
    }
    for (let i = 0; i < group.length; i += 1) {
      const delta = group[i]
      if (!Number.isFinite(delta?.id)) {
        continue
      }
      const current = map.get(delta.id) ?? { id: delta.id, dx: 0, dy: 0, dz: 0 }
      current.dx += delta.dx ?? 0
      current.dy += delta.dy ?? 0
      current.dz += delta.dz ?? 0
      map.set(delta.id, current)
    }
  }
  return Array.from(map.values())
}

export function createHybridPlusOperatorRegistry() {
  return [
    {
      id: 'particle_bulk_flow',
      stage: 'bulk',
      supports: ['cpu', 'gpu'],
      defaultBackend: 'gpu',
      description: 'Bulk particle flow and advection stage',
    },
    {
      id: 'natural_direction_modulation',
      stage: 'guidance',
      supports: ['cpu', 'gpu'],
      defaultBackend: 'gpu',
      description: 'Natural alpha-guided circulation direction modulation',
    },
    {
      id: 'topology_deformation',
      stage: 'topology',
      supports: ['cpu'],
      defaultBackend: 'cpu',
      description: 'Topology-heavy deformation operator family',
    },
    {
      id: 'barnes_hut_farfield',
      stage: 'correction',
      supports: ['cpu'],
      defaultBackend: 'cpu',
      description: 'Barnes-Hut far-field velocity correction (CPU assist)',
    },
  ]
}

export function selectHybridPlusAssistOperators(plan, operatorRegistry) {
  if (!plan?.active || !Array.isArray(operatorRegistry) || operatorRegistry.length === 0) {
    return []
  }

  return operatorRegistry
    .filter((operator) => operator?.supports?.includes(plan.assistBackend))
    .filter((operator) => operator?.defaultBackend === plan.assistBackend)
}

export function getHybridPlusOperatorCapabilities(operatorRegistry = []) {
  return operatorRegistry.map((operator) => ({
    id: operator.id,
    stage: operator.stage,
    supports: unique(operator.supports ?? []),
    defaultBackend: operator.defaultBackend,
  }))
}

export function runHybridPlusAssistPass({
  plan,
  operatorRegistry,
  particles = [],
  params = {},
  dt = 0.016,
  webgpuManager = null,
}) {
  const totalStartMs = nowMs()
  const selected = selectHybridPlusAssistOperators(plan, operatorRegistry)

  if (!plan?.active || selected.length === 0) {
    return {
      applied: false,
      selectedOperatorIds: selected.map((operator) => operator.id),
      reason: plan?.active ? 'no_compatible_operators' : 'inactive',
      syncMode: plan?.syncPolicy?.mode ?? 'none',
      producedDeltaCount: 0,
      appliedDeltaCount: 0,
      rejectedDeltaCount: 0,
      topologyProducedCount: 0,
      barnesHutProducedCount: 0,
      topologyCostMs: 0,
      barnesHutCostMs: 0,
      applyCostMs: 0,
      assistCostMs: nowMs() - totalStartMs,
    }
  }

  let topologyDeltas = []
  let barnesHutDeltas = []
  let topologyCostMs = 0
  let barnesHutCostMs = 0

  const hasTopologyOperator = selected.some((operator) => operator.id === 'topology_deformation')
  if (hasTopologyOperator && plan.assistBackend === 'cpu') {
    const topologyStartMs = nowMs()
    topologyDeltas = buildTopologyCorrectionDeltas(particles, params, dt)
    topologyCostMs = nowMs() - topologyStartMs
  }
  const hasBarnesHutOperator = selected.some((operator) => operator.id === 'barnes_hut_farfield')
  if (hasBarnesHutOperator && plan.assistBackend === 'cpu') {
    const barnesHutStartMs = nowMs()
    barnesHutDeltas = buildBarnesHutFarFieldDeltas(particles, params, dt)
    barnesHutCostMs = nowMs() - barnesHutStartMs
  }
  const deltas = mergeDeltas(topologyDeltas, barnesHutDeltas)
  const applyStartMs = nowMs()
  const appliedDeltaCount = applyParticleDeltasLocal(particles, deltas, dt)
  const applyCostMs = nowMs() - applyStartMs
  if (
    appliedDeltaCount > 0 &&
    plan.baseBackend === 'gpu' &&
    webgpuManager &&
    typeof webgpuManager.queueParticleDeltas === 'function'
  ) {
    webgpuManager.queueParticleDeltas(deltas)
  }

  return {
    applied: appliedDeltaCount > 0,
    selectedOperatorIds: selected.map((operator) => operator.id),
    reason: appliedDeltaCount > 0 ? 'assist_pass_applied' : 'assist_pass_no_deltas',
    syncMode: plan?.syncPolicy?.mode ?? 'none',
    producedDeltaCount: deltas.length,
    appliedDeltaCount,
    rejectedDeltaCount: Math.max(0, deltas.length - appliedDeltaCount),
    topologyProducedCount: topologyDeltas.length,
    barnesHutProducedCount: barnesHutDeltas.length,
    topologyCostMs,
    barnesHutCostMs,
    applyCostMs,
    assistCostMs: nowMs() - totalStartMs,
  }
}
