// ---------------------------------------------------------------------------
// ImageWorkspace.tsx — Image Analysis: worms → intensity → normalized → graph.
//
// Three ways to select a worm (worm picking is finicky, so there's always a
// fallback):
//   • Box  — drag a rectangle; intensity is background-subtracted inside it.
//   • Pen  — paint the worm by hand (brush); measure inside the drawn mask.
//   • SAM  — click a point AND/OR drag a box to focus SlimSAM on that region;
//            the model sees a contrast-boosted image so faint GFP segments better.
//
// Every measurement is tagged with a Group (condition), so measurements from
// several folders accumulate into ONE table you can normalize to a control and
// export as a single graph-ready CSV — or hit Graph to plot it immediately.
//
// CORRECTNESS: decode keeps raw 16-bit; the preview is contrast-stretched and
// view-only. Intensity is always measured on that honest 8-bit preview — the
// SAM contrast boost is fed to the model ONLY, never to the measurement.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { Workspace } from '@/components/Workspace';
import { Button } from '@/components/Button';
import { saveText } from '@/lib/exportFile';
import { listTiffs, decodeTiff, type TiffMeta, type DecodedTiff } from '@/lib/invoke';
import { useCollection, COLLECTIONS, type BaseRecord } from '@/lib/localStore';
import { loadSam, embedImage, segmentAt, enhanceContrast, type SamSession, type SamMask, type SamBox } from '@/lib/sam';
import { quantify } from '@/lib/densitometry';
import { wideCsv, normalizeToControl, graphFromCsv, type Measurement } from '@/lib/analysisExport';

interface ImageSession extends BaseRecord {
  name: string;
  dir: string;
  fileCount: number;
}

interface Measure {
  mean: number;
  integrated: number;
  area: number;
  score: number;
}

interface ResultRow extends Measure {
  file: string;
  folder: string;
  group: string;
  label: string;
}

