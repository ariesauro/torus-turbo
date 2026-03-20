function magnitude(vector) {
  return Math.hypot(vector.x, vector.y, vector.z)
}

function normalize(vector, fallback = { x: 0, y: 0, z: 0 }) {
  const len = magnitude(vector)
  if (len <= 1e-8) {
    return { ...fallback }
  }
  return {
    x: vector.x / len,
    y: vector.y / len,
    z: vector.z / len,
  }
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function scale(vector, factor) {
  return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor }
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1)
}

function smoothstep01(value) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function signedPow(value, exponent) {
  const safeExponent = Number.isFinite(exponent) ? Math.max(exponent, 0.25) : 1
  return Math.sign(value) * Math.pow(Math.abs(value), safeExponent)
}

export function controlNaturalCirculationDirection(sourcePosition, omega, params) {
  if (params?.dynamicsMode !== 'guidedPhysics') {
    return omega
  }

  const rawStrength = clamp01(params?.guidedStrength ?? 0)
  const strengthExponent = 1.35
  const strength = smoothstep01(Math.pow(rawStrength, strengthExponent))
  if (strength <= 0) {
    return omega
  }

  const omegaMag = magnitude(omega)
  if (omegaMag <= 1e-8) {
    return omega
  }

  const radialXY = { x: sourcePosition.x ?? 0, y: sourcePosition.y ?? 0, z: 0 }
  const radialLen = Math.max(Math.hypot(radialXY.x, radialXY.y), 1e-6)
  const radialDir = {
    x: radialXY.x / radialLen,
    y: radialXY.y / radialLen,
    z: 0,
  }

  const torusCenter = scale(radialDir, Math.max(params?.ringMajor ?? 0, 1e-4))
  const normal = normalize(
    {
      x: (sourcePosition.x ?? 0) - torusCenter.x,
      y: (sourcePosition.y ?? 0) - torusCenter.y,
      z: (sourcePosition.z ?? 0) - torusCenter.z,
    },
    radialDir,
  )
  const eTheta = normalize({ x: -radialDir.y, y: radialDir.x, z: 0 }, { x: 1, y: 0, z: 0 })
  const ePhi = normalize(cross(normal, eTheta), { x: 0, y: 0, z: 1 })

  const alpha = ((params?.alpha ?? 0) * Math.PI) / 180
  const alphaExponent = 1.15
  const thetaWeight = signedPow(Math.cos(alpha), alphaExponent) * (params?.ringSpin ? 1 : -1)
  const phiWeight = signedPow(Math.sin(alpha), alphaExponent) * (params?.ringFlip ? -1 : 1)
  const targetDirection = normalize(add(scale(eTheta, thetaWeight), scale(ePhi, phiWeight)), eTheta)

  const orientationSign = dot(omega, targetDirection) >= 0 ? 1 : -1
  const desiredOmega = scale(targetDirection, omegaMag * orientationSign)

  return add(omega, scale({ x: desiredOmega.x - omega.x, y: desiredOmega.y - omega.y, z: desiredOmega.z - omega.z }, strength))
}
