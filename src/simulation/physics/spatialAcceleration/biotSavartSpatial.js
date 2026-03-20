/**
 * Biot–Savart с spatial acceleration (uniform grid)
 * Точные вычисления для близких частиц, агрегация для дальних
 */

import {
  buildGrid,
} from './gridBuilder.js'
import { getNeighborCells, isCellInRange } from './neighborSearch.js'
import { computeAggregatedCell, computeCellCenter } from './aggregatedCells.js'
import { controlNaturalCirculationDirection } from '../runtime/naturalBiotSavartModulation.js'

const FOUR_PI = 4 * Math.PI

function getCoreRadius(particle, params) {
  const minCore = Math.max(params.minCoreRadius ?? 0.01, 1e-4)
  const sigma = particle.coreRadius ?? params.coreRadiusSigma ?? minCore
  return Math.max(minCore, sigma)
}

function getInjectedVelocityContribution(particle, params) {
  const jetDuration = Math.max(params.pulseDuration ?? 0, 1e-4)
  const age = Math.max(particle.age ?? 0, 0)

  if (age >= jetDuration) {
    return { x: 0, y: 0, z: 0 }
  }

  const injectVx = particle.injectVx ?? particle.vx ?? 0
  const injectVy = particle.injectVy ?? particle.vy ?? 0
  const injectVz = particle.injectVz ?? particle.vz ?? 0
  const weight = 1 - age / jetDuration

  return {
    x: injectVx * weight,
    y: injectVy * weight,
    z: injectVz * weight,
  }
}

function computeVelocityExact(
  particle,
  particles,
  cellIndex,
  cellStartBuffer,
  cellCountBuffer,
  particleIndexBuffer,
  params,
  interactionRadius2,
) {
  const eps = 1e-8
  let vx = 0
  let vy = 0
  let vz = 0

  const count = cellCountBuffer[cellIndex]
  if (count === 0) return { x: 0, y: 0, z: 0 }

  const start = cellStartBuffer[cellIndex]

  for (let i = 0; i < count; i++) {
    const j = particleIndexBuffer[start + i]
    const source = particles[j]

    if (source === particle) continue

    const rx = particle.x - source.x
    const ry = particle.y - source.y
    const rz = particle.z - source.z
    const r2 = rx * rx + ry * ry + rz * rz

    if (interactionRadius2 > 0 && r2 > interactionRadius2) continue

    const sigma = getCoreRadius(source, params)
    const denom = (r2 + sigma * sigma) ** 1.5
    if (denom <= eps) continue

    const omega = controlNaturalCirculationDirection(
      source,
      source.vorticity ?? { x: 0, y: 0, z: 0 },
      params,
    )
    const cx = ry * omega.z - rz * omega.y
    const cy = rz * omega.x - rx * omega.z
    const cz = rx * omega.y - ry * omega.x
    const gamma = source.gamma ?? params.gamma ?? 0
    const factor = gamma / (FOUR_PI * denom)

    vx += cx * factor
    vy += cy * factor
    vz += cz * factor
  }

  return { x: vx, y: vy, z: vz }
}

function computeVelocityAggregated(
  particle,
  aggregatedCells,
  params,
  interactionRadius2,
) {
  const eps = 1e-8
  let vx = 0
  let vy = 0
  let vz = 0

  for (const cellData of aggregatedCells) {
    const rx = particle.x - cellData.center.x
    const ry = particle.y - cellData.center.y
    const rz = particle.z - cellData.center.z
    const r2 = rx * rx + ry * ry + rz * rz

    if (interactionRadius2 > 0 && r2 > interactionRadius2) continue

    const sigma = params.coreRadiusSigma ?? 0.01
    const denom = (r2 + sigma * sigma) ** 1.5
    if (denom <= eps) continue

    const omega = controlNaturalCirculationDirection(
      cellData.center ?? { x: 0, y: 0, z: 0 },
      cellData.avgVorticity ?? { x: 0, y: 0, z: 0 },
      params,
    )
    const cx = ry * omega.z - rz * omega.y
    const cy = rz * omega.x - rx * omega.z
    const cz = rx * omega.y - ry * omega.x
    const factor = cellData.totalGamma / (FOUR_PI * denom)

    vx += cx * factor
    vy += cy * factor
    vz += cz * factor
  }

  return { x: vx, y: vy, z: vz }
}

