import { createFilament, createFilamentNode } from './filamentTypes'
import { createVortexRingSeed } from '../physics/emission/vortexRingSeed'
import { createVortexKnotSeed } from '../physics/emission/vortexKnotSeed'

export function createFilamentRing(params, filamentId = 1, options = {}) {
  const nodeCount = Math.max(8, Math.floor(params.filamentNodeCount ?? params.ringResolution ?? 64))
  const seedBuilder =
    options.mode === 'vortexKnot' || params.emissionMode === 'vortexKnot'
      ? createVortexKnotSeed
      : createVortexRingSeed
  const seed = seedBuilder(params, {
    resolution: nodeCount,
    jetVelocity: options.jetVelocity ?? params.jetSpeed ?? 0,
    axialDt: options.axialDt ?? 0,
    totalCirculation: options.totalCirculation ?? params.gamma ?? 1,
    phaseOffset: options.phaseOffset ?? 0,
  })
  const nodes = seed.samples.map((sample) => createFilamentNode(sample.position, sample.velocity))

  return createFilament({
    id: filamentId,
    circulation: seed.totalCirculation,
    coreRadius: Math.max(params.filamentCoreRadius ?? params.coreRadiusSigma ?? 0.01, 1e-4),
    closedLoop: true,
    nodes,
  })
}
