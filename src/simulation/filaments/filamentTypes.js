export function createFilamentNode(position, velocity = { x: 0, y: 0, z: 0 }) {
  return {
    position: {
      x: position.x ?? 0,
      y: position.y ?? 0,
      z: position.z ?? 0,
    },
    velocity: {
      x: velocity.x ?? 0,
      y: velocity.y ?? 0,
      z: velocity.z ?? 0,
    },
  }
}

export function createFilament({
  id,
  circulation,
  coreRadius,
  closedLoop = true,
  nodes = [],
}) {
  return {
    id,
    circulation,
    coreRadius,
    closedLoop,
    nodes,
  }
}
