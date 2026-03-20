import { getNozzle } from './shared'

export const MAX_MULTI_EMITTERS = 3

function clampFinite(value, min, max, fallback) {
  const numeric = Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, numeric))
}

function normalizeDirection(direction) {
  const x = Number.isFinite(direction?.x) ? direction.x : 0
  const y = Number.isFinite(direction?.y) ? direction.y : 0
  const z = Number.isFinite(direction?.z) ? direction.z : 1
  const length = Math.hypot(x, y, z)
  if (length <= 1e-8) {
    return { x: 0, y: 0, z: 1 }
  }
  return { x: x / length, y: y / length, z: z / length }
}

function buildDefaultEmitter(index) {
  const zOffset = index === 0 ? 0 : index === 1 ? 1.4 : -1.4
  return {
    enabled: index === 0,
    visible: true,
    oppositeDirection: false,
    delayMs: Math.max(0, index) * 120,
    offsetX: 0,
    offsetY: 0,
    offsetZ: zOffset,
    yawDeg: 0,
    pitchDeg: 0,
  }
}

function normalizeEmitterConfig(config, index) {
  const fallback = buildDefaultEmitter(index)
  return {
    enabled: config?.enabled ?? fallback.enabled,
    visible: config?.visible ?? fallback.visible,
    oppositeDirection: config?.oppositeDirection ?? fallback.oppositeDirection,
    delayMs: clampFinite(config?.delayMs, 0, 5000, fallback.delayMs),
    offsetX: clampFinite(config?.offsetX, -10, 10, fallback.offsetX),
    offsetY: clampFinite(config?.offsetY, -10, 10, fallback.offsetY),
    offsetZ: clampFinite(config?.offsetZ, -10, 10, fallback.offsetZ),
    yawDeg: clampFinite(config?.yawDeg, -180, 180, fallback.yawDeg),
    pitchDeg: clampFinite(config?.pitchDeg, -89, 89, fallback.pitchDeg),
  }
}

export function normalizeMultiEmitterConfig(params) {
  const enabled = params?.multiEmitterPresetEnabled === true
  const count = Math.max(1, Math.min(MAX_MULTI_EMITTERS, Math.floor(params?.multiEmitterCount ?? 1)))
  const selectedIndex = Math.max(
    0,
    Math.min(
      MAX_MULTI_EMITTERS - 1,
      Math.floor(params?.multiEmitterSelectedIndex ?? 0),
    ),
  )
  const emitters = new Array(MAX_MULTI_EMITTERS)
  for (let i = 0; i < MAX_MULTI_EMITTERS; i += 1) {
    emitters[i] = normalizeEmitterConfig(params?.multiEmitters?.[i], i)
  }
  return {
    enabled,
    count,
    selectedIndex,
    emitters,
  }
}

function applyYawPitch(direction, yawDeg, pitchDeg) {
  const base = normalizeDirection(direction)
  const yaw = (yawDeg * Math.PI) / 180
  const pitch = (pitchDeg * Math.PI) / 180

  const cosYaw = Math.cos(yaw)
  const sinYaw = Math.sin(yaw)
  const yawed = {
    x: base.x * cosYaw + base.z * sinYaw,
    y: base.y,
    z: -base.x * sinYaw + base.z * cosYaw,
  }

  const cosPitch = Math.cos(pitch)
  const sinPitch = Math.sin(pitch)
  return normalizeDirection({
    x: yawed.x,
    y: yawed.y * cosPitch - yawed.z * sinPitch,
    z: yawed.y * sinPitch + yawed.z * cosPitch,
  })
}

export function getConfiguredEmitters(params, options = {}) {
  const includeDisabled = options.includeDisabled === true
  const nozzle = getNozzle(params)
  const multi = normalizeMultiEmitterConfig(params)
  if (!multi.enabled || multi.count <= 1) {
    return [
      {
        index: 0,
        enabled: true,
        active: true,
        visible: params?.showNozzle === true,
        delaySec: 0,
        nozzle,
      },
    ]
  }

  const emitters = []
  for (let i = 0; i < multi.count; i += 1) {
    const config = multi.emitters[i]
    if (!config.enabled && !includeDisabled) {
      continue
    }
    const direction = applyYawPitch(nozzle.direction, config.yawDeg, config.pitchDeg)
    emitters.push({
      index: i,
      enabled: true,
      active: config.enabled === true,
      visible: config.visible === true,
      delaySec: config.delayMs / 1000,
      nozzle: {
        radius: nozzle.radius,
        position: {
          x: nozzle.position.x + config.offsetX,
          y: nozzle.position.y + config.offsetY,
          z: nozzle.position.z + config.offsetZ,
        },
        direction: config.oppositeDirection
          ? { x: -direction.x, y: -direction.y, z: -direction.z }
          : direction,
      },
    })
  }

  if (emitters.length === 0) {
    return [
      {
        index: 0,
        enabled: true,
        active: true,
        visible: params?.showNozzle === true,
        delaySec: 0,
        nozzle,
      },
    ]
  }

  return emitters
}

export function buildEmitterParams(params, emitter) {
  const nozzle = emitter?.nozzle ?? getNozzle(params)
  return {
    ...params,
    nozzle,
    nozzleRadius: nozzle.radius,
    nozzleZ: nozzle.position.z,
    nozzleX: nozzle.position.x,
  }
}
