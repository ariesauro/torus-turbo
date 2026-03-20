import { getNozzle, getNozzleBasis } from './shared'

function normalize(vector) {
  const len = Math.hypot(vector.x, vector.y, vector.z)
  if (len <= 1e-8) {
    return { x: 0, y: 0, z: 0 }
  }
  return { x: vector.x / len, y: vector.y / len, z: vector.z / len }
}

function mapLocalToWorld(local, nozzle, basis) {
  return {
    x:
      nozzle.position.x +
      basis.tangent.x * local.x +
      basis.bitangent.x * local.y +
      basis.direction.x * local.z,
    y:
      nozzle.position.y +
      basis.tangent.y * local.x +
      basis.bitangent.y * local.y +
      basis.direction.y * local.z,
    z:
      nozzle.position.z +
      basis.tangent.z * local.x +
      basis.bitangent.z * local.y +
      basis.direction.z * local.z,
  }
}

export function createVortexKnotSeed(
  params,
  {
    resolution = params.ringResolution ?? params.filamentNodeCount ?? 128,
    jetVelocity = params.jetSpeed ?? 0,
    axialDt = 0,
    totalCirculation = params.gamma ?? 1,
    phaseOffset = 0,
  } = {},
) {
  const nozzle = getNozzle(params)
  const basis = getNozzleBasis(nozzle)
  const safeResolution = Math.max(24, Math.floor(resolution))
  const majorRadius = Math.max(nozzle.radius * 0.95, 1e-4)
  const minorRadius = Math.max(nozzle.radius * 0.35, 1e-4)
  const axialOffset = Math.max(0, jetVelocity) * Math.max(axialDt, 0) * 0.5
  const vorticityMagnitude = Math.max(jetVelocity / Math.max(minorRadius, 1e-4), 1e-3)
  const gammaPerSample = totalCirculation / Math.max(safeResolution, 1)
  const samples = new Array(safeResolution)

  for (let i = 0; i < safeResolution; i += 1) {
    const t = (i / safeResolution) * Math.PI * 2 + phaseOffset

    // Trefoil knot: p=2, q=3 torus knot.
    const cos2t = Math.cos(2 * t)
    const sin2t = Math.sin(2 * t)
    const cos3t = Math.cos(3 * t)
    const sin3t = Math.sin(3 * t)
    const ring = majorRadius + minorRadius * cos3t
    const localPosition = {
      x: ring * cos2t,
      y: ring * sin2t,
      z: minorRadius * sin3t + axialOffset,
    }

    const dRing = -3 * minorRadius * sin3t
    const tangentLocal = normalize({
      x: dRing * cos2t - 2 * ring * sin2t,
      y: dRing * sin2t + 2 * ring * cos2t,
      z: 3 * minorRadius * cos3t,
    })
    const tangentWorld = normalize({
      x:
        basis.tangent.x * tangentLocal.x +
        basis.bitangent.x * tangentLocal.y +
        basis.direction.x * tangentLocal.z,
      y:
        basis.tangent.y * tangentLocal.x +
        basis.bitangent.y * tangentLocal.y +
        basis.direction.y * tangentLocal.z,
      z:
        basis.tangent.z * tangentLocal.x +
        basis.bitangent.z * tangentLocal.y +
        basis.direction.z * tangentLocal.z,
    })

    samples[i] = {
      angle: t,
      position: mapLocalToWorld(localPosition, nozzle, basis),
      velocity: {
        x: tangentWorld.x * jetVelocity,
        y: tangentWorld.y * jetVelocity,
        z: tangentWorld.z * jetVelocity,
      },
      vorticity: {
        x: tangentWorld.x * vorticityMagnitude,
        y: tangentWorld.y * vorticityMagnitude,
        z: tangentWorld.z * vorticityMagnitude,
      },
    }
  }

  return {
    nozzle,
    basis,
    safeResolution,
    axialOffset,
    jetVelocity,
    totalCirculation,
    gammaPerSample,
    samples,
  }
}
