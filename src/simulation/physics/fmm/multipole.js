/**
 * Мультипольные операции для Biot–Savart FMM (порядок p=0 монополь + p=2 квадруполь).
 * Ядро: v = (omegaGamma × r) / (4π (r² + σ²)^1.5).
 */

const FOUR_PI = 4 * Math.PI

/**
 * Вклад одного мультиполя (источник) в поле скорости в точке (qx, qy, qz).
 * source: { comX, comY, comZ, omegaGammaX, omegaGammaY, omegaGammaZ, sigmaMean, qTrace? }
 * When source.qTrace > 0, applies quadrupole correction.
 */
export function m2lContribution(qx, qy, qz, source, softening2 = 0, interactionRadius2 = 0) {
  const rx = qx - source.comX
  const ry = qy - source.comY
  const rz = qz - source.comZ
  const r2 = rx * rx + ry * ry + rz * rz
  if (interactionRadius2 > 0 && r2 > interactionRadius2) return { x: 0, y: 0, z: 0 }

  const sigma2 = (source.sigmaMean ?? 0.01) ** 2 + softening2
  const r2s = r2 + sigma2
  const denom = r2s ** 1.5
  if (denom <= 1e-10) return { x: 0, y: 0, z: 0 }

  const factor = 1 / (FOUR_PI * denom)
  let vx = (ry * source.omegaGammaZ - rz * source.omegaGammaY) * factor
  let vy = (rz * source.omegaGammaX - rx * source.omegaGammaZ) * factor
  let vz = (rx * source.omegaGammaY - ry * source.omegaGammaX) * factor

  const qTrace = source.qTrace ?? 0
  if (qTrace > 1e-15 && r2 > 1e-10) {
    const r2s2 = r2s * r2s
    const quadFactor = -1.5 * qTrace / (FOUR_PI * r2s2 * Math.sqrt(r2s))
    vx += (ry * source.omegaGammaZ - rz * source.omegaGammaY) * quadFactor
    vy += (rz * source.omegaGammaX - rx * source.omegaGammaZ) * quadFactor
    vz += (rx * source.omegaGammaY - ry * source.omegaGammaX) * quadFactor
  }

  return { x: vx, y: vy, z: vz }
}

/**
 * Объединение мультиполей детей в мультиполь родителя (M2M для p=0).
 * Дети уже имеют заполненный multipole; переносим центр в центр масс по весам count.
 */
export function mergeMultipoles(childrenMultipoles) {
  let totalCount = 0
  let cx = 0
  let cy = 0
  let cz = 0
  let omegaGammaX = 0
  let omegaGammaY = 0
  let omegaGammaZ = 0
  let sigmaWeighted = 0

  for (let i = 0; i < childrenMultipoles.length; i += 1) {
    const m = childrenMultipoles[i]
    if (!m) continue
    const n = 1
    totalCount += n
    cx += m.comX * n
    cy += m.comY * n
    cz += m.comZ * n
    omegaGammaX += m.omegaGammaX
    omegaGammaY += m.omegaGammaY
    omegaGammaZ += m.omegaGammaZ
    sigmaWeighted += (m.sigmaMean ?? 0.01) * n
  }

  if (totalCount <= 0) {
    return {
      comX: 0, comY: 0, comZ: 0,
      omegaGammaX: 0, omegaGammaY: 0, omegaGammaZ: 0,
      sigmaMean: 0.01, qTrace: 0,
    }
  }

  const parentComX = cx / totalCount
  const parentComY = cy / totalCount
  const parentComZ = cz / totalCount

  let qTrace = 0
  for (let i = 0; i < childrenMultipoles.length; i += 1) {
    const m = childrenMultipoles[i]
    if (!m) continue
    const dx = m.comX - parentComX
    const dy = m.comY - parentComY
    const dz = m.comZ - parentComZ
    const childQTrace = m.qTrace ?? 0
    const strength = Math.hypot(m.omegaGammaX, m.omegaGammaY, m.omegaGammaZ)
    qTrace += childQTrace + strength * (dx * dx + dy * dy + dz * dz)
  }

  return {
    comX: parentComX,
    comY: parentComY,
    comZ: parentComZ,
    omegaGammaX,
    omegaGammaY,
    omegaGammaZ,
    sigmaMean: Math.max(1e-6, sigmaWeighted / totalCount),
    qTrace,
  }
}

/**
 * Прямой вклад одной частицы-источника в поле в точке (qx,qy,qz).
 * source: { x, y, z, omegaGammaX, omegaGammaY, omegaGammaZ, sigma }
 * interactionRadius2: если > 0, вклад нулевой при r2 > interactionRadius2.
 */
export function p2pKernel(qx, qy, qz, source, softening2 = 0, interactionRadius2 = 0) {
  const rx = qx - source.x
  const ry = qy - source.y
  const rz = qz - source.z
  const r2 = rx * rx + ry * ry + rz * rz
  if (interactionRadius2 > 0 && r2 > interactionRadius2) return { x: 0, y: 0, z: 0 }

  const sigma2 = (source.sigma ?? 0.01) ** 2 + softening2
  const denom = (r2 + sigma2) ** 1.5
  if (denom <= 1e-10) return { x: 0, y: 0, z: 0 }

  const factor = 1 / (FOUR_PI * denom)
  return {
    x: (ry * source.omegaGammaZ - rz * source.omegaGammaY) * factor,
    y: (rz * source.omegaGammaX - rx * source.omegaGammaZ) * factor,
    z: (rx * source.omegaGammaY - ry * source.omegaGammaX) * factor,
  }
}
