//! Database module — SQLite via rusqlite, append-only event log architecture.
//!
//! All mutations go through `append_event()` — the ONLY write path.
//! The events table is the source of truth; projection tables are derived.
//! NO update/delete paths are exposed — corrections are new events referencing
//! prior ones. Each event's hash = SHA-256(prev_hash || seq || ts || entity_type
//! || entity_id || event_type || payload).

use crate::provenance;
use rusqlite::{params, Connection};
use serde_json::Value as JsonValue;
use std::path::Path;

/// The LabVAR database — wraps a rusqlite Connection.
///
/// Thread safety is provided by the Mutex in AppState (lib.rs).
/// The Database itself is NOT Send/Sync by default (rusqlite Connection is !Send),
/// but we implement Send manually because access is always serialized through a Mutex.
pub struct Database {
    conn: Connection,
}

// SAFETY: Database is always accessed through a Mutex<Database> in AppState,
// ensuring only one thread accesses the Connection at a time. SQLite in WAL mode
// with serialized access through a Mutex is thread-safe.
unsafe impl Send for Database {}

impl Database {
    /// Open (or create) the LabVAR database at the given path, running migrations.
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("Failed to open database: {}", e))?;

        // Enable WAL mode for better concurrent read performance
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

        let db = Database { conn };
        db.migrate()?;
        Ok(db)
    }

    /// Run all migrations — creates tables if they don't exist.
    fn migrate(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                -- Append-only event log. NO UPDATE, NO DELETE.
                CREATE TABLE IF NOT EXISTS events (
                    id           TEXT PRIMARY KEY,
                    seq          INTEGER NOT NULL,
                    prev_hash    TEXT,
                    ts           TEXT NOT NULL,
                    actor        TEXT,
                    entity_type  TEXT NOT NULL,
                    entity_id    TEXT NOT NULL,
                    event_type   TEXT NOT NULL,
                    payload      TEXT NOT NULL,
                    hash         TEXT NOT NULL
                );

                -- Materialized projections (derived, disposable)
                CREATE TABLE IF NOT EXISTS experiments (
                    id TEXT PRIMARY KEY,
                    name TEXT,
                    created_ts TEXT,
                    state_json TEXT
                );
                CREATE TABLE IF NOT EXISTS datasets (
                    id TEXT PRIMARY KEY,
                    experiment_id TEXT,
                    name TEXT,
                    rows INTEGER,
                    cols INTEGER,
                    sha256 TEXT,
                    state_json TEXT
                );
                CREATE TABLE IF NOT EXISTS figures (
                    id TEXT PRIMARY KEY,
                    experiment_id TEXT,
                    dataset_id TEXT,
                    vega_spec TEXT,
                    state_json TEXT
                );
                CREATE TABLE IF NOT EXISTS test_results (
                    id TEXT PRIMARY KEY,
                    experiment_id TEXT,
                    dataset_id TEXT,
                    test TEXT,
                    params_json TEXT,
                    result_json TEXT,
                    scipy_version TEXT
                );
                CREATE TABLE IF NOT EXISTS stocks (
                    id TEXT PRIMARY KEY,
                    name TEXT,
                    qty REAL,
                    unit TEXT,
                    reorder_at REAL,
                    state_json TEXT
                );
                CREATE TABLE IF NOT EXISTS cultures (
                    id TEXT PRIMARY KEY,
                    name TEXT,
                    kind TEXT,
                    interval_days INTEGER,
                    last_checked_ts TEXT,
                    state_json TEXT
                );
                CREATE TABLE IF NOT EXISTS hypotheses (
                    id TEXT PRIMARY KEY,
                    experiment_id TEXT,
                    question TEXT,
                    hypothesis TEXT,
                    null_h TEXT,
                    alt_h TEXT,
                    critiques_json TEXT
                );
                CREATE TABLE IF NOT EXISTS notes (
                    id TEXT PRIMARY KEY,
                    experiment_id TEXT,
                    content TEXT,
                    created_ts TEXT
                );
                ",
            )
            .map_err(|e| format!("Migration failed: {}", e))?;

        // Migration: add archived column if missing
        let _ = self.conn.execute("ALTER TABLE experiments ADD COLUMN archived INTEGER DEFAULT 0", []);

        Ok(())
    }

    // =========================================================================
    // CORE: append_event — the ONLY write path
    // =========================================================================

    /// Append a new event to the provenance chain.
    ///
    /// This is the ONLY method that writes to the database.
    /// It appends an event to the events table, then folds the
    /// projection tables to reflect the new state.
    ///
    /// Returns the event id.
    pub fn append_event(
        &self,
        entity_type: &str,
        entity_id: &str,
        event_type: &str,
        payload: &str,
        actor: Option<&str>,
    ) -> Result<String, String> {
        // 1. Get current max seq (or 0)
        let max_seq: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(seq), 0) FROM events",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to get max seq: {}", e))?;

        let new_seq = max_seq + 1;

        // 2. Get prev_hash from the last event (or GENESIS_HASH)
        let prev_hash: String = self
            .conn
            .query_row(
                "SELECT hash FROM events WHERE seq = ?1",
                params![max_seq],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| provenance::GENESIS_HASH.to_string());

        // 3. Generate UUID for event id
        let event_id = uuid::Uuid::new_v4().to_string();

        // 4. Current UTC timestamp
        let ts = chrono::Utc::now().to_rfc3339();

        // 5. Compute hash
        let hash = provenance::compute_hash(
            &prev_hash,
            new_seq,
            &ts,
            entity_type,
            entity_id,
            event_type,
            payload,
        );

        // 6. INSERT the event row
        self.conn
            .execute(
                "INSERT INTO events (id, seq, prev_hash, ts, actor, entity_type, entity_id, event_type, payload, hash)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    event_id,
                    new_seq,
                    prev_hash,
                    ts,
                    actor,
                    entity_type,
                    entity_id,
                    event_type,
                    payload,
                    hash,
                ],
            )
            .map_err(|e| format!("Failed to insert event: {}", e))?;

        // 7. Fold projection
        self.fold_projection(entity_type, entity_id, event_type, payload, &ts)?;

        Ok(event_id)
    }

    // =========================================================================
    // PROJECTION FOLDING
    // =========================================================================

    /// Dispatch on entity_type/event_type to upsert the right projection table.
    fn fold_projection(
        &self,
        entity_type: &str,
        entity_id: &str,
        event_type: &str,
        payload: &str,
        ts: &str,
    ) -> Result<(), String> {
        let payload_json: JsonValue =
            serde_json::from_str(payload).unwrap_or(JsonValue::Object(serde_json::Map::new()));

        match (entity_type, event_type) {
            ("experiment", "created") => {
                let name = payload_json["name"].as_str().unwrap_or("");
                self.conn
                    .execute(
                        "INSERT OR REPLACE INTO experiments (id, name, created_ts, state_json)
                         VALUES (?1, ?2, ?3, ?4)",
                        params![entity_id, name, ts, payload],
                    )
                    .map_err(|e| format!("Failed to fold experiment: {}", e))?;
            }

            ("dataset", "imported") => {
                let name = payload_json["name"].as_str().unwrap_or("");
                let rows = payload_json["rows"].as_i64().unwrap_or(0);
                let cols = payload_json["cols"].as_i64().unwrap_or(0);
                let sha256 = payload_json["sha256"].as_str().unwrap_or("");
                let experiment_id = payload_json["experiment_id"].as_str().unwrap_or("");
                self.conn
                    .execute(
                        "INSERT OR REPLACE INTO datasets (id, experiment_id, name, rows, cols, sha256, state_json)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        params![entity_id, experiment_id, name, rows, cols, sha256, payload],
                    )
                    .map_err(|e| format!("Failed to fold dataset: {}", e))?;
            }

            ("figure", "created") => {
                let experiment_id = payload_json["experiment_id"].as_str().unwrap_or("");
                let dataset_id = payload_json["dataset_id"].as_str().unwrap_or("");
                let vega_spec = payload_json["vega_spec"].as_str().unwrap_or("{}");
                self.conn
                    .execute(
                        "INSERT OR REPLACE INTO figures (id, experiment_id, dataset_id, vega_spec, state_json)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![entity_id, experiment_id, dataset_id, vega_spec, payload],
                    )
                    .map_err(|e| format!("Failed to fold figure: {}", e))?;
            }

            ("test", "computed") => {
                let experiment_id = payload_json["experiment_id"].as_str().unwrap_or("");
                let dataset_id = payload_json["dataset_id"].as_str().unwrap_or("");
                let test = payload_json["test"].as_str().unwrap_or("");
                let params_json = payload_json
                    .get("params")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "{}".to_string());
                let result_json = payload_json
                    .get("result")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "{}".to_string());
                let scipy_version = payload_json["scipy_version"].as_str().unwrap_or("");
                self.conn
                    .execute(
                        "INSERT OR REPLACE INTO test_results (id, experiment_id, dataset_id, test, params_json, result_json, scipy_version)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        params![entity_id, experiment_id, dataset_id, test, params_json, result_json, scipy_version],
                    )
                    .map_err(|e| format!("Failed to fold test result: {}", e))?;
            }

            ("stock", "created") => {
                let name = payload_json["name"].as_str().unwrap_or("");
                let qty = payload_json["qty"].as_f64().unwrap_or(0.0);
                let unit = payload_json["unit"].as_str().unwrap_or("");
                let reorder_at = payload_json["reorder_at"].as_f64().unwrap_or(0.0);
                self.conn
                    .execute(
                        "INSERT OR REPLACE INTO stocks (id, name, qty, unit, reorder_at, state_json)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![entity_id, name, qty, unit, reorder_at, payload],
                    )
                    .map_err(|e| format!("Failed to fold stock: {}", e))?;
            }

            ("stock", "updated") => {
                let qty = payload_json.get("qty").and_then(|v| v.as_f64());
                let reorder_at = payload_json.get("reorder_at").and_then(|v| v.as_f64());

                // Update only the fields present in the payload
                if let Some(q) = qty {
                    self.conn
                        .execute(
                            "UPDATE stocks SET qty = ?1, state_json = ?2 WHERE id = ?3",
                            params![q, payload, entity_id],
                        )
                        .map_err(|e| format!("Failed to update stock qty: {}", e))?;
                }
                if let Some(r) = reorder_at {
                    self.conn
                        .execute(
                            "UPDATE stocks SET reorder_at = ?1 WHERE id = ?2",
                            params![r, entity_id],
                        )
                        .map_err(|e| format!("Failed to update stock reorder_at: {}", e))?;
                }
            }

            ("culture", "created") => {
                let name = payload_json["name"].as_str().unwrap_or("");
                let kind = payload_json["kind"].as_str().unwrap_or("");
                let interval_days = payload_json["interval_days"].as_i64().unwrap_or(7);
                self.conn
                    .execute(
                        "INSERT OR REPLACE INTO cultures (id, name, kind, interval_days, last_checked_ts, state_json)
                         VALUES (?1, ?2, ?3, ?4, NULL, ?5)",
                        params![entity_id, name, kind, interval_days, payload],
                    )
                    .map_err(|e| format!("Failed to fold culture: {}", e))?;
            }

            ("culture", "checked") => {
                self.conn
                    .execute(
                        "UPDATE cultures SET last_checked_ts = ?1, state_json = ?2 WHERE id = ?3",
                        params![ts, payload, entity_id],
                    )
                    .map_err(|e| format!("Failed to update culture check: {}", e))?;
            }

            ("hypothesis", "created") => {
                let experiment_id = payload_json["experiment_id"].as_str().unwrap_or("");
                let question = payload_json["question"].as_str().unwrap_or("");
                let hypothesis = payload_json["hypothesis"].as_str().unwrap_or("");
                let null_h = payload_json["null_h"].as_str().unwrap_or("");
                let alt_h = payload_json["alt_h"].as_str().unwrap_or("");
                let critiques = payload_json
                    .get("critiques")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "[]".to_string());
                self.conn
                    .execute(
                        "INSERT OR REPLACE INTO hypotheses (id, experiment_id, question, hypothesis, null_h, alt_h, critiques_json)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        params![entity_id, experiment_id, question, hypothesis, null_h, alt_h, critiques],
                    )
                    .map_err(|e| format!("Failed to fold hypothesis: {}", e))?;
            }

            ("note", "created") => {
                let experiment_id = payload_json["experiment_id"].as_str().unwrap_or("");
                let content = payload_json["content"].as_str().unwrap_or("");
                self.conn
                    .execute(
                        "INSERT OR REPLACE INTO notes (id, experiment_id, content, created_ts)
                         VALUES (?1, ?2, ?3, ?4)",
                        params![entity_id, experiment_id, content, ts],
                    )
                    .map_err(|e| format!("Failed to fold note: {}", e))?;
            }

            ("experiment", "deleted") => {
                // Remove from projection — event is still in the log
                self.conn
                    .execute("DELETE FROM experiments WHERE id = ?1", params![entity_id])
                    .map_err(|e| format!("Failed to fold experiment deletion: {}", e))?;
                // Also clean up any child projections (shouldn't exist if empty, but be safe)
                self.conn.execute("DELETE FROM datasets WHERE experiment_id = ?1", params![entity_id]).ok();
                self.conn.execute("DELETE FROM figures WHERE experiment_id = ?1", params![entity_id]).ok();
                self.conn.execute("DELETE FROM test_results WHERE experiment_id = ?1", params![entity_id]).ok();
                self.conn.execute("DELETE FROM hypotheses WHERE experiment_id = ?1", params![entity_id]).ok();
                self.conn.execute("DELETE FROM notes WHERE experiment_id = ?1", params![entity_id]).ok();
            }

            ("dataset", "deleted") => {
                // Remove the dataset projection plus anything derived from it.
                self.conn
                    .execute("DELETE FROM datasets WHERE id = ?1", params![entity_id])
                    .map_err(|e| format!("Failed to fold dataset deletion: {}", e))?;
                self.conn.execute("DELETE FROM figures WHERE dataset_id = ?1", params![entity_id]).ok();
                self.conn.execute("DELETE FROM test_results WHERE dataset_id = ?1", params![entity_id]).ok();
            }

            ("figure", "deleted") => {
                self.conn
                    .execute("DELETE FROM figures WHERE id = ?1", params![entity_id])
                    .map_err(|e| format!("Failed to fold figure deletion: {}", e))?;
            }

            ("test", "deleted") => {
                self.conn
                    .execute("DELETE FROM test_results WHERE id = ?1", params![entity_id])
                    .map_err(|e| format!("Failed to fold test deletion: {}", e))?;
            }

            ("note", "deleted") => {
                self.conn
                    .execute("DELETE FROM notes WHERE id = ?1", params![entity_id])
                    .map_err(|e| format!("Failed to fold note deletion: {}", e))?;
            }

            ("experiment", "archived") => {
                self.conn
                    .execute("UPDATE experiments SET archived = 1 WHERE id = ?1", params![entity_id])
                    .map_err(|e| format!("Failed to fold experiment archive: {}", e))?;
            }

            ("experiment", "unarchived") => {
                self.conn
                    .execute("UPDATE experiments SET archived = 0 WHERE id = ?1", params![entity_id])
                    .map_err(|e| format!("Failed to fold experiment unarchive: {}", e))?;
            }

            ("experiment", "renamed") => {
                let new_name = payload_json["name"].as_str().unwrap_or("");
                self.conn
                    .execute("UPDATE experiments SET name = ?1 WHERE id = ?2", params![new_name, entity_id])
                    .map_err(|e| format!("Failed to fold experiment rename: {}", e))?;
            }

            _ => {
                // Unknown entity_type/event_type pair — event is still recorded,
                // but no projection is updated. This is intentional: new event
                // types can be added without breaking older code.
            }
        }

        Ok(())
    }

    // =========================================================================
    // CHAIN VERIFICATION
    // =========================================================================

    /// Verify the entire hash chain. Returns whether it's intact and, if not,
    /// the sequence number where the chain first breaks.
    pub fn verify_chain(&self) -> Result<(bool, Option<i64>), String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT seq, prev_hash, ts, entity_type, entity_id, event_type, payload, hash
                 FROM events ORDER BY seq ASC",
            )
            .map_err(|e| format!("Failed to prepare verify query: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                ))
            })
            .map_err(|e| format!("Failed to query events for verification: {}", e))?;

        let mut expected_prev_hash = provenance::GENESIS_HASH.to_string();

        for row_result in rows {
            let (seq, prev_hash, ts, entity_type, entity_id, event_type, payload, stored_hash) =
                row_result.map_err(|e| format!("Row read error: {}", e))?;

            // Check prev_hash linkage
            if prev_hash != expected_prev_hash {
                return Ok((false, Some(seq)));
            }

            // Recompute hash
            let computed = provenance::compute_hash(
                &prev_hash,
                seq,
                &ts,
                &entity_type,
                &entity_id,
                &event_type,
                &payload,
            );

            if computed != stored_hash {
                return Ok((false, Some(seq)));
            }

            expected_prev_hash = stored_hash;
        }

        Ok((true, None))
    }

    // =========================================================================
    // READ METHODS — projection table queries
    // =========================================================================

    pub fn has_datasets(&self, experiment_id: &str) -> Result<bool, String> {
        let count: i64 = self.conn
            .query_row(
                "SELECT COUNT(*) FROM datasets WHERE experiment_id = ?1",
                params![experiment_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to check datasets: {}", e))?;
        Ok(count > 0)
    }

    pub fn list_experiments(&self) -> Result<Vec<(String, String, String, bool)>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, created_ts, COALESCE(archived, 0) FROM experiments ORDER BY created_ts DESC")
            .map_err(|e| format!("Failed to list experiments: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<i64>>(3)?.unwrap_or(0) != 0,
                ))
            })
            .map_err(|e| format!("Query failed: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Row error: {}", e))?);
        }
        Ok(results)
    }

    pub fn get_experiment(&self, id: &str) -> Result<(String, String, String), String> {
        self.conn
            .query_row(
                "SELECT id, name, created_ts FROM experiments WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    ))
                },
            )
            .map_err(|e| format!("Experiment not found: {}", e))
    }

    pub fn list_datasets(
        &self,
        experiment_id: &str,
    ) -> Result<Vec<(String, String, String, i64, i64, String, String)>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, experiment_id, name, rows, cols, sha256, state_json
                 FROM datasets WHERE experiment_id = ?1",
            )
            .map_err(|e| format!("Failed to list datasets: {}", e))?;

        let rows = stmt
            .query_map(params![experiment_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                    row.get::<_, Option<i64>>(4)?.unwrap_or(0),
                    row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                ))
            })
            .map_err(|e| format!("Query failed: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Row error: {}", e))?);
        }
        Ok(results)
    }

    pub fn get_dataset(
        &self,
        id: &str,
    ) -> Result<(String, String, String, i64, i64, String, String), String> {
        self.conn
            .query_row(
                "SELECT id, experiment_id, name, rows, cols, sha256, state_json
                 FROM datasets WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                        row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                        row.get::<_, Option<i64>>(4)?.unwrap_or(0),
                        row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    ))
                },
            )
            .map_err(|e| format!("Dataset not found: {}", e))
    }

    pub fn list_figures(
        &self,
        experiment_id: &str,
    ) -> Result<Vec<(String, String, String, String)>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, experiment_id, dataset_id, vega_spec
                 FROM figures WHERE experiment_id = ?1",
            )
            .map_err(|e| format!("Failed to list figures: {}", e))?;

        let rows = stmt
            .query_map(params![experiment_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                ))
            })
            .map_err(|e| format!("Query failed: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Row error: {}", e))?);
        }
        Ok(results)
    }

    pub fn get_figure(&self, id: &str) -> Result<(String, String, String, String), String> {
        self.conn
            .query_row(
                "SELECT id, experiment_id, dataset_id, vega_spec FROM figures WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    ))
                },
            )
            .map_err(|e| format!("Figure not found: {}", e))
    }

    pub fn list_test_results(
        &self,
        experiment_id: &str,
    ) -> Result<Vec<(String, String, String, String, String, String, String)>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, experiment_id, dataset_id, test, params_json, result_json, scipy_version
                 FROM test_results WHERE experiment_id = ?1",
            )
            .map_err(|e| format!("Failed to list test results: {}", e))?;

        let rows = stmt
            .query_map(params![experiment_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                ))
            })
            .map_err(|e| format!("Query failed: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Row error: {}", e))?);
        }
        Ok(results)
    }

    pub fn list_stocks(&self) -> Result<Vec<(String, String, f64, String, f64)>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, qty, unit, reorder_at FROM stocks")
            .map_err(|e| format!("Failed to list stocks: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                ))
            })
            .map_err(|e| format!("Query failed: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Row error: {}", e))?);
        }
        Ok(results)
    }

    pub fn list_cultures(
        &self,
    ) -> Result<Vec<(String, String, String, i64, Option<String>)>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, kind, interval_days, last_checked_ts FROM cultures")
            .map_err(|e| format!("Failed to list cultures: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<i64>>(3)?.unwrap_or(7),
                    row.get::<_, Option<String>>(4)?,
                ))
            })
            .map_err(|e| format!("Query failed: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Row error: {}", e))?);
        }
        Ok(results)
    }

    pub fn list_hypotheses(
        &self,
        experiment_id: &str,
    ) -> Result<Vec<(String, String, String, String, String, String)>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, experiment_id, question, hypothesis, null_h, alt_h
                 FROM hypotheses WHERE experiment_id = ?1",
            )
            .map_err(|e| format!("Failed to list hypotheses: {}", e))?;

        let rows = stmt
            .query_map(params![experiment_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                ))
            })
            .map_err(|e| format!("Query failed: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Row error: {}", e))?);
        }
        Ok(results)
    }

    pub fn list_notes(
        &self,
        experiment_id: &str,
    ) -> Result<Vec<(String, String, String, String)>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, experiment_id, content, created_ts
                 FROM notes WHERE experiment_id = ?1 ORDER BY created_ts DESC",
            )
            .map_err(|e| format!("Failed to list notes: {}", e))?;

        let rows = stmt
            .query_map(params![experiment_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                ))
            })
            .map_err(|e| format!("Query failed: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Row error: {}", e))?);
        }
        Ok(results)
    }
}
