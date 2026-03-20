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

function toInt(value, fallback = 0) {
  return Math.max(0, Math.floor(toFinite(value, fallback)))
}

function distance3(a, b) {
  const dx = (a?.x ?? 0) - (b?.x ?? 0)
  const dy = (a?.y ?? 0) - (b?.y ?? 0)
  const dz = (a?.z ?? 0) - (b?.z ?? 0)
  return Math.hypot(dx, dy, dz)
}

function normalizeFeature(feature) {
  return {
    class: String(feature?.class ?? 'cluster'),
    confidence: clamp01(feature?.confidence ?? 0),
    center: {
      x: toFinite(feature?.center?.x, 0),
      y: toFinite(feature?.center?.y, 0),
      z: toFinite(feature?.center?.z, 0),
    },
    radius: Math.max(1e-4, toFinite(feature?.radius, 0.1)),
    count: toInt(feature?.count, 0),
  }
}

function normalizeEvent(event) {
  return {
    eventId: toInt(event?.eventId, 0),
    frame: toInt(event?.frame, 0),
    eventType: String(event?.eventType ?? 'vortex_birth'),
    subjectIds: Array.isArray(event?.subjectIds)
      ? event.subjectIds.slice(0, 8).map((id) => String(id))
      : [],
    parentIds: Array.isArray(event?.parentIds)
      ? event.parentIds.slice(0, 8).map((id) => String(id))
      : [],
    childIds: Array.isArray(event?.childIds)
      ? event.childIds.slice(0, 8).map((id) => String(id))
      : [],
    confidence: clamp01(event?.confidence ?? 0),
    deltaEnergy: toFinite(event?.deltaEnergy, 0),
    deltaCirculation: toFinite(event?.deltaCirculation, 0),
  }
}

