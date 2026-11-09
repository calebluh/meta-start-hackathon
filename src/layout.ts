import type { GraphData, GraphNode, NodeKind } from './maps/types.js';

/**
 * Turns a Floorplan graph into a tabletop layout, in meters, centred on the
 * board origin with +Z toward the viewer. Pure and deterministic: the same map
 * always produces the same districts.
 *
 * Every part of the app becomes a district sized by how much code it holds
 * (a squarified treemap). Parts with children become low plinths with their
 * children standing on them; leaf parts become buildings whose height grows
 * with their line count. Outside services stand in a row behind the board.
 */

export interface Rect {
  /** Min-x corner. */
  x: number;
  /** Min-z corner. */
  z: number;
  w: number;
  d: number;
}

export interface District {
  id: string;
  label: string;
  kind: NodeKind;
  parent: string | null;
  depth: number;
  rect: Rect;
  /** Height of the floor this district stands on. */
  base: number;
  height: number;
  isLeaf: boolean;
  totalFiles: number;
  totalLoc: number;
}

export interface ExternalSite {
  id: string;
  label: string;
  x: number;
  z: number;
  radius: number;
  height: number;
}

export interface DioramaLayout {
  width: number;
  depth: number;
  districts: Map<string, District>;
  externals: Map<string, ExternalSite>;
}

export const BOARD_WIDTH = 0.72;
export const BOARD_DEPTH = 0.44;
const BOARD_MARGIN = 0.016;
const PLINTH_HEIGHT = 0.006;
const PLINTH_PADDING = 0.01;
const MIN_HEIGHT = 0.01;
const MAX_EXTRA_HEIGHT = 0.045;

interface Weighted<T> {
  item: T;
  weight: number;
}

