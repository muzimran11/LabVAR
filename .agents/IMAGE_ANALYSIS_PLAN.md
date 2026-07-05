# LabVAR — Image Analysis Workflow (design + build plan)

> Status: design agreed 2026-07-02. Supersedes the buggy UTIF-in-browser path in
> `GelWorkspace.loadTiff`. Build is staged so the Rust backend can be compiled on a
> Rust-capable Mac (`npm run tauri dev` / `npm run deploy`); the frontend is verifiable
> anywhere via `npx tsc --noEmit` + a `/tmp` Vite build.

## Goal

A researcher points the app at a **directory of `.TIF`s** for one group. They segment and
measure **one** example (one worm's fluorescent structure), which calibrates a **recipe**.
The app then applies that recipe automatically across the rest of the directory, drops each
sample's measurement into a table, and saves a CSV — which is exported into the right
project/experiment folder and added as a **node in the notebook graph**.

## The one reframing that shapes everything

MobileSAM is a **promptable segmenter**, not a model that trains from your example. You give
it a point/box; it returns a mask instantly. It does **not** learn from one worm and then
generalize on its own — there is no in-browser fine-tuning loop.

So "teach it from 1–2 images" = **calibrate a recipe**, not train a network:

- **channel** to segment on + **intensity threshold** learned from the example mask
- **size range** (area in px) and **shape** (elongation/solidity) of a valid worm
- **what to measure** — **v1: intensity only** (mean + integrated GFP intensity inside the
  worm ROI, background-subtracted + normalized). No area-as-endpoint, no skeleton length.
- **normalization** (per-image background, reference sample/control)
- **prompt strategy** for the batch (a grid of point prompts → "everything" masks)

### Raw vs. display — a correctness rule (GFP can be near-invisible)

Real worm GFP is often so faint it only shows after heavy contrast/brightness fiddling.
Therefore:

- **Decode keeps the raw 16-bit data as f32** and **all measurement runs on the raw pixels.**
- A **separate display transform** (auto percentile contrast-stretch + brightness/contrast/
  gamma sliders, ImageJ-style window/level) is applied only to the 8-bit preview — for the
  human to see faint signal, and as the input SAM segments on. Adjusting display **never**
  changes a measured number.
- Because GFP may be invisible, the preferred pipeline is **segment the worm outline on the
  channel you *can* see (brightfield, or a contrast-stretched view), then measure raw GFP
  intensity inside that outline.** Whether a separate brightfield channel exists depends on
  the TIFF's page/channel structure (see open items) — `decode_tiff` reports page count so we
  discover it from the real files.

The SAM weights stay frozen. The recipe is the learned artifact; each manual correction on a
finicky image updates the recipe. This is honest about SAM and fully buildable.

**Batch strategy (chosen): SAM auto-mask + recipe filter.** For each new TIFF, prompt SAM with
a grid of points → many candidate masks → keep only those matching the recipe's size/intensity/
shape. Closest to "does it automatically." A classical-CV fallback (threshold + watershed
calibrated from the same example) is kept in reserve for images where SAM under-segments, and
runs far faster — worth wiring as a toggle.

## Decisions locked

| Decision | Choice | Why |
|---|---|---|
| Decode + inference location | **Rust backend** | `tiff` crate handles 16-bit/BigTIFF/compression robustly; native `ort` + CoreML is far faster than onnxruntime-web WASM, and dodges the uncertain WebGPU-in-WKWebView story. Compiles on the owner's Mac. |
| First measurement target | **Worm structures** | No existing feature (bands are already ~solved by `densitometry.ts` + Gel). Area / mean / integrated intensity, optional skeleton length. |
| Batch automation | **SAM auto-mask + recipe filter** | Automatic per-image; corrections refine the recipe. Classical-CV propagation kept as a fast fallback toggle. |

## Why not the old path

`GelWorkspace.loadTiff` uses `UTIF.decode → decodeImage → toRGBA8`. UTIF is fine for simple
8-bit RGB TIFFs but is the source of the bugs on scientific images: 16-bit samples get clipped/
mis-scaled, BigTIFF and several LZW/PackBits variants aren't handled, and multi-page/multi-
channel stacks collapse wrong. Decoding in Rust with the `tiff` crate fixes this at the root and
means big files never travel through the webview as an ArrayBuffer.

## Architecture

```
Directory of .TIFs (on disk)
        │  Rust reads directly (tauri-plugin-fs scope)
        ▼
[Rust] image.rs
  list_tiffs(dir)                      → [ {path, name, w, h, bitDepth, pages} ]
  decode_tiff(path, maxDim, page)      → { preview(RGBA/PNG, downsampled to maxDim),
                                           f32 stats (min/max/mean), scale, natW, natH }
  sam_embed(path|preview)              → image embedding  (Stage 2, ORT+CoreML)
  sam_decode(embedding, prompts)       → mask             (Stage 2)
        │
        ▼
[Frontend] features/image/ImageWorkspace.tsx
  • pick directory (native dir picker, like project-folder export)
  • gallery of previews
  • CALIBRATE: open one image, click a worm → SAM mask → confirm measurement + normalization
    → recipe saved
  • BATCH: run recipe over the rest (SAM auto-mask → recipe filter → measure), with a
    per-sample results table, QC flags, and click-to-correct
  • EXPORT: measurements.csv into <projectDir>/<group>/ ; add nodes to the notebook graph
        │
        ▼
lib/imageRecipe.ts  (pure TS, reuses densitometry.ts + a small maskStats/skeleton helper)
localStore COLLECTIONS.imageAnalyses  (recipe + results + refs; NOT pixels)
graphNodes: kind:'image' directory node + results node, deep-link back into the workspace
```

Nothing pixel-heavy is persisted to localStorage — only the directory path, recipe params,
per-sample numbers, and (optionally) small preview thumbnails. Matches the existing
`gelAnalyses` "metadata + results only" convention.

## Build stages

**Stage 1 — Robust TIFF ingestion (foundation).**
`src-tauri/src/image.rs`: `list_tiffs`, `decode_tiff` via the `tiff` crate (preserve 16-bit,
downsample, scale u16→f32→u8 preview, return metadata). Register in `lib.rs`, add `invoke.ts`
wrappers. *Rust compiles on the Mac; frontend scaffold verifiable here.*
**Gel migration deferred:** `decode_tiff` returns only a downsampled *preview*; `GelWorkspace`
measures on full-res pixels, so it stays on UTIF until Stage 3 adds a full-res `measure_tiff`
raw-pixel command — then both Gel and worms migrate together. (No fs-capability change needed:
Rust reads the files directly via `std::fs`, outside the plugin-fs scope.)

**Stage 2 — MobileSAM native inference.**
`ort` crate + CoreML EP. Ship MobileSAM encoder+decoder ONNX (bundle in `src-tauri` resources or
download-on-first-use with a cached checksum). `sam_embed` (once per image) + `sam_decode` (per
prompt). Interactive canvas: click a worm → mask overlay in <1s.

**Stage 3 — Recipe calibration + batch runner.**
`lib/imageRecipe.ts`: derive channel/threshold/size/shape/measure/normalize from the example
mask. Batch: SAM auto-mask (point grid) → candidate masks → recipe filter → measure each →
results table with QC flags + manual correction. Classical-CV fallback toggle.

**Stage 4 — CSV export + notebook integration.**
Write `measurements.csv` into the experiment/project folder (`exportFile.saveIntoDir`). Create a
directory node + results node in `graphNodes` (`kind:'image'`, `sourceRef`) with a deep-link
back into `ImageWorkspace`. Update MAP.md.

## Verification per stage

- Frontend: `npx tsc --noEmit` + `npx vite build --outDir /tmp/labvar-build --emptyOutDir`.
- Rust (owner's Mac only): `cargo build` in `src-tauri/`, then `npm run tauri dev`.
- Numerics: unit-check `imageRecipe`/`maskStats` against known synthetic masks; spot-check
  measured intensities against ImageJ on one real image.
- End-to-end: run a real worm directory, confirm the table + CSV + node.

## Open items to confirm during the build

- **Model hosting:** owner has no ONNX files → **download MobileSAM on first use** and cache with
  a checksum (encoder + decoder). Decide cache location under `app_data_dir`.
- ~~Length metric~~ — **resolved: intensity + normalization only for v1.**
- **Multi-channel TIFFs:** does one `.TIF` hold multiple pages/channels (e.g. brightfield +
  fluorescence), or a single faint-GFP grayscale image? Drives whether we segment on brightfield
  and measure GFP, or segment on a contrast-stretched GFP. `decode_tiff` page count answers this
  from the real files.
