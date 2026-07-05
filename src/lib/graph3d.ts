// ---------------------------------------------------------------------------
// graph3d.ts — tiny dependency-free 3D graph maths: perspective projection,
// screen-axis basis (for dragging nodes in the view plane), and one step of a
// force-directed layout (repulsion + edge springs + centering). Operates on
// plain data so the notebook UI stays thin.
// ---------------------------------------------------------------------------

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Particle extends Vec3 {
  vx: number;
  vy: number;
  vz: number;
}

export interface Camera {
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
  cx: number; // viewport centre
  cy: number;
  focal: number;
}

export interface Projected {
  x: number; // screen px
  y: number;
  depth: number; // rotated z (larger = closer to camera)
  scale: number; // perspective scale factor
}

function rotate(p: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const x1 = p.x * cy - p.z * sy;
  const z1 = p.x * sy + p.z * cy;
  const cx = Math.cos(pitch), sx = Math.sin(pitch);
  const y1 = p.y * cx - z1 * sx;
  const z2 = p.y * sx + z1 * cx;
  return { x: x1, y: y1, z: z2 };
}

export function project(p: Vec3, cam: Camera): Projected {
  const r = rotate(p, cam.yaw, cam.pitch);
  const scale = (cam.focal / (cam.focal + r.z)) * cam.zoom;
  return {
    x: cam.cx + r.x * scale + cam.panX,
    y: cam.cy + r.y * scale + cam.panY,
    depth: -r.z,
    scale,
  };
}

/** World-space directions that correspond to screen +x and screen +y. Used to
 *  translate a node under the cursor within the current view plane. */
export function screenBasis(cam: Camera): { right: Vec3; up: Vec3 } {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const cx = Math.cos(cam.pitch), sx = Math.sin(cam.pitch);
  // Inverse of (pitch∘yaw) applied to (1,0,0) and (0,1,0).
  // right = R^-1 * (1,0,0); up = R^-1 * (0,1,0)
  const right: Vec3 = { x: cy, y: 0, z: -sy };
  const up: Vec3 = { x: sy * sx, y: cx, z: cy * sx };
  return { right, up };
}

export interface ForceOptions {
  repulsion: number; // node-node repulsion strength
  spring: number; // edge spring stiffness
  linkLength: number; // rest length of an edge
  centering: number; // pull toward origin
  damping: number; // velocity retention per step
}

export const DEFAULT_FORCES: ForceOptions = {
  repulsion: 9000,
  spring: 0.02,
  linkLength: 90,
  centering: 0.004,
  damping: 0.86,
};

/** Advance the layout one step. Mutates `parts` in place. `frozen` particles
 *  (pinned or being dragged) keep their position but still push others. */
export function forceStep(
  parts: Map<string, Particle>,
  edges: [string, string][],
  opts: ForceOptions,
  frozen: Set<string>
): number {
  const ids = Array.from(parts.keys());
  const acc = new Map<string, Vec3>();
  for (const id of ids) acc.set(id, { x: 0, y: 0, z: 0 });

  // Repulsion (O(n²) — fine for the hundreds of nodes a lab notebook has).
  for (let i = 0; i < ids.length; i++) {
    const a = parts.get(ids[i])!;
    for (let j = i + 1; j < ids.length; j++) {
      const b = parts.get(ids[j])!;
      let dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      let d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 0.01) {
        dx = (Math.random() - 0.5) * 0.1;
        dy = (Math.random() - 0.5) * 0.1;
        dz = (Math.random() - 0.5) * 0.1;
        d2 = 0.01;
      }
      const d = Math.sqrt(d2);
      const f = opts.repulsion / d2;
      const ux = dx / d, uy = dy / d, uz = dz / d;
      const aa = acc.get(ids[i])!, ab = acc.get(ids[j])!;
      aa.x += ux * f; aa.y += uy * f; aa.z += uz * f;
      ab.x -= ux * f; ab.y -= uy * f; ab.z -= uz * f;
    }
  }

  // Edge springs.
  for (const [from, to] of edges) {
    const a = parts.get(from), b = parts.get(to);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
    const f = opts.spring * (d - opts.linkLength);
    const ux = dx / d, uy = dy / d, uz = dz / d;
    const aa = acc.get(from)!, ab = acc.get(to)!;
    aa.x += ux * f; aa.y += uy * f; aa.z += uz * f;
    ab.x -= ux * f; ab.y -= uy * f; ab.z -= uz * f;
  }

  // Centering + integrate.
  let energy = 0;
  for (const id of ids) {
    const p = parts.get(id)!;
    const a = acc.get(id)!;
    a.x -= p.x * opts.centering;
    a.y -= p.y * opts.centering;
    a.z -= p.z * opts.centering;
    if (frozen.has(id)) {
      p.vx = p.vy = p.vz = 0;
      continue;
    }
    p.vx = (p.vx + a.x) * opts.damping;
    p.vy = (p.vy + a.y) * opts.damping;
    p.vz = (p.vz + a.z) * opts.damping;
    p.x += p.vx;
    p.y += p.vy;
    p.z += p.vz;
    energy += p.vx * p.vx + p.vy * p.vy + p.vz * p.vz;
  }
  return energy;
}
