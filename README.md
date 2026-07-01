<p align="center">
  <img src="public/tauri.svg" width="80" alt="LabVAR logo" />
</p>

<h1 align="center">LabVAR</h1>

<p align="center">
  <strong>Local-first, free, open-source desktop app for researchers to design experiments, analyze data, and run a lab.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#tech-stack">Tech Stack</a> &middot;
  <a href="#license">License</a>
</p>

---

## Why LabVAR?

Most lab software is cloud-locked, expensive, and sends your unpublished data to someone else's server. LabVAR runs entirely on your machine — no accounts, no subscriptions, no internet required. Every action is recorded in a tamper-evident, hash-chained provenance log so you always know exactly what happened to your data and when.

## Features

### Experiment Management
Create, archive, and organize experiments. Each experiment is a self-contained workspace with its own datasets, figures, statistical tests, hypotheses, and notes.

### CSV Import & Data Explorer
Import data via file picker or paste. Browse datasets in an interactive table with automatic type detection and column/row counts.

### Drag-and-Drop Plot Builder
Build publication-ready figures by dragging columns onto encoding shelves (X, Y, Color, Size, Facet). Six research-oriented templates out of the box:

- **Bar + Scatter** — with error bars
- **Box / Violin** — distribution plots
- **Dose-Response** — sigmoidal curves with log-scale
- **Before / After** — paired comparisons
- **Volcano** — fold change vs. p-value
- **Time Series** — temporal data with interpolation

All plots are rendered as Vega-Lite specs and saved as reproducible artifacts.

### Statistical Testing
Run hypothesis tests powered by SciPy (via Pyodide — no Python install needed). Results are stored per-dataset with full parameter records.

### Experimental Design
Structure your thinking with formal hypotheses (question, H₀, H₁) and a lab notebook for free-form notes.

### Inventory & Culture Tracking
Track reagent stocks with reorder alerts. Schedule and monitor culture maintenance intervals.

### Literature Search
Search PubMed directly from within the app.

### Optional AI Assistant
Local-only AI via Ollama — never sends data off your machine. Completely optional; the app works fully without it.

## Quick Start

**Prerequisites:** [Node.js](https://nodejs.org/) 18+, [Rust](https://rustup.rs/) 1.70+, and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
git clone https://github.com/muzimran/LabVAR.git
cd LabVAR
npm install
npm run tauri dev
```

To build a distributable app:

```bash
npm run tauri build
```

The installer will be in `src-tauri/target/release/bundle/`.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  React + Vite + TypeScript + Tailwind            │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌───────────┐ │
│  │DataTab │ │PlotTab │ │StatsTab│ │InventoryTab│ │
│  └───┬────┘ └───┬────┘ └───┬────┘ └─────┬─────┘ │
│      └──────────┴──────────┴─────────────┘       │
│                    Zustand Store                  │
│                    invoke() IPC                   │
├──────────────────────────────────────────────────┤
│  Tauri 2 / Rust                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │ append_event() ─── the ONLY write path      │ │
│  │     │                                       │ │
│  │     ▼                                       │ │
│  │ ┌─────────┐    ┌──────────────────────────┐ │ │
│  │ │ events  │───▶│ projection tables        │ │ │
│  │ │ (append │    │ (derived, disposable,    │ │ │
│  │ │  only)  │    │  rebuildable)            │ │ │
│  │ └─────────┘    └──────────────────────────┘ │ │
│  │     │                                       │ │
│  │     ▼                                       │ │
│  │ SHA-256 hash chain (provenance)             │ │
│  └─────────────────────────────────────────────┘ │
│  SQLite (rusqlite, bundled)                      │
└──────────────────────────────────────────────────┘
```

**Key invariants:**

- **Append-only event log** — every mutation flows through `append_event()`. There are no update or delete paths on the events table.
- **Hash chain** — `SHA-256(prev_hash || seq || timestamp || entity_type || entity_id || event_type || payload)` links every event to its predecessor.
- **Projection tables** — materialized views derived from the event log. They can be dropped and rebuilt at any time.
- **Verifiable** — `verify_chain()` walks the entire log and confirms integrity.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2 (Rust) |
| Frontend | React 19 + Vite + TypeScript |
| Styling | Tailwind CSS 4 |
| State | Zustand |
| Tables | TanStack Table |
| Drag & drop | dnd-kit |
| Charts | Vega-Lite 6 + react-vega 8 |
| Database | SQLite (rusqlite, bundled) |
| Hashing | sha2 (Rust) |
| Stats engine | Pyodide + SciPy (lazy-loaded in browser) |
| AI (optional) | Ollama (local only) |

## Project Structure

```
src/                    # React frontend
  features/
    experiments/        # DataTab, experiment views
    plot/               # Drag-and-drop plot builder
    stats/              # Statistical testing UI
    design/             # Hypotheses & experimental design
    inventory/          # Stock & culture tracking
  store/                # Zustand state management
  lib/                  # Tauri invoke wrappers
  shell/                # App shell, sidebar, layout
  components/           # Shared components (DataTable, etc.)

src-tauri/src/          # Rust backend
  lib.rs                # Tauri commands
  db.rs                 # Database, migrations, event folding
  provenance.rs         # Hash chain computation & verification
  ai.rs                 # AiProvider trait + Ollama implementation
  pubmed.rs             # PubMed search integration
```

## License

[Apache 2.0](LICENSE)