/** Squarified treemap (Bruls, Huizing & van Wijk). Returns one rect per item. */
export function squarify<T>(items: Weighted<T>[], rect: Rect): { item: T; rect: Rect }[] {
  const out: { item: T; rect: Rect }[] = [];
  const total = items.reduce((sum, i) => sum + Math.max(0, i.weight), 0);
  if (total <= 0 || rect.w <= 0 || rect.d <= 0) return out;
  const area = rect.w * rect.d;
  const sized = items
    .filter((i) => i.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map((i) => ({ item: i.item, area: (i.weight / total) * area }));

  const worst = (row: { area: number }[], side: number): number => {
    const s = row.reduce((sum, r) => sum + r.area, 0);
    let w = 0;
    for (const r of row) {
      w = Math.max(w, (side * side * r.area) / (s * s), (s * s) / (side * side * r.area));
    }
    return w;
  };

  const placeRow = (row: { item: T; area: number }[], r: Rect): Rect => {
    const s = row.reduce((sum, i) => sum + i.area, 0);
    if (r.w >= r.d) {
      // Column along the left edge.
      const t = s / r.d;
      let z = r.z;
      for (const i of row) {
        const d = i.area / t;
        out.push({ item: i.item, rect: { x: r.x, z, w: t, d } });
        z += d;
      }
      return { x: r.x + t, z: r.z, w: r.w - t, d: r.d };
    }
    // Row along the back edge.
    const t = s / r.w;
    let x = r.x;
    for (const i of row) {
      const w = i.area / t;
      out.push({ item: i.item, rect: { x, z: r.z, w, d: t } });
      x += w;
    }
    return { x: r.x, z: r.z + t, w: r.w, d: r.d - t };
  };

  let remaining: Rect = { ...rect };
  let row: { item: T; area: number }[] = [];
  let index = 0;
  while (index < sized.length) {
    const side = Math.min(remaining.w, remaining.d);
    const next = sized[index];
    if (row.length === 0 || worst([...row, next], side) <= worst(row, side)) {
      row.push(next);
      index += 1;
    } else {
      remaining = placeRow(row, remaining);
      row = [];
    }
  }
  if (row.length > 0) placeRow(row, remaining);
  return out;
}

const inset = (r: Rect, by: number): Rect => {
  const dx = Math.min(by, r.w / 4);
  const dz = Math.min(by, r.d / 4);
  return { x: r.x + dx, z: r.z + dz, w: r.w - 2 * dx, d: r.d - 2 * dz };
};

export function buildLayout(graph: GraphData): DioramaLayout {
  const byParent = new Map<string | null, GraphNode[]>();
  for (const n of graph.nodes) {
    if (n.kind === 'external') continue;
    const list = byParent.get(n.parent) ?? [];
    list.push(n);
    byParent.set(n.parent, list);
  }

  // Totals include every descendant, so a parent is sized by all it contains.
  const totals = new Map<string, { files: number; loc: number }>();
  const total = (n: GraphNode): { files: number; loc: number } => {
    const cached = totals.get(n.id);
    if (cached) return cached;
    const sum = { files: n.stats?.files ?? 0, loc: n.stats?.loc ?? 0 };
    for (const child of byParent.get(n.id) ?? []) {
      const t = total(child);
      sum.files += t.files;
      sum.loc += t.loc;
    }
    totals.set(n.id, sum);
    return sum;
  };
  const weightOf = (n: GraphNode): number => {
    const t = total(n);
    return Math.max(t.loc, t.files * 40, 40);
  };

  let maxLeafLoc = 1;
  for (const n of graph.nodes) {
    if (n.kind !== 'external' && !(byParent.get(n.id)?.length)) {
      maxLeafLoc = Math.max(maxLeafLoc, total(n).loc);
    }
  }

  const districts = new Map<string, District>();
  const place = (parentId: string | null, rect: Rect, depth: number, base: number): void => {
    const children = byParent.get(parentId) ?? [];
    const items: Weighted<GraphNode | null>[] = children.map((n) => ({ item: n, weight: weightOf(n) }));
    // A parent's own files leave an open plaza beside its children.
    const parent = parentId ? graph.nodes.find((n) => n.id === parentId) : undefined;
    const ownLoc = parent?.stats?.loc ?? 0;
    if (parent && ownLoc > 0) items.push({ item: null, weight: ownLoc });

    const gap = depth === 0 ? 0.008 : 0.004;
    for (const { item, rect: cell } of squarify(items, rect)) {
      if (!item) continue;
      const r = inset(cell, gap);
      const kids = byParent.get(item.id) ?? [];
      const t = total(item);
      const isLeaf = kids.length === 0;
      const height = isLeaf
        ? MIN_HEIGHT + MAX_EXTRA_HEIGHT * Math.sqrt(t.loc / maxLeafLoc)
        : PLINTH_HEIGHT;
      districts.set(item.id, {
        id: item.id,
        label: item.label,
        kind: item.kind,
        parent: item.parent,
        depth,
        rect: r,
        base,
        height,
        isLeaf,
        totalFiles: t.files,
        totalLoc: t.loc,
      });
      if (!isLeaf) place(item.id, inset(r, PLINTH_PADDING), depth + 1, base + height);
    }
  };

  place(
    null,
    {
      x: -BOARD_WIDTH / 2 + BOARD_MARGIN,
      z: -BOARD_DEPTH / 2 + BOARD_MARGIN,
      w: BOARD_WIDTH - 2 * BOARD_MARGIN,
      d: BOARD_DEPTH - 2 * BOARD_MARGIN,
    },
    0,
    0,
  );

  // Outside services: a row of towers behind the board.
  const externals = new Map<string, ExternalSite>();
  const outside = graph.nodes.filter((n) => n.kind === 'external');
  const spacing = BOARD_WIDTH / Math.max(outside.length, 1);
  outside.forEach((n, i) => {
    externals.set(n.id, {
      id: n.id,
      label: n.label,
      x: -BOARD_WIDTH / 2 + spacing * (i + 0.5),
      z: -BOARD_DEPTH / 2 - 0.05,
      radius: 0.018,
      height: 0.03,
    });
  });

  return { width: BOARD_WIDTH, depth: BOARD_DEPTH, districts, externals };
}

/** Maps a Floorplan reference (`n:id`, `f:path`, or a bare id/path) to a node id. */
export function resolveRef(graph: GraphData, ref: string): string | null {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  if (ref.startsWith('n:')) return nodeIds.has(ref.slice(2)) ? ref.slice(2) : null;
  const path = ref.startsWith('f:') ? ref.slice(2) : ref;
  if (nodeIds.has(path)) return path;
  return graph.files.find((f) => f.p === path)?.n ?? null;
}
