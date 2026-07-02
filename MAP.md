# LabVAR — Codebase Map

> **Purpose:** A living directory of how this app is built so Claude (and you) don't have to re-search the codebase every session. **Keep this current.** When you add/rename/remove a command, component, or lib function, update the relevant section here in the same commit.
>
> **Repo path:** `/Users/muzammilimran/Documents/Claude/SpliceVar` (the *outer* folder — the source lives directly in `src/` and `src-tauri/`).
> ⚠️ There is a stray empty `SpliceVar/` folder at the repo root (untracked, only holds a partial copy of `figurePresets.ts`). Ignore it — it is not the app. iCloud can also leave files half-downloaded at session start; verify files exist before assuming they're missing.

---

## ⏱️ Session workflow reminders (READ EVERY TIME)

1. **Recompile after Rust changes.** Editing anything in `src-tauri/` (commands, db, provenance) requires a rebuild — `npm run tauri dev` recompiles the Rust backend. Frontend-only changes (`src/`) hot-reload via Vite; no rebuild needed.
2. **Verify before finishing:**
   - Frontend typecheck: `npx tsc --noEmit`
   - Frontend build: `npx vite build --outDir /tmp/labvar-build --emptyOutDir` (write to `/tmp`, not repo `dist/`, to avoid EPERM on mounted/synced folders)
   - Backend (only where a Rust toolchain exists): `cargo build` / `cargo test` inside `src-tauri/`. **Note:** some environments have no Rust/cargo — you can only verify the frontend there.
3. **Push to git when a unit of work is done.** `git add -A && git commit -m "..." && git push`. Don't let changes pile up uncommitted (recent `git status` showed many modified files sitting unstaged).
   - **Deploy to /Applications:** `npm run deploy` (→ `scripts/install-macos.sh`) builds a release bundle, quits any running LabVAR, replaces `/Applications/LabVAR.app`, and relaunches. Single-instance (`tauri-plugin-single-instance` in `lib.rs`) means a running copy is reused, never duplicated. For dev, `npm run dev:app` auto-kills stale `target/debug/labvar` processes first (via the `predev:app` hook).
4. **Update this MAP.md** whenever the structure changes. A stale map is worse than none.
5. **Respect the architecture rules** (see below) — especially: never add update/delete Tauri commands; all writes go through `append_event()`.

---

## 🧱 Tech stack

**Desktop shell:** Tauri 2 (Rust backend + system webview, single-instance).
**Frontend:** React 19 · Vite 6 · TypeScript 5.8 · Tailwind CSS v4 (`@tailwindcss/vite`).
**State:** Zustand (`src/store/useAppStore.ts`).
**Tables:** TanStack Table v8. **Drag-and-drop:** dnd-kit. **Charts:** Vega / Vega-Lite via `react-vega`. **Excel import:** SheetJS (`xlsx`).
**Backend crates:** `rusqlite` (bundled SQLite, WAL) · `sha2` · `uuid` v4 · `chrono` · `serde`/`serde_json` · `reqwest`+`tokio` (async PubMed) · `tauri-plugin-opener`, `tauri-plugin-single-instance`, `tauri-plugin-dialog`, `tauri-plugin-fs` (last two for project-folder export). Capabilities in `src-tauri/capabilities/default.json`.
**Path alias:** `@/` → `src/` (configured in `vite.config.ts` and `tsconfig`).
**Dev server:** Vite on `http://localhost:1420` (Tauri `devUrl`). Build output → `dist/`.
**Bundle id:** `com.labvar.app` · productName `LabVAR` · version `0.1.0`.
**CI:** `.github/workflows/build.yml` builds+releases on `v*` tags for macOS (arm64+x64), Linux x64, Windows x64.

---

## 🏛️ Architecture (the non-negotiables)

- **Append-only provenance log.** `events` table is the single source of truth. Every mutation is an event appended via **`db.append_event()` — the ONLY write path.**
- **Hash chain.** Each event: `hash = SHA-256(prev_hash ‖ seq ‖ ts ‖ entity_type ‖ entity_id ‖ event_type ‖ payload)`. First event chains from `GENESIS_HASH` (64 zeros). `verify_chain` walks and re-checks every link.
- **Projection tables** (`experiments`, `datasets`, `figures`, `test_results`, `stocks`, `cultures`, `hypotheses`, `notes`) are derived/disposable — rebuilt by folding events (`fold_projection`).
- **No update/delete commands.** Corrections are new events (e.g. `renamed`, `archived`, `checked`, `updated`). "Delete experiment" only allowed when it has no datasets, and it just removes projections (event stays in log).
- **Stats are offline & dependency-free** (`src/lib/stats.ts`) — pure TS validated against SciPy. (The CLAUDE.md line about "Pyodide + scipy" is aspirational; current code uses hand-rolled numerics. AI is Ollama-only and **not yet wired**.)
- **Plots = Vega-Lite spec is the artifact.** `save_figure` stores the JSON spec; re-rendering reproduces the figure.

