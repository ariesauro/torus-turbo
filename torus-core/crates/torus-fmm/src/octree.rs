//! Octree for FMM: adaptive spatial decomposition.
//!
//! Port of `src/simulation/physics/fmm/octree.js`.

use glam::DVec3;

use crate::multipole::{FmmSource, Multipole, merge_multipoles};

/// Octree node.
pub struct OctreeNode {
    pub leaf: bool,
    pub center: DVec3,
    pub half_size: f64,
    pub count: usize,
    pub multipole: Multipole,
    /// Leaf-only: indices into source array.
    pub indices: Vec<usize>,
    /// Internal-only: 8 children (octants).
    pub children: [Option<Box<OctreeNode>>; 8],
}

/// Bounding box of sources.
pub struct Bounds {
    pub center: DVec3,
    pub half_size: f64,
}

pub fn compute_bounds(sources: &[FmmSource]) -> Bounds {
    if sources.is_empty() {
        return Bounds {
            center: DVec3::ZERO,
            half_size: 1.0,
        };
    }

    let mut min = DVec3::splat(f64::INFINITY);
    let mut max = DVec3::splat(f64::NEG_INFINITY);

    for s in sources {
        min = min.min(s.position);
        max = max.max(s.position);
    }

    let center = (min + max) * 0.5;
    let extent = (max - min).max_element().max(1e-4);

    Bounds {
        center,
        half_size: extent * 0.5 + 1e-4,
    }
}

fn get_octant(pos: DVec3, center: DVec3) -> usize {
    let mut octant = 0;
    if pos.x >= center.x { octant |= 1; }
    if pos.y >= center.y { octant |= 2; }
    if pos.z >= center.z { octant |= 4; }
    octant
}

fn child_center(parent_center: DVec3, child_half: f64, octant: usize) -> DVec3 {
    DVec3::new(
        parent_center.x + if octant & 1 != 0 { child_half } else { -child_half },
        parent_center.y + if octant & 2 != 0 { child_half } else { -child_half },
        parent_center.z + if octant & 4 != 0 { child_half } else { -child_half },
    )
}

/// Build an octree node recursively.
pub fn build_node(
    sources: &[FmmSource],
    indices: &[usize],
    center: DVec3,
    half_size: f64,
    leaf_size: usize,
    depth: u32,
    max_depth: u32,
) -> Option<Box<OctreeNode>> {
    if indices.is_empty() {
        return None;
    }

    // Compute multipole for this node
    let mut total_weight = 0.0;
    let mut weighted_pos = DVec3::ZERO;
    let mut sigma_weighted = 0.0;
    let mut omega_gamma = DVec3::ZERO;

    for &idx in indices {
        let s = &sources[idx];
        let w = s.gamma.abs() + 1e-6;
        total_weight += w;
        weighted_pos += s.position * w;
        sigma_weighted += s.sigma * w;
        omega_gamma += s.omega_gamma;
    }

    let com = weighted_pos / total_weight.max(1e-6);
    let sigma_mean = (sigma_weighted / total_weight.max(1e-6)).max(1e-6);

    let mut q_trace = 0.0;
    for &idx in indices {
        let s = &sources[idx];
        let d = s.position - com;
        let strength = s.omega_gamma.length();
        q_trace += strength * d.length_squared();
    }

    let multipole = Multipole {
        com,
        omega_gamma,
        sigma_mean,
        q_trace,
    };

    let is_leaf = indices.len() <= leaf_size || depth >= max_depth;

    if is_leaf {
        return Some(Box::new(OctreeNode {
            leaf: true,
            center,
            half_size,
            count: indices.len(),
            multipole,
            indices: indices.to_vec(),
            children: Default::default(),
        }));
    }

    // Split into 8 octants
    let child_half = half_size * 0.5;
    let mut buckets: [Vec<usize>; 8] = Default::default();

    for &idx in indices {
        let octant = get_octant(sources[idx].position, center);
        buckets[octant].push(idx);
    }

    let mut children: [Option<Box<OctreeNode>>; 8] = Default::default();
    for octant in 0..8 {
        if buckets[octant].is_empty() {
            continue;
        }
        let cc = child_center(center, child_half, octant);
        children[octant] = build_node(
            sources,
            &buckets[octant],
            cc,
            child_half,
            leaf_size,
            depth + 1,
            max_depth,
        );
    }

    Some(Box::new(OctreeNode {
        leaf: false,
        center,
        half_size,
        count: indices.len(),
        multipole,
        indices: Vec::new(),
        children,
    }))
}

/// Upward pass: recompute multipoles for internal nodes from children.
pub fn upward_pass(node: &mut OctreeNode) {
    if node.leaf {
        return;
    }

    let mut child_multipoles: Vec<&Multipole> = Vec::new();
    for child in &mut node.children {
        if let Some(c) = child {
            upward_pass(c);
            child_multipoles.push(&c.multipole);
        }
    }

    if !child_multipoles.is_empty() {
        node.multipole = merge_multipoles(&child_multipoles);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_sources(n: usize) -> Vec<FmmSource> {
        (0..n)
            .map(|i| {
                let t = 2.0 * std::f64::consts::PI * i as f64 / n as f64;
                FmmSource {
                    id: i as u32,
                    index: i,
                    position: DVec3::new(t.cos(), t.sin(), 0.0),
                    gamma: 1.0,
                    sigma: 0.1,
                    omega_gamma: DVec3::new(0.0, 0.0, 0.1),
                }
            })
            .collect()
    }

    #[test]
    fn builds_tree_without_panic() {
        let sources = make_sources(64);
        let bounds = compute_bounds(&sources);
        let indices: Vec<usize> = (0..sources.len()).collect();
        let root = build_node(&sources, &indices, bounds.center, bounds.half_size, 8, 0, 20);
        assert!(root.is_some());
        let root = root.unwrap();
        assert_eq!(root.count, 64);
        assert!(!root.leaf);
    }

    #[test]
    fn small_set_makes_leaf() {
        let sources = make_sources(4);
        let bounds = compute_bounds(&sources);
        let indices: Vec<usize> = (0..sources.len()).collect();
        let root = build_node(&sources, &indices, bounds.center, bounds.half_size, 8, 0, 20);
        assert!(root.is_some());
        assert!(root.unwrap().leaf);
    }

    #[test]
    fn upward_pass_recomputes_multipole() {
        let sources = make_sources(32);
        let bounds = compute_bounds(&sources);
        let indices: Vec<usize> = (0..sources.len()).collect();
        let mut root = build_node(&sources, &indices, bounds.center, bounds.half_size, 4, 0, 20).unwrap();

        let og_before = root.multipole.omega_gamma;
        upward_pass(&mut root);
        let og_after = root.multipole.omega_gamma;

        // Total omega_gamma should be same (it's summed)
        assert!((og_before.z - og_after.z).abs() < 1e-6);
    }
}
