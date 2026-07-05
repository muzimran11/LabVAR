// ---------------------------------------------------------------------------
// densitometry.ts — gel-band / fluorescence quantification from pixel data.
//
// Pure functions over ImageData so the numerics can be reasoned about and
// (later) unit-tested independently of the canvas UI. This is the "quick
// alternative to ImageJ" core: select a lane ROI, get an integrated density.
//
// Method (classic densitometry):
//   1. Convert each pixel to an intensity (luminance, or the green channel for
//      GFP-style fluorescence).
//   2. For dark bands on a light background (typical stained/blotted gels),
//      invert so signal is high-valued.
//   3. Estimate a per-ROI background as a low percentile of the intensities
//      (band-free pixels dominate the low end). This is a cheap stand-in for a
//      rolling-ball background and works well for well-separated lanes.
//   4. Integrated density = Σ max(0, intensity − background) over the ROI.
// ---------------------------------------------------------------------------

export type ChannelMode = 'luminance' | 'green' | 'red' | 'blue';

export interface LaneQuant {
  /** Σ background-subtracted intensity — the primary densitometry readout. */
  integrated: number;
  /** Mean raw (post-invert) intensity across the ROI. */
  mean: number;
  /** Estimated background level that was subtracted. */
  background: number;
  /** Number of pixels sampled. */
  area: number;
  /** Peak (post-invert) intensity in the ROI. */
  peak: number;
}

function pixelIntensity(r: number, g: number, b: number, mode: ChannelMode): number {
  switch (mode) {
    case 'green':
      return g;
    case 'red':
      return r;
    case 'blue':
      return b;
    default:
      return 0.299 * r + 0.587 * g + 0.114 * b;
  }
}

export interface QuantOptions {
  /** Invert intensities — set true for dark bands on a light gel. */
  invert: boolean;
  channel: ChannelMode;
  /** Percentile (0–100) of ROI intensities used as the background estimate. */
  backgroundPercentile: number;
}

/** Quantify a single ROI's ImageData. */
export function quantify(img: ImageData, opts: QuantOptions): LaneQuant {
  const { data } = img;
  const n = data.length / 4;
  const vals = new Float64Array(n);
  for (let p = 0, i = 0; i < data.length; i += 4, p++) {
    let v = pixelIntensity(data[i], data[i + 1], data[i + 2], opts.channel);
    if (opts.invert) v = 255 - v;
    vals[p] = v;
  }
  // Background = requested percentile of the sorted intensities.
  const sorted = Float64Array.from(vals).sort();
  const idx = Math.min(n - 1, Math.max(0, Math.floor((opts.backgroundPercentile / 100) * (n - 1))));
  const background = sorted[idx] ?? 0;

  let integrated = 0;
  let sum = 0;
  let peak = 0;
  for (let p = 0; p < n; p++) {
    const v = vals[p];
    sum += v;
    if (v > peak) peak = v;
    const s = v - background;
    if (s > 0) integrated += s;
  }
  return { integrated, mean: n ? sum / n : 0, background, area: n, peak };
}

export interface LaneResult extends LaneQuant {
  id: string;
  label: string;
  /** integrated / reference integrated (unitless), if a reference is set. */
  normalized: number | null;
  /** integrated as a fraction of the total across all lanes. */
  fraction: number;
}

/** Attach normalization + fraction across a set of quantified lanes. */
export function normalizeLanes(
  lanes: { id: string; label: string; quant: LaneQuant }[],
  referenceId: string | null
): LaneResult[] {
  const total = lanes.reduce((a, l) => a + l.quant.integrated, 0);
  const ref = referenceId ? lanes.find((l) => l.id === referenceId)?.quant.integrated ?? null : null;
  return lanes.map((l) => ({
    id: l.id,
    label: l.label,
    ...l.quant,
    normalized: ref && ref > 0 ? l.quant.integrated / ref : null,
    fraction: total > 0 ? l.quant.integrated / total : 0,
  }));
}