function buildGraphSnapshot(objectsById, eventLog) {
  const nodes = Array.from(objectsById.values())
    .slice(-96)
    .map((item) => ({
      id: String(item.id),
      type: String(item.type),
      ageSteps: toInt(item.ageSteps, 0),
      energy: toFinite(item.energy, 0),
      circulation: toFinite(item.circulation, 0),
      radius: Math.max(1e-4, toFinite(item.radius, 0.1)),
      velocity: Math.max(0, toFinite(item.velocity, 0)),
      lifetimeSec: Math.max(0, toFinite(item.lifetimeSec, 0)),
      creationFrame: toInt(item.creationFrame, 0),
      parents: Array.isArray(item.parents) ? item.parents.slice(0, 8).map((id) => String(id)) : [],
      children: Array.isArray(item.children) ? item.children.slice(0, 8).map((id) => String(id)) : [],
    }))
  const edges = []
  const seen = new Set()
  const recentEvents = Array.isArray(eventLog) ? eventLog.slice(-240) : []
  for (let i = 0; i < recentEvents.length; i += 1) {
    const event = recentEvents[i]
    const parents = Array.isArray(event.parentIds) ? event.parentIds : []
    const children = Array.isArray(event.childIds) ? event.childIds : []
    for (let p = 0; p < parents.length; p += 1) {
      for (let c = 0; c < children.length; c += 1) {
        const from = String(parents[p])
        const to = String(children[c])
        const key = `${from}->${to}:${event.eventType}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({
          from,
          to,
          eventType: String(event.eventType ?? 'vortex_merge'),
          frame: toInt(event.frame, 0),
        })
      }
    }
  }
  return { nodes, edges }
}

function addEvent(state, event) {
  state.eventSerial += 1
  const entry = normalizeEvent({ ...event, eventId: state.eventSerial })
  state.eventLog.push(entry)
  if (state.eventLog.length > 240) {
    state.eventLog.splice(0, state.eventLog.length - 240)
  }
  state.latestEvent = entry
  const type = entry.eventType
  if (type === 'vortex_birth') state.counters.birth += 1
  else if (type === 'vortex_decay') state.counters.decay += 1
  else if (type === 'vortex_merge') state.counters.merge += 1
  else if (type === 'vortex_split') state.counters.split += 1
  else if (type === 'vortex_reconnection') state.counters.reconnection += 1
}

export function createTopologyTrackingState() {
  return {
    frameSerial: 0,
    eventSerial: 0,
    objectSerial: 0,
    lastTransitionCommitted: 0,
    eventLog: [],
    latestEvent: null,
    objectsById: new Map(),
    counters: {
      birth: 0,
      decay: 0,
      merge: 0,
      split: 0,
      reconnection: 0,
    },
  }
}

export function buildTopologyEventsCsv(eventLog = []) {
  const header = [
    'eventId',
    'frame',
    'eventType',
    'subjectIds',
    'parentIds',
    'childIds',
    'confidence',
    'deltaEnergy',
    'deltaCirculation',
  ]
  const rows = [header.join(',')]
  const list = Array.isArray(eventLog) ? eventLog : []
  for (let i = 0; i < list.length; i += 1) {
    const event = normalizeEvent(list[i])
    rows.push(
      [
        event.eventId,
        event.frame,
        event.eventType,
        `"${event.subjectIds.join('|')}"`,
        `"${event.parentIds.join('|')}"`,
        `"${event.childIds.join('|')}"`,
        event.confidence.toFixed(6),
        event.deltaEnergy.toFixed(6),
        event.deltaCirculation.toFixed(6),
      ].join(','),
    )
  }
  return rows.join('\n')
}

export function updateTopologyTrackingState(stateInput, detections = {}, newtonium = {}, params = {}) {
  const state = stateInput ?? createTopologyTrackingState()
  state.frameSerial = toInt(state.frameSerial, 0) + 1
  state.counters = state.counters ?? { birth: 0, decay: 0, merge: 0, split: 0, reconnection: 0 }
  const dt = Math.max(1e-5, toFinite(params.fixedStep, 1 / 60))
  const overlay = Array.isArray(detections.overlayFeatures) ? detections.overlayFeatures.slice(0, 24) : []
  const features = overlay.map(normalizeFeature)
  const prevActive = Array.from(state.objectsById.values()).filter((item) => item.lastFrame === state.frameSerial - 1)
  const usedPrevIds = new Set()
  const nextObjects = []
  const newObjectsByClass = new Map()

  for (let i = 0; i < features.length; i += 1) {
    const feature = features[i]
    let best = null
    let bestDist = Number.POSITIVE_INFINITY
    for (let p = 0; p < prevActive.length; p += 1) {
      const candidate = prevActive[p]
      if (candidate.type !== feature.class || usedPrevIds.has(candidate.id)) continue
      const dist = distance3(candidate.center, feature.center)
      const threshold = Math.max(0.4, feature.radius * 1.8, candidate.radius * 1.2)
      if (dist <= threshold && dist < bestDist) {
        best = candidate
        bestDist = dist
      }
    }
    if (best) {
      usedPrevIds.add(best.id)
      const velocity = bestDist / dt
      const updated = {
        ...best,
        center: feature.center,
        confidence: feature.confidence,
        radius: feature.radius,
        velocity,
        ageSteps: toInt(best.ageSteps, 0) + 1,
        lifetimeSec: toFinite(best.lifetimeSec, 0) + dt,
        lastFrame: state.frameSerial,
        energy: clamp01(feature.confidence * 0.7 + Math.min(1, feature.radius / 2) * 0.3),
        circulation: clamp01(feature.count / 128),
      }
      state.objectsById.set(updated.id, updated)
      nextObjects.push(updated)
      continue
    }
    state.objectSerial += 1
    const id = `vtx_${state.objectSerial}`
    const spawned = {
      id,
      type: feature.class,
      center: feature.center,
      confidence: feature.confidence,
      radius: feature.radius,
      velocity: 0,
      ageSteps: 1,
      lifetimeSec: dt,
      creationFrame: state.frameSerial,
      lastFrame: state.frameSerial,
      energy: clamp01(feature.confidence * 0.7 + Math.min(1, feature.radius / 2) * 0.3),
      circulation: clamp01(feature.count / 128),
      parents: [],
      children: [],
    }
    state.objectsById.set(id, spawned)
    nextObjects.push(spawned)
    const list = newObjectsByClass.get(feature.class) ?? []
    list.push(spawned)
    newObjectsByClass.set(feature.class, list)
    addEvent(state, {
      frame: state.frameSerial,
      eventType: 'vortex_birth',
      subjectIds: [id],
      parentIds: [],
      childIds: [],
      confidence: feature.confidence,
      deltaEnergy: spawned.energy,
      deltaCirculation: spawned.circulation,
    })
  }

  for (let i = 0; i < prevActive.length; i += 1) {
    const prev = prevActive[i]
    if (usedPrevIds.has(prev.id)) continue
    addEvent(state, {
      frame: state.frameSerial,
      eventType: 'vortex_decay',
      subjectIds: [prev.id],
      parentIds: [prev.id],
      childIds: [],
      confidence: clamp01(prev.confidence),
      deltaEnergy: -Math.abs(toFinite(prev.energy, 0)),
      deltaCirculation: -Math.abs(toFinite(prev.circulation, 0)),
    })
    state.objectsById.delete(prev.id)
  }

  const byClassPrev = new Map()
  const byClassNext = new Map()
  for (let i = 0; i < prevActive.length; i += 1) {
    const k = String(prevActive[i].type)
    byClassPrev.set(k, (byClassPrev.get(k) ?? 0) + 1)
  }
  for (let i = 0; i < nextObjects.length; i += 1) {
    const k = String(nextObjects[i].type)
    byClassNext.set(k, (byClassNext.get(k) ?? 0) + 1)
  }
  const classes = new Set([...Array.from(byClassPrev.keys()), ...Array.from(byClassNext.keys())])
  for (const cls of classes) {
    const prevCount = byClassPrev.get(cls) ?? 0
    const nextCount = byClassNext.get(cls) ?? 0
    if (prevCount > nextCount && nextCount > 0) {
      const parents = prevActive.filter((item) => item.type === cls).slice(0, 2).map((item) => item.id)
      const children = nextObjects.filter((item) => item.type === cls).slice(0, 1).map((item) => item.id)
      addEvent(state, {
        frame: state.frameSerial,
        eventType: 'vortex_merge',
        subjectIds: children,
        parentIds: parents,
        childIds: children,
        confidence: clamp01((detections.confidence ?? 0) * 0.85),
        deltaEnergy: toFinite(detections.confidence ?? 0, 0) * 0.1,
        deltaCirculation: 0,
      })
    } else if (nextCount > prevCount && prevCount > 0) {
      const parents = prevActive.filter((item) => item.type === cls).slice(0, 1).map((item) => item.id)
      const children = nextObjects.filter((item) => item.type === cls).slice(0, 2).map((item) => item.id)
      addEvent(state, {
        frame: state.frameSerial,
        eventType: 'vortex_split',
        subjectIds: children,
        parentIds: parents,
        childIds: children,
        confidence: clamp01((detections.confidence ?? 0) * 0.82),
        deltaEnergy: toFinite(detections.confidence ?? 0, 0) * 0.05,
        deltaCirculation: 0,
      })
    }
  }

  const committed = toInt(newtonium.transitionCommitted, 0)
  if (committed > toInt(state.lastTransitionCommitted, 0)) {
    const delta = committed - toInt(state.lastTransitionCommitted, 0)
    addEvent(state, {
      frame: state.frameSerial,
      eventType: 'vortex_reconnection',
      subjectIds: nextObjects.slice(0, 2).map((item) => item.id),
      parentIds: nextObjects.slice(0, 1).map((item) => item.id),
      childIds: nextObjects.slice(1, 3).map((item) => item.id),
      confidence: clamp01(newtonium.confidence ?? detections.confidence ?? 0),
      deltaEnergy: delta * 0.02,
      deltaCirculation: 0,
    })
  }
  state.lastTransitionCommitted = committed

  const graph = buildGraphSnapshot(state.objectsById, state.eventLog)
  const latestEvent = state.latestEvent ?? null
  const guidedStrength = clamp01(params.guidedStrength ?? 0)
  const alphaNorm = clamp01(Math.abs(toFinite(params.alpha, 0)) / 90)
  const modifierStrength = params.dynamicsMode === 'guidedPhysics' ? clamp01(guidedStrength * 0.65 + alphaNorm * 0.35) : 0
  const profile = params.dynamicsMode === 'guidedPhysics' ? 'natural_modulated' : 'classic'
  const externalValidationEligible = !(params.dynamicsMode === 'guidedPhysics' && modifierStrength > 1e-6)
  const externalValidationEligibilityReason = externalValidationEligible
    ? 'eligible'
    : 'natural_modifier_active'
  return {
    version: 'tt028b.topology_tracking.v1',
    valid: true,
    profile,
    modifierStrength,
    externalValidationEligible,
    externalValidationEligibilityReason,
    frameSerial: state.frameSerial,
    eventCount: state.eventLog.length,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    counters: {
      birth: toInt(state.counters.birth, 0),
      decay: toInt(state.counters.decay, 0),
      merge: toInt(state.counters.merge, 0),
      split: toInt(state.counters.split, 0),
      reconnection: toInt(state.counters.reconnection, 0),
    },
    latestEvent: latestEvent
      ? {
          eventType: String(latestEvent.eventType ?? 'none'),
          confidence: clamp01(latestEvent.confidence ?? 0),
          frame: toInt(latestEvent.frame, 0),
        }
      : {
          eventType: 'none',
          confidence: 0,
          frame: toInt(state.frameSerial, 0),
        },
    eventLog: state.eventLog.slice(-240).map((event) => normalizeEvent(event)),
    graph,
  }
}
