// Clear atomic counter data.

@group(0) @binding(8) var<storage, read_write> counter : CounterData;

@compute @workgroup_size(1)
fn main() {
  atomicStore(&counter.activeCount, 0u);
  atomicStore(&counter.overflow, 0u);
  atomicStore(&counter.collisions, 0u);
  atomicStore(&counter.occupiedBuckets, 0u);
  atomicStore(&counter.diagEnergyFP, 0u);
  atomicStore(&counter.diagEnstrophyFP, 0u);
  atomicStore(&counter.diagCirculationFP, 0u);
  atomicStore(&counter.diagMaxSpeedFP, 0u);
}