type Metric = 'mean' | 'integrated';
type SelMode = 'box' | 'pen' | 'sam';
interface Box { x: number; y: number; w: number; h: number }

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export function ImageWorkspace() {
  const sessions = useCollection<ImageSession>(COLLECTIONS.imageAnalyses);

  const [dir, setDir] = useState<string | null>(null);
  const [files, setFiles] = useState<TiffMeta[]>([]);
  const [selected, setSelected] = useState<TiffMeta | null>(null);
  const [page, setPage] = useState(0);
  const [decoded, setDecoded] = useState<DecodedTiff | null>(null);
  const [win, setWin] = useState<{ low: number; high: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Analysis state
  const [group, setGroup] = useState('Control');
  const [mode, setMode] = useState<SelMode>('box');
  const [bgPct, setBgPct] = useState(25);
  const [brush, setBrush] = useState(12);
  const [metric, setMetric] = useState<Metric>('mean');
  const [controlGroup, setControlGroup] = useState('');
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [graphMsg, setGraphMsg] = useState<string | null>(null);

  // SAM state
  const [samState, setSamState] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [samPct, setSamPct] = useState(0);
  const [samError, setSamError] = useState<string | null>(null);
  const [segBusy, setSegBusy] = useState(false);
  const [mask, setMask] = useState<SamMask | null>(null);
  const [segInfo, setSegInfo] = useState<string | null>(null);
  const [samEnhance, setSamEnhance] = useState(true);
  const [samGamma, setSamGamma] = useState(0.7);

  // Box + Pen state
  const [box, setBox] = useState<Box | null>(null);
  const liveBox = useRef<Box | null>(null);
  const boxDraw = useRef<{ active: boolean; startX: number; startY: number }>({ active: false, startX: 0, startY: 0 });
  const penMaskRef = useRef<Uint8Array | null>(null);
  const penning = useRef(false);
  const [penVersion, setPenVersion] = useState(0);

  const decodeSeq = useRef(0);
  const sessionRef = useRef<SamSession | null>(null);
  const sessionSrc = useRef<string | null>(null);
  const enhancedRef = useRef<{ key: string; src: string } | null>(null);
  const previewGray = useRef<{ w: number; h: number; data: Uint8ClampedArray } | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const applyBox = (b: Box | null) => {
    liveBox.current = b;
    setBox(b);
  };
  const clearSelection = () => {
    setMask(null);
    setMeasure(null);
    applyBox(null);
    penMaskRef.current = null;
    setPenVersion((v) => v + 1);
  };

  // ---- directory selection -------------------------------------------------
  const pickDirectory = useCallback(async () => {
    setError(null);
    if (!inTauri()) {
      setError('Picking a folder needs the desktop app — the browser preview cannot read directories.');
      return;
    }
    try {
      const dialog = await import('@tauri-apps/plugin-dialog');
      const chosen = await dialog.open({ directory: true, multiple: false, title: 'Choose a folder of .TIFs' });
      if (typeof chosen !== 'string') return;
      setBusy(true);
      const list = await listTiffs(chosen);
      setDir(chosen);
      setFiles(list);
      setSelected(null);
      setDecoded(null);
      setWin(null);
      // rows are intentionally NOT cleared — switch folders to accumulate groups.
      sessions.create({ name: baseName(chosen), dir: chosen, fileCount: list.length });
    } catch (e) {
      setError(`Could not read directory: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [sessions]);

  // ---- decode --------------------------------------------------------------
  const decode = useCallback(
    async (file: TiffMeta, pg: number, window: { low: number; high: number } | null) => {
      const seq = ++decodeSeq.current;
      setBusy(true);
      setError(null);
      try {
        const d = await decodeTiff(file.path, { maxDim: 1024, page: pg, low: window?.low, high: window?.high });
        if (seq !== decodeSeq.current) return;
        setDecoded(d);
        if (!window) setWin({ low: d.applied_low, high: d.applied_high });
      } catch (e) {
        if (seq !== decodeSeq.current) return;
        setError(`Decode failed: ${e instanceof Error ? e.message : String(e)}`);
        setDecoded(null);
      } finally {
        if (seq === decodeSeq.current) setBusy(false);
      }
    },
    []
  );

  const selectFile = useCallback(
    (file: TiffMeta) => {
      setSelected(file);
      setPage(0);
      setWin(null);
      setZoom(1);
      decode(file, 0, null);
    },
    [decode]
  );

  useEffect(() => {
    if (!selected || !win) return;
    const t = setTimeout(() => decode(selected, page, win), 140);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win?.low, win?.high]);

  const changePage = useCallback(
    (pg: number) => {
      if (!selected) return;
      setPage(pg);
      setWin(null);
      decode(selected, pg, null);
    },
    [selected, decode]
  );

  // ---- when the preview changes, reset selection + cache its grayscale ------
  useEffect(() => {
    setMask(null);
    setMeasure(null);
    applyBox(null);
    penMaskRef.current = null;
    enhancedRef.current = null;
    setPenVersion((v) => v + 1);
    previewGray.current = null;
    if (!decoded) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = decoded.preview_w;
      c.height = decoded.preview_h;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      previewGray.current = { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
    };
    img.src = decoded.preview_png_base64;
  }, [decoded?.preview_png_base64]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- overlay: draw the SAM mask, else the pen mask -----------------------
  useEffect(() => {
    const c = overlayRef.current;
    if (!c || !decoded) return;
    c.width = decoded.preview_w;
    c.height = decoded.preview_h;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    const paint = (get: (i: number) => boolean) => {
      const id = ctx.createImageData(c.width, c.height);
      const n = c.width * c.height;
      for (let i = 0; i < n; i++) {
        if (get(i)) {
          id.data[i * 4] = 20;
          id.data[i * 4 + 1] = 184;
          id.data[i * 4 + 2] = 166;
          id.data[i * 4 + 3] = 120;
        }
      }
      ctx.putImageData(id, 0, 0);
    };
    if (mask) {
      const n = Math.min(mask.width * mask.height, c.width * c.height);
      paint((i) => i < n && !!mask.data[i]);
    } else if (penMaskRef.current) {
      const pm = penMaskRef.current;
      paint((i) => !!pm[i]);
    }
  }, [mask, decoded, penVersion]);

  // ---- SAM: load model -----------------------------------------------------
  const loadModel = useCallback(async () => {
    setSamState('loading');
    setSamError(null);
    setSamPct(0);
    try {
      await loadSam((p) => {
        if (typeof p.progress === 'number') setSamPct(Math.round(p.progress));
      });
      setSamState('ready');
    } catch (e) {
      setSamError(`Model load failed: ${e instanceof Error ? e.message : String(e)}`);
      setSamState('idle');
    }
  }, []);

  const measureMask = useCallback((m: SamMask): Measure | null => {
    const g = previewGray.current;
    if (!g) return null;
    let sum = 0;
    let count = 0;
    const n = Math.min(m.width * m.height, g.w * g.h);
    for (let i = 0; i < n; i++) {
      if (!m.data[i]) continue;
      sum += g.data[i * 4];
      count++;
    }
    return { mean: count ? sum / count : 0, integrated: sum, area: count, score: m.score };
  }, []);

  // ---- Box: background-subtracted intensity inside the rectangle -----------
  const measureBox = useCallback(
    (b: Box): Measure | null => {
      const g = previewGray.current;
      if (!g) return null;
      const x0 = Math.max(0, Math.round(b.x));
      const y0 = Math.max(0, Math.round(b.y));
      const bw = Math.max(1, Math.min(g.w - x0, Math.round(b.w)));
      const bh = Math.max(1, Math.min(g.h - y0, Math.round(b.h)));
      const sub = new Uint8ClampedArray(bw * bh * 4);
      for (let row = 0; row < bh; row++) {
        for (let col = 0; col < bw; col++) {
          const srcI = ((y0 + row) * g.w + (x0 + col)) * 4;
          const dstI = (row * bw + col) * 4;
          sub[dstI] = g.data[srcI];
          sub[dstI + 1] = g.data[srcI + 1];
          sub[dstI + 2] = g.data[srcI + 2];
          sub[dstI + 3] = 255;
        }
      }
      const q = quantify(new ImageData(sub, bw, bh), { invert: false, channel: 'luminance', backgroundPercentile: bgPct });
      return { mean: q.mean, integrated: q.integrated, area: q.area, score: 1 };
    },
    [bgPct]
  );

  // ---- Pen: measure inside the hand-drawn mask -----------------------------
  const measurePen = useCallback((): Measure | null => {
    const g = previewGray.current;
    const pm = penMaskRef.current;
    if (!g || !pm) return null;
    const vals: number[] = [];
    const n = Math.min(pm.length, g.w * g.h);
    for (let i = 0; i < n; i++) if (pm[i]) vals.push(g.data[i * 4]);
    if (!vals.length) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    const bg = sorted[Math.min(sorted.length - 1, Math.floor((bgPct / 100) * (sorted.length - 1)))] ?? 0;
    let integrated = 0;
    let sum = 0;
    for (const v of vals) {
      sum += v;
      const s = v - bg;
      if (s > 0) integrated += s;
    }
    return { mean: sum / vals.length, integrated, area: vals.length, score: 1 };
  }, [bgPct]);

  // Live re-measure box/pen when the background slider or the drawing changes.
  useEffect(() => {
    if (mode === 'box' && box) {
      const m = measureBox(box);
      if (m) setMeasure(m);
    } else if (mode === 'pen' && penMaskRef.current) {
      const m = measurePen();
      setMeasure(m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, penVersion, bgPct, mode]);

  // ---- SAM: run segmentation (point and/or box), on the enhanced image -----
  const enhancedSrc = useCallback(async (): Promise<string> => {
    if (!decoded) return '';
    const raw = decoded.preview_png_base64;
    if (!samEnhance) return raw;
    const key = `${raw.length}:${raw.slice(-32)}:${samGamma}`;
    if (enhancedRef.current?.key === key) return enhancedRef.current.src;
    const src = await enhanceContrast(raw, { gamma: samGamma });
    enhancedRef.current = { key, src };
    return src;
  }, [decoded, samEnhance, samGamma]);

  const runSam = useCallback(
    async (point: { x: number; y: number }, region?: SamBox) => {
      if (!decoded || segBusy) return;
      if (samState !== 'ready') {
        setSamError('Load the worm finder first — or use Box / Pen, which need no model.');
        return;
      }
      setSegBusy(true);
      setSamError(null);
      try {
        const src = await enhancedSrc();
        let s = sessionRef.current;
        if (!s || sessionSrc.current !== src) {
          s = await embedImage(src);
          sessionRef.current = s;
          sessionSrc.current = src;
        }
        const m = await segmentAt(s, point.x, point.y, region);
        let area = 0;
        for (let i = 0; i < m.data.length; i++) area += m.data[i];
        if (area === 0) {
          setMask(null);
          setMeasure(null);
          setSegInfo('SAM returned an empty mask — try a box around the worm, raise the contrast boost, or use Pen.');
          return;
        }
        applyBox(null);
        setMask(m);
        const meas = measureMask(m);
        setMeasure(meas);
        setSegInfo(meas ? `Mask ${m.width}×${m.height}, ${area} px · IoU ${m.score.toFixed(2)}` : null);
      } catch (err) {
        setSamError(`Segmentation failed: ${err instanceof Error ? err.message : String(err)}`);
        setSegInfo(null);
      } finally {
        setSegBusy(false);
      }
    },
    [decoded, segBusy, samState, enhancedSrc, measureMask]
  );

  // ---- pointer handling on the overlay ------------------------------------
  const toPreview = (e: React.PointerEvent) => {
    const c = overlayRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * (decoded?.preview_w ?? rect.width),
      y: ((e.clientY - rect.top) / rect.height) * (decoded?.preview_h ?? rect.height),
    };
  };

  const paintAt = (x: number, y: number) => {
    if (!decoded) return;
    if (!penMaskRef.current) penMaskRef.current = new Uint8Array(decoded.preview_w * decoded.preview_h);
    const pm = penMaskRef.current;
    const w = decoded.preview_w;
    const h = decoded.preview_h;
    const r = brush;
    const cx = Math.round(x);
    const cy = Math.round(y);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        pm[py * w + px] = 1;
      }
    }
    setPenVersion((v) => v + 1);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!decoded) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const { x, y } = toPreview(e);
    if (mode === 'pen') {
      penning.current = true;
      setMask(null);
      paintAt(x, y);
      return;
    }
    boxDraw.current = { active: true, startX: x, startY: y };
    setMask(null);
    applyBox({ x, y, w: 0, h: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!decoded) return;
    const { x, y } = toPreview(e);
    if (mode === 'pen') {
      if (penning.current) paintAt(x, y);
      return;
    }
    if (!boxDraw.current.active) return;
    applyBox({
      x: Math.min(x, boxDraw.current.startX),
      y: Math.min(y, boxDraw.current.startY),
      w: Math.abs(x - boxDraw.current.startX),
      h: Math.abs(y - boxDraw.current.startY),
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (mode === 'pen') {
      penning.current = false;
      setMeasure(measurePen());
      return;
    }
    boxDraw.current.active = false;
    const b = liveBox.current;
    const isBox = b && b.w >= 3 && b.h >= 3;
    if (mode === 'sam') {
      const { x, y } = toPreview(e);
      if (isBox && b) {
        runSam({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, [b.x, b.y, b.x + b.w, b.y + b.h]);
      } else {
        applyBox(null);
        runSam({ x, y });
      }
    } else if (!isBox) {
      applyBox(null);
    }
    // mode 'box' with a valid box: the live effect already measured it.
  };

  const clearPen = () => {
    if (decoded) penMaskRef.current = new Uint8Array(decoded.preview_w * decoded.preview_h);
    setPenVersion((v) => v + 1);
    setMeasure(null);
  };

  // ---- results -------------------------------------------------------------
  const addRow = useCallback(() => {
    if (!measure || !selected) return;
    const g = group.trim() || 'Group';
    setRows((r) => [
      ...r,
      { file: selected.name, folder: dir ? baseName(dir) : '', group: g, label: `${g} ${r.filter((x) => x.group === g).length + 1}`, ...measure },
    ]);
    clearSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, selected, group, dir]);

  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));

  const groupsInRows = Array.from(new Set(rows.map((r) => r.group)));
  const asMeasurements: Measurement[] = rows.map((r) => ({ group: r.group, value: metric === 'mean' ? r.mean : r.integrated }));
  const normalized = normalizeToControl(asMeasurements, controlGroup || null);
  const metricLabel = metric === 'mean' ? 'MeanIntensity' : 'IntegratedIntensity';

  const cleanCsv = (): string => {
    if (controlGroup) return wideCsv(normalized.map((r) => ({ group: r.group, value: r.normalized ?? NaN })));
    return wideCsv(asMeasurements);
  };

  const exportClean = useCallback(async () => {
    const tag = controlGroup ? `${metricLabel}_norm` : metricLabel;
    await saveText(cleanCsv(), `worm_${tag}.csv`, [{ name: 'CSV', extensions: ['csv'] }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, metric, controlGroup]);

  const exportFull = useCallback(async () => {
    const header = 'group,folder,file,label,mean_intensity,integrated_intensity,normalized,area_px,iou';
    const body = normalized
      .map((r, i) => {
        const row = rows[i];
        return [row.group, row.folder, row.file, row.label, row.mean.toFixed(2), row.integrated.toFixed(0), r.normalized != null ? r.normalized.toFixed(4) : '', row.area, row.score.toFixed(3)].join(',');
      })
      .join('\n');
    await saveText(header + '\n' + body, 'worm_intensity_full.csv', [{ name: 'CSV', extensions: ['csv'] }]);
  }, [rows, normalized]);

  const graphNow = useCallback(async () => {
    const csv = cleanCsv();
    try {
      await graphFromCsv(controlGroup ? 'Worm GFP (normalized)' : 'Worm GFP', csv);
    } catch {
      setGraphMsg('Graphing needs the desktop app. Exported a CSV instead — drop it into Plotting & Stats.');
      await saveText(csv, 'worm_for_graph.csv', [{ name: 'CSV', extensions: ['csv'] }]);
      setTimeout(() => setGraphMsg(null), 5000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, metric, controlGroup]);

  const pw = decoded ? decoded.preview_w * zoom : 0;
  const ph = decoded ? decoded.preview_h * zoom : 0;
  const cursor = mode === 'sam' && samState !== 'ready' ? '' : 'cursor-crosshair touch-none';

  return (
    <Workspace
      title="Image Analysis"
      subtitle="Worms → intensity → normalized → graph. Box, pen-draw, or SAM-click a worm — whatever the image needs."
      actions={
        <Button onClick={pickDirectory} disabled={busy}>
          {dir ? 'Add / change folder…' : 'Choose folder of .TIFs'}
        </Button>
      }
    >
      {error && <div className="mb-4 rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>}
      {graphMsg && <div className="mb-4 rounded-md border border-amber-700 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">{graphMsg}</div>}

      {!dir && !error && (
        <div className="text-sm text-zinc-400 max-w-2xl space-y-3">
          <p>
            Pick a folder of <code>.TIF</code>s for one group. Decoding + contrast run in Rust on the raw 16-bit
            pixels, so faint GFP can be brought up with the window sliders. Then grab a worm with <b>Box</b>, <b>Pen</b>,
            or <b>SAM</b>. Set the <b>Group</b> before measuring — switch folders to add more groups, then normalize and
            graph from one table.
          </p>
          {sessions.items.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Recent folders</p>
                <button
                  onClick={() => {
                    if (confirm('Clear all recent folders? This only removes the list, not your files.')) sessions.replaceAll([]);
                  }}
                  className="text-xs text-zinc-500 hover:text-red-400"
                >
                  Clear all
                </button>
              </div>
              <ul className="space-y-1">
                {sessions.items.slice(0, 6).map((s) => (
                  <li key={s.id} className="group flex items-center gap-2 text-zinc-300">
                    <span className="text-zinc-500">{s.fileCount} files ·</span> {s.name}
                    <button onClick={() => sessions.remove(s.id)} className="ml-auto text-xs text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100" title="Remove from list">
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {dir && (
        <div className="grid grid-cols-[220px_1fr] gap-5">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
              {files.length} TIFF{files.length === 1 ? '' : 's'} · {baseName(dir)}
            </div>
            <ul className="space-y-0.5 max-h-[74vh] overflow-y-auto pr-1">
              {files.map((f) => (
                <li key={f.path}>
                  <button
                    onClick={() => selectFile(f)}
                    className={`w-full text-left px-2 py-1 rounded text-sm truncate ${selected?.path === f.path ? 'bg-teal-500/20 text-teal-200' : 'text-zinc-300 hover:bg-zinc-800'}`}
                    title={f.error ? f.error : `${f.width}×${f.height} · ${f.bits_per_sample}-bit · ${f.pages} page(s)`}
                  >
                    {f.error ? '! ' : ''}
                    {f.name}
                  </button>
                </li>
              ))}
              {files.length === 0 && <li className="text-sm text-zinc-500 px-2 py-1">No .TIF/.TIFF files here.</li>}
            </ul>
          </div>

          <div className="min-w-0">
            {!selected && <p className="text-sm text-zinc-500">Select a file to preview it.</p>}

            {selected && decoded && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
                  <span className="text-zinc-200 font-medium">{selected.name}</span>
                  <span>{decoded.nat_w}×{decoded.nat_h}</span>
                  <span>{decoded.bits_per_sample}-bit · {decoded.samples} sample(s)</span>
                  <span>raw {decoded.raw_min.toFixed(0)}–{decoded.raw_max.toFixed(0)}</span>
                  {decoded.pages > 1 && (
                    <label className="flex items-center gap-1">
                      Page/channel:
                      <select value={page} onChange={(e) => changePage(Number(e.target.value))} className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-zinc-200">
                        {Array.from({ length: decoded.pages }, (_, i) => (
                          <option key={i} value={i}>{i}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>

                {/* group + mode + tool params */}
                <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                  <label className="flex items-center gap-1.5">
                    <span className="text-zinc-500">Group</span>
                    <input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="e.g. FUdR 50uM" className="w-36 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-teal-600" />
                  </label>
                  <div className="inline-flex rounded overflow-hidden border border-zinc-700">
                    {(['box', 'pen', 'sam'] as SelMode[]).map((m) => (
                      <button key={m} onClick={() => { setMode(m); clearSelection(); }} className={`px-2.5 py-1 ${mode === m ? 'bg-teal-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}>
                        {m === 'box' ? 'Box' : m === 'pen' ? 'Pen' : 'SAM'}
                      </button>
                    ))}
                  </div>
                  {(mode === 'box' || mode === 'pen') && (
                    <label className="flex items-center gap-1.5">
                      <span className="text-zinc-500">Background {bgPct}%</span>
                      <input type="range" min={0} max={80} value={bgPct} onChange={(e) => setBgPct(Number(e.target.value))} />
                    </label>
                  )}
                  {mode === 'pen' && (
                    <>
                      <label className="flex items-center gap-1.5">
                        <span className="text-zinc-500">Brush {brush}px</span>
                        <input type="range" min={2} max={40} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
                      </label>
                      <button onClick={clearPen} className="text-zinc-500 hover:text-zinc-300 underline">clear drawing</button>
                    </>
                  )}
                  {mode === 'sam' && (
                    <>
                      <label className="flex items-center gap-1.5" title="Feed SlimSAM a contrast-boosted image so faint worms segment better. Measurement is unaffected.">
                        <input type="checkbox" checked={samEnhance} onChange={(e) => { setSamEnhance(e.target.checked); enhancedRef.current = null; sessionSrc.current = null; }} />
                        <span className="text-zinc-500">Contrast boost</span>
                      </label>
                      {samEnhance && (
                        <label className="flex items-center gap-1.5" title="Lower = brighten faint signal more">
                          <span className="text-zinc-500">Gamma {samGamma.toFixed(2)}</span>
                          <input type="range" min={0.3} max={1.5} step={0.05} value={samGamma} onChange={(e) => { setSamGamma(Number(e.target.value)); enhancedRef.current = null; sessionSrc.current = null; }} />
                        </label>
                      )}
                    </>
                  )}
                  <div className="flex items-center gap-1">
                    <span className="text-zinc-500">Zoom</span>
                    <button onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))} className="px-1.5 rounded bg-zinc-800 hover:bg-zinc-700">−</button>
                    <span className="w-11 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                    <button onClick={() => setZoom((z) => Math.min(8, +(z + 0.25).toFixed(2)))} className="px-1.5 rounded bg-zinc-800 hover:bg-zinc-700">+</button>
                  </div>
                  {win && (
                    <>
                      <label className="flex items-center gap-1.5">
                        <span className="text-zinc-500">Black</span>
                        <input type="range" min={decoded.raw_min} max={decoded.raw_max} value={win.low} onChange={(e) => setWin((w) => (w ? { ...w, low: Math.min(Number(e.target.value), w.high - 1) } : w))} />
                      </label>
                      <label className="flex items-center gap-1.5">
                        <span className="text-zinc-500">White</span>
                        <input type="range" min={decoded.raw_min} max={decoded.raw_max} value={win.high} onChange={(e) => setWin((w) => (w ? { ...w, high: Math.max(Number(e.target.value), w.low + 1) } : w))} />
                      </label>
                      <button onClick={() => decode(selected, page, null)} className="text-zinc-500 hover:text-zinc-300 underline">auto contrast</button>
                    </>
                  )}
                </div>

                {/* image + overlay */}
                <div className="rounded border border-zinc-800 bg-black/40" style={{ maxWidth: '58vw', maxHeight: '68vh', overflow: 'auto' }}>
                  <div className="relative" style={{ width: pw, height: ph }}>
                    <img src={decoded.preview_png_base64} alt={selected.name} draggable={false} style={{ width: pw, height: ph, imageRendering: 'pixelated', display: 'block' }} />
                    <canvas
                      ref={overlayRef}
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      className={cursor}
                      style={{ position: 'absolute', inset: 0, width: pw, height: ph, imageRendering: 'pixelated' }}
                    />
                    {box && decoded && (
                      <div
                        className="absolute border-2 border-teal-400 bg-teal-400/10 pointer-events-none"
                        style={{ left: (box.x / decoded.preview_w) * pw, top: (box.y / decoded.preview_h) * ph, width: (box.w / decoded.preview_w) * pw, height: (box.h / decoded.preview_h) * ph }}
                      />
                    )}
                    {segBusy && <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-teal-200 text-sm">Segmenting…</div>}
                  </div>
                </div>

                {/* measure panel */}
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
                  {mode === 'box' && <div className="text-sm text-zinc-300"><span className="text-teal-300">Drag a box</span> around a worm — background is subtracted inside it. No model needed.</div>}
                  {mode === 'pen' && <div className="text-sm text-zinc-300"><span className="text-teal-300">Paint over the worm</span> to trace it by hand. Adjust brush size; "clear drawing" to redo.</div>}
                  {mode === 'sam' && (
                    <>
                      {samState === 'idle' && (
                        <div className="flex items-center gap-3">
                          <Button onClick={loadModel}>Load worm finder (SlimSAM)</Button>
                          <span className="text-xs text-zinc-500">Downloads the model once (~tens of MB), then caches it.</span>
                        </div>
                      )}
                      {samState === 'loading' && <div className="text-sm text-teal-200">Downloading model… {samPct}%</div>}
                      {samState === 'ready' && <div className="text-sm text-zinc-300"><span className="text-teal-300">Click a worm</span>, or <span className="text-teal-300">drag a box</span> around it to focus SAM on that region.</div>}
                      {samError && <div className="text-sm text-red-300">{samError}</div>}
                      {segInfo && !samError && <div className="text-xs text-zinc-400">{segInfo}</div>}
                    </>
                  )}

                  {measure && (
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-zinc-200 pt-1">
                      <span>mean <b>{measure.mean.toFixed(1)}</b></span>
                      <span>integrated <b>{measure.integrated.toFixed(0)}</b></span>
                      <span>area <b>{measure.area}</b> px</span>
                      <span className="text-teal-300">→ {group.trim() || 'Group'}</span>
                      <Button size="sm" onClick={addRow}>Add to results</Button>
                    </div>
                  )}
                  <p className="text-[11px] text-zinc-500">Intensity is measured on the contrast-stretched preview (tracks the display window) — good for relative comparison across worms measured under the same window.</p>
                </div>

                {/* results table + normalize + export */}
                {rows.length > 0 && (
                  <div className="rounded-lg border border-zinc-800">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800">
                      <span className="text-xs uppercase tracking-wide text-zinc-500">{rows.length} worm(s) · {groupsInRows.length} group(s)</span>
                      <div className="flex flex-wrap gap-2 items-center">
                        <label className="text-xs text-zinc-400 flex items-center gap-1">
                          Metric
                          <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-zinc-200">
                            <option value="mean">Mean</option>
                            <option value="integrated">Integrated</option>
                          </select>
                        </label>
                        <label className="text-xs text-zinc-400 flex items-center gap-1">
                          Normalize to
                          <select value={controlGroup} onChange={(e) => setControlGroup(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-zinc-200">
                            <option value="">— none —</option>
                            {groupsInRows.map((g) => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </label>
                        <Button size="sm" variant="secondary" onClick={() => setRows([])}>Clear</Button>
                        <button onClick={exportClean} className="text-xs text-teal-500 hover:text-teal-400" title="Graph-ready: one column per group">Clean CSV</button>
                        <button onClick={exportFull} className="text-xs text-zinc-400 hover:text-zinc-200" title="Every column incl. area, IoU, file">Full CSV</button>
                        <Button size="sm" onClick={graphNow}>Graph →</Button>
                      </div>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-zinc-500 text-xs">
                          <th className="text-left font-normal px-3 py-1">Group</th>
                          <th className="text-left font-normal px-3 py-1">Worm</th>
                          <th className="text-right font-normal px-3 py-1">Mean</th>
                          <th className="text-right font-normal px-3 py-1">Integrated</th>
                          <th className="text-right font-normal px-3 py-1">{controlGroup ? 'Norm.' : 'Area'}</th>
                          <th className="w-6" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className="border-t border-zinc-800/60 text-zinc-300">
                            <td className="px-3 py-1">{r.group}</td>
                            <td className="px-3 py-1 text-zinc-500 truncate max-w-[160px]" title={r.file}>{r.label}</td>
                            <td className="px-3 py-1 text-right">{r.mean.toFixed(1)}</td>
                            <td className="px-3 py-1 text-right">{r.integrated.toFixed(0)}</td>
                            <td className="px-3 py-1 text-right tabular-nums">{controlGroup ? (normalized[i]?.normalized != null ? normalized[i]!.normalized!.toFixed(3) : '—') : r.area}</td>
                            <td className="px-1 text-center">
                              <button onClick={() => removeRow(i)} className="text-zinc-600 hover:text-red-400 text-xs">×</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="px-3 py-2 text-[11px] text-zinc-500">
                      Clean CSV = one column per group ({metric} intensity{controlGroup ? `, normalized to ${controlGroup}` : ''}), replicates down the rows — drops straight into any graphing tool. Graph → opens it in Plotting &amp; Stats.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Workspace>
  );
}
