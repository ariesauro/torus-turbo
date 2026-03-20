import { getNozzle, getNozzleBasis } from './shared'

export function createVortexRingSeed(
  params,
  {
    resolution = params.ringResolution ?? params.filamentNodeCount ?? 64,
    jetVelocity = params.jetSpeed ?? 0,
    axialDt = 0,
    totalCirculation = params.gamma ?? 1,
    phaseOffset = 0,
  } = {},
) {
  const nozzle = getNozzle(params)
  const basis = getNozzleBasis(nozzle)
  const safeResolution = Math.max(8, Math.floor(resolution))
  const safeRadius = Math.max(nozzle.radius, 1e-4)
  const axialOffset = Math.max(0, jetVelocity) * Math.max(axialDt, 0) * 0.5
  const vorticityMagnitude = Math.max(jetVelocity / safeRadius, 1e-3)
  const gammaPerSample = totalCirculation / Math.max(safeResolution, 1)
  const samples = new Array(safeResolution)

  for (let i = 0; i < safeResolution; i += 1) {
    const angle = (i / safeResolution) * Math.PI * 2 + phaseOffset
    const radialVector = {
      x: basis.tangent.x * Math.cos(angle) + basis.bitangent.x * Math.sin(angle),
      y: basis.tangent.y * Math.cos(angle) + basis.bitangent.y * Math.sin(angle),
      z: basis.tangent.z * Math.cos(angle) + basis.bitangent.z * Math.sin(angle),
    }
    const tangentialVorticity = {
      x: radialVector.y * basis.direction.z - radialVector.z * basis.direction.y,
      y: radialVector.z * basis.direction.x - radialVector.x * basis.direction.z,
      z: radialVector.x * basis.direction.y - radialVector.y * basis.direction.x,
    }

    samples[i] = {
      angle,
      position: {
        x: nozzle.position.x + radialVector.x * safeRadius + basis.direction.x * axialOffset,
        y: nozzle.position.y + radialVector.y * safeRadius + basis.direction.y * axialOffset,
        z: nozzle.position.z + radialVector.z * safeRadius + basis.direction.z * axialOffset,
      },
      velocity: {
        x: basis.direction.x * jetVelocity,
        y: basis.direction.y * jetVelocity,
        z: basis.direction.z * jetVelocity,
      },
      vorticity: {
        x: tangentialVorticity.x * vorticityMagnitude,
        y: tangentialVorticity.y * vorticityMagnitude,
        z: tangentialVorticity.z * vorticityMagnitude,
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
