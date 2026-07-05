# LabVAR — Codebase Map

> **Purpose:** A living directory of how this app is built so Claude (and you) don't have to re-search the codebase every session. **Keep this current.** When you add/rename/remove a command, component, or lib function, update the relevant section here in the same commit.
>
> **Repo path:** `/Users/muzammilimran/Documents/Claude/SpliceVar` (the *outer* folder — the source lives directly in `src/` and `src-tauri/`).
> **Docs layout:** all Claude/agent-facing notes (this file, `CLAUDE.md`, `AGENTS.md`, planning docs) live under `.agents/` at the repo root. Root-level `README.md` is the user-facing launch doc. iCloud can leave files half-downloaded at session start; verify files exist before assuming they're missing.

## 🆕 v0.5 (2026-07-05, this session — pre-launch cleanup)

**Onboarding + prefs + release wiring, all frontend-verified (`tsc --noEmit` and `vite build` clean); the new Rust command still pending compile until `npm run tauri build`.**

- **`src/lib/userPrefs.ts`** — single source of truth for user preferences, persisted to `localStorage 'labvar.userPrefs'`. Shape: `{ onboarded, userName, initials, dataDir, defaultLanguage, defaultModel, ollamaEndpoint, defaultExportFormat }`. Reactive via `useUserPrefs()`. `updatePrefs`, `resetPrefs`, `deriveInitials` helpers exported.
- **`src/lib/ollamaSetup.ts`** — `detectOllama()` pings `/api/tags`; `detectOS()` returns mac/windows/linux/unknown; `ollamaInstallInstructions(os)` returns OS-specific steps; `pullOllamaModel(model, onProgress)` invokes the new Rust command and subscribes to the `ollama-pull-progress:<model>` event channel.
- **`src/features/onboarding/OnboardingWizard.tsx`** — full-screen 5-step wizard (welcome → folder picker → profile → AI model → done). Shown when `!prefs.onboarded`; sets the flag on completion. Model step detects Ollama, offers `ollama pull` with live progress bar; falls back to install instructions if missing.
- **`src/App.tsx`** — gates the wizard at boot via `useState(() => !getPrefs().onboarded)`. Once dismissed, the Sidebar+MainPanel render normally.
- **`src/features/settings/SettingsWorkspace.tsx`** — rewritten to bind to `userPrefs`. Editable name, folder picker, theme, Ollama endpoint, default model, language, export format. New Reset section: "Show onboarding again" (clears the `onboarded` flag) + "Reset all preferences".
- **`src/shell/Sidebar.tsx`** — avatar initials/name now come from `userPrefs` (was hardcoded "MI" / "Muzammil I."). Version tag corrected to v0.1. `loadExampleStudy` import + button removed.
- **`src/features/experiments/HomeView.tsx`** — rewritten without any reference to the personal seed study. Hero greets the user by name if set. "Load example study" replaced by "Plot a CSV" jump.
- **`src/lib/seedExample.ts`** — **DELETED.** The whole hardcoded N2/numr-1 GFP demo is gone.
- **`src/features/design/DesignTab.tsx`** — placeholder text de-personalized (FUdR/numr-1 → "Treatment X"/"gene Y").
- **`src-tauri/src/lib.rs`** — new async command `pull_ollama_model(model)` that shells out to `ollama pull` with a piped stderr, parses percent from each line, and emits `ollama-pull-progress:<model>` Tauri events. Also uses `tauri::Emitter` (import added).
- **`src-tauri/tauri.conf.json`** — added `category`, `shortDescription`, `longDescription`, `publisher`, `copyright`, `macOS.minimumSystemVersion=10.15`, `windows.webviewInstallMode=downloadBootstrapper`, `linux.deb.depends`. `minWidth`/`minHeight` on the window.
- **`.github/workflows/release.yml`** — replaces old `build.yml`. Uses official `tauri-apps/tauri-action@v0`; matrix builds macOS arm64 + x64, Windows x64, Linux x64; creates draft GitHub Release on `v*` tag with all bundle artifacts attached. Reserves the code-signing secrets so you can flip them on later.
- **`README.md`** — full rewrite for public launch: Install / First run / Features / Build from source / Architecture / Privacy / Roadmap. No personal references. Explains the onboarding flow.
- **Root cleanup**: `MAP.md`, `CLAUDE.md`, `AGENTS.md`, `IMAGE_ANALYSIS_PLAN.md`, `UX_ADOPTION_MAP.md` all moved into `.agents/`; the stray `SpliceVar/` inner folder deleted. Root now shows just README + LICENSE + config + source dirs.

