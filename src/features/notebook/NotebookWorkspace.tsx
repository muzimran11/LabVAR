import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { useAppStore, type Experiment } from '@/store/useAppStore';
import { useCollection, COLLECTIONS, scopedGraphKeys, store, type BaseRecord } from '@/lib/localStore';
import {
  project,
  screenBasis,
  forceStep,
  DEFAULT_FORCES,
  type Camera,
  type Particle,
  type Projected,
} from '@/lib/graph3d';


// ---- records ---------------------------------------------------------------

type NodeKind =
  | 'experiment'
  | 'dataset'
  | 'figure'
  | 'assay'
  | 'design'
  | 'gel'
  | 'image'
  | 'note'
  | 'idea'
  | 'file'
  | 'pdf';

interface GNode extends BaseRecord {
  label: string;
  kind: NodeKind;
  body: string;
  sourceRef?: string;
  seedX?: number;
  seedY?: number;
  seedZ?: number;
}

interface GEdge extends BaseRecord {
  from: string;
  to: string;
  label: string;
}

const KIND_COLOR: Record<NodeKind, string> = {
  experiment: '#14b8a6',
  dataset: '#3b82f6',
  figure: '#a855f7',
  assay: '#f97316',
  design: '#22c55e',
  gel: '#ec4899',
  image: '#06b6d4',
  note: '#eab308',
  idea: '#f59e0b',
  file: '#94a3b8',
  pdf: '#ef4444',
};

const KIND_LABEL: Record<NodeKind, string> = {
  experiment: 'Experiment',
  dataset: 'Dataset',
  figure: 'Figure',
  assay: 'Assay',
  design: 'Design',
  gel: 'Gel analysis',
  image: 'Image analysis',
  note: 'Note',
  idea: 'Idea',
  file: 'File',
  pdf: 'PDF',
};

const POS_KEY = 'labvar.graph.positions';
const DISMISS_KEY = 'labvar.graph.dismissed';
const PROJECT_KEY = 'labvar.graph.project';

type Mode = 'move' | 'connect';

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ---------------------------------------------------------------------------