export function computeVelocityBiotSavartSpatial(
  particles,
  params,
) {
  const {
    cellSizeMultiplier = 4,
    neighborCellRange = 1,
    aggregationDistance = 2,
  } = params

  const coreRadius = params.coreRadiusSigma ?? 0.01
  const cellSize = Math.max(coreRadius * cellSizeMultiplier, 0.01)
  const gridResolution = 32
  const interactionRadius2 =
    params.interactionRadius * params.interactionRadius

  const { cellStartBuffer, cellCountBuffer, particleIndexBuffer, gridOrigin } =
    buildGrid(particles, cellSize, gridResolution)

  const aggregatedCells = []
  const totalCells = gridResolution ** 3

  for (let ci = 0; ci < totalCells; ci++) {
    if (cellCountBuffer[ci] > 0) {
      const cellCenter = computeCellCenter(ci, gridResolution, gridOrigin, cellSize)
      const aggregated = computeAggregatedCell(
        ci,
        particles,
        particleIndexBuffer,
        cellStartBuffer,
        cellCountBuffer,
      )
      if (aggregated) {
        aggregated.center = cellCenter
        aggregated.cellIndex = ci
        aggregatedCells.push(aggregated)
      }
    }
  }

  const count = particles.length
  for (let i = 0; i < count; i++) {
    const particle = particles[i]
    const injectedVelocity = getInjectedVelocityContribution(particle, params)
    const cellIdx = computeCellIndexForParticle(
      particle,
      cellSize,
      gridOrigin,
      gridResolution,
    )

    if (cellIdx < 0) {
      particle.flowVx = injectedVelocity.x
      particle.flowVy = injectedVelocity.y
      particle.flowVz = injectedVelocity.z
      continue
    }

    const neighborCells = getNeighborCells(
      cellIdx,
      gridResolution,
      neighborCellRange,
      cellCountBuffer,
    )

    let exactVx = 0
    let exactVy = 0
    let exactVz = 0

    for (const nc of neighborCells) {
      const v = computeVelocityExact(
        particle,
        particles,
        nc,
        cellStartBuffer,
        cellCountBuffer,
        particleIndexBuffer,
        params,
        interactionRadius2,
      )
      exactVx += v.x
      exactVy += v.y
      exactVz += v.z
    }

    let aggregatedVx = 0
    let aggregatedVy = 0
    let aggregatedVz = 0

    for (let k = 0; k < aggregatedCells.length; k += 1) {
      const aggregatedCell = aggregatedCells[k]
      if (
        isCellInRange(cellIdx, aggregatedCell.cellIndex, gridResolution, aggregationDistance)
      ) {
        continue
      }

      const aggregatedVelocity = computeVelocityAggregated(
        particle,
        [aggregatedCell],
        params,
        interactionRadius2,
      )
      aggregatedVx += aggregatedVelocity.x
      aggregatedVy += aggregatedVelocity.y
      aggregatedVz += aggregatedVelocity.z
    }

    particle.flowVx = injectedVelocity.x + exactVx + aggregatedVx
    particle.flowVy = injectedVelocity.y + exactVy + aggregatedVy
    particle.flowVz = injectedVelocity.z + exactVz + aggregatedVz
  }
}

function computeCellIndexForParticle(particle, cellSize, gridOrigin, gridResolution) {
  const localX = particle.x - gridOrigin.x
  const localY = particle.y - gridOrigin.y
  const localZ = particle.z - gridOrigin.z

  const cellX = Math.floor(localX / cellSize)
  const cellY = Math.floor(localY / cellSize)
  const cellZ = Math.floor(localZ / cellSize)

  if (
    cellX < 0 ||
    cellX >= gridResolution ||
    cellY < 0 ||
    cellY >= gridResolution ||
    cellZ < 0 ||
    cellZ >= gridResolution
  ) {
    return -1
  }

  return cellX + cellY * gridResolution + cellZ * gridResolution * gridResolution
}