⚠️ **First recompile needed on a Rust-capable machine**: `npm run tauri build` (or `npm run deploy`). Frontend already builds clean. The new `pull_ollama_model` command uses `tauri::Emitter` which is available in Tauri 2 — no new crate deps.

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

## 🧭 v0.4 changes (AI Chart Builder + Settings)

Frontend-verified (tsc + vite build clean). New Rust command `run_plot_script` compile-pending until `npm run deploy`.

- **AI Chart Builder** — agentic plotting via local Phi-3 Mini (Ollama). Lives inside the **Plotting & Stats** workspace as a tab toggle ("Preset Charts" / "AI Chart Builder"). User provides a CSV (with its full disk path + directory), describes what they want in free-text fields (context, appearance), sets axis titles, color scheme (18 presets), and Python/R preference. `lib/ollamaClient.ts` streams from Ollama at `localhost:11434`, extracts code from the response. `features/aichart/AiChartWorkspace.tsx` is the full UI: CSV picker with column preview, form fields, streaming code generation, editable code review, execution, result image display, and iterative correction loop (user describes what to fix, model regenerates). **Key design:** CSV directory path is passed to the model so generated code reads/writes from the correct location — the model cannot run code itself, so the app handles execution via the new `run_plot_script` Rust command (`std::process::Command` running `python3` or `Rscript` in the CSV's directory). Output is always `ai_chart_output.png` in the CSV directory.
- **Settings workspace** — `features/settings/SettingsWorkspace.tsx`, routed via `settings` View. Placeholder UI with Account card (initials avatar + name), Appearance (dark/light toggle, functional), AI Integration (Ollama endpoint, default model, default language — display-only for now), Data & Export (default export format, provenance chain status). No backend wiring yet — just the shell.
- **Sidebar footer replaced** — "Local-first research tool" text replaced with an account avatar (initials "MI") + name + settings gear icon. Clicking either navigates to the Settings workspace. Theme toggle remains.
- **New Rust command:** `run_plot_script(code, language, work_dir)` — writes code to a temp file in `work_dir`, executes via `python3`/`Rscript`, returns stdout or throws stderr. Registered in `invoke_handler!`. Frontend wrapper in `lib/invoke.ts` as `runPlotScript()`.

## 🧭 v0.3 changes (cleanup + deletability + project folders)

Frontend-verified (tsc + vite build clean). Backend commands compile-pending until `npm run deploy`.

- **Removed the Figures/RNA-seq workspace** — `features/figures/FiguresWorkspace.tsx` is now an empty stub (mount blocks deletion), dropped from `View`, `Sidebar` WORKSPACES, `MainPanel` routing; `volcano` + `heatmap` presets deleted from `figurePresets.ts`. `store.loadFigures`/`figures` (saved Vega figures) are unrelated and stay.
- **Scrapped the Lab Management sidebar section** (Inventory + Log Culture Check nav). `inventory` view/route + store stocks/cultures remain (Design still reads stocks) but there's no nav to Inventory. `HomeView` was rewritten to drop the stock/culture alerts + "Add Stock" card (2nd quick card is now Experimental Design).
- **All emojis + mojibake removed from the UI.** Workspace `icon` props dropped; ✕→×, checkmarks/gears/etc. removed. `LabMathWorkspace.tsx` and `HomeView.tsx` had invalid-UTF-8 mojibake (µ, subscripts→`?`, em-dash/apostrophe/ellipsis→`�`) and were rewritten in clean UTF-8 (µM/µL units, C1/C2/V1/V2). Only remaining non-ASCII: typographic ·—→ and one stray byte in the unused `lib/utif.d.ts`.
- **Deletability (append-only backend).** New Tauri commands: `delete_dataset`/`delete_figure`/`delete_test_result`/`delete_note` append a `<entity>/deleted` event; new `fold_projection` arms remove the projection row (dataset delete also drops derived figures/test_results). `delete_experiment` no longer requires "no datasets" — it cascades (the `experiment/deleted` fold already cleans children). Wrappers in `lib/invoke.ts`. UI: DataTab "Delete dataset", StatsTab per-result Delete + Clear all, NotesTab per-note Delete, Sidebar experiment Delete (cascades, with confirm). Tool workspaces (Design/Assay/Gel/Image/LabMath-notes) got explicit **Save** (toast) + **Autosaves** hint + per-item Delete + **Clear all**.
- **Project folder = experiment directory + auto-copy.** New Rust `copy_file(src,dest)` (std::fs::copy, bypasses fs-plugin scope like `write_export_file`). `ExperimentView` has a `ProjectFolderBar` binding one folder per experiment (reuses `exportFile.getProjectDir/setProjectDir/chooseProjectDir` keyed by expId). `DataTab` auto-copies imported CSVs into `<dir>/data/` (`saveIntoDir`). `GelWorkspace` binds its own folder (key `'gel'`) and copies each opened image into `<dir>/images/` via `copyFile`, then decodes/analyzes off the copy (falls back to original on failure).
- **Per-experiment node cluster (DONE).** The notebook graph is now scoped per experiment directory. `lib/localStore.ts` exports `scopedGraphKeys(project)` → `graphNodes:<id>`/`graphEdges:<id>` (project `null` = shared "Scratch / all" board on the base keys, preserving any legacy global graph). `NotebookWorkspace` has a `projectId` state (persisted `labvar.graph.project`), a **project switcher** `<select>` in the toolbar (Scratch + each experiment), and swaps collections via the scoped keys. Auto-import is project-aware: for an experiment it fetches that experiment's datasets+figures (`listDatasets`/`listFigures`, cached once per project in `projData` state) and auto-wires experiment→dataset→figure edges; Scratch keeps the legacy all-experiments+tools overview. `openNode` routes dataset/figure nodes to the experiment's Data/Plots tabs; `deletePermanently` now also deletes dataset/figure backend records. `ExperimentView` has an **"Open node cluster"** button (sets `labvar.graph.project` + navigates to notebook). `seedExample` writes its curated cluster under the seed experiment's scoped keys (falls back to Scratch if no backend). ⚠️ Naming: the notebook state is `projectId` (NOT `project`) because `project` is the imported 3D-projection fn from `graph3d`.

## 🧭 v0.2 workspace restructure (Claude-app model)

The app is no longer experiment-first. The sidebar now leads with standalone **Tools** (nothing committed to an experiment up front); experiments are optional "projects" listed below, and Inventory sits under Lab Management. Nav is driven by the expanded `View` union in `useAppStore.ts`:
`home | experiment | design | plots | gel | assays | labmath | figures | notebook | inventory | settings`.

- **Routing:** `shell/MainPanel.tsx` is a flex column: a slim top bar (holds the persistent right-aligned **Node view** tab, `NodeViewTab`, which toggles into `notebook` and back to the last view) + a scroll area that switches `view` → the workspace component. `shell/Sidebar.tsx` renders the ordered `WORKSPACES` list; clicking a tool calls `setActiveExperiment(null)` then `setView(id)` so tools are standalone.
- **Shared chrome:** `components/Workspace.tsx` (`Workspace` header wrapper + `ComingSoon` dashed panel).

**Client-side persistence for the new features** — `lib/localStore.ts`. These workspaces do NOT use the Rust event log (couldn't compile everywhere); instead a small namespaced, reactive CRUD layer over `localStorage`:
- `store.{list,get,create,update,put,remove,replaceAll,clear}` + `useCollection<T>(name)` React hook (built on `useSyncExternalStore` with a snapshot cache so it doesn't loop).
- Records extend `BaseRecord { id, created_ts, updated_ts }`. Collection keys in `COLLECTIONS`.
- **Migration path:** reimplement `read`/`write` against Tauri events to promote any collection into the provenance log; feature code + hook are unchanged.

**New feature folders / files:**
- `features/design/DesignWorkspace.tsx` — objective/hypothesis/constraints/groups, reagent shopping list (auto-checked against `stocks`), ideas, Materials & Methods draft. Exports M&M to Word (`.doc` HTML) / Markdown, shopping list to CSV.
- `features/plot/PlotWorkspace.tsx` — hub over the existing `PlotTab` engine; "Quick plot from CSV" spins up a scratch experiment (`createExperiment`+`importDataset`) then jumps to its plots tab. (PlotTab itself is unchanged.)
- `features/gel/GelWorkspace.tsx` + `lib/densitometry.ts` — canvas gel/GFP quantification. Draw one lane ROI → auto-tile N lanes → `quantify()` (luminance/green channel, invert for dark bands, percentile background subtraction) → `normalizeLanes()` (reference-lane + fraction). Draggable ROIs, editable labels + per-lane override, CSV/JSON export, saved analyses (metadata+results only, no pixels) in `gelAnalyses`.
- `features/assays/AssayWorkspace.tsx` — poor-man's-Excel tracker. Templates (lifespan/timecourse/blank), editable/deletable rows + columns (text/number/date), CSV + JSON export. Data in `assays`.
- `features/labmath/LabMathWorkspace.tsx` — C₁V₁ dilution, molarity (mass from MW/conc/vol), serial dilution series, quick notes (`labMathNotes`). Pure client math.
- `features/figures/FiguresWorkspace.tsx` — working **volcano plot** (loads a DE table, picks log2FC/p columns, thresholds → colored scatter via `vega-embed` in a ref, export significance calls CSV); gene lookup + pathway enrichment are `ComingSoon`.
- `features/notebook/NotebookWorkspace.tsx` + `lib/graph3d.ts` — **3D node-graph lab notebook** (Obsidian-like), the flagship. Full-bleed `<canvas>` (`absolute inset-0`) with only floating overlays: a top-left toolbar (Move/Connect mode toggle, Add▾, Freeze/Reset/Export), legend + counts bottom corners, and a floating inspector / edge-editor card top-right (`FloatingPanel`). Dependency-free force-directed 3D graph (`project`/`screenBasis`/`forceStep`). **Move mode:** drag node = move (view-plane via `screenBasis`), drag empty = orbit, shift-drag = pan, wheel = zoom, click node/edge = select. **Connect mode:** drag from one node to another draws a live temp link and creates a labeled edge (auto-selects it for naming); click an edge to relabel / flip / delete. Auto-imports experiments/assays/designs/gels as nodes; user adds idea/note/file/pdf nodes. **Deletion:** every node/edge is removable — Delete/Backspace on the selected item, right-click a node/edge, or the inspector. Source-backed nodes offer "Remove from map" (`removeFromMap`, dismisses to `labvar.graph.dismissed`, restorable via the toolbar "Restore N hidden" → `restoreHidden`) vs "Delete data permanently" (`deletePermanently`, also deletes the underlying assay/design/gel `localStore` record or calls `deleteExperiment`, surfacing the backend's no-datasets error). Custom nodes just delete. **Double-click a node → open its source** (experiment view / assay / design / gel) via `openNode`, which routes through the store's `deepLink { view, itemId }` channel (`useAppStore`); the target workspace reads `deepLink` on mount, selects the item, and clears it. Inspector has an "Open ↗" button too. Positions persisted to `localStorage['labvar.graph.positions']`; nodes/edges in `graphNodes`/`graphEdges`. **Export notebook** writes an Obsidian-style folder (one `.md` per node with YAML frontmatter + `[[wikilinks]]` under `notes/`, plus `graph.json`) via the Tauri fs plugin, falling back to a `graph.json` download outside Tauri. Reachable from anywhere via the top-bar **Node view** tab.

> AI/Ollama assist for Design is intentionally deferred (per product direction). The `ai.rs` trait stub remains parked.

### Baked-in example study — `lib/seedExample.ts`
A one-click hardcoded demo that stages the whole app end-to-end using the author's real *"Drug-Induced Stress Signalling Rescues RNA Dysregulation in C. elegans"* (numr-1 / pgp-8 GFP) data. `loadExampleStudy()` (idempotent, guarded by `SEED_FLAG = 'labvar.seed.n2gfp.v1'`) writes, with **fixed record ids** so graph edges wire deterministically:
- a **Design** doc (`designDocs`, id `seed-n2-design`) — objective/hypothesis/groups/reagents/M&M from the poster;
- a long-format **Assay** table (`assays`, id `seed-n2-assay-numr`) of real per-worm numr-1 5-FU GFP (dose × time × replicate);
- four **Gel/GFP densitometry** analyses (`gelAnalyses`, ids `seed-gel-*`) seeded with the real 24 h condition means, control-normalised;
- four wide-format **CSV datasets** imported into a real experiment via `invoke` (`createExperiment`+`importDataset`) — **guarded**: skipped gracefully if no Rust backend (dev browser), in which case the experiment node is non-navigable;
- a curated **3-D node graph** (`graphNodes`/`graphEdges`, ids `seed-n-*`/`seed-e-*`) linking poster→design→experiment→datasets→{assay, gels, figures}→findings→conclusion with labelled edges and hand-placed `seedX/Y/Z` positions.
The notebook's auto-import is a no-op for the seeded design/assay/gel/experiment nodes because their `sourceRef`s already exist. Entry points: **Home hero** button ("Load example study" / "Open example study →") and a **Sidebar → Tools → "✨ Example study"** item; both call `loadExampleStudy()` then jump to the Node view. `isExampleLoaded()` gates re-seeding. To see it in the installed app, redeploy (`npm run deploy`).

---

## 🔎 Common "where do I…" index

- **Add a new stored entity / mutation** → new event type: add command in `lib.rs`, register it in `invoke_handler!`, add a `fold_projection` arm + (maybe) projection table in `db.rs`, add wrapper in `lib/invoke.ts`, add loader/state in `useAppStore.ts`. Recompile.
- **Change how a figure is drawn** → `PlotTab.tsx buildSpec` (+ `figurePresets.ts` if it's a new preset).
- **Change a statistical test** → `lib/stats.ts` (keep SciPy parity).
- **Parse a new CSV/condition format** → `lib/labdata.ts` (`inferCondition` regexes: `TIME_RE`, `DOSE_RE`, `CONTROL_RE`).
- **Theme / colors** → `index.css` (`.light`/`.dark`) + store theme + `makeConfig` in PlotTab for chart theming.
- **File export behavior / project-folder export** → `lib/exportFile.ts` (+ folder UI & `routeExport` in `PlotTab.tsx`; Rust plugins in `src-tauri` Cargo.toml/lib.rs/capabilities/tauri.conf.json).
- **Provenance/hashing** → `src-tauri/src/provenance.rs` + `db.rs append_event/verify_chain`.
- **Add a top-level tool/workspace** → add to `View` in `useAppStore.ts`, add a component under `features/<x>/`, route it in `MainPanel.tsx`, add to `WORKSPACES` in `Sidebar.tsx`. Persist its data with `useCollection('<key>')` (+ add the key to `COLLECTIONS` in `lib/localStore.ts`).
- **Gel/densitometry math** → `lib/densitometry.ts` (`quantify`, `normalizeLanes`); ROI/canvas UI in `features/gel/GelWorkspace.tsx`.
- **3D graph math** → `lib/graph3d.ts` (`project`, `screenBasis`, `forceStep`); notebook UI + export in `features/notebook/NotebookWorkspace.tsx`.
- **New-feature persistence / localStorage collections** → `lib/localStore.ts`.
- **AI Chart Builder** → `lib/ollamaClient.ts` (Ollama client, prompt construction, code extraction, color schemes) + `features/aichart/AiChartWorkspace.tsx` (UI). Embedded in `PlotWorkspace` as a tab. Rust execution in `lib.rs run_plot_script`, frontend wrapper in `lib/invoke.ts runPlotScript`.
- **Settings / user prefs** → `features/settings/SettingsWorkspace.tsx`. Placeholder UI; wired to `settings` View.
