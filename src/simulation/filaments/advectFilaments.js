export function advectFilaments(filaments, dt) {
  for (let filamentIndex = 0; filamentIndex < filaments.length; filamentIndex += 1) {
    const filament = filaments[filamentIndex]
    for (let nodeIndex = 0; nodeIndex < filament.nodes.length; nodeIndex += 1) {
      const node = filament.nodes[nodeIndex]
      node.position.x += (node.velocity.x ?? 0) * dt
      node.position.y += (node.velocity.y ?? 0) * dt
      node.position.z += (node.velocity.z ?? 0) * dt
    }
  }
}