---

## 📁 Directory layout

```
SpliceVar/
├── src/                      # React frontend (app)
│   ├── main.tsx              # ReactDOM root, wraps <App/> in <ErrorBoundary>
│   ├── App.tsx               # Layout: <Sidebar/> + <MainPanel/>; applies theme; loads experiments
│   ├── index.css             # Tailwind entry + .light/.dark theme overrides
│   ├── store/useAppStore.ts  # Zustand store: nav state, data arrays, async loaders, theme
│   ├── lib/                  # Pure logic (no React)
│   ├── shell/                # App chrome (sidebar, main panel)
│   ├── components/           # Reusable UI primitives
│   └── features/             # Feature modules (one folder per domain)
├── src-tauri/                # Rust backend
│   ├── src/{main,lib,db,provenance,pubmed,ai}.rs
│   ├── Cargo.toml            # crate deps
│   └── tauri.conf.json       # app config (window, bundle, dev/build commands)
├── labvarfront/  landing/    # Marketing website (Astro) — SEPARATE from the app, ignore for app work
├── index.html                # Vite HTML entry
├── vite.config.ts            # Vite config + @ alias
├── CLAUDE.md / AGENTS.md     # short architecture notes for agents
└── MAP.md                    # ← this file
```

---

## 🦀 Backend — `src-tauri/src/`

### `main.rs`
Thin entry: calls `labvar_lib::run()`.

### `lib.rs` — Tauri commands + app setup
Defines shared serde structs (`Experiment`, `Dataset`, `Figure`, `TestResult`, `Stock`, `Culture`, `Hypothesis`, `Note`, `VerifyResult`) and `AppState { db: Mutex<Database> }`. `run()` sets up single-instance + opener plugins, opens the DB at `app_data_dir/labvar.db`, and registers the handler.

**Registered commands** (frontend calls these via `invoke`):

| Command | Args | Returns | Notes |
|---|---|---|---|
| `create_experiment` | name | id | event `experiment/created` |
| `list_experiments` | – | `Experiment[]` | ordered by created_ts desc |
| `get_experiment` | id | `Experiment` | |
| `rename_experiment` | id, name | – | event `renamed` |
| `delete_experiment` | id | – | **only if no datasets**, else errors |
| `archive_experiment` / `unarchive_experiment` | id | – | events `archived`/`unarchived` |
| `import_dataset` | experiment_id, name, csv_content | id | parses rows/cols, SHA-256s CSV, stores raw CSV in payload `csv_data` |
| `list_datasets` | experiment_id | `Dataset[]` | csv_data pulled from state_json |
| `get_dataset` | id | `Dataset` | includes csv_data |
| `save_figure` | experiment_id, dataset_id, vega_spec | id | spec stored verbatim |
| `list_figures` / `get_figure` | experiment_id / id | `Figure[]` / `Figure` | |
| `save_test_result` | experiment_id, dataset_id, test, params_json, result_json, scipy_version | id | |
| `list_test_results` | experiment_id | `TestResult[]` | |
| `create_stock` | name, qty, unit, reorder_at | id | |
| `update_stock` | id, qty, reorder_at | event_id | event `stock/updated` (projection mutated in place) |
| `list_stocks` | – | `Stock[]` | |
| `create_culture` | name, kind, interval_days | id | |
| `check_culture` | id | event_id | stamps `checked_at`; `next_due` computed in Rust on list |
| `list_cultures` | – | `Culture[]` | computes `next_due = last_checked + interval_days` |
| `save_hypothesis` | experiment_id, question, hypothesis, null_h, alt_h | id | |
| `list_hypotheses` | experiment_id | `Hypothesis[]` | |
| `add_note` / `list_notes` | experiment_id(, content) | id / `Note[]` | |
| `append_event` | entity_type, entity_id, event_type, payload | event_id | generic escape hatch |
| `verify_chain` | – | `VerifyResult{ok, broken_at}` | |
| `search_pubmed` | query, max_results | `PubMedArticle[]` | async; calls NCBI E-utilities |

