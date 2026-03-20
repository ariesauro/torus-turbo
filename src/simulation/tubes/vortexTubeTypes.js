export function createTubeParticle({
  x,
  y,
  z,
  vorticity,
  gamma = 0,
  tubeId,
  spineNodeIndex,
  localAngle,
  localRadius,
}) {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    vorticity: {
      x: vorticity?.x ?? 0,
      y: vorticity?.y ?? 0,
      z: vorticity?.z ?? 0,
    },
    gamma,
    tubeId,
    spineNodeIndex,
    localAngle,
    localRadius,
  }
}

export function createVortexTube({
  id,
  spineFilamentId,
  radius,
  layers,
  particlesPerRing,
  circulation,
  vorticityParticles,
  restSegmentLengths,
}) {
  return {
    id,
    spineFilamentId,
    radius,
    layers,
    particlesPerRing,
    circulation,
    vorticityParticles,
    restSegmentLengths,
    lastProjectionStep: 0,
  }
}
