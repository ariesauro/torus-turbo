import { createTubeParticle, createVortexTube } from './vortexTubeTypes'
import { add, buildLocalBasis, computeSegmentLengths, scale } from './vortexTubeMath'

export function createVortexTubeFromFilament(filament, params, tubeId) {
  const nodes = filament?.nodes ?? []
  if (nodes.length < 3) {
    return null
  }
  const radius = Math.max(params?.tubeRadius ?? params?.filamentCoreRadius ?? 0.08, 0.002)
  const layers = Math.max(1, Math.floor(params?.tubeLayers ?? 3))
  const particlesPerRing = Math.max(6, Math.floor(params?.tubeParticlesPerRing ?? 24))
  const circulation = filament?.circulation ?? params?.gamma ?? 1
  const totalParticles = nodes.length * layers * particlesPerRing
  const gammaPerParticle = circulation / Math.max(totalParticles, 1)
  const vorticityParticles = []

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const basis = buildLocalBasis(nodes, nodeIndex, filament.closedLoop !== false)
    if (!basis) {
      continue
    }
    const nodePos = nodes[nodeIndex].position
    for (let layer = 1; layer <= layers; layer += 1) {
      const localRadius = (radius * layer) / layers
      for (let i = 0; i < particlesPerRing; i += 1) {
        const angle = (Math.PI * 2 * i) / particlesPerRing
        const radialOffset = add(
          scale(basis.normal, localRadius * Math.cos(angle)),
          scale(basis.binormal, localRadius * Math.sin(angle)),
        )
        const position = add(nodePos, radialOffset)
        vorticityParticles.push(
          createTubeParticle({
            x: position.x,
            y: position.y,
            z: position.z,
            vorticity: basis.tangent,
            gamma: gammaPerParticle,
            tubeId,
            spineNodeIndex: nodeIndex,
            localAngle: angle,
            localRadius,
          }),
        )
      }
    }
  }

  return createVortexTube({
    id: tubeId,
    spineFilamentId: filament.id,
    radius,
    layers,
    particlesPerRing,
    circulation,
    vorticityParticles,
    restSegmentLengths: computeSegmentLengths(nodes, filament.closedLoop !== false),
  })
}
