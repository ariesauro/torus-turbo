/**
 * Biot–Savart через настоящий FMM (монополь p=0): O(N) по числу частиц при ограниченном числе листьев.
 * Тот же контракт, что computeVelocityBiotSavart / computeVelocityBiotSavartSpatial: (particles, params) → пишет particle.flowVx/Vy/Vz.
 */

import { controlNaturalCirculationDirection } from '../runtime/naturalBiotSavartModulation.js'
import { computeBounds, buildNode } from './octree.js'
import { mergeMultipoles, m2lContribution, p2pKernel } from './multipole.js'

function clampFinite(value, min, max, fallback) {
  const next = Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, next))
}

function getInjectedVelocityContribution(particle, params) {
  const jetDuration = Math.max(params.pulseDuration ?? 0, 1e-4)
  const age = Math.max(particle.age ?? 0, 0)
  if (age >= jetDuration) return { x: 0, y: 0, z: 0 }

  const weight = 1 - age / jetDuration
  return {
    x: (particle.injectVx ?? particle.vx ?? 0) * weight,
    y: (particle.injectVy ?? particle.vy ?? 0) * weight,
    z: (particle.injectVz ?? particle.vz ?? 0) * weight,
  }
}

function getCoreRadius(particle, params) {
  const minCore = Math.max(params.minCoreRadius ?? 0.01, 1e-4)
  const sigma = particle.coreRadius ?? params.coreRadiusSigma ?? minCore
  return Math.max(minCore, sigma)
}

function buildSourceData(particles, params) {
  const sources = []
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i]
    if (!Number.isFinite(p?.id)) continue

    const gamma = p.gamma ?? params.gamma ?? 0
    const rawOmega = p.vorticity ?? { x: 0, y: 0, z: 0 }
    const omega = controlNaturalCirculationDirection(p, rawOmega, params)
    const sigma = getCoreRadius(p, params)

    sources.push({
      id: p.id,
      index: i,
      x: p.x ?? 0,
      y: p.y ?? 0,
      z: p.z ?? 0,
      gamma,
      sigma,
      omegaGammaX: (omega.x ?? 0) * gamma,
      omegaGammaY: (omega.y ?? 0) * gamma,
      omegaGammaZ: (omega.z ?? 0) * gamma,
    })
  }
  return sources
}

/**
 * Upward pass: заполнить multipole у не-листовых узлов объединением мультиполей детей.
 */
function upwardPass(node) {
  if (!node) return
  if (node.leaf) return

  const childMultipoles = []
  for (let i = 0; i < node.children.length; i += 1) {
    const c = node.children[i]
    if (!c) continue
    upwardPass(c)
    if (c.multipole) childMultipoles.push(c.multipole)
  }
  node.multipole = mergeMultipoles(childMultipoles)
}

/**
 * Tree traversal: compute velocity at (qx,qy,qz) by walking the octree.
 * For well-separated nodes → use multipole (M2L).
 * For near-field leaves → direct P2P.
 * Complexity: O(N log N) vs O(N * L) for flat leaf-to-leaf.
 */
function treeWalkVelocity(qx, qy, qz, node, excludeId, theta, softening2, interactionRadius2, sources) {
  if (!node) return { x: 0, y: 0, z: 0 }

  const dx = qx - node.centerX
  const dy = qy - node.centerY
  const dz = qz - node.centerZ
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const size = node.halfSize * 2

  if (!node.leaf && dist > 0 && size / dist < theta) {
    return m2lContribution(qx, qy, qz, node.multipole, softening2, interactionRadius2)
  }

  if (node.leaf) {
    let vx = 0, vy = 0, vz = 0
    for (let t = 0; t < node.indices.length; t++) {
      const src = sources[node.indices[t]]
      if (src.id === excludeId) continue
      const c = p2pKernel(qx, qy, qz, src, softening2, interactionRadius2)
      vx += c.x; vy += c.y; vz += c.z
    }
    return { x: vx, y: vy, z: vz }
  }

  let vx = 0, vy = 0, vz = 0
  for (let i = 0; i < node.children.length; i++) {
    if (!node.children[i]) continue
    const c = treeWalkVelocity(qx, qy, qz, node.children[i], excludeId, theta, softening2, interactionRadius2, sources)
    vx += c.x; vy += c.y; vz += c.z
  }
  return { x: vx, y: vy, z: vz }
}

/**
 * Главная функция: Biot–Savart через FMM.
 */
export function computeVelocityBiotSavartFMM(particles, params) {
  const count = particles.length
  const interactionRadius = Math.max(params.interactionRadius ?? 0, 0)
  const interactionRadius2 = interactionRadius * interactionRadius

  if (count === 0) return

  const theta = clampFinite(params.fmmTheta ?? params.hybridPlusBarnesHutTheta ?? 0.65, 0.2, 1.2, 0.65)
  const leafSize = Math.max(4, Math.floor(clampFinite(params.fmmLeafSize ?? 16, 4, 64, 16)))
  const softening = clampFinite(params.fmmSoftening ?? 0.02, 1e-5, 2, 0.02)
  const softening2 = softening * softening
  const maxDepth = 20

  const sources = buildSourceData(particles, params)
  if (sources.length < 2) {
    for (let i = 0; i < count; i += 1) {
      const particle = particles[i]
      const inj = getInjectedVelocityContribution(particle, params)
      particle.flowVx = inj.x
      particle.flowVy = inj.y
      particle.flowVz = inj.z
    }
    return
  }

  const bounds = computeBounds(sources)
  const indices = sources.map((_, i) => i)
  const root = buildNode(
    sources,
    indices,
    bounds.centerX,
    bounds.centerY,
    bounds.centerZ,
    bounds.halfSize,
    leafSize,
    0,
    maxDepth,
  )
  if (!root) {
    for (let i = 0; i < count; i += 1) {
      const particle = particles[i]
      const inj = getInjectedVelocityContribution(particle, params)
      particle.flowVx = inj.x
      particle.flowVy = inj.y
      particle.flowVz = inj.z
    }
    return
  }

  upwardPass(root)

  for (let i = 0; i < count; i += 1) {
    const particle = particles[i]
    const inj = getInjectedVelocityContribution(particle, params)
    let vx = inj.x
    let vy = inj.y
    let vz = inj.z

    if (!params.useBiotSavart) {
      particle.flowVx = vx + (particle.vx ?? 0) / Math.max(params.timeScale ?? 1, 1e-4)
      particle.flowVy = vy + (particle.vy ?? 0) / Math.max(params.timeScale ?? 1, 1e-4)
      particle.flowVz = vz + (particle.vz ?? 0) / Math.max(params.timeScale ?? 1, 1e-4)
      continue
    }

    const walk = treeWalkVelocity(
      particle.x, particle.y, particle.z,
      root, particle.id, theta, softening2, interactionRadius2, sources,
    )
    vx += walk.x
    vy += walk.y
    vz += walk.z

    particle.flowVx = vx
    particle.flowVy = vy
    particle.flowVz = vz
  }
}
