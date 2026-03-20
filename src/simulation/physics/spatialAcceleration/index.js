/**
 * Spatial Acceleration Module
 * Оптимизация вычислений Biot–Savart через uniform grid
 */

export {
  computeCellIndex,
  buildGrid,
  getGridOrigin,
} from './gridBuilder.js'
export { getNeighborCells, isCellInRange } from './neighborSearch.js'
export {
  computeAggregatedCell,
  computeCellCenter,
} from './aggregatedCells.js'
