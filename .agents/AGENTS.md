# LabVAR

Local-first, free, open-source desktop app for researchers to design experiments, analyze data, and run a lab.

## Quick start
```
npm install
npm run tauri dev
```

## Architecture
- **Tauri 2** (Rust backend + React frontend)
- **Append-only provenance**: every mutation goes through `append_event()` in Rust. No update/delete paths.
- **Hash chain**: SHA-256(prev_hash || seq || ts || entity_type || entity_id || event_type || payload)
- **Projection tables**: derived from the event log, disposable and rebuildable

## Key rules
1. Never add update/delete Tauri commands
2. All writes go through `db.append_event()`
3. AI is behind the `AiProvider` trait — optional, Ollama only
4. Stats use Pyodide + scipy (lazy-loaded)
5. Plots use Vega-Lite specs (the spec is the artifact)

## Stack
React + Vite + TypeScript + Tailwind · Zustand · TanStack Table · dnd-kit · react-vega · rusqlite · sha2
