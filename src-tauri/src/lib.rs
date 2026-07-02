mod ai;
mod db;
mod provenance;
mod pubmed;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::Manager;

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
    // Only allow deleting if the experiment has no datasets
    if db.has_datasets(&id)? {
        return Err("Cannot delete an experiment that has data. Archive it instead.".to_string());
    }
    let payload = serde_json::json!({}).to_string();
    db.append_event("experiment", &id, "deleted", &payload, None)?;
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
            flatten_png_white,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LabVAR");
}