export function NotebookWorkspace() {
  const experiments = useAppStore((s) => s.experiments);
  const activeExperimentId = useAppStore((s) => s.activeExperimentId);
  const setView = useAppStore((s) => s.setView);
  const setActiveExperiment = useAppStore((s) => s.setActiveExperiment);
  const setExperimentTab = useAppStore((s) => s.setExperimentTab);
  const setDeepLink = useAppStore((s) => s.setDeepLink);
  const setModalOpen = useAppStore((s) => s.setModalOpen);
  const loadExperiments = useAppStore((s) => s.loadExperiments);

  // Show the project-picker landing screen when no cluster has been opened yet.
  const [picking, setPicking] = useState(() => {
    try {
      return !localStorage.getItem(PROJECT_KEY);
    } catch {
      return true;
    }
  });

  // Which project's node cluster is showing. null = shared "Scratch / all" board.
  // Each experiment directory has its own cluster (graphNodes:<id> / graphEdges:<id>).
  const [projectId, setProjectIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PROJECT_KEY) || null;
    } catch {
      return null;
    }
  });
  // Arriving from an open experiment? Show that experiment's cluster once.
  const initedProject = useRef(false);
  useEffect(() => {
    if (!initedProject.current) {
      initedProject.current = true;
      if (activeExperimentId) {
        setProjectIdState(activeExperimentId);
        try { localStorage.setItem(PROJECT_KEY, activeExperimentId); } catch { /* ignore */ }
      }
    }
  }, [activeExperimentId]);
  // Keep experiments loaded so the project switcher is populated.
  useEffect(() => {
    loadExperiments();
  }, [loadExperiments]);

  const graphKeys = scopedGraphKeys(projectId);
  const nodesCol = useCollection<GNode>(graphKeys.nodes);
  const edgesCol = useCollection<GEdge>(graphKeys.edges);
  const { items: nodes } = nodesCol;
  const { items: edges } = edgesCol;

  const assaysCol = useCollection<BaseRecord & { name: string }>(COLLECTIONS.assays);
  const designsCol = useCollection<BaseRecord & { title: string }>(COLLECTIONS.designDocs);
  const gelsCol = useCollection<BaseRecord & { name: string }>(COLLECTIONS.gelAnalyses);
  const imagesCol = useCollection<BaseRecord & { name: string }>(COLLECTIONS.imageAnalyses);
  const assays = assaysCol.items;
  const designs = designsCol.items;
  const gels = gelsCol.items;
  const images = imagesCol.items;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Switch the visible project cluster and persist the choice.
  const setProject = (p: string | null) => {
    setProjectIdState(p);
    try {
      if (p) localStorage.setItem(PROJECT_KEY, p);
      else localStorage.removeItem(PROJECT_KEY);
    } catch {
      /* ignore */
    }
    setSelectedId(null);
    setSelectedEdgeId(null);
    setPicking(false);
    if (p) setActiveExperiment(p);
  };

  const [mode, setMode] = useState<Mode>('move');
  const [running, setRunning] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [importTick, setImportTick] = useState(0); // bump to re-run auto-import (e.g. after restoring hidden)
  const [hiddenCount, setHiddenCount] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const parts = useRef<Map<string, Particle>>(new Map());
  const projected = useRef<Map<string, Projected>>(new Map());
  const cam = useRef<Camera>({ yaw: 0.6, pitch: -0.35, zoom: 1, panX: 0, panY: 0, cx: 0, cy: 0, focal: 720 });
  const runningRef = useRef(running);
  runningRef.current = running;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // live interaction refs (read by the draw loop without re-subscribing)
  const cursor = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const tempFrom = useRef<string | null>(null);
  const hoverId = useRef<string | null>(null);

  // For an experiment project, fetch its datasets + figures from the backend
  // once per project (not every render), so we can reconstruct the cluster.
  const [projData, setProjData] = useState<{ datasets: any[]; figures: any[] }>({ datasets: [], figures: [] });
  useEffect(() => {
    if (!projectId) {
      setProjData({ datasets: [], figures: [] });
      return;
    }
    let cancelled = false;
    (async () => {
      const { listDatasets, listFigures } = await import('@/lib/invoke');
      const [datasets, figures] = await Promise.all([
        listDatasets(projectId).catch(() => [] as any[]),
        listFigures(projectId).catch(() => [] as any[]),
      ]);
      if (!cancelled) setProjData({ datasets, figures });
    })();
    return () => { cancelled = true; };
  }, [projectId, importTick]);

  // ---- auto-import app entities as nodes (idempotent, project-scoped) ------
  // An experiment project reconstructs experiment→dataset→figure from its own
  // data. The "Scratch / all" board keeps the legacy overview: every experiment
  // plus every standalone tool item.
  useEffect(() => {
    const dismissed: string[] = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]');
    setHiddenCount(dismissed.length);
    const existing = new Set(nodes.map((n) => n.sourceRef).filter(Boolean) as string[]);

    let desired: { sourceRef: string; label: string; kind: NodeKind }[] = [];
    let desiredEdges: { from: string; to: string; label: string }[] = []; // keyed by sourceRef

    if (projectId) {
      const exp = experiments.find((e) => e.id === projectId);
      const expRef = `experiment:${projectId}`;
      desired = [
        { sourceRef: expRef, label: exp?.name ?? 'Experiment', kind: 'experiment' },
        ...projData.datasets.map((d) => ({ sourceRef: `dataset:${d.id}`, label: d.name || 'Dataset', kind: 'dataset' as NodeKind })),
        ...projData.figures.map((f) => ({ sourceRef: `figure:${f.id}`, label: 'Figure', kind: 'figure' as NodeKind })),
      ];
      desiredEdges = [
        ...projData.datasets.map((d) => ({ from: expRef, to: `dataset:${d.id}`, label: 'has data' })),
        ...projData.figures
          .filter((f) => f.dataset_id)
          .map((f) => ({ from: `dataset:${f.dataset_id}`, to: `figure:${f.id}`, label: 'figure' })),
      ];
    } else {
      desired = [
        ...experiments.filter((e) => !e.archived).map((e) => ({ sourceRef: `experiment:${e.id}`, label: e.name, kind: 'experiment' as NodeKind })),
        ...assays.map((a) => ({ sourceRef: `assay:${a.id}`, label: a.name || 'Assay', kind: 'assay' as NodeKind })),
        ...designs.map((d) => ({ sourceRef: `design:${d.id}`, label: d.title || 'Design', kind: 'design' as NodeKind })),
        ...gels.map((g) => ({ sourceRef: `gel:${g.id}`, label: g.name || 'Gel', kind: 'gel' as NodeKind })),
        ...images.map((im) => ({ sourceRef: `image:${im.id}`, label: im.name || 'Image analysis', kind: 'image' as NodeKind })),
      ];
    }

    const missing = desired.filter((d) => !existing.has(d.sourceRef) && !dismissed.includes(d.sourceRef));
    const refToId = new Map<string, string>();
    nodes.forEach((n) => { if (n.sourceRef) refToId.set(n.sourceRef, n.id); });
    for (const m of missing) {
      const rec = nodesCol.create({
        label: m.label,
        kind: m.kind,
        body: '',
        sourceRef: m.sourceRef,
        seedX: (Math.random() - 0.5) * 200,
        seedY: (Math.random() - 0.5) * 200,
        seedZ: (Math.random() - 0.5) * 200,
      } as Omit<GNode, keyof BaseRecord>);
      refToId.set(m.sourceRef, rec.id);
    }

    // Auto-wire structural edges (idempotent by resolved node-id pair).
    if (desiredEdges.length) {
      const edgeExists = new Set(edges.map((e) => `${e.from}->${e.to}`));
      for (const de of desiredEdges) {
        const fromId = refToId.get(de.from);
        const toId = refToId.get(de.to);
        if (!fromId || !toId || edgeExists.has(`${fromId}->${toId}`)) continue;
        edgesCol.create({ from: fromId, to: toId, label: de.label } as Omit<GEdge, keyof BaseRecord>);
        edgeExists.add(`${fromId}->${toId}`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projData, experiments, assays, designs, gels, images, nodes, edges, nodesCol, edgesCol, importTick]);

  // ---- particle bookkeeping ----------------------------------------------
  useEffect(() => {
    const stored: Record<string, { x: number; y: number; z: number }> = JSON.parse(localStorage.getItem(POS_KEY) || '{}');
    const map = parts.current;
    const ids = new Set(nodes.map((n) => n.id));
    for (const id of Array.from(map.keys())) if (!ids.has(id)) map.delete(id);
    for (const n of nodes) {
      if (!map.has(n.id)) {
        const p = stored[n.id];
        map.set(n.id, {
          x: p?.x ?? n.seedX ?? (Math.random() - 0.5) * 200,
          y: p?.y ?? n.seedY ?? (Math.random() - 0.5) * 200,
          z: p?.z ?? n.seedZ ?? (Math.random() - 0.5) * 200,
          vx: 0, vy: 0, vz: 0,
        });
      }
    }
    setRunning(true);
  }, [nodes]);

  const savePositions = () => {
    const out: Record<string, { x: number; y: number; z: number }> = {};
    parts.current.forEach((p, id) => (out[id] = { x: p.x, y: p.y, z: p.z }));
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(out));
    } catch {
      /* quota */
    }
  };

  const edgePairs = useMemo(() => edges.map((e) => [e.from, e.to] as [string, string]), [edges]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const edgeById = useMemo(() => new Map(edges.map((e) => [e.id, e])), [edges]);

  const drag = useRef<{ mode: 'orbit' | 'pan' | 'node' | 'connect' | null; id?: string; lastX: number; lastY: number; moved: number }>({
    mode: null, lastX: 0, lastY: 0, moved: 0,
  });

  // ---- render + sim loop --------------------------------------------------
  useEffect(() => {
    // The canvas only exists on the graph screen, not the project picker.
    if (picking) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let raf = 0;
    let idleFrames = 0;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const isLight = () => document.documentElement.classList.contains('light');

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = wrap.clientWidth * dpr;
      canvas.height = wrap.clientHeight * dpr;
      canvas.style.width = wrap.clientWidth + 'px';
      canvas.style.height = wrap.clientHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cam.current.cx = wrap.clientWidth / 2;
      cam.current.cy = wrap.clientHeight / 2;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current!);

    const frame = () => {
      if (runningRef.current) {
        const frozen = new Set<string>();
        if (drag.current.mode === 'node' && drag.current.id) frozen.add(drag.current.id);
        const energy = forceStep(parts.current, edgePairs, DEFAULT_FORCES, frozen);
        if (energy < 0.05) {
          idleFrames++;
          if (idleFrames > 30) {
            setRunning(false);
            savePositions();
          }
        } else idleFrames = 0;
      }

      const light = isLight();
      const W = canvas.clientWidth, H = canvas.clientHeight;
      ctx.clearRect(0, 0, W, H);
      const c = cam.current;

      const proj = projected.current;
      proj.clear();
      for (const n of nodes) {
        const p = parts.current.get(n.id);
        if (p) proj.set(n.id, project(p, c));
      }

      // edges
      for (const e of edges) {
        const a = proj.get(e.from), b = proj.get(e.to);
        if (!a || !b) continue;
        const isSel = e.id === selectedEdgeId;
        const alpha = 0.25 + 0.35 * Math.min(1, (a.scale + b.scale) / 2);
        ctx.strokeStyle = isSel ? '#14b8a6' : light ? `rgba(113,113,122,${alpha})` : `rgba(161,161,170,${alpha})`;
        ctx.lineWidth = isSel ? 2.5 : 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (e.label) {
          ctx.fillStyle = isSel ? '#2dd4bf' : light ? 'rgba(82,82,91,0.9)' : 'rgba(161,161,170,0.85)';
          ctx.font = '9px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(e.label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 3);
        }
      }

      // temp connection line
      if (tempFrom.current) {
        const a = proj.get(tempFrom.current);
        if (a) {
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(cursor.current.x, cursor.current.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // nodes back-to-front
      const order = nodes.slice().sort((n1, n2) => (proj.get(n1.id)?.depth ?? 0) - (proj.get(n2.id)?.depth ?? 0));
      for (const n of order) {
        const p = proj.get(n.id);
        if (!p) continue;
        const r = Math.max(3, 7 * p.scale);
        const sel = n.id === selectedId;
        const hov = n.id === hoverId.current;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = KIND_COLOR[n.kind];
        ctx.globalAlpha = 0.55 + 0.45 * Math.min(1, p.scale);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (sel || hov) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = hov && modeRef.current === 'connect' ? '#f59e0b' : light ? '#18181b' : '#fafafa';
          ctx.stroke();
        }
        if (p.scale > 0.5) {
          ctx.fillStyle = light ? '#3f3f46' : '#d4d4d8';
          ctx.font = `${Math.round(10 * Math.min(1.2, p.scale))}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          const lbl = n.label.length > 24 ? n.label.slice(0, 23) + '…' : n.label;
          ctx.fillText(lbl, p.x, p.y + r + 11);
        }
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [picking, nodes, edges, edgePairs, selectedId, selectedEdgeId]);

  // ---- hit testing --------------------------------------------------------
  const nodeAt = (mx: number, my: number): string | null => {
    let best: string | null = null;
    let bestD = Infinity;
    projected.current.forEach((p, id) => {
      const r = Math.max(3, 7 * p.scale) + 6;
      const d = (mx - p.x) ** 2 + (my - p.y) ** 2;
      if (d < r * r && d < bestD) {
        bestD = d;
        best = id;
      }
    });
    return best;
  };

  const edgeAt = (mx: number, my: number): string | null => {
    let best: string | null = null;
    let bestD = 7;
    for (const e of edges) {
      const a = projected.current.get(e.from), b = projected.current.get(e.to);
      if (!a || !b) continue;
      const d = distToSegment(mx, my, a.x, a.y, b.x, b.y);
      if (d < bestD) {
        bestD = d;
        best = e.id;
      }
    }
    return best;
  };

  const localXY = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const { x, y } = localXY(e);
    cursor.current = { x, y };
    const hit = nodeAt(x, y);
    drag.current = { mode: null, lastX: x, lastY: y, moved: 0 };
    if (hit && modeRef.current === 'connect') {
      drag.current.mode = 'connect';
      drag.current.id = hit;
      tempFrom.current = hit;
    } else if (hit) {
      drag.current.mode = 'node';
      drag.current.id = hit;
    } else if (e.shiftKey) {
      drag.current.mode = 'pan';
    } else {
      drag.current.mode = 'orbit';
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const { x, y } = localXY(e);
    cursor.current = { x, y };
    // hover feedback in connect mode
    hoverId.current = modeRef.current === 'connect' ? nodeAt(x, y) : null;
    if (!drag.current.mode) return;
    const dx = x - drag.current.lastX, dy = y - drag.current.lastY;
    drag.current.lastX = x;
    drag.current.lastY = y;
    drag.current.moved += Math.abs(dx) + Math.abs(dy);
    const c = cam.current;
    if (drag.current.mode === 'orbit') {
      c.yaw += dx * 0.01;
      c.pitch = Math.max(-1.5, Math.min(1.5, c.pitch + dy * 0.01));
    } else if (drag.current.mode === 'pan') {
      c.panX += dx;
      c.panY += dy;
    } else if (drag.current.mode === 'node' && drag.current.id) {
      const p = parts.current.get(drag.current.id);
      const pr = projected.current.get(drag.current.id);
      if (p && pr) {
        const { right, up } = screenBasis(c);
        const s = pr.scale || 1;
        p.x += (right.x * dx + up.x * dy) / s;
        p.y += (right.y * dx + up.y * dy) / s;
        p.z += (right.z * dx + up.z * dy) / s;
        p.vx = p.vy = p.vz = 0;
        setRunning(true);
      }
    }
    // connect mode: temp line follows cursor (drawn in loop)
  };

  const onUp = () => {
    const wasClick = drag.current.moved < 4;
    const from = tempFrom.current;
    if (drag.current.mode === 'connect' && from) {
      const target = nodeAt(cursor.current.x, cursor.current.y);
      if (target && target !== from) {
        const rec = edgesCol.create({ from, to: target, label: '' } as Omit<GEdge, keyof BaseRecord>);
        setSelectedId(null);
        setSelectedEdgeId(rec.id);
      }
      tempFrom.current = null;
    } else if (wasClick && drag.current.mode === 'node' && drag.current.id) {
      setSelectedId(drag.current.id);
      setSelectedEdgeId(null);
    } else if (wasClick && drag.current.mode === 'orbit') {
      const eid = edgeAt(cursor.current.x, cursor.current.y);
      if (eid) {
        setSelectedEdgeId(eid);
        setSelectedId(null);
      } else {
        setSelectedId(null);
        setSelectedEdgeId(null);
      }
    }
    if (drag.current.mode === 'node') savePositions();
    drag.current.mode = null;
    hoverId.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    const c = cam.current;
    c.zoom = Math.max(0.2, Math.min(4, c.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
  };

  // Double-click a node → jump to its source (experiment / assay / design / gel).
  const openNode = (id: string) => {
    const n = nodeById.get(id);
    if (!n?.sourceRef) return;
    const [type, ref] = n.sourceRef.split(':');
    savePositions();
    switch (type) {
      case 'experiment':
        setActiveExperiment(ref);
        setView('experiment');
        break;
      case 'dataset':
        if (projectId) {
          setActiveExperiment(projectId);
          setExperimentTab('data');
          setView('experiment');
        }
        break;
      case 'figure':
        if (projectId) {
          setActiveExperiment(projectId);
          setExperimentTab('plots');
          setView('experiment');
        }
        break;
      case 'assay':
        setActiveExperiment(null);
        setDeepLink({ view: 'assays', itemId: ref });
        setView('assays');
        break;
      case 'design':
        setActiveExperiment(null);
        setDeepLink({ view: 'design', itemId: ref });
        setView('design');
        break;
      case 'gel':
        setActiveExperiment(null);
        setDeepLink({ view: 'gel', itemId: ref });
        setView('gel');
        break;
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = localXY(e);
    const hit = nodeAt(x, y);
    if (hit) openNode(hit);
  };

  // ---- node/edge ops ------------------------------------------------------
  const addNode = (kind: NodeKind) => {
    const rec = nodesCol.create({
      label: kind === 'idea' ? 'New idea' : `New ${KIND_LABEL[kind].toLowerCase()}`,
      kind,
      body: '',
      seedX: (Math.random() - 0.5) * 60,
      seedY: (Math.random() - 0.5) * 60,
      seedZ: (Math.random() - 0.5) * 60,
    } as Omit<GNode, keyof BaseRecord>);
    setSelectedId(rec.id);
    setSelectedEdgeId(null);
    setAddOpen(false);
    setRunning(true);
  };

  /** Remove a node from the graph. Source-backed nodes are also "dismissed" so
   *  the auto-import doesn't immediately recreate them (restorable later). The
   *  underlying experiment/assay/etc is left untouched. Works for every node. */
  const removeFromMap = (id: string) => {
    const n = nodeById.get(id);
    if (n?.sourceRef) {
      const dismissed: string[] = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]');
      if (!dismissed.includes(n.sourceRef)) {
        dismissed.push(n.sourceRef);
        localStorage.setItem(DISMISS_KEY, JSON.stringify(dismissed));
        setHiddenCount(dismissed.length);
      }
    }
    edges.filter((e) => e.from === id || e.to === id).forEach((e) => edgesCol.remove(e.id));
    nodesCol.remove(id);
    if (selectedId === id) setSelectedId(null);
    if (selectedEdgeId && edgeById.get(selectedEdgeId) && (edgeById.get(selectedEdgeId)!.from === id || edgeById.get(selectedEdgeId)!.to === id)) {
      setSelectedEdgeId(null);
    }
  };

  /** Permanently delete a node AND its underlying data (assay/design/gel record,
   *  or the experiment itself). For custom nodes this is just removal. */
  const deletePermanently = async (id: string) => {
    const n = nodeById.get(id);
    if (!n) return;
    if (n.sourceRef) {
      const [type, ref] = n.sourceRef.split(':');
      try {
        if (type === 'experiment') {
          const { deleteExperiment } = await import('@/lib/invoke');
          await deleteExperiment(ref); // cascades to its datasets/figures/etc.
          await loadExperiments();
        } else if (type === 'dataset') {
          const { deleteDataset } = await import('@/lib/invoke');
          await deleteDataset(ref);
        } else if (type === 'figure') {
          const { deleteFigure } = await import('@/lib/invoke');
          await deleteFigure(ref);
        } else if (type === 'assay') {
          assaysCol.remove(ref);
        } else if (type === 'design') {
          designsCol.remove(ref);
        } else if (type === 'gel') {
          gelsCol.remove(ref);
        }
      } catch (err) {
        alert(
          `Couldn't delete the underlying ${type}: ${err instanceof Error ? err.message : String(err)}\n\n` +
            `Tip: an experiment can only be deleted once its datasets are removed. Use “Remove from map” to just hide the node.`
        );
        return;
      }
      // clean the dismissed entry — the source is gone, no need to suppress it
      const dismissed: string[] = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]');
      const next = dismissed.filter((d) => d !== n.sourceRef);
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
      setHiddenCount(next.length);
    }
    edges.filter((e) => e.from === id || e.to === id).forEach((e) => edgesCol.remove(e.id));
    nodesCol.remove(id);
    if (selectedId === id) setSelectedId(null);
  };

  /** Un-hide every dismissed source node so it re-imports. */
  const restoreHidden = () => {
    localStorage.setItem(DISMISS_KEY, '[]');
    setHiddenCount(0);
    setImportTick((t) => t + 1);
  };

  const fitView = () => {
    cam.current = { ...cam.current, yaw: 0.6, pitch: -0.35, zoom: 1, panX: 0, panY: 0 };
  };

  const selected = selectedId ? nodeById.get(selectedId) : null;
  const selectedEdges = selectedId ? edges.filter((e) => e.from === selectedId || e.to === selectedId) : [];
  const selectedEdge = selectedEdgeId ? edgeById.get(selectedEdgeId) : null;

  // Landing screen: pick which project's node cluster to open.
  if (picking) {
    return (
      <ProjectPicker
        experiments={experiments}
        onOpen={(id) => setProject(id)}
        onNew={() => setModalOpen('newExperiment')}
      />
    );
  }

  return (
    <div className="h-full w-full relative select-none">
      {/* full-bleed graph */}
      <div
        ref={wrapRef}
        className="absolute inset-0 bg-zinc-950"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            tempFrom.current = null;
            setSelectedId(null);
            setSelectedEdgeId(null);
          } else if (e.key === 'Delete' || e.key === 'Backspace') {
            // don't hijack typing in the inspector inputs
            const t = e.target as HTMLElement;
            if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
            if (selectedId) {
              e.preventDefault();
              removeFromMap(selectedId);
            } else if (selectedEdgeId) {
              e.preventDefault();
              edgesCol.remove(selectedEdgeId);
              setSelectedEdgeId(null);
            }
          }
        }}
      >
        <canvas
          ref={canvasRef}
          className={`block ${mode === 'connect' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => {
            e.preventDefault();
            const { x, y } = localXY(e);
            const hitNode = nodeAt(x, y);
            if (hitNode) {
              removeFromMap(hitNode);
              return;
            }
            const hitEdge = edgeAt(x, y);
            if (hitEdge) {
              edgesCol.remove(hitEdge);
              if (selectedEdgeId === hitEdge) setSelectedEdgeId(null);
            }
          }}
          onWheel={onWheel}
        />
      </div>

      {/* floating toolbar */}
      <div className="absolute top-3 left-3 flex items-center gap-2 bg-zinc-900/85 backdrop-blur border border-zinc-800 rounded-lg px-2 py-1.5 shadow-xl">
        <span className="text-sm font-semibold text-zinc-200 px-1 flex items-center gap-1.5">
          Node view
        </span>
        <div className="w-px h-5 bg-zinc-700" />
        <button
          onClick={() => setPicking(true)}
          className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-800"
          title="Back to the project picker"
        >
          Projects
        </button>
        {/* project switcher — each experiment directory is its own cluster */}
        <select
          value={projectId ?? ''}
          onChange={(e) => setProject(e.target.value || null)}
          title="Switch which experiment/project cluster is shown"
          className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-teal-600 max-w-[180px]"
        >
          <option value="">Scratch / all</option>
          {experiments.filter((e) => !e.archived).map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        <div className="w-px h-5 bg-zinc-700" />
        {/* mode toggle */}
        <div className="flex rounded-md overflow-hidden border border-zinc-700">
          {(['move', 'connect'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                mode === m ? 'bg-teal-500/20 text-teal-300' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {m === 'connect' ? 'Connect' : 'Move'}
            </button>
          ))}
        </div>
        {/* add */}
        <div className="relative">
          <button
            onClick={() => setAddOpen((v) => !v)}
            className="px-2.5 py-1 text-xs font-medium text-zinc-300 hover:text-white rounded-md hover:bg-zinc-800"
          >
            + Add ▾
          </button>
          {addOpen && (
            <div className="absolute top-full left-0 mt-1 z-20 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[130px]">
              {(['idea', 'note', 'file', 'pdf'] as NodeKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => addNode(k)}
                  className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: KIND_COLOR[k] }} />
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="w-px h-5 bg-zinc-700" />
        <button onClick={() => setRunning((r) => !r)} className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-800">
          {running ? 'Freeze' : 'Re-run'}
        </button>
        <button onClick={fitView} className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-800">
          Reset
        </button>
        {hiddenCount > 0 && (
          <button onClick={restoreHidden} className="px-2 py-1 text-xs text-amber-400 hover:text-amber-300 rounded hover:bg-zinc-800" title="Un-hide dismissed nodes">
            Restore {hiddenCount} hidden
          </button>
        )}
        <button onClick={() => exportNotebook(nodes, edges)} className="px-2 py-1 text-xs text-teal-400 hover:text-teal-300 rounded hover:bg-zinc-800">
          Save Project
        </button>
      </div>

      {/* connect-mode hint */}
      {mode === 'connect' && !tempFrom.current && (
        <div className="absolute top-16 left-3 text-xs text-amber-400/90 bg-zinc-900/80 border border-amber-500/30 rounded px-2 py-1">
          Drag from one node to another to link them. Drag empty space to orbit.
        </div>
      )}

      {/* legend */}
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 bg-zinc-900/70 backdrop-blur rounded px-2 py-1 max-w-[60%]">
        {(['experiment', 'dataset', 'figure', 'assay', 'design', 'gel', 'idea', 'note'] as NodeKind[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
            <span className="w-2 h-2 rounded-full" style={{ background: KIND_COLOR[k] }} />
            {KIND_LABEL[k]}
          </span>
        ))}
      </div>

      {/* counts / help bottom-right */}
      <div className="absolute bottom-3 right-3 text-[11px] text-zinc-500 bg-zinc-900/70 backdrop-blur rounded px-2 py-1">
        {nodes.length} nodes · {edges.length} links · double-click to open
      </div>

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-zinc-500 text-center">
            Your experiments, assays, designs and gels appear here automatically.
            <br />
            Add ideas and drag between nodes to build your lab notebook.
          </p>
        </div>
      )}

      {/* floating node inspector */}
      {selected && (
        <FloatingPanel onClose={() => setSelectedId(null)}>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: KIND_COLOR[selected.kind] }} />
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">{KIND_LABEL[selected.kind]}</span>
            {selected.sourceRef && (
              <button
                onClick={() => openNode(selected.id)}
                className="ml-auto text-xs text-teal-400 hover:text-teal-300 font-medium"
                title="Open this item (or double-click the node)"
              >
                Open ↗
              </button>
            )}
          </div>
          <input
            value={selected.label}
            onChange={(e) => nodesCol.update(selected.id, { label: e.target.value })}
            className="w-full px-2 py-1.5 text-sm font-medium bg-zinc-800 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-teal-600"
          />
          <textarea
            value={selected.body}
            onChange={(e) => nodesCol.update(selected.id, { body: e.target.value })}
            rows={4}
            placeholder="Notes about this node…"
            className="w-full mt-2 px-2 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:border-teal-600 resize-y"
          />
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Links</span>
              <button
                onClick={() => setMode('connect')}
                className="text-xs text-teal-500 hover:text-teal-400"
                title="Switch to Connect, then drag to another node"
              >
                + Link
              </button>
            </div>
            {selectedEdges.length === 0 ? (
              <p className="text-xs text-zinc-600">No links yet. Switch to Connect and drag to another node.</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {selectedEdges.map((e) => {
                  const otherId = e.from === selected.id ? e.to : e.from;
                  const other = nodeById.get(otherId);
                  const dir = e.from === selected.id ? '→' : '←';
                  return (
                    <div key={e.id} className="group flex items-center justify-between text-xs bg-zinc-800/60 rounded px-2 py-1">
                      <button onClick={() => { setSelectedEdgeId(e.id); setSelectedId(null); }} className="text-left truncate text-zinc-300 hover:text-teal-400">
                        <span className="text-zinc-500">{dir}</span> {other?.label ?? '—'}
                        {e.label && <span className="text-zinc-500 italic"> · {e.label}</span>}
                      </button>
                      <button onClick={() => edgesCol.remove(e.id)} className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100">×</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-zinc-800 flex flex-wrap gap-2">
            {selected.sourceRef ? (
              <>
                <button onClick={() => removeFromMap(selected.id)} className="text-xs text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded px-2 py-1">
                  Remove from map
                </button>
                <button
                  onClick={() => {
                    const kind = selected.sourceRef!.split(':')[0];
                    if (confirm(`Permanently delete this ${kind} and its data? This cannot be undone.`)) deletePermanently(selected.id);
                  }}
                  className="text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded px-2 py-1"
                >
                  Delete data permanently
                </button>
              </>
            ) : (
              <button
                onClick={() => removeFromMap(selected.id)}
                className="text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 rounded px-2 py-1"
              >
                Delete node
              </button>
            )}
          </div>
          {selected.sourceRef && (
            <p className="text-[10px] text-zinc-600 mt-2">
              “Remove from map” just hides the node (restore it later from the toolbar). “Delete data permanently” also
              deletes the underlying {selected.sourceRef.split(':')[0]}.
            </p>
          )}
          <p className="text-[10px] text-zinc-600 mt-1">Shortcut: select a node and press Delete, or right-click it.</p>
        </FloatingPanel>
      )}

      {/* floating edge editor */}
      {selectedEdge && (
        <FloatingPanel onClose={() => setSelectedEdgeId(null)}>
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Connection</span>
          <div className="flex items-center gap-1.5 text-sm text-zinc-200 my-2">
            <span className="truncate">{nodeById.get(selectedEdge.from)?.label ?? '—'}</span>
            <span className="text-teal-400">→</span>
            <span className="truncate">{nodeById.get(selectedEdge.to)?.label ?? '—'}</span>
          </div>
          <label className="block text-[11px] text-zinc-500 uppercase tracking-wide">Relationship</label>
          <input
            autoFocus
            value={selectedEdge.label}
            onChange={(e) => edgesCol.update(selectedEdge.id, { label: e.target.value })}
            placeholder='e.g. "produced", "supports", "input to"'
            className="w-full mt-1 px-2 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-teal-600"
          />
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => edgesCol.update(selectedEdge.id, { from: selectedEdge.to, to: selectedEdge.from })}
            >
              Flip direction
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { edgesCol.remove(selectedEdge.id); setSelectedEdgeId(null); }}>
              Delete link
            </Button>
          </div>
        </FloatingPanel>
      )}
    </div>
  );
}

/**
 * Landing screen for the Node view: browse experiments/projects and open one to
 * pop its node cluster. Each card shows how many nodes that project's cluster
 * already holds. The "Scratch / all" card opens the shared overview board.
 */
function ProjectPicker({
  experiments,
  onOpen,
  onNew,
}: {
  experiments: Experiment[];
  onOpen: (id: string | null) => void;
  onNew: () => void;
}) {
  const active = experiments.filter((e) => !e.archived);
  const nodeCount = (project: string | null) => {
    try {
      return store.list(scopedGraphKeys(project).nodes).length;
    } catch {
      return 0;
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-zinc-950">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-zinc-100">Node view — pick a project</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Each experiment directory is its own web of nodes. Open one to see its cluster, or use the shared
            Scratch board for a cross-project overview.
          </p>
        </div>

        {active.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-700 p-10 text-center">
            <p className="text-sm text-zinc-200 font-medium">No projects yet</p>
            <p className="text-xs text-zinc-500 mt-1 mb-5 max-w-md mx-auto">
              A project is an experiment directory with its own node cluster. Create one to start building its web
              of nodes — or open the shared Scratch board.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={onNew}
                className="px-5 py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Create a project
              </button>
              <button
                onClick={() => onOpen(null)}
                className="px-5 py-2.5 border border-zinc-700 hover:border-zinc-600 text-zinc-300 text-sm font-medium rounded-lg transition-colors"
              >
                Open Scratch board
              </button>
            </div>
          </div>
        ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Scratch / all */}
          <button
            onClick={() => onOpen(null)}
            className="text-left rounded-lg border border-zinc-800 bg-zinc-900 hover:border-teal-600/50 hover:bg-zinc-800/60 transition-colors p-4"
          >
            <div className="text-sm text-zinc-100 font-medium">Scratch / all</div>
            <div className="text-xs text-zinc-500 mt-1">Shared board — every experiment &amp; tool</div>
            <div className="text-[11px] text-zinc-600 mt-3 font-mono">{nodeCount(null)} nodes</div>
          </button>

          {/* One card per experiment/project */}
          {active.map((exp) => (
            <button
              key={exp.id}
              onClick={() => onOpen(exp.id)}
              className="text-left rounded-lg border border-zinc-800 bg-zinc-900 hover:border-teal-600/50 hover:bg-zinc-800/60 transition-colors p-4"
            >
              <div className="text-sm text-zinc-100 font-medium truncate">{exp.name}</div>
              <div className="text-xs text-zinc-500 mt-1">{new Date(exp.created_ts).toLocaleDateString()}</div>
              <div className="text-[11px] text-zinc-600 mt-3 font-mono">{nodeCount(exp.id)} nodes</div>
            </button>
          ))}

          {/* New experiment */}
          <button
            onClick={onNew}
            className="text-left rounded-lg border border-dashed border-zinc-700 hover:border-teal-600/50 text-zinc-400 hover:text-teal-300 transition-colors p-4 flex items-center gap-2"
          >
            <span className="text-lg leading-none">+</span>
            <span className="text-sm font-medium">New experiment</span>
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

function FloatingPanel({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="absolute top-3 right-3 w-72 bg-zinc-900/95 backdrop-blur border border-zinc-800 rounded-lg shadow-2xl p-4 max-h-[calc(100%-1.5rem)] overflow-y-auto">
      <button onClick={onClose} className="absolute top-2 right-2 text-zinc-600 hover:text-zinc-300 text-sm">×</button>
      {children}
    </div>
  );
}

// ---- Project-bundle export -------------------------------------------------
// Saves the whole node net as one project folder:
//   <ProjectName>/
//     graph.json           — full graph (nodes + edges)
//     notes/<node>.md      — one .md per node (Obsidian-compatible)
//     gel/                 — one JSON per saved gel analysis
//     design/              — one JSON per design doc
//     assay/               — one JSON per assay
// A second pass could export raw CSVs; for now we bundle the metadata.
function safe(name: string): string {
  return (name || 'untitled').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'untitled';
}

async function exportNotebook(nodes: GNode[], edges: GEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Build note files
  const noteFiles: { name: string; content: string }[] = nodes.map((n) => {
    const wiki = edges
      .filter((e) => e.from === n.id || e.to === n.id)
      .map((e) => {
        const other = byId.get(e.from === n.id ? e.to : e.from);
        return other ? `- ${e.label || 'related'}: [[${safe(other.label)}]]` : '';
      })
      .filter(Boolean)
      .join('\n');
    const links = edges
      .filter((e) => e.from === n.id || e.to === n.id)
      .map((e) => {
        const other = byId.get(e.from === n.id ? e.to : e.from);
        const rel = e.label || 'related';
        const dir = e.from === n.id ? 'out' : 'in';
        return `  - target: "${other?.label ?? ''}"\n    rel: "${rel}"\n    dir: ${dir}`;
      })
      .join('\n');
    const fm = `---\nid: ${n.id}\nkind: ${n.kind}\ntitle: "${n.label.replace(/"/g, '\\"')}"\n${n.sourceRef ? `source: ${n.sourceRef}\n` : ''}links:\n${links}\n---\n`;
    return { name: `${safe(n.label)}.md`, content: `${fm}\n# ${n.label}\n\n${n.body || ''}\n\n## Links\n${wiki}\n` };
  });

  const graphJson = JSON.stringify(
    {
      nodes: nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind, source: n.sourceRef, body: n.body })),
      edges: edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
    },
    null,
    2
  );

  // Pull companion data from localStorage for bundling
  const gelKey    = 'labvar.store.gelAnalyses';
  const designKey = 'labvar.store.designDocs';
  const assayKey  = 'labvar.store.assays';
  const gels    = JSON.parse(localStorage.getItem(gelKey)    || '[]');
  const designs = JSON.parse(localStorage.getItem(designKey) || '[]');
  const assays  = JSON.parse(localStorage.getItem(assayKey)  || '[]');

  try {
    const core = await import('@tauri-apps/api/core');
    const isTauri = typeof core.isTauri === 'function' ? core.isTauri() : !!(window as any).__TAURI_INTERNALS__;
    if (isTauri) {
      const dialog = await import('@tauri-apps/plugin-dialog');
      const dir = await dialog.open({ directory: true, multiple: false, title: 'Choose a folder for your project bundle' });
      if (typeof dir === 'string') {
        const { saveIntoDir } = await import('@/lib/exportFile');
        // Root files
        await saveIntoDir(dir, '', 'graph.json', graphJson);
        // Notes
        for (const f of noteFiles) await saveIntoDir(dir, 'notes', f.name, f.content);
        // Companion data sub-folders
        for (const g of gels)    await saveIntoDir(dir, 'gel',    `${safe(g.name || g.id)}.json`, JSON.stringify(g, null, 2));
        for (const d of designs) await saveIntoDir(dir, 'design', `${safe(d.title || d.id)}.json`, JSON.stringify(d, null, 2));
        for (const a of assays)  await saveIntoDir(dir, 'assay',  `${safe(a.name || a.id)}.json`, JSON.stringify(a, null, 2));

        alert(
          `Project bundle saved to:\n${dir}\n\n` +
          `${noteFiles.length} notes · ${gels.length} gels · ${designs.length} designs · ${assays.length} assays`
        );
        return;
      }
      return;
    }
  } catch (e) {
    console.warn('Folder export unavailable, downloading JSON instead:', e);
  }

  // Fallback: download graph.json only
  const { saveText } = await import('@/lib/exportFile');
  await saveText(graphJson, 'notebook_graph.json', [{ name: 'JSON', extensions: ['json'] }]);
}