### `db.rs` — SQLite + event log
- `Database::open(path)` → opens conn, WAL mode, runs `migrate()`.
- `migrate()` — creates `events` + all projection tables; ad-hoc `ALTER TABLE experiments ADD COLUMN archived`.
- **`append_event(entity_type, entity_id, event_type, payload, actor)`** — THE write path: computes seq, prev_hash, ts, hash; inserts event; calls `fold_projection`.
- `fold_projection(...)` — big `match (entity_type, event_type)` that upserts the correct projection table. Unknown pairs are recorded but not projected (forward-compatible).
- `verify_chain()` → `(ok, broken_at_seq)`.
- Read helpers: `has_datasets`, `list_experiments`, `get_experiment`, `list_datasets`, `get_dataset`, `list_figures`, `get_figure`, `list_test_results`, `list_stocks`, `list_cultures`, `list_hypotheses`, `list_notes`.
- `unsafe impl Send for Database` — safe because always behind the `Mutex` in `AppState`.

### `provenance.rs`
`compute_hash(prev_hash, seq, ts, entity_type, entity_id, event_type, payload) -> String` and `GENESIS_HASH`. Has unit tests (determinism, input sensitivity). This is the module to touch if the hashing scheme ever changes — and changing it invalidates existing chains.

### `pubmed.rs`
`PubMedClient` with async `search()` (esearch → PMIDs) and `get_summaries()` (esummary → `PubMedArticle{pmid,title,authors,journal,year,doi}`). HTTP done in Rust to dodge CORS.

### `ai.rs`
`AiProvider` trait + `OllamaProvider` (localhost:11434, model `llama3`). **Trait not implemented yet** — parked for v1.1. Optional; app works without it.

---

## ⚛️ Frontend — `src/`

### `store/useAppStore.ts` (Zustand)
Central store. Holds:
- **Nav:** `view` (`home|experiment|inventory|design`), `activeExperimentId`, `experimentTab` (`data|plots|stats|design|notes`), `activeDatasetId`, `modalOpen`.
- **Theme:** `theme` (`dark|light`), `setTheme`/`toggleTheme` (persists to `localStorage 'labvar.theme'`); `applyThemeClass` toggles `.light/.dark` on `<html>`.
- **Data arrays:** experiments, datasets, figures, testResults, stocks, cultures, hypotheses, notes + their setters.
- **Async loaders** (each lazy-imports `@/lib/invoke`, sets `loading[key]`): `loadExperiments`, `loadDatasets` (auto-selects first dataset), `loadDatasetDetail` (merges csv_data), `loadStocks`, `loadCultures`, `loadFigures`, `loadTestResults`, `loadNotes`, `loadHypotheses`.
- TS interfaces mirror the Rust structs.

### `lib/` — pure logic
- **`invoke.ts`** — typed wrappers around every Tauri command (see table above). One function per command; camelCase arg keys. **When you add a Rust command, add its wrapper here.**
- **`labdata.ts`** — CSV/TSV parsing + wet-lab shape inference.
  - `parseTable(text)` → `{columns, rows}`; auto-sniffs delimiter, handles BOM/CRLF/quoted fields.
  - `inferCondition(name)` → `Condition` (parses dose/unit/time/treatment/isControl from a column header like `"24 Hours FUDR 12.5uM"`).
  - `analyzeConditions`, `isWideFormat`, `toLong(table, roleOverrides)` → `LongRow[]` (pivot wide→long), `orderedDoseLabels`, `orderedTimeLabels`.
- **`stats.ts`** — offline stats validated against SciPy: `oneWayAnova`, `tukeyHSD` (Tukey–Kramer, `ptukey` via Simpson integration), `tTestUnpaired` (Welch/Student), `tTestPaired`, `pearson`, `summarize`, plus helpers `fPValue`, `tPValueTwoSided`, `formatP`, `stars`. No network/Pyodide.
- **`figurePresets.ts`** — the figure-preset registry ("what figures can this app draw"). Types `PlotMode`, `PlotStyle`, `RecommendedTest`, `DataNeeds`, `FigurePreset`, `DatasetShape`. Exports `FIGURE_PRESETS`, `ENABLED_PRESETS`, `getPreset(id)`, `presetFits(preset, shape)`.
- **`exportFile.ts`** — save-to-disk with graceful fallback: (1) native Tauri dialog+fs → (2) File System Access API → (3) blob `<a download>`. `saveFile`, `saveText`, `dataUrlToBytes`. Remembers last dir in `localStorage 'labvar.exportDir'`.
  - **Project-folder export (Option B):** `chooseProjectDir(expId)` opens a native directory picker and binds one folder per experiment (localStorage key `labvar.projectDir.<expId>`); `getProjectDir`/`setProjectDir` read/clear it; `saveIntoDir(baseDir, subdir, filename, data)` does recursive `fs.mkdir` + `fs.writeFile`; `safeSegment(name)` sanitizes a path segment. Layout is **by dataset**: exports land in `<projectDir>/<dataset>/<file>` with no per-file prompt. Falls back to `saveFile`/`saveText` when no folder is bound or the write fails.
  - ⚠️ Both the per-file native path AND the project-folder path need the Rust plugins compiled (`tauri-plugin-dialog`/`-fs` in Cargo.toml + `.init()` in lib.rs + `capabilities/default.json` + `plugins` in tauri.conf.json — **all now added**, but require `npm run tauri dev` to compile). Until compiled in a Rust-capable env, the picker throws and exports downgrade to download.

