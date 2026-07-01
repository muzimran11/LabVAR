//! Provenance module — append-only hash-chain event log.
//!
//! Every mutation in LabVAR is recorded as a provenance event. Events
//! form a hash chain: each event's `hash` field is SHA-256 of
//! (prev_hash || seq || ts || entity_type || entity_id || event_type || payload).
//!
//! `verify_chain` walks the full chain and checks every link.

use sha2::{Digest, Sha256};

/// Compute the hash for a single event in the chain.
///
/// Hash = SHA-256(prev_hash || seq || ts || entity_type || entity_id || event_type || payload)
pub fn compute_hash(
    prev_hash: &str,
    seq: i64,
    ts: &str,
    entity_type: &str,
    entity_id: &str,
    event_type: &str,
    payload: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prev_hash.as_bytes());
    hasher.update(seq.to_string().as_bytes());
    hasher.update(ts.as_bytes());
    hasher.update(entity_type.as_bytes());
    hasher.update(entity_id.as_bytes());
    hasher.update(event_type.as_bytes());
    hasher.update(payload.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// The genesis hash used as `prev_hash` for the very first event.
pub const GENESIS_HASH: &str =
    "0000000000000000000000000000000000000000000000000000000000000000";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_deterministic() {
        let h1 = compute_hash(GENESIS_HASH, 1, "2025-01-01T00:00:00Z", "experiment", "e1", "created", "{}");
        let h2 = compute_hash(GENESIS_HASH, 1, "2025-01-01T00:00:00Z", "experiment", "e1", "created", "{}");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64); // SHA-256 hex
    }

    #[test]
    fn different_inputs_different_hashes() {
        let h1 = compute_hash(GENESIS_HASH, 1, "2025-01-01T00:00:00Z", "experiment", "e1", "created", "{}");
        let h2 = compute_hash(GENESIS_HASH, 1, "2025-01-01T00:00:00Z", "experiment", "e2", "created", "{}");
        assert_ne!(h1, h2);
    }

    #[test]
    fn seq_affects_hash() {
        let h1 = compute_hash(GENESIS_HASH, 1, "2025-01-01T00:00:00Z", "experiment", "e1", "created", "{}");
        let h2 = compute_hash(GENESIS_HASH, 2, "2025-01-01T00:00:00Z", "experiment", "e1", "created", "{}");
        assert_ne!(h1, h2);
    }
}
