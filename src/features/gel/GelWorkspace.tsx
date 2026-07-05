import { useCallback, useEffect, useRef, useState } from 'react';
import { Workspace } from '@/components/Workspace';
import { Button } from '@/components/Button';
import { useAppStore } from '@/store/useAppStore';
import { quantify, normalizeLanes, type ChannelMode, type LaneResult } from '@/lib/densitometry';
import { saveText, getProjectDir, setProjectDir, chooseProjectDir, safeSegment } from '@/lib/exportFile';
import { useCollection, newId, COLLECTIONS, type BaseRecord } from '@/lib/localStore';
import { decodeTiff, copyFile } from '@/lib/invoke';
import { convertFileSrc } from '@tauri-apps/api/core';
import { wideCsv, graphFromCsv, type Measurement } from '@/lib/analysisExport';

// Standalone tools aren't tied to an experiment, so the gel workspace binds its
// own project folder under this fixed key. Opened images are copied into
// <folder>/images/ and analysis then runs off that copy.
const GEL_PROJECT_KEY = 'gel';

interface Lane {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  override?: number;
}

interface Settings {
  invert: boolean;
  channel: ChannelMode;
  backgroundPercentile: number;
  referenceId: string | null;
}

interface SavedGel extends BaseRecord {
  name: string;
  imageName: string;
  settings: Settings;
  lanes: Lane[];
  results: { label: string; integrated: number; mean: number; normalized: number | null; fraction: number }[];
}

const MAX_W = 780;

// TIFF decoding now goes through the Rust `decode_tiff` command (robust 16-bit /
// BigTIFF / compression), replacing the old in-browser UTIF path that clipped
// scientific TIFFs and crashed on first load. See IMAGE_ANALYSIS_PLAN.md.

