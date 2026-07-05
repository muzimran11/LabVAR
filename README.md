<p align="center">
  <img src="public/tauri.svg" width="80" alt="LabVAR logo" />
</p>

<h1 align="center">LabVAR</h1>

<p align="center">
  <strong>Local-first, free, open-source desktop app for researchers to design experiments, quantify data, plot results, and run a lab.</strong>
</p>

<p align="center">
  <a href="#install">Install</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#first-run">First run</a> &middot;
  <a href="#build-from-source">Build from source</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#license">License</a>
</p>

<p align="center">
  <a href="https://github.com/muzimran/LabVAR/releases"><img alt="Release" src="https://img.shields.io/github/v/release/muzimran/LabVAR?include_prereleases&sort=semver"></a>
  <img alt="License" src="https://img.shields.io/badge/license-Apache_2.0-blue">
  <img alt="Platforms" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey">
  <img alt="Made with Tauri" src="https://img.shields.io/badge/built_with-Tauri_2-24C8DB">
</p>

---

## Why LabVAR?

Most lab software is cloud-locked, expensive, and sends your unpublished data to someone else's server. **LabVAR runs entirely on your machine.** No accounts, no subscriptions, no internet required. Every experiment mutation is recorded in a tamper-evident, hash-chained provenance log so you always know exactly what happened to your data and when.

The app bundles the tools a wet-lab researcher actually reaches for every day — an experimental-design scaffold, a drag-and-drop plotting engine, offline statistics, gel/GFP densitometry, an assay tracker, lab-math calculators, image analysis, and a 3-D graph notebook — all in one native desktop app.

## Install

