mod ai;
mod db;
mod imaging;
mod provenance;
mod pubmed;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------
pub struct AppState {
    pub db: Mutex<db::Database>,
}

// ---------------------------------------------------------------------------
// Data types shared between Rust commands and the frontend
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Experiment {
    pub id: String,
    pub name: String,
    pub created_ts: String,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dataset {
    pub id: String,
    pub experiment_id: String,
    pub name: String,
    pub rows: i64,
    pub cols: i64,
    pub sha256: String,
    pub csv_data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Figure {
    pub id: String,
    pub experiment_id: String,
    pub dataset_id: String,
    pub vega_spec: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResult {
    pub id: String,
    pub experiment_id: String,
    pub dataset_id: String,
    pub test: String,
    pub params_json: String,
    pub result_json: String,
    pub scipy_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stock {
    pub id: String,
    pub name: String,
    pub qty: f64,
    pub unit: String,
    pub reorder_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Culture {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub interval_days: i64,
    pub last_checked_ts: Option<String>,
    pub next_due: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hypothesis {
    pub id: String,
    pub experiment_id: String,
    pub question: String,
    pub hypothesis: String,
    pub null_h: String,
    pub alt_h: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub experiment_id: String,
    pub content: String,
    pub created_ts: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyResult {
    pub ok: bool,
    pub broken_at: Option<i64>,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn create_experiment(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let entity_id = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({ "name": name }).to_string();
    db.append_event("experiment", &entity_id, "created", &payload, None)?;
    Ok(entity_id)
}

#[tauri::command]
fn list_experiments(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Experiment>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let rows = db.list_experiments()?;
    Ok(rows
        .into_iter()
        .map(|(id, name, created_ts, archived)| Experiment {
            id,
            name,
            created_ts,
            archived,
        })
        .collect())
}

#[tauri::command]
fn get_experiment(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Experiment, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let (eid, name, created_ts) = db.get_experiment(&id)?;
    Ok(Experiment {
        id: eid,
        name,
        created_ts,
        archived: false,
    })
}

#[tauri::command]
fn import_dataset(
    state: tauri::State<'_, AppState>,
    experiment_id: String,
    name: String,
    csv_content: String,
) -> Result<String, String> {
    // Parse CSV to determine rows, cols, and sha256
    let lines: Vec<&str> = csv_content.lines().collect();
    let cols = if let Some(header) = lines.first() {
        header.split(',').count() as i64
    } else {
        0
    };
    // rows = total lines minus header (if there is one)
    let rows = if lines.len() > 1 {
        (lines.len() - 1) as i64
    } else {
        0
    };

    // SHA-256 of the raw CSV content
    let mut hasher = Sha256::new();
    hasher.update(csv_content.as_bytes());
    let csv_sha256 = format!("{:x}", hasher.finalize());

    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let entity_id = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({
        "experiment_id": experiment_id,
        "name": name,
        "rows": rows,
        "cols": cols,
        "sha256": csv_sha256,
        "csv_data": csv_content,
    })
    .to_string();

    db.append_event("dataset", &entity_id, "imported", &payload, None)?;
    Ok(entity_id)
}

#[tauri::command]
fn list_datasets(
    state: tauri::State<'_, AppState>,
    experiment_id: String,
) -> Result<Vec<Dataset>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let rows = db.list_datasets(&experiment_id)?;
    Ok(rows
        .into_iter()
        .map(
            |(id, experiment_id, name, row_count, col_count, sha256, state_json)| {
                let csv_data = serde_json::from_str::<serde_json::Value>(&state_json)
                    .ok()
                    .and_then(|v| v["csv_data"].as_str().map(String::from));
                Dataset {
                    id,
                    experiment_id,
                    name,
                    rows: row_count,
                    cols: col_count,
                    sha256,
                    csv_data,
                }
            },
        )
        .collect())
}

#[tauri::command]
fn get_dataset(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Dataset, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let (did, experiment_id, name, row_count, col_count, sha256, state_json) =
        db.get_dataset(&id)?;

    // Extract csv_data from the state_json (which is the full payload)
    let csv_data = serde_json::from_str::<serde_json::Value>(&state_json)
        .ok()
        .and_then(|v| v["csv_data"].as_str().map(String::from));

    Ok(Dataset {
        id: did,
        experiment_id,
        name,
        rows: row_count,
        cols: col_count,
        sha256,
        csv_data,
    })
}

#[tauri::command]
fn save_figure(
    state: tauri::State<'_, AppState>,
    experiment_id: String,
    dataset_id: String,
    vega_spec: String,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let entity_id = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({
        "experiment_id": experiment_id,
        "dataset_id": dataset_id,
        "vega_spec": vega_spec,
    })
    .to_string();

    db.append_event("figure", &entity_id, "created", &payload, None)?;
    Ok(entity_id)
}

#[tauri::command]
fn list_figures(
    state: tauri::State<'_, AppState>,
    experiment_id: String,
) -> Result<Vec<Figure>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let rows = db.list_figures(&experiment_id)?;
    Ok(rows
        .into_iter()
        .map(|(id, experiment_id, dataset_id, vega_spec)| Figure {
            id,
            experiment_id,
            dataset_id,
            vega_spec,
        })
        .collect())
}

#[tauri::command]
fn get_figure(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Figure, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let (fid, experiment_id, dataset_id, vega_spec) = db.get_figure(&id)?;
    Ok(Figure {
        id: fid,
        experiment_id,
        dataset_id,
        vega_spec,
    })
}

#[tauri::command]
fn save_test_result(
    state: tauri::State<'_, AppState>,
    experiment_id: String,
    dataset_id: String,
    test: String,
    params_json: String,
    result_json: String,
    scipy_version: String,
) -> Result<String, String> {
    // Parse params and result as JSON values to embed properly
    let params_val: serde_json::Value =
        serde_json::from_str(&params_json).unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
    let result_val: serde_json::Value =
        serde_json::from_str(&result_json).unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let entity_id = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({
        "experiment_id": experiment_id,
        "dataset_id": dataset_id,
        "test": test,
        "params": params_val,
        "result": result_val,
        "scipy_version": scipy_version,
    })
    .to_string();

    db.append_event("test", &entity_id, "computed", &payload, None)?;
    Ok(entity_id)
}

#[tauri::command]
fn list_test_results(
    state: tauri::State<'_, AppState>,
    experiment_id: String,
) -> Result<Vec<TestResult>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let rows = db.list_test_results(&experiment_id)?;
    Ok(rows
        .into_iter()
        .map(
            |(id, experiment_id, dataset_id, test, params_json, result_json, scipy_version)| {
                TestResult {
                    id,
                    experiment_id,
                    dataset_id,
                    test,
                    params_json,
                    result_json,
                    scipy_version,
                }
            },
        )
        .collect())
}

#[tauri::command]
fn create_stock(
    state: tauri::State<'_, AppState>,
    name: String,
    qty: f64,
    unit: String,
    reorder_at: f64,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let entity_id = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({
        "name": name,
        "qty": qty,
        "unit": unit,
        "reorder_at": reorder_at,
    })
    .to_string();

    db.append_event("stock", &entity_id, "created", &payload, None)?;
    Ok(entity_id)
}

#[tauri::command]
fn update_stock(
    state: tauri::State<'_, AppState>,
    id: String,
    qty: f64,
    reorder_at: f64,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let payload = serde_json::json!({
        "qty": qty,
        "reorder_at": reorder_at,
    })
    .to_string();

    let event_id = db.append_event("stock", &id, "updated", &payload, None)?;
    Ok(event_id)
}

#[tauri::command]
fn list_stocks(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Stock>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let rows = db.list_stocks()?;
    Ok(rows
        .into_iter()
        .map(|(id, name, qty, unit, reorder_at)| Stock {
            id,
            name,
            qty,
            unit,
            reorder_at,
        })
        .collect())
}

#[tauri::command]
fn create_culture(
    state: tauri::State<'_, AppState>,
    name: String,
    kind: String,
    interval_days: i64,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let entity_id = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({
        "name": name,
        "kind": kind,
        "interval_days": interval_days,
    })
    .to_string();

    db.append_event("culture", &entity_id, "created", &payload, None)?;
    Ok(entity_id)
}

#[tauri::command]
fn check_culture(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let payload = serde_json::json!({
        "checked_at": chrono::Utc::now().to_rfc3339(),
    })
    .to_string();

    let event_id = db.append_event("culture", &id, "checked", &payload, None)?;
    Ok(event_id)
}

#[tauri::command]
fn list_cultures(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Culture>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let rows = db.list_cultures()?;
    Ok(rows
        .into_iter()
        .map(|(id, name, kind, interval_days, last_checked_ts)| {
            // Compute next_due from last_checked_ts + interval_days
            #[allow(deprecated)]
            let next_due = last_checked_ts.as_ref().and_then(|ts| {
                chrono::DateTime::parse_from_rfc3339(ts)
                    .ok()
                    .map(|dt| {
                        (dt + chrono::Duration::days(interval_days))
                            .to_rfc3339()
                    })
            });

            Culture {
                id,
                name,
                kind,
                interval_days,
                last_checked_ts,
                next_due,
            }
        })
        .collect())
}

#[tauri::command]
fn save_hypothesis(
    state: tauri::State<'_, AppState>,
    experiment_id: String,
    question: String,
    hypothesis: String,
    null_h: String,
    alt_h: String,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let entity_id = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({
        "experiment_id": experiment_id,
        "question": question,
        "hypothesis": hypothesis,
        "null_h": null_h,
        "alt_h": alt_h,
    })
    .to_string();

    db.append_event("hypothesis", &entity_id, "created", &payload, None)?;
    Ok(entity_id)
}

#[tauri::command]
fn list_hypotheses(
    state: tauri::State<'_, AppState>,
    experiment_id: String,
) -> Result<Vec<Hypothesis>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let rows = db.list_hypotheses(&experiment_id)?;
    Ok(rows
        .into_iter()
        .map(
            |(id, experiment_id, question, hypothesis, null_h, alt_h)| Hypothesis {
                id,
                experiment_id,
                question,
                hypothesis,
                null_h,
                alt_h,
            },
        )
        .collect())
}

#[tauri::command]
fn add_note(
    state: tauri::State<'_, AppState>,
    experiment_id: String,
    content: String,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let entity_id = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({
        "experiment_id": experiment_id,
        "content": content,
    })
    .to_string();

    db.append_event("note", &entity_id, "created", &payload, None)?;
    Ok(entity_id)
}

#[tauri::command]
fn list_notes(
    state: tauri::State<'_, AppState>,
    experiment_id: String,
) -> Result<Vec<Note>, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let rows = db.list_notes(&experiment_id)?;
    Ok(rows
        .into_iter()
        .map(|(id, experiment_id, content, created_ts)| Note {
            id,
            experiment_id,
            content,
            created_ts,
        })
        .collect())
}

#[tauri::command]
fn delete_experiment(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    // Deleting an experiment cascades: the `experiment/deleted` fold also removes
    // its datasets, figures, test results, hypotheses and notes projections. The
    // events themselves stay in the append-only log, so provenance is preserved.
    let payload = serde_json::json!({}).to_string();
    db.append_event("experiment", &id, "deleted", &payload, None)?;
    Ok(())
}

/// Delete a single dataset (and its derived figures/test results) by appending a
/// `dataset/deleted` event. The raw event stays in the log; only the projection
/// rows are removed.
#[tauri::command]
fn delete_dataset(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.append_event("dataset", &id, "deleted", "{}", None)?;
    Ok(())
}

/// Delete a saved figure by appending a `figure/deleted` event.
#[tauri::command]
fn delete_figure(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.append_event("figure", &id, "deleted", "{}", None)?;
    Ok(())
}

/// Delete a saved statistical result by appending a `test/deleted` event.
#[tauri::command]
fn delete_test_result(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.append_event("test", &id, "deleted", "{}", None)?;
    Ok(())
}

/// Delete a note by appending a `note/deleted` event.
#[tauri::command]
fn delete_note(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.append_event("note", &id, "deleted", "{}", None)?;
    Ok(())
}

#[tauri::command]
fn rename_experiment(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let payload = serde_json::json!({ "name": name }).to_string();
    db.append_event("experiment", &id, "renamed", &payload, None)?;
    Ok(())
}

#[tauri::command]
fn archive_experiment(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let payload = serde_json::json!({}).to_string();
    db.append_event("experiment", &id, "archived", &payload, None)?;
    Ok(())
}

#[tauri::command]
fn unarchive_experiment(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let payload = serde_json::json!({}).to_string();
    db.append_event("experiment", &id, "unarchived", &payload, None)?;
    Ok(())
}

#[tauri::command]
fn append_event(
    state: tauri::State<'_, AppState>,
    entity_type: String,
    entity_id: String,
    event_type: String,
    payload: String,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    db.append_event(&entity_type, &entity_id, &event_type, &payload, None)
}

#[tauri::command]
fn verify_chain(
    state: tauri::State<'_, AppState>,
) -> Result<VerifyResult, String> {
    let db = state.db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let (ok, broken_at) = db.verify_chain()?;
    Ok(VerifyResult { ok, broken_at })
}

#[tauri::command]
async fn search_pubmed(
    query: String,
    max_results: u32,
) -> Result<Vec<pubmed::PubMedArticle>, String> {
    let client = pubmed::PubMedClient::new();
    let pmids = client.search(&query, max_results).await?;
    let articles = client.get_summaries(&pmids).await?;
    Ok(articles)
}

/// Flatten a (possibly transparent) PNG onto an opaque white background and
/// return the re-encoded PNG bytes. Vega exports figures with a transparent
/// background, and compositing white in the WebKit webview is unreliable, so we
/// do it here in Rust where it's deterministic.
#[tauri::command]
fn flatten_png_white(png: Vec<u8>) -> Result<Vec<u8>, String> {
    use image::{ImageFormat, Rgba, RgbaImage};
    let src = image::load_from_memory_with_format(&png, ImageFormat::Png)
        .map_err(|e| format!("decode PNG: {}", e))?
        .to_rgba8();
    let (w, h) = src.dimensions();
    let mut out = RgbaImage::from_pixel(w, h, Rgba([255, 255, 255, 255]));
    for (x, y, p) in src.enumerate_pixels() {
        let a = p[3] as f32 / 255.0;
        let over = |c: u8| (c as f32 * a + 255.0 * (1.0 - a)).round().clamp(0.0, 255.0) as u8;
        out.put_pixel(x, y, Rgba([over(p[0]), over(p[1]), over(p[2]), 255]));
    }
    let mut buf = std::io::Cursor::new(Vec::new());
    out.write_to(&mut buf, ImageFormat::Png)
        .map_err(|e| format!("encode PNG: {}", e))?;
    Ok(buf.into_inner())
}

/// Write raw bytes to an absolute path, creating parent directories as needed.
/// Used by figure/data export. Done in Rust so writes are NOT subject to the
/// tauri-plugin-fs scope allowlist — the user picks any folder via the dialog
/// and we can write straight into it. Returns the path written.
#[tauri::command]
fn write_export_file(path: String, contents: Vec<u8>) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create folder {}: {}", parent.display(), e))?;
    }
    std::fs::write(p, &contents).map_err(|e| format!("Could not write {}: {}", path, e))?;
    Ok(path)
}

/// Copy a file from `src` (an absolute path the user picked) into the project
/// folder at `dest`, creating parent directories as needed. Used to pull inputs
/// (images, spreadsheets) into an experiment's directory so analysis always runs
/// off the copy that lives with the project. Returns the destination path.
/// Done in Rust with std::fs so it isn't bound by the tauri-plugin-fs scope.
#[tauri::command]
fn copy_file(src: String, dest: String) -> Result<String, String> {
    let dp = std::path::Path::new(&dest);
    if let Some(parent) = dp.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create folder {}: {}", parent.display(), e))?;
    }
    std::fs::copy(&src, &dest)
        .map_err(|e| format!("Could not copy {} -> {}: {}", src, dest, e))?;
    Ok(dest)
}