export function GelWorkspace() {
  const saved = useCollection<SavedGel>(COLLECTIONS.gelAnalyses);
  const nodes = useCollection<BaseRecord & { kind: string; sourceRef?: string }>(COLLECTIONS.graphNodes);

  const [imgName, setImgName]   = useState('');
  const [nat, setNat]           = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale]       = useState(1);
  const [lanes, setLanes]       = useState<Lane[]>([]);
  const [settings, setSettings] = useState<Settings>({
    invert: true,
    channel: 'luminance',
    backgroundPercentile: 25,
    referenceId: null,
  });
  const [numLanes, setNumLanes]   = useState(8);
  const [pitchPct, setPitchPct]   = useState(100);
  const [laneMode, setLaneMode]   = useState<'tile' | 'manual'>('tile');
  const [graphMsg, setGraphMsg]   = useState<string | null>(null);
  const [results, setResults]     = useState<LaneResult[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [focusSavedId, setFocusSavedId] = useState<string | null>(null);
  const [saveMsg, setSaveMsg]     = useState<string | null>(null);
  const [projectDir, setProjectDirState] = useState<string | undefined>(() => getProjectDir(GEL_PROJECT_KEY));
  // View-only transforms for the selection canvas. These NEVER touch the sample
  // canvas that densitometry reads, so measured values are unaffected.
  const [zoom, setZoom]           = useState(1);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast]   = useState(100);

  const deepLink    = useAppStore((s) => s.deepLink);
  const setDeepLink = useAppStore((s) => s.setDeepLink);
  const setView     = useAppStore((s) => s.setView);

  useEffect(() => {
    if (deepLink?.view === 'gel') {
      setShowSaved(true);
      setFocusSavedId(deepLink.itemId);
      setDeepLink(null);
    }
  }, [deepLink, setDeepLink]);

  const displayCanvas = useRef<HTMLCanvasElement>(null);
  const sampleCanvas  = useRef<HTMLCanvasElement>(null);
  const fileRef       = useRef<HTMLInputElement>(null);

  const draw = useRef<{
    mode: 'new' | 'move' | null;
    startX: number;
    startY: number;
    laneId?: string;
    ox?: number;
    oy?: number;
  }>({ mode: null, startX: 0, startY: 0 });

  const [rubber, setRubber] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Check if this gel analysis is wired into the node graph
  const gelNodesExist = nodes.items.some((n) => n.kind === 'gel');

  // ---- image loading -------------------------------------------------------
  // The decoded image is held here and painted onto the canvases by an effect
  // AFTER the display canvas mounts (it only mounts once `nat` is set). This
  // fixes the first-load crash where `displayCanvas.current` was still null.
  const imgElRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = imgElRef.current;
    const dc = displayCanvas.current;
    const sc = sampleCanvas.current;
    if (!img || !nat || !dc || !sc) return;
    // Sample canvas at native (preview) resolution — densitometry reads this.
    sc.width = nat.w;
    sc.height = nat.h;
    sc.getContext('2d')!.drawImage(img, 0, 0, nat.w, nat.h);
    // Display canvas scaled down for the ROI overlay.
    dc.width = Math.round(nat.w * scale);
    dc.height = Math.round(nat.h * scale);
    dc.getContext('2d')!.drawImage(img, 0, 0, dc.width, dc.height);
  }, [nat, scale]);

  /** Load any image src (data URL or asset URL) into state, then the effect paints. */
  const loadFromSrc = (src: string, name: string) => {
    const img = new Image();
    img.onload = () => {
      imgElRef.current = img;
      setNat({ w: img.naturalWidth, h: img.naturalHeight });
      setScale(Math.min(1, MAX_W / img.naturalWidth));
      setZoom(1);
      setBrightness(100);
      setContrast(100);
      setLanes([]);
      setResults([]);
      setImgName(name);
    };
    img.onerror = () => alert('Could not load image: ' + name);
    img.src = src;
  };

  /** Open via the native picker. Required for TIFFs — Rust decodes them by path. */
  const openImage = async () => {
    try {
      const dialog = await import('@tauri-apps/plugin-dialog');
      const path = await dialog.open({
        multiple: false,
        filters: [{ name: 'Image', extensions: ['tif', 'tiff', 'png', 'jpg', 'jpeg', 'webp'] }],
      });
      if (typeof path !== 'string') return;
      const name = path.split(/[\\/]/).pop() || path;

      // If a project folder is bound, copy the picked image into <folder>/images/
      // and run analysis off that copy so the data lives with the project.
      let workPath = path;
      if (projectDir) {
        try {
          const dest = `${projectDir.replace(/[/\\]+$/, '')}/images/${safeSegment(name)}`;
          workPath = await copyFile(path, dest);
        } catch (err) {
          console.warn('Could not copy image into project folder, using original:', err);
        }
      }

      if (/\.tiff?$/i.test(workPath)) {
        // Robust 16-bit decode → contrast-stretched 8-bit preview (view + quant).
        const d = await decodeTiff(workPath, { maxDim: 2000 });
        loadFromSrc(d.preview_png_base64, name);
      } else {
        loadFromSrc(convertFileSrc(workPath), name);
      }
    } catch (err) {
      alert(
        'Could not open image: ' +
          String(err) +
          '\n\n(Opening files needs the desktop app.)'
      );
    }
  };

  /** Drag-and-drop: raster files decode in-browser; TIFFs must use the picker. */
  const loadDroppedFile = (file: File) => {
    if (/\.tiff?$/i.test(file.name)) {
      alert('For TIFF files, click the panel to browse — reading them needs the file picker.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => loadFromSrc(reader.result as string, file.name);
    reader.readAsDataURL(file);
  };

  // ---- quantify ------------------------------------------------------------
  const recompute = useCallback((ls: Lane[], st: Settings) => {
    const sc = sampleCanvas.current;
    if (!sc || ls.length === 0) { setResults([]); return; }
    const ctx = sc.getContext('2d')!;
    const quantLanes = ls.map((l) => {
      const x = Math.max(0, Math.round(l.x));
      const y = Math.max(0, Math.round(l.y));
      const w = Math.max(1, Math.min(sc.width - x, Math.round(l.w)));
      const h = Math.max(1, Math.min(sc.height - y, Math.round(l.h)));
      const data = ctx.getImageData(x, y, w, h);
      const q = quantify(data, { invert: st.invert, channel: st.channel, backgroundPercentile: st.backgroundPercentile });
      if (l.override != null && isFinite(l.override)) q.integrated = l.override;
      return { id: l.id, label: l.label, quant: q };
    });
    setResults(normalizeLanes(quantLanes, st.referenceId));
  }, []);

  useEffect(() => { recompute(lanes, settings); }, [lanes, settings, recompute]);

  // ---- lane generation -----------------------------------------------------
  const generateLanes = (template: { x: number; y: number; w: number; h: number }, count: number, pitchFactor: number) => {
    const pitch = template.w * (pitchFactor / 100);
    const out: Lane[] = [];
    for (let i = 0; i < count; i++) {
      out.push({ id: newId(), label: `Lane ${i + 1}`, x: template.x + i * pitch, y: template.y, w: template.w, h: template.h });
    }
    setLanes(out);
    setSettings((s) => ({ ...s, referenceId: out[0]?.id ?? null }));
  };

  // Manual mode: each drawn box adds exactly one lane (append), so you can place
  // lanes by hand when auto-tiling doesn't fit an uneven gel.
  const addSingleLane = (r: { x: number; y: number; w: number; h: number }) => {
    setLanes((ls) => {
      const next = [...ls, { id: newId(), label: `Lane ${ls.length + 1}`, x: r.x, y: r.y, w: r.w, h: r.h }];
      if (!settings.referenceId) setSettings((s) => ({ ...s, referenceId: next[0].id }));
      return next;
    });
  };

  // ---- pointer interactions ------------------------------------------------
  // Map a client point to natural (sample-canvas) coordinates. Normalising by
  // the ACTUAL rendered rect makes this invariant to zoom and display scale.
  const toNat = (clientX: number, clientY: number) => {
    const rect = displayCanvas.current!.getBoundingClientRect();
    const nw = nat?.w ?? rect.width;
    const nh = nat?.h ?? rect.height;
    return {
      x: ((clientX - rect.left) / rect.width) * nw,
      y: ((clientY - rect.top) / rect.height) * nh,
    };
  };

  const laneAt = (nx: number, ny: number): Lane | undefined =>
    [...lanes].reverse().find((l) => nx >= l.x && nx <= l.x + l.w && ny >= l.y && ny <= l.y + l.h);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!nat) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const { x, y } = toNat(e.clientX, e.clientY);
    const hit = laneAt(x, y);
    if (hit) {
      draw.current = { mode: 'move', startX: x, startY: y, laneId: hit.id, ox: x - hit.x, oy: y - hit.y };
    } else {
      draw.current = { mode: 'new', startX: x, startY: y };
      setRubber({ x, y, w: 0, h: 0 });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draw.current.mode || !nat) return;
    const { x, y } = toNat(e.clientX, e.clientY);
    if (draw.current.mode === 'new') {
      const rx = Math.min(x, draw.current.startX);
      const ry = Math.min(y, draw.current.startY);
      setRubber({ x: rx, y: ry, w: Math.abs(x - draw.current.startX), h: Math.abs(y - draw.current.startY) });
    } else if (draw.current.mode === 'move' && draw.current.laneId) {
      const id = draw.current.laneId;
      setLanes((ls) => ls.map((l) => l.id === id ? { ...l, x: x - (draw.current.ox ?? 0), y: y - (draw.current.oy ?? 0) } : l));
    }
  };

  const onPointerUp = () => {
    if (draw.current.mode === 'new' && rubber && rubber.w > 4 && rubber.h > 4) {
      if (laneMode === 'manual') addSingleLane(rubber);
      else generateLanes(rubber, numLanes, pitchPct);
    }
    draw.current.mode = null;
    setRubber(null);
  };

  // ---- results editing -----------------------------------------------------
  const renameLane  = (id: string, label: string) => setLanes((ls) => ls.map((l) => l.id === id ? { ...l, label } : l));
  const overrideLane = (id: string, val: string) =>
    setLanes((ls) => ls.map((l) => l.id === id ? { ...l, override: val === '' ? undefined : Number(val) } : l));
  const deleteLane  = (id: string) => setLanes((ls) => ls.filter((l) => l.id !== id));

  // ---- export / save -------------------------------------------------------
  const exportResults = async (fmt: 'csv' | 'json') => {
    const safe = (imgName || 'gel').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'gel';
    if (fmt === 'csv') {
      const header = 'Lane,IntegratedDensity,Mean,Background,Area,Normalized,Fraction';
      const body   = results.map((r) =>
        [r.label, r.integrated, r.mean, r.background, r.area, r.normalized ?? '', r.fraction].join(',')
      ).join('\n');
      await saveText(header + '\n' + body, `${safe}_densitometry.csv`, [{ name: 'CSV', extensions: ['csv'] }]);
    } else {
      await saveText(
        JSON.stringify({ image: imgName, settings, results }, null, 2),
        `${safe}_densitometry.json`,
        [{ name: 'JSON', extensions: ['json'] }]
      );
    }
  };

  // ---- graph-ready export / merge ------------------------------------------
  // Each lane = a sample. Value = normalized (target/reference) when a reference
  // lane is set, else raw integrated density. Wide CSV → one column per sample,
  // so several gels (or several saved analyses) stack as replicate rows.
  const hasNorm = settings.referenceId != null && results.some((r) => r.normalized != null);
  const gelMeasurements = (
    rs: { label: string; integrated: number; normalized: number | null }[]
  ): Measurement[] =>
    rs.map((r) => ({ group: r.label || 'Lane', value: hasNorm && r.normalized != null ? r.normalized : r.integrated }));

  const safeName = () => (imgName || 'gel').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'gel';

  const exportCleanCsv = async () => {
    const csv = wideCsv(gelMeasurements(results));
    await saveText(csv, `${safeName()}_${hasNorm ? 'normalized' : 'integrated'}.csv`, [{ name: 'CSV', extensions: ['csv'] }]);
  };

  const graphNow = async () => {
    const csv = wideCsv(gelMeasurements(results));
    try {
      await graphFromCsv(hasNorm ? 'Western (normalized)' : 'Western densitometry', csv);
    } catch {
      setGraphMsg('Graphing needs the desktop app. Exported a CSV instead — drop it into Plotting & Stats.');
      await saveText(csv, 'gel_for_graph.csv', [{ name: 'CSV', extensions: ['csv'] }]);
      setTimeout(() => setGraphMsg(null), 5000);
    }
  };

  // Merge every saved analysis into one table, matching samples by lane label.
  const mergedMeasurements = (): Measurement[] => {
    const out: Measurement[] = [];
    for (const s of saved.items)
      for (const r of s.results) out.push({ group: r.label || 'Lane', value: r.normalized != null ? r.normalized : r.integrated });
    return out;
  };
  const exportMergedCsv = async () => {
    await saveText(wideCsv(mergedMeasurements()), 'gels_merged.csv', [{ name: 'CSV', extensions: ['csv'] }]);
  };
  const graphMerged = async () => {
    const csv = wideCsv(mergedMeasurements());
    try {
      await graphFromCsv('Westerns merged', csv);
    } catch {
      setGraphMsg('Graphing needs the desktop app. Exported a merged CSV instead.');
      await saveText(csv, 'gels_merged.csv', [{ name: 'CSV', extensions: ['csv'] }]);
      setTimeout(() => setGraphMsg(null), 5000);
    }
  };

  const saveAnalysis = () => {
    const rec = saved.create({
      name: (imgName || 'Gel').replace(/\.[^.]+$/, ''),
      imageName: imgName,
      settings,
      lanes,
      results: results.map((r) => ({
        label: r.label,
        integrated: r.integrated,
        mean: r.mean,
        normalized: r.normalized,
        fraction: r.fraction,
      })),
    } as Omit<SavedGel, keyof BaseRecord>);
    setSaveMsg(`Saved as "${rec.name}" — visible in Saved analyses and Node view.`);
    setTimeout(() => setSaveMsg(null), 4000);
  };

  const displayW = nat ? nat.w * scale : 0;
  const displayH = nat ? nat.h * scale : 0;

  return (
    <Workspace
      title="Gel / Fluorescence Quantification"
      subtitle="Draw one lane, auto-tile the rest, get background-subtracted densitometry. Supports PNG, JPEG and TIF/TIFF."
      actions={
        <>
          <button
            onClick={async () => {
              try {
                const d = await chooseProjectDir(GEL_PROJECT_KEY);
                if (d) setProjectDirState(d);
              } catch (err) {
                alert(err instanceof Error ? err.message : String(err));
              }
            }}
            title={projectDir ? `Images copy into ${projectDir}/images` : 'Bind a project folder so images copy into it'}
            className="text-xs text-zinc-400 hover:text-teal-400 max-w-[28ch] truncate"
          >
            {projectDir ? `Folder: ${projectDir.split(/[/\\]/).pop()}` : 'Set project folder'}
          </button>
          {projectDir && (
            <button
              onClick={() => { setProjectDir(GEL_PROJECT_KEY, null); setProjectDirState(undefined); }}
              className="text-xs text-zinc-600 hover:text-red-400"
            >
              Clear
            </button>
          )}
          <Button variant="secondary" onClick={() => setShowSaved((v) => !v)}>
            Saved ({saved.items.length})
          </Button>
          <Button onClick={openImage}>{nat ? 'New image' : 'Load image'}</Button>
        </>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/tiff,.tif,.tiff"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadDroppedFile(f);
          e.target.value = '';
        }}
      />

      {/* offscreen sampling canvas */}
      <canvas ref={sampleCanvas} className="hidden" />

      {/* Node-graph nudge */}
      {!gelNodesExist && nat && (
        <div className="mb-4 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-1.5 flex items-center justify-between gap-2">
          <span>This analysis isn't wired into your Node view yet. Link it so it appears in your lab notebook.</span>
          <button
            onClick={() => setView('notebook')}
            className="text-teal-400 hover:text-teal-300 font-medium whitespace-nowrap"
          >
            Open Node view
          </button>
        </div>
      )}

      {/* Save confirmation */}
      {saveMsg && (
        <div className="mb-4 text-xs text-teal-400 bg-teal-500/10 border border-teal-500/20 rounded px-3 py-1.5">
          {saveMsg}
        </div>
      )}
      {graphMsg && (
        <div className="mb-4 text-xs text-amber-200 bg-amber-950/30 border border-amber-700 rounded px-3 py-1.5">
          {graphMsg}
        </div>
      )}

      {showSaved && (
        <div className="mb-5 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Saved analyses</h3>
            <div className="flex items-center gap-3">
              {saved.items.length > 1 && (
                <>
                  <button onClick={exportMergedCsv} className="text-xs text-teal-500 hover:text-teal-400" title="Combine all saved gels into one CSV, matched by lane label">
                    Merge → CSV
                  </button>
                  <button onClick={graphMerged} className="text-xs font-medium text-teal-400 hover:text-teal-300" title="Combine all saved gels and open in Plotting & Stats">
                    Merge → Graph
                  </button>
                </>
              )}
              {saved.items.length > 0 && (
                <button
                  onClick={() => {
                    if (confirm('Delete ALL saved gel analyses? This cannot be undone.')) saved.replaceAll([]);
                  }}
                  className="text-xs text-zinc-500 hover:text-red-400"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>
          {saved.items.length === 0 ? (
            <p className="text-xs text-zinc-500">Nothing saved yet. Quantify a gel and hit Save.</p>
          ) : (
            <div className="space-y-1">
              {saved.items.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center justify-between text-sm px-2 py-1.5 rounded transition-colors ${
                    focusSavedId === s.id ? 'bg-teal-500/15 ring-1 ring-teal-600/50' : 'hover:bg-zinc-800'
                  }`}
                >
                  <span className="text-zinc-300">
                    {s.name} <span className="text-zinc-600 text-xs">· {s.results.length} lanes · {new Date(s.created_ts).toLocaleDateString()}</span>
                  </span>
                  <div className="flex gap-3">
                    <button
                      onClick={() =>
                        saveText(
                          'Lane,IntegratedDensity,Mean,Normalized,Fraction\n' +
                            s.results.map((r) => [r.label, r.integrated, r.mean, r.normalized ?? '', r.fraction].join(',')).join('\n'),
                          `${s.name.replace(/[^\w.-]+/g, '_')}.csv`,
                          [{ name: 'CSV', extensions: ['csv'] }]
                        )
                      }
                      className="text-xs text-teal-500 hover:text-teal-400"
                    >
                      CSV
                    </button>
                    <button onClick={() => saved.remove(s.id)} className="text-xs text-zinc-600 hover:text-red-400">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!nat ? (
        <div
          onClick={openImage}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) loadDroppedFile(f);
          }}
          className="rounded-lg border-2 border-dashed border-zinc-700 hover:border-zinc-600 p-12 text-center cursor-pointer"
        >
          <p className="text-sm text-zinc-300 font-medium">Drop a gel or fluorescence image</p>
          <p className="text-xs text-zinc-500 mt-1">
            Supports <strong>PNG, JPEG, WebP, and TIF/TIFF</strong> (including multi-channel fluorescence images).
            <br />
            Then drag a box around <em>one</em> lane — the rest are placed and quantified automatically.
          </p>
        </div>
      ) : (
        <div className="flex gap-5 items-start">
          {/* image + ROIs */}
          <div className="flex-shrink-0">
            {/* View controls — DISPLAY ONLY, they never change measured values. */}
            <div className="flex items-center gap-4 mb-2 text-xs text-zinc-400 flex-wrap">
              <div className="flex items-center gap-1">
                <span className="text-zinc-500">Zoom</span>
                <button
                  onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))}
                  className="px-1.5 rounded bg-zinc-800 hover:bg-zinc-700"
                >
                  −
                </button>
                <span className="w-11 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => setZoom((z) => Math.min(8, +(z + 0.25).toFixed(2)))}
                  className="px-1.5 rounded bg-zinc-800 hover:bg-zinc-700"
                >
                  +
                </button>
              </div>
              <label className="flex items-center gap-1.5">
                <span className="text-zinc-500">Brightness</span>
                <input
                  type="range"
                  min={20}
                  max={300}
                  value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-zinc-500">Contrast</span>
                <input
                  type="range"
                  min={20}
                  max={400}
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                />
              </label>
              <button
                onClick={() => { setZoom(1); setBrightness(100); setContrast(100); }}
                className="text-zinc-500 hover:text-zinc-300 underline"
              >
                reset view
              </button>
            </div>
            <div
              className="rounded border border-zinc-800 bg-black/30"
              style={{ maxWidth: '58vw', maxHeight: '72vh', overflow: 'auto' }}
            >
              <div className="relative" style={{ width: displayW * zoom, height: displayH * zoom }}>
                <canvas
                  ref={displayCanvas}
                  className="block"
                  style={{
                    width: displayW * zoom,
                    height: displayH * zoom,
                    filter: `brightness(${brightness}%) contrast(${contrast}%)`,
                    imageRendering: 'pixelated',
                  }}
                />
                <svg
                  className="absolute inset-0 cursor-crosshair touch-none"
                  width={displayW * zoom}
                  height={displayH * zoom}
                  viewBox={`0 0 ${displayW || 1} ${displayH || 1}`}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                >
                {lanes.map((l, i) => {
                  const isRef = settings.referenceId === l.id;
                  return (
                    <g key={l.id}>
                      <rect
                        x={l.x * scale} y={l.y * scale} width={l.w * scale} height={l.h * scale}
                        fill={isRef ? 'rgba(20,184,166,0.15)' : 'rgba(20,184,166,0.06)'}
                        stroke={isRef ? '#14b8a6' : '#2dd4bf'}
                        strokeWidth={isRef ? 2 : 1}
                        className="cursor-move"
                      />
                      <text x={l.x * scale + 2} y={l.y * scale - 3} fill="#2dd4bf" fontSize={11} fontFamily="monospace">
                        {i + 1}
                      </text>
                    </g>
                  );
                })}
                {rubber && (
                  <rect
                    x={rubber.x * scale} y={rubber.y * scale} width={rubber.w * scale} height={rubber.h * scale}
                    fill="rgba(20,184,166,0.1)" stroke="#14b8a6" strokeDasharray="4 3" strokeWidth={1.5}
                  />
                )}
              </svg>
              </div>
            </div>
            <p className="text-[11px] text-zinc-500 mt-2">
              Drag a box over one lane to (re)tile. Drag any box to nudge it. Zoom / brightness /
              contrast are view-only — they don't change measured values. {imgName}
            </p>
          </div>

          {/* controls + results */}
          <div className="flex-1 min-w-0 space-y-4">
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <span className="text-zinc-500 uppercase tracking-wide text-[10px]">Lane placement</span>
              <div className="inline-flex rounded overflow-hidden border border-zinc-700">
                <button
                  onClick={() => setLaneMode('tile')}
                  className={`px-2.5 py-1 ${laneMode === 'tile' ? 'bg-teal-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
                >
                  Auto-tile
                </button>
                <button
                  onClick={() => setLaneMode('manual')}
                  className={`px-2.5 py-1 ${laneMode === 'manual' ? 'bg-teal-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
                >
                  Draw each lane
                </button>
              </div>
              <span className="text-zinc-600">
                {laneMode === 'tile' ? 'Drag one lane → the rest are placed for you' : 'Each box you drag adds one lane — place uneven lanes by hand'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Ctl label="Lanes">
                <input type="number" min={1} max={40} value={numLanes}
                  onChange={(e) => setNumLanes(Math.max(1, Number(e.target.value) || 1))}
                  className={ctlInput} />
              </Ctl>
              <Ctl label="Lane pitch (% of width)">
                <input type="number" min={20} max={400} value={pitchPct}
                  onChange={(e) => setPitchPct(Number(e.target.value) || 100)}
                  className={ctlInput} />
              </Ctl>
              <Ctl label="Signal">
                <select value={settings.invert ? 'dark' : 'bright'}
                  onChange={(e) => setSettings((s) => ({ ...s, invert: e.target.value === 'dark' }))}
                  className={ctlInput}>
                  <option value="dark">Dark bands (gel/blot)</option>
                  <option value="bright">Bright signal (GFP/fluor)</option>
                </select>
              </Ctl>
              <Ctl label="Channel">
                <select value={settings.channel}
                  onChange={(e) => setSettings((s) => ({ ...s, channel: e.target.value as ChannelMode }))}
                  className={ctlInput}>
                  <option value="luminance">Luminance</option>
                  <option value="green">Green (GFP)</option>
                  <option value="red">Red</option>
                  <option value="blue">Blue</option>
                </select>
              </Ctl>
              <Ctl label={`Background percentile (${settings.backgroundPercentile}%)`}>
                <input type="range" min={0} max={80} value={settings.backgroundPercentile}
                  onChange={(e) => setSettings((s) => ({ ...s, backgroundPercentile: Number(e.target.value) }))}
                  className="w-full" />
              </Ctl>
              <Ctl label="Normalize to">
                <select value={settings.referenceId ?? ''}
                  onChange={(e) => setSettings((s) => ({ ...s, referenceId: e.target.value || null }))}
                  className={ctlInput}>
                  <option value="">— none —</option>
                  {lanes.map((l, i) => (
                    <option key={l.id} value={l.id}>{l.label || `Lane ${i + 1}`}</option>
                  ))}
                </select>
              </Ctl>
            </div>

            {lanes.length > 1 && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => generateLanes(lanes[0], numLanes, pitchPct)} variant="secondary">
                  Re-tile from lane 1
                </Button>
              </div>
            )}

            {results.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Results</h3>
                  <div className="flex gap-2 items-center">
                    <button onClick={exportCleanCsv} className="text-xs text-teal-500 hover:text-teal-400" title="Graph-ready: one column per sample (normalized when a reference lane is set)">
                      Clean CSV
                    </button>
                    <button onClick={() => exportResults('csv')} className="text-xs text-zinc-400 hover:text-zinc-200" title="Every column incl. background, area, fraction">
                      Full CSV
                    </button>
                    <button onClick={() => exportResults('json')} className="text-xs text-zinc-400 hover:text-zinc-200">
                      JSON
                    </button>
                    <button
                      onClick={saveAnalysis}
                      className="text-xs font-medium border border-zinc-700 hover:border-teal-600 text-zinc-200 rounded px-2.5 py-1 transition-colors"
                    >
                      Save analysis
                    </button>
                    <button
                      onClick={graphNow}
                      className="text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white rounded px-2.5 py-1 transition-colors"
                    >
                      Graph →
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-zinc-800">
                  <table className="text-sm w-full">
                    <thead className="bg-zinc-900 text-[10px] text-zinc-500 uppercase">
                      <tr>
                        <th className="text-left px-2 py-1.5">Lane</th>
                        <th className="text-right px-2 py-1.5">Integrated</th>
                        <th className="text-right px-2 py-1.5">Mean</th>
                        <th className="text-right px-2 py-1.5">Norm.</th>
                        <th className="text-right px-2 py-1.5">%</th>
                        <th className="text-right px-2 py-1.5">Edit</th>
                        <th className="w-6" />
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r) => (
                        <tr key={r.id} className="border-t border-zinc-800">
                          <td className="p-0">
                            <input value={r.label} onChange={(e) => renameLane(r.id, e.target.value)}
                              className="w-28 px-2 py-1.5 bg-transparent text-zinc-200 focus:bg-zinc-800 focus:outline-none" />
                          </td>
                          <td className="text-right px-2 tabular-nums text-zinc-300">{Math.round(r.integrated).toLocaleString()}</td>
                          <td className="text-right px-2 tabular-nums text-zinc-400">{r.mean.toFixed(1)}</td>
                          <td className="text-right px-2 tabular-nums text-teal-400">{r.normalized == null ? '—' : r.normalized.toFixed(3)}</td>
                          <td className="text-right px-2 tabular-nums text-zinc-400">{(r.fraction * 100).toFixed(1)}</td>
                          <td className="p-0">
                            <input placeholder="override" defaultValue=""
                              onBlur={(e) => overrideLane(r.id, e.target.value)}
                              className="w-20 px-2 py-1.5 bg-transparent text-amber-300 placeholder-zinc-700 focus:bg-zinc-800 focus:outline-none text-right" />
                          </td>
                          <td className="text-center">
                            <button onClick={() => deleteLane(r.id)} className="text-zinc-600 hover:text-red-400 text-xs">×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Integrated density = Σ(background-subtracted intensity). Background is the {settings.backgroundPercentile}th-percentile
                  intensity per lane. Type a value in "override" if the auto number for a lane is wrong.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </Workspace>
  );
}

const ctlInput =
  'w-full px-2 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:border-teal-600';

function Ctl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] text-zinc-500 uppercase tracking-wide block mb-0.5">{label}</span>
      {children}
    </label>
  );
}