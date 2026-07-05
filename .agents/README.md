# `.agents/` — dev + agent context

These files are working notes for humans and AI coding assistants (Claude Code,
Cursor, etc.). They are **not** user-facing documentation.

- **`MAP.md`** — living codebase map. Read this first when opening the repo; keep
  it in sync with structural changes.
- **`CLAUDE.md`** — architecture rules and non-negotiables the AI must respect
  (append-only event log, hash chain, no update/delete Tauri commands, etc.).
- **`AGENTS.md`** — same content, mirrored for tools that look at `AGENTS.md` at
  the repo root.
- **`IMAGE_ANALYSIS_PLAN.md`** — staged plan for the TIFF/SAM image-analysis
  feature.
- **`UX_ADOPTION_MAP.md`** — UX/adoption planning notes for launch.

For user-facing docs see [`../README.md`](../README.md).