/// Run a Python or R script to generate a plot. The code is written to a temp
/// file in `work_dir`, executed, and the process output (stdout + stderr) is
/// returned. The AI Chart Builder uses this to execute Phi-3-generated code.
/// `language` must be "python" or "r".
#[tauri::command]
fn run_plot_script(code: String, language: String, work_dir: String) -> Result<String, String> {
    let dir = std::path::Path::new(&work_dir);
    if !dir.exists() {
        return Err(format!("Work directory does not exist: {}", work_dir));
    }

    let (ext, interpreter) = match language.as_str() {
        "python" => ("py", "python3"),
        "r" => ("R", "Rscript"),
        other => return Err(format!("Unsupported language: {}", other)),
    };

    let script_path = dir.join(format!("_labvar_aichart.{}", ext));
    std::fs::write(&script_path, &code)
        .map_err(|e| format!("Failed to write script: {}", e))?;

    let output = std::process::Command::new(interpreter)
        .arg(script_path.to_str().unwrap_or(""))
        .current_dir(dir)
        .output()
        .map_err(|e| format!("Failed to run {}: {}", interpreter, e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // Clean up the temp script
    let _ = std::fs::remove_file(&script_path);

    if output.status.success() {
        Ok(if stdout.is_empty() { "Script completed successfully.".into() } else { stdout })
    } else {
        Err(format!("Script failed (exit {}):\n{}\n{}", output.status, stderr, stdout))
    }
}

/// Run `ollama pull <model>` and stream progress lines back to the frontend
/// via a Tauri event. The frontend listens for `ollama-pull-progress:<model>`
/// events and updates the UI as chunks come in.
///
/// Ollama's `ollama pull` prints human-readable status lines on stderr like:
///   pulling manifest
///   pulling ab12cd...  15% ▕██▏  120 MB/ 800 MB  10 MB/s   0m1s
///   verifying sha256 digest
///   success
///
/// We parse the percent when we can and emit each line as a `PullEvent`.
#[tauri::command]
async fn pull_ollama_model(app: tauri::AppHandle, model: String) -> Result<(), String> {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};

    let event_name = format!("ollama-pull-progress:{}", model);

    // Sanity check: refuse if `ollama` isn't on PATH.
    if Command::new("ollama").arg("--version").output().is_err() {
        let msg = "The 'ollama' command is not on your PATH. Install Ollama from ollama.com/download and try again.";
        let _ = app.emit(
            &event_name,
            serde_json::json!({ "status": "error", "error": msg, "done": true }),
        );
        return Err(msg.to_string());
    }

    let mut child = Command::new("ollama")
        .arg("pull")
        .arg(&model)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn ollama: {}", e))?;

    // Read stderr line-by-line (ollama writes progress there).
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "ollama had no stderr".to_string())?;
    let reader = BufReader::new(stderr);
    let app_for_thread = app.clone();
    let event_for_thread = event_name.clone();
    std::thread::spawn(move || {
        for line in reader.lines().flatten() {
            let percent = parse_percent(&line);
            let payload = if let Some(p) = percent {
                serde_json::json!({ "status": line, "percent": p })
            } else {
                serde_json::json!({ "status": line })
            };
            let _ = app_for_thread.emit(&event_for_thread, payload);
        }
    });

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait on ollama: {}", e))?;
    if status.success() {
        let _ = app.emit(
            &event_name,
            serde_json::json!({ "status": "complete", "percent": 100, "done": true }),
        );
        Ok(())
    } else {
        let msg = format!("ollama pull exited with status {}", status);
        let _ = app.emit(
            &event_name,
            serde_json::json!({ "status": "error", "error": msg, "done": true }),
        );
        Err(msg)
    }
}

