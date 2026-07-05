// ---------------------------------------------------------------------------
// sam.ts — promptable segmentation ("the worm finder") via transformers.js.
//
// Uses SlimSAM (a ~100× compressed Segment Anything) running in-browser through
// onnxruntime-web. The model + weights download from the Hugging Face hub on
// first use and are cached by the browser. See IMAGE_ANALYSIS_PLAN.md.
//
// HONEST NOTE: SAM does not "learn" your worm. You click a point, it returns a
// mask instantly. The recipe/auto-batch layer (Stage 3) is what turns one click
// into a repeatable measurement across a folder. This module is just the
// segmentation primitive: load, embed an image once, then segment at a point.
// ---------------------------------------------------------------------------

const MODEL_ID = 'Xenova/slimsam-77-uniform';

// transformers.js is heavy; import it lazily so the app starts without it and
// the ~tens-of-MB model machinery only loads when the user opens the worm finder.
type TF = typeof import('@huggingface/transformers');
let tfPromise: Promise<TF> | null = null;
function tf(): Promise<TF> {
  if (!tfPromise) tfPromise = import('@huggingface/transformers');
  return tfPromise;
}

export interface SamProgress {
  status: string;
  file?: string;
  progress?: number; // 0..100
  loaded?: number;
  total?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let modelPromise: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processorPromise: Promise<any> | null = null;

/** Load (and cache) the SAM model + processor. First call downloads weights. */
export async function loadSam(onProgress?: (p: SamProgress) => void) {
  const { SamModel, AutoProcessor, env } = await tf();
  // Fetch from the HF hub (no local model files bundled).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (env as any).allowLocalModels = false;
  if (!modelPromise) {
    modelPromise = SamModel.from_pretrained(MODEL_ID, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      progress_callback: onProgress as any,
    });
  }
  if (!processorPromise) {
    processorPromise = AutoProcessor.from_pretrained(MODEL_ID);
  }
  const [model, processor] = await Promise.all([modelPromise, processorPromise]);
  return { model, processor };
}

/** True once the model has been requested (so the UI can hide the load button). */
export function samRequested(): boolean {
  return modelPromise !== null;
}

export interface SamSession {
  // The decoded RawImage; cached so repeated clicks don't re-fetch the data URL.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  image: any;
  width: number;
  height: number;
}

/**
 * Prepare an image for segmentation. Kept lightweight (just reads the pixels);
 * the encoder runs per-click inside `segmentAt` using the documented one-call
 * pattern, which is the reliable path for transformers.js SAM.
 * `src` is any image URL — here the contrast-stretched preview data URL.
 */
export async function embedImage(src: string): Promise<SamSession> {
  const { RawImage } = await tf();
  await loadSam();
  const image = await RawImage.read(src);
  return { image, width: image.width, height: image.height };
}

export interface SamMask {
  data: Uint8Array; // length width*height, 1 = inside worm
  width: number;
  height: number;
  score: number; // model's predicted IoU for the chosen mask
}

export interface EnhanceOptions {
  /** <1 brightens faint (dark) signal, >1 darkens. 1 = no gamma. */
  gamma?: number;
  /** Percentile clipped to black (default 0.5). */
  lowPct?: number;
  /** Percentile clipped to white (default 99.5). */
  highPct?: number;
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}

/**
 * Percentile auto-stretch + gamma an image so faint worms pop for SAM's encoder.
 * Returns a PNG data URL. This is fed ONLY to the model — measurement still runs
 * on the honest display preview, so numbers are unaffected by enhancement.
 */
export async function enhanceContrast(src: string, opts: EnhanceOptions = {}): Promise<string> {
  const gamma = opts.gamma ?? 0.7;
  const lowPct = opts.lowPct ?? 0.5;
  const highPct = opts.highPct ?? 99.5;
  const img = await loadImg(src);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  const n = d.length / 4;
  const lum = new Float64Array(n);
  for (let p = 0, i = 0; i < d.length; i += 4, p++) lum[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const sorted = Float64Array.from(lum).sort();
  const lo = sorted[Math.max(0, Math.floor((lowPct / 100) * (n - 1)))] ?? 0;
  const hi = sorted[Math.min(n - 1, Math.floor((highPct / 100) * (n - 1)))] ?? 255;
  const range = hi - lo || 1;
  const invG = 1 / gamma;
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      let v = (d[i + k] - lo) / range;
      if (v < 0) v = 0;
      if (v > 1) v = 1;
      v = Math.pow(v, invG);
      d[i + k] = Math.round(v * 255);
    }
  }
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/png');
}

export type SamBox = [number, number, number, number]; // [x0, y0, x1, y1]

/**
 * Segment at a point and/or inside a box, in the image's pixel coordinates.
 * A box ("focus here") constrains the result to a region — pass the box centre
 * as (x, y) and the box as `box`; the mask is clipped to the box so a stray
 * neighbouring worm or background outside the box is never included.
 */
export async function segmentAt(
  session: SamSession,
  x: number,
  y: number,
  box?: SamBox
): Promise<SamMask> {
  const { model, processor } = await loadSam();
  // NB: SlimSAM's exported forward reads `input_points.dims` unguarded (crashes
  // without points) and its ONNX decoder may ignore `input_boxes` entirely. So
  // "focus on a box" is done robustly, model-agnostically: prompt with a POINT
  // (here the box centre, passed as x,y) and then CLIP the returned mask to the
  // box below — the box always constrains the result, and it never crashes.
  const inputs = await processor(session.image, { input_points: [[[x, y]]] });
  const outputs = await model(inputs);
  const masks = await processor.post_process_masks(
    outputs.pred_masks,
    inputs.original_sizes,
    inputs.reshaped_input_sizes
  );
  // masks[0].dims == [1, nMasks, H, W]; pick the highest-IoU mask.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mask: any = masks[0];
  const dims: number[] = mask.dims;
  const H = dims[dims.length - 2];
  const W = dims[dims.length - 1];
  const nMasks = dims[dims.length - 3] ?? 1;
  const scores: ArrayLike<number> = outputs.iou_scores.data;
  let best = 0;
  for (let i = 1; i < nMasks; i++) if (scores[i] > scores[best]) best = i;
  const src: ArrayLike<number> = mask.data;
  const off = best * H * W;
  const out = new Uint8Array(H * W);
  for (let i = 0; i < H * W; i++) out[i] = src[off + i] ? 1 : 0;
  // Clip the mask to the focus box (mask dims == original preview size, and the
  // box is in those same pixel coords), so a drawn box always constrains the
  // measured region even if the model ignored the box prompt.
  if (box) {
    const x0 = Math.max(0, Math.min(W - 1, Math.round(Math.min(box[0], box[2]))));
    const x1 = Math.max(0, Math.min(W - 1, Math.round(Math.max(box[0], box[2]))));
    const y0 = Math.max(0, Math.min(H - 1, Math.round(Math.min(box[1], box[3]))));
    const y1 = Math.max(0, Math.min(H - 1, Math.round(Math.max(box[1], box[3]))));
    for (let yy = 0; yy < H; yy++) {
      const inRowBand = yy >= y0 && yy <= y1;
      for (let xx = 0; xx < W; xx++) {
        if (!inRowBand || xx < x0 || xx > x1) out[yy * W + xx] = 0;
      }
    }
  }
  return { data: out, width: W, height: H, score: Number(scores[best] ?? 0) };
}