Grab the installer for your OS from the [Releases page](https://github.com/muzimran/LabVAR/releases/latest).

| Platform | File |
| --- | --- |
| macOS (Apple Silicon) | `LabVAR_x.y.z_aarch64.dmg` |
| macOS (Intel) | `LabVAR_x.y.z_x64.dmg` |
| Windows 10/11 | `LabVAR_x.y.z_x64-setup.exe` or `LabVAR_x.y.z_x64_en-US.msi` |
| Linux (Debian/Ubuntu) | `labvar_x.y.z_amd64.deb` or `labvar_x.y.z_amd64.AppImage` |

Open the file and follow the platform's usual install flow.

> **First-launch warning on macOS:** the binary is not yet notarized. On the first launch, right-click the app in `/Applications` and choose *Open* to accept the Gatekeeper prompt.
> **On Windows:** SmartScreen may flag the unsigned installer. Click *More info* → *Run anyway*. Code signing certs are on the roadmap.

## First run

The first time you launch LabVAR you'll see a short onboarding wizard:

1. **Choose a data folder.** LabVAR uses this as the default project root for exports and copies of imported files. You can pick a Dropbox/iCloud folder for automatic backup, or skip and set it per-experiment later.
2. **Set your name.** Just for the sidebar avatar — nothing is sent anywhere.
3. **Pick a color theme.** Dark or light. Toggle any time.
4. **(Optional) Install a local AI model.** If you want the AI Chart Builder, LabVAR detects [Ollama](https://ollama.com) at `localhost:11434`. If it's installed, choose a model (default `qwen2.5-coder:3b`, ~2 GB) and click *Install* — LabVAR runs `ollama pull` in the background and shows progress. If Ollama isn't installed, you get OS-specific setup instructions; you can also skip this step entirely.

Everything from the wizard is editable later under **Settings** (gear icon, bottom-left).

## Features

LabVAR is organized like a modern workspace app: the left sidebar leads with standalone **Tools** you can jump into without setup, and **Experiments** act as optional projects that group your work. Everything is editable and deletable.

### Experimental design
Plan an experiment end-to-end: objective, hypothesis, null and alternate hypotheses, constraints, groups, and a reagent shopping list. Draft a Materials & Methods section and export it to Word or Markdown.

### Plotting & Stats
Drag columns onto encoding shelves to build publication-ready figures from wide-format lab CSVs — Bar + Scatter with error bars, Box, Violin, Dose-Response, Before/After, Time Series. Rendered as Vega-Lite specs and saved as reproducible artifacts. Offline hypothesis tests — one-way ANOVA, Tukey HSD, Welch/Student t-tests, Pearson correlation — validated against SciPy. No Python install required for the built-in stats.

### AI Chart Builder (optional)
Describe the chart you want in plain English; LabVAR uses a local Ollama model (`qwen2.5-coder:3b` by default) to generate Python or R code, executes it, and shows you the resulting figure. Iterate by describing what to fix. All local — the app never sends your data off-device.

### Gel / GFP quantification
A quick alternative to ImageJ for densitometry. Load a gel/blot or fluorescence image, drag a box over one lane, and the rest are auto-tiled and quantified: background-subtracted integrated density, mean, normalized-to-reference, and % of total. Draggable ROIs, editable labels, per-lane manual override, and CSV/JSON export.

### Assay tracking
A lightweight, editable data log for assays (lifespan/survival, timecourses, or anything). Templated or blank tables with add/remove rows *and* columns (text/number/date) and one-click CSV/JSON export.

### Lab math
Dilution (C₁V₁), molarity (mass from MW/conc/vol), serial-dilution series, and a quick-notes scratchpad.

### Image analysis
16-bit-aware TIFF ingestion with contrast-stretched preview (never measure off the preview — measurements run against the full-depth original). Foundation for SAM-assisted worm/cell segmentation on the roadmap.

### Node view — 3D lab notebook
An Obsidian-style, full-screen 3D graph of your work. Experiments, assays, designs, and gel analyses appear as nodes automatically; add your own idea/note/file/PDF nodes and draw labeled links to describe how everything connects. Orbit, pan, zoom, and drag nodes in 3D; switch to Connect mode to drag a link between two nodes; **double-click any node to open its source**. Export the whole notebook as an Obsidian-compatible folder (one Markdown file per node with YAML frontmatter + `[[wikilinks]]`, plus `graph.json`).

### Provenance you can trust
Every experiment mutation flows through a tamper-evident, hash-chained append-only log so you always know exactly what happened to your data and when.

## Build from source

**Prerequisites**
- [Node.js](https://nodejs.org/) 18 or newer
- [Rust](https://rustup.rs/) 1.70 or newer
- The [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Windows:** Microsoft C++ Build Tools + WebView2 (usually preinstalled on Windows 11)
  - **Linux:** `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`

**Clone and run in dev mode**
```bash
git clone https://github.com/muzimran/LabVAR.git
cd LabVAR
npm install
npm run tauri dev
```

**Build a production installer for your OS**
```bash
npm run tauri build
```
Installer output ends up in `src-tauri/target/release/bundle/`:

| Platform | Format | Path |
| --- | --- | --- |
| macOS | `.dmg` | `bundle/dmg/*.dmg` |
| macOS | `.app` | `bundle/macos/LabVAR.app` |
| Windows | `.msi` | `bundle/msi/*.msi` |
| Windows | `.exe` (NSIS) | `bundle/nsis/*.exe` |
| Linux | `.deb` | `bundle/deb/*.deb` |
| Linux | `.AppImage` | `bundle/appimage/*.AppImage` |

### Cross-platform releases (GitHub Actions)

Pushing a tag matching `v*` (e.g. `v0.1.0`) triggers `.github/workflows/release.yml`, which builds installers on macOS (arm64 + x64), Windows (x64), and Linux (x64) and attaches them to a GitHub Release automatically.

```bash
git tag v0.1.0
git push origin v0.1.0
```

You'll find the release at `https://github.com/muzimran/LabVAR/releases/tag/v0.1.0`.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  React 19 + Vite + TypeScript + Tailwind         │
│  ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐┌─────┐│
│  │Design││Plots ││ Gel  ││Assays││LabMath││Notes││
│  └──┬───┘└──┬───┘└──┬───┘└──┬───┘└──┬────┘└──┬──┘│
│     └──────┴───────┴───────┴───────┴────────┘    │
│                  Zustand + userPrefs              │
│                  invoke() IPC                     │
├──────────────────────────────────────────────────┤
│  Tauri 2 (Rust)                                  │
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

**Non-negotiables**

- **Append-only event log** — every mutation flows through `append_event()`. There are no update or delete paths on the events table.
- **Hash chain** — `SHA-256(prev_hash || seq || timestamp || entity_type || entity_id || event_type || payload)` links every event to its predecessor.
- **Projection tables** — materialized views derived from the event log. They can be dropped and rebuilt at any time.
- **Verifiable** — `verify_chain()` walks the entire log and confirms integrity.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2 (Rust + system webview) |
| Frontend | React 19 · Vite 6 · TypeScript 5.8 |
| Styling | Tailwind CSS 4 |
| State | Zustand |
| Tables | TanStack Table 8 |
| Drag & drop | dnd-kit |
| Charts | Vega-Lite 6 + vega-embed |
| 3D graph | Custom canvas force-directed engine (zero dependencies) |
| Densitometry | Canvas 2D + luminance/green-channel math |
| TIFF | Rust `tiff` crate (16-bit / multi-page preserved) |
| Database | SQLite (rusqlite, bundled) — provenance log |
| New-tool storage | Reactive localStorage collections |
| Hashing | sha2 (Rust) |
| Stats engine | Offline TypeScript numerics (validated against SciPy) |
| AI (optional) | Local Ollama (never sends data off-device) |

## Project structure

```
src/                       # React frontend
  App.tsx                  # Root; gates first-run onboarding
  features/
    onboarding/            # First-run wizard
    settings/              # Preferences UI (bound to userPrefs)
    experiments/           # Home, experiment view, tabs
    plot/                  # Drag-and-drop plot builder + standalone PlotWorkspace
    stats/                 # Statistical testing UI
    design/                # Experimental design + Materials & Methods
    gel/                   # Gel / GFP densitometry
    assays/                # Assay tracking
    labmath/               # Dilution / molarity / serial-dilution calculators
    image/                 # Image analysis (TIFF ingestion)
    notebook/              # 3D node-graph lab notebook (Node view)
    aichart/               # AI Chart Builder (Ollama-powered)
  store/useAppStore.ts     # Zustand state
  lib/
    invoke.ts              # Tauri command wrappers
    userPrefs.ts           # Persistent user preferences
    ollamaSetup.ts         # Ollama detection + pull with progress
    ollamaClient.ts        # Ollama HTTP client + model registry
    localStore.ts          # Reactive localStorage collections
    exportFile.ts          # Save-file / project-folder helpers
    densitometry.ts        # Gel/GFP quantification math
    graph3d.ts             # 3D projection + force-directed layout
    labdata.ts, stats.ts, figurePresets.ts
  shell/                   # App shell (Sidebar, MainPanel)
  components/              # Shared UI primitives

src-tauri/                 # Rust backend
  src/
    lib.rs                 # Tauri commands (including pull_ollama_model)
    db.rs                  # Database, migrations, event folding
    provenance.rs          # Hash chain computation & verification
    imaging.rs             # TIFF decode + preview
    ai.rs, pubmed.rs
  tauri.conf.json          # App config, bundle targets, plugins
  capabilities/default.json # Permission model for the main window
```

## Privacy & data location

LabVAR does not phone home. It has no analytics, no crash reporting, no telemetry.

The app writes its provenance database and preferences to your OS's app-data directory:

- **macOS:** `~/Library/Application Support/com.labvar.app/`
- **Windows:** `%APPDATA%\com.labvar.app\`
- **Linux:** `~/.local/share/com.labvar.app/`

The optional AI Chart Builder runs entirely against a local [Ollama](https://ollama.com) server at `localhost:11434`. LabVAR never sends your data or code to a hosted LLM.

## Contributing

Issues and PRs welcome. Please:
1. Open an issue first for feature work so we can agree on scope.
2. Run `npx tsc --noEmit` and `npm run tauri dev` locally before opening a PR.
3. Update `MAP.md` in the same PR whenever the structure changes.

## Roadmap

- Code-signed installers for macOS (notarization) and Windows (Authenticode)
- SAM-assisted image segmentation in the Image workspace
- Peak-integration lane profiles in the Gel workspace
- Gene lookup + pathway enrichment in supplementary figures
- Optional sync backend (opt-in, encrypted) for teams

## License

[Apache 2.0](LICENSE)