/// Best-effort percent parser for ollama's status lines (`... 42% ...`).
fn parse_percent(line: &str) -> Option<f64> {
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
                i += 1;
            }
            // Look for '%' immediately after (or with a space).
            let mut j = i;
            while j < bytes.len() && bytes[j] == b' ' {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b'%' {
                let s = std::str::from_utf8(&bytes[start..i]).ok()?;
                return s.parse::<f64>().ok();
            }
        }
        i += 1;
    }
    None
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second launch was attempted: instead of opening another window,
            // reveal + raise the one that's already running, then let the new
            // process exit. show() undoes a hidden window, unminimize() undoes a
            // dock-minimized one, set_focus() brings it to the front.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");
            std::fs::create_dir_all(&app_dir).expect("Failed to create app data directory");
            let db_path = app_dir.join("labvar.db");
            let database = db::Database::open(&db_path)
                .expect("Failed to open LabVAR database");
            app.manage(AppState {
                db: Mutex::new(database),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_experiment,
            list_experiments,
            get_experiment,
            delete_experiment,
            delete_dataset,
            delete_figure,
            delete_test_result,
            delete_note,
            rename_experiment,
            archive_experiment,
            unarchive_experiment,
            import_dataset,
            list_datasets,
            get_dataset,
            save_figure,
            list_figures,
            get_figure,
            save_test_result,
            list_test_results,
            create_stock,
            update_stock,
            list_stocks,
            create_culture,
            check_culture,
            list_cultures,
            save_hypothesis,
            list_hypotheses,
            add_note,
            list_notes,
            append_event,
            verify_chain,
            search_pubmed,
            write_export_file,
            copy_file,
            flatten_png_white,
            imaging::list_tiffs,
            imaging::decode_tiff,
            run_plot_script,
            pull_ollama_model,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LabVAR");
}