### `shell/`
- **`Sidebar.tsx`** — brand, experiment list (click to open, double-click/⋯-menu to rename, archive, delete-if-empty), archived section, quick actions (Import CSV, Log Culture Check), Inventory nav, theme toggle.
- **`MainPanel.tsx`** — switches on `view` → `HomeView | ExperimentView | InventoryView`; renders global `newExperiment` modal.
- `TopBar.tsx`, `index.ts` — `TopBar` is a deprecated stub; `index.ts` re-exports Sidebar/MainPanel.

### `components/`
- **`DataTable.tsx`** — generic TanStack table (sort + filter). `DataTable<T>` + `createColumnsFromKeys(keys)`.
- **`Modal.tsx`** — overlay modal (ESC to close, click-outside). Props: title, onClose, width.
- **`Button.tsx`** — variant/size button using CSS vars.
- **`ErrorBoundary.tsx`** — catches render errors, shows message instead of white screen. Wraps `<App/>` in `main.tsx`.

### `features/` (one folder per domain)
- **`experiments/`**
  - `HomeView.tsx` — dashboard (experiments, stock/culture summaries, quick create).
  - `ExperimentView.tsx` — tab bar for the active experiment; **hypothesis-first tab order**: `1·Hypothesis (design) → 2·Data → 3·Plots → 4·Stats → 5·Notes`.
  - `DataTab.tsx` — CSV/Excel import (`fileToCsv` uses SheetJS for `.xlsx/.xls`), preview via DataTable.
  - `NotesTab.tsx` — add/list notes.
  - `NewExperimentModal.tsx` — create-experiment form.
  - `ExperimentsPanel.tsx` — **deprecated stub.**
- **`plot/PlotTab.tsx`** (~1.4k lines — the big one) — the plot builder.
  - Key internals: `buildSpec(opts)` (constructs the Vega-Lite spec — the core function), `project(rows, mode)` (shape data for a `PlotMode`), `computeSig(rows, mode)` (significance brackets/stars), `colorScale`, `makeConfig(theme, fmt)` (dark/light Vega config).
  - Exported: `PlotFormat` interface, `DEFAULT_FORMAT`, `PALETTE_SCHEMES`, `PlotTab`.
  - UI subcomponents: `ConditionChip`, `Field`, `FormatPanel` (dnd-kit for control/experiment role assignment; format controls for theme/palette/order/output format).
  - `PlotBuilder.tsx` — **deprecated stub.**
- **`stats/StatsTab.tsx`** — pick test + groups, runs `src/lib/stats.ts`, renders results, saves via `save_test_result`. `StatsPanel.tsx` — **deprecated stub.**
- **`inventory/InventoryView.tsx`** — stocks (create/update qty, low-stock highlight via reorder_at) + cultures (create/check, next-due). `InventoryPanel.tsx` — **deprecated stub.**
- **`design/DesignTab.tsx`** — hypothesis scaffold (question / hypothesis / null_h / alt_h), reviewer critiques, PubMed search (`search_pubmed`). `DesignPanel.tsx` — **deprecated stub.**

> **Pattern note:** the `*Panel.tsx` files in every feature folder are dead stubs left from an earlier shell; the live components are `*View.tsx` / `*Tab.tsx`. Don't edit the stubs.

---

## 🔎 Common "where do I…" index

- **Add a new stored entity / mutation** → new event type: add command in `lib.rs`, register it in `invoke_handler!`, add a `fold_projection` arm + (maybe) projection table in `db.rs`, add wrapper in `lib/invoke.ts`, add loader/state in `useAppStore.ts`. Recompile.
- **Change how a figure is drawn** → `PlotTab.tsx buildSpec` (+ `figurePresets.ts` if it's a new preset).
- **Change a statistical test** → `lib/stats.ts` (keep SciPy parity).
- **Parse a new CSV/condition format** → `lib/labdata.ts` (`inferCondition` regexes: `TIME_RE`, `DOSE_RE`, `CONTROL_RE`).
- **Theme / colors** → `index.css` (`.light`/`.dark`) + store theme + `makeConfig` in PlotTab for chart theming.
- **File export behavior / project-folder export** → `lib/exportFile.ts` (+ folder UI & `routeExport` in `PlotTab.tsx`; Rust plugins in `src-tauri` Cargo.toml/lib.rs/capabilities/tauri.conf.json).
- **Provenance/hashing** → `src-tauri/src/provenance.rs` + `db.rs append_event/verify_chain`.
