//! Multipole operations for Biot-Savart FMM (monopole p=0 + quadrupole p=2).
//!
//! Kernel: v = (ωΓ × r) / (4π · (r² + σ²)^1.5)

use glam::DVec3;

const FOUR_PI: f64 = 4.0 * std::f64::consts::PI;

/// Multipole expansion data for an octree node.
#[derive(Debug, Clone)]
pub struct Multipole {
    pub com: DVec3,
    pub omega_gamma: DVec3,
    pub sigma_mean: f64,
    /// Trace of second moment tensor (quadrupole correction).
    pub q_trace: f64,
}

impl Default for Multipole {
    fn default() -> Self {
        Self {
            com: DVec3::ZERO,
            omega_gamma: DVec3::ZERO,
            sigma_mean: 0.01,
            q_trace: 0.0,
        }
    }
}

/// Source particle data pre-computed for FMM.
#[derive(Debug, Clone)]
pub struct FmmSource {
    pub id: u32,
    pub index: usize,
    pub position: DVec3,
    pub gamma: f64,
    pub sigma: f64,
    pub omega_gamma: DVec3,
}

/// M2L: multipole-to-local contribution at query point.
///
/// Monopole: v = (ωΓ × r) / (4π · (r² + σ²)^1.5)
/// Quadrupole correction: v += (ωΓ × r) · (-1.5 · qTrace) / (4π · (r² + σ²)^2.5)
pub fn m2l_contribution(
    query: DVec3,
    multipole: &Multipole,
    softening2: f64,
    interaction_radius2: f64,
) -> DVec3 {
    let r = query - multipole.com;
    let r2 = r.length_squared();

    if interaction_radius2 > 0.0 && r2 > interaction_radius2 {
        return DVec3::ZERO;
    }

    let sigma2 = multipole.sigma_mean * multipole.sigma_mean + softening2;
    let r2s = r2 + sigma2;
    let denom = r2s.powf(1.5);

    if denom <= 1e-10 {
        return DVec3::ZERO;
    }

    let factor = 1.0 / (FOUR_PI * denom);
    let cross = r.cross(multipole.omega_gamma);
    let mut v = cross * factor;

    // Quadrupole correction
    if multipole.q_trace > 1e-15 && r2 > 1e-10 {
        let r2s2 = r2s * r2s;
        let quad_factor = -1.5 * multipole.q_trace / (FOUR_PI * r2s2 * r2s.sqrt());
        v += cross * quad_factor;
    }

    v
}

/// P2P: direct particle-to-particle Biot-Savart kernel.
pub fn p2p_kernel(
    query: DVec3,
    source: &FmmSource,
    softening2: f64,
    interaction_radius2: f64,
) -> DVec3 {
    let r = query - source.position;
    let r2 = r.length_squared();

    if interaction_radius2 > 0.0 && r2 > interaction_radius2 {
        return DVec3::ZERO;
    }

    let sigma2 = source.sigma * source.sigma + softening2;
    let denom = (r2 + sigma2).powf(1.5);

    if denom <= 1e-10 {
        return DVec3::ZERO;
    }

    let factor = 1.0 / (FOUR_PI * denom);
    r.cross(source.omega_gamma) * factor
}

/// M2M: merge children multipoles into parent (upward pass).
///
/// COM weighted by count=1 per child. Quadrupole uses parallel axis theorem.
pub fn merge_multipoles(children: &[&Multipole]) -> Multipole {
    if children.is_empty() {
        return Multipole::default();
    }

    let total_count = children.len() as f64;
    let mut cx = 0.0;
    let mut cy = 0.0;
    let mut cz = 0.0;
    let mut omega_gamma = DVec3::ZERO;
    let mut sigma_weighted = 0.0;

    for m in children {
        cx += m.com.x;
        cy += m.com.y;
        cz += m.com.z;
        omega_gamma += m.omega_gamma;
        sigma_weighted += m.sigma_mean;
    }

    let parent_com = DVec3::new(cx / total_count, cy / total_count, cz / total_count);

    let mut q_trace = 0.0;
    for m in children {
        let d = m.com - parent_com;
        let strength = m.omega_gamma.length();
        q_trace += m.q_trace + strength * d.length_squared();
    }

    Multipole {
        com: parent_com,
        omega_gamma,
        sigma_mean: (sigma_weighted / total_count).max(1e-6),
        q_trace,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn p2p_gives_biot_savart() {
        let src = FmmSource {
            id: 0,
            index: 0,
            position: DVec3::ZERO,
            gamma: 1.0,
            sigma: 0.1,
            omega_gamma: DVec3::new(0.0, 0.0, 1.0),
        };
        let v = p2p_kernel(DVec3::new(1.0, 0.0, 0.0), &src, 0.0, 0.0);
        // r = (1,0,0), ω×Γ = (0,0,1), r×ωΓ = (0·1-0·0, 0·0-1·1, 1·0-0·0) = (0,-1,0)
        assert!(v.y < 0.0, "Expected negative vy from Biot-Savart");
        assert!(v.x.abs() < 1e-15);
        assert!(v.z.abs() < 1e-15);
    }

    #[test]
    fn m2l_matches_p2p_for_single_source() {
        let src = FmmSource {
            id: 0,
            index: 0,
            position: DVec3::ZERO,
            gamma: 1.0,
            sigma: 0.1,
            omega_gamma: DVec3::new(0.0, 0.0, 1.0),
        };
        let m = Multipole {
            com: src.position,
            omega_gamma: src.omega_gamma,
            sigma_mean: src.sigma,
            q_trace: 0.0,
        };

        let query = DVec3::new(2.0, 0.0, 0.0);
        let v_p2p = p2p_kernel(query, &src, 0.0, 0.0);
        let v_m2l = m2l_contribution(query, &m, 0.0, 0.0);

        assert!((v_p2p - v_m2l).length() < 1e-12, "M2L should match P2P for single source");
    }

    #[test]
    fn merge_preserves_total_omega_gamma() {
        let m1 = Multipole {
            com: DVec3::new(1.0, 0.0, 0.0),
            omega_gamma: DVec3::new(0.0, 0.0, 1.0),
            sigma_mean: 0.1,
            q_trace: 0.0,
        };
        let m2 = Multipole {
            com: DVec3::new(-1.0, 0.0, 0.0),
            omega_gamma: DVec3::new(0.0, 0.0, 0.5),
            sigma_mean: 0.1,
            q_trace: 0.0,
        };

        let merged = merge_multipoles(&[&m1, &m2]);
        assert!((merged.omega_gamma.z - 1.5).abs() < 1e-12);
        assert!(merged.q_trace > 0.0, "Quadrupole should be non-zero for separated sources");
    }
}
