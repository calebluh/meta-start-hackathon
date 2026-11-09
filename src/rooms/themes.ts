import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from '@iwsdk/core';
import { KIND_COLORS } from '../colors.js';
import type { GraphData, GraphNode } from '../maps/types.js';

/**
 * Room themes: each part of the app becomes a place that does the same job in
 * the real world. Parts that match no theme get a procedural office, seeded by
 * the part's id so it varies between parts but is the same on every visit.
 * Everything is built from primitives in code (no downloads) and kept low in
 * draw calls for Quest.
 */
export type ThemeId =
  | 'finance'
  | 'warehouse'
  | 'postoffice'
  | 'archive'
  | 'library'
  | 'switchboard'
  | 'security'
  | 'radio'
  | 'analytics'
  | 'thinktank'
  | 'studio'
  | 'factory'
  | 'lab'
  | 'controlroom'
  | 'utility'
  | 'storefront'
  | 'workshop'
  | 'office';

/** What a worker carries in this room. */
export type ItemKind =
  | 'crate'
  | 'envelope'
  | 'receipt'
  | 'folder'
  | 'book'
  | 'card'
  | 'badge'
  | 'vial'
  | 'gear'
  | 'bag'
  | 'photo'
  | 'tape';

export type StationKind =
  // storage and goods
  | 'rack'
  | 'pallets'
  | 'tallShelves'
  | 'cubbies'
  | 'lockers'
  | 'filingCabinet'
  | 'cardCatalog'
  // desks and counters
  | 'register'
  | 'accountingDesk'
  | 'sortingTable'
  | 'readingDesk'
  | 'operatorDesk'
  | 'guardDesk'
  | 'radioDesk'
  | 'bench'
  | 'workbench'
  | 'desk'
  | 'counter'
  | 'display'
  // machines and walls
  | 'securityGate'
  | 'patchPanel'
  | 'serverRack'
  | 'monitors'
  | 'chartWall'
  | 'whiteboard'
  | 'conveyor'
  | 'press'
  | 'scanner'
  | 'fuseBox'
  | 'toolWall'
  | 'lightStand';

export type DecorKind = 'plant' | 'lamp' | 'waterCooler' | 'bin' | 'crateStack' | 'chair' | 'sofa' | 'clock' | 'wetFloor';

export interface Theme {
  id: ThemeId;
  /** Shown on the room sign, e.g. "Finance office". */
  place: string;
  /** What the workers are called, e.g. "cashier". */
  role: string;
  floor: string;
  wall: string;
  accent: string;
  item: ItemKind;
  /** Three stations, left to right in front of the viewer. */
  stations: StationKind[];
  decor: DecorKind[];
}

const T = (
  id: ThemeId,
  place: string,
  role: string,
  accent: string,
  item: ItemKind,
  stations: StationKind[],
  decor: DecorKind[],
  floor = '#2f2c29',
  wall = '#25262b',
): Theme => ({ id, place, role, floor, wall, accent, item, stations, decor });

export const THEMES: Record<Exclude<ThemeId, 'office'>, Theme> = {
  finance: T('finance', 'Finance office', 'cashier', '#3fb950', 'receipt', ['accountingDesk', 'register', 'filingCabinet'], ['plant', 'clock', 'chair', 'sofa'], '#2e2b27', '#22282a'),
  warehouse: T('warehouse', 'Warehouse', 'stocker', '#f0b429', 'crate', ['rack', 'pallets', 'rack'], ['crateStack', 'wetFloor', 'crateStack', 'clock'], '#3a3631', '#2b2a2e'),
  postoffice: T('postoffice', 'Post office', 'mail clerk', '#ff7b72', 'envelope', ['cubbies', 'sortingTable', 'cubbies'], ['crateStack', 'plant', 'clock', 'chair'], '#33302c', '#262a33'),
  archive: T('archive', 'Records archive', 'archivist', '#e3b341', 'folder', ['tallShelves', 'readingDesk', 'filingCabinet'], ['plant', 'clock', 'chair', 'sofa']),
  library: T('library', 'Library', 'librarian', '#d2a8ff', 'book', ['tallShelves', 'cardCatalog', 'tallShelves'], ['plant', 'clock', 'sofa', 'chair']),
  switchboard: T('switchboard', 'Switchboard', 'operator', '#a371f7', 'card', ['patchPanel', 'operatorDesk', 'patchPanel'], ['chair', 'clock', 'plant', 'lamp'], '#262a31', '#1f232b'),
  security: T('security', 'Security desk', 'guard', '#58a6ff', 'badge', ['lockers', 'securityGate', 'guardDesk'], ['plant', 'clock', 'chair', 'lamp'], '#272a30', '#1e2229'),
  radio: T('radio', 'Radio room', 'radio operator', '#56d4dd', 'card', ['radioDesk', 'serverRack', 'radioDesk'], ['chair', 'clock', 'lamp', 'plant'], '#25292e', '#1d2127'),
  analytics: T('analytics', 'Analytics office', 'analyst', '#79c0ff', 'folder', ['chartWall', 'monitors', 'accountingDesk'], ['plant', 'clock', 'sofa', 'waterCooler']),
  thinktank: T('thinktank', 'Think tank', 'researcher', '#d2a8ff', 'card', ['whiteboard', 'monitors', 'readingDesk'], ['plant', 'sofa', 'clock', 'waterCooler'], '#2a2833', '#211f2a'),
  studio: T('studio', 'Photo studio', 'photographer', '#ffa657', 'photo', ['lightStand', 'display', 'lightStand'], ['chair', 'sofa', 'lamp', 'plant'], '#2d2b2b', '#1f1f22'),
  factory: T('factory', 'Assembly line', 'line worker', '#f0883e', 'gear', ['conveyor', 'press', 'conveyor'], ['crateStack', 'wetFloor', 'crateStack', 'clock'], '#2d2d2f', '#24252a'),
  lab: T('lab', 'Inspection lab', 'inspector', '#db61a2', 'vial', ['bench', 'scanner', 'bench'], ['plant', 'wetFloor', 'clock', 'chair'], '#2a2f33', '#222830'),
  controlroom: T('controlroom', 'Control room', 'engineer', '#58a6ff', 'card', ['monitors', 'serverRack', 'monitors'], ['chair', 'clock', 'chair', 'plant'], '#25282d', '#1d2026'),
  utility: T('utility', 'Utility room', 'technician', '#8b949e', 'tape', ['fuseBox', 'toolWall', 'lockers'], ['crateStack', 'wetFloor', 'clock', 'bin']),
  storefront: T('storefront', 'Shop floor', 'host', '#5b8def', 'bag', ['display', 'counter', 'display'], ['plant', 'plant', 'sofa', 'clock'], '#34302d', '#2a2c34'),
  workshop: T('workshop', 'Workshop', 'maker', '#3fb950', 'gear', ['workbench', 'toolWall', 'workbench'], ['crateStack', 'wetFloor', 'clock', 'chair'], '#302c28', '#26272b'),
};

/** Keyword rules, in priority order. Checked against a part's label, then its summary. */
const RULES: [RegExp, Exclude<ThemeId, 'office'>][] = [
  [/payment|billing|invoice|refund|charge|stripe|paypal|wallet|bank|ledger|accounting|tax|payout/i, 'finance'],
  [/auth|login|sign.?in|session|permission|security|guard|oauth|password|identity|access/i, 'security'],
  [/inventory|stock|warehouse|packing|shipping|fulfil|\border|cart|product|catalog/i, 'warehouse'],
  [/e-?mail|mail|notif|sms|newsletter|postmark|sendgrid|twilio|mailgun/i, 'postoffice'],
  [/socket|realtime|real-time|event|stream|pubsub|broadcast|\bchat\b|push/i, 'radio'],
  [/search|index|recommend|lookup|\bdocs?\b|knowledge/i, 'library'],
  [/\bai\b|llm|gpt|claude|llama|agent|prompt|embedding|\bml\b|predict|model/i, 'thinktank'],
  [/photo|image|media|upload|video|audio|asset|\bfiles?\b|\bcdn\b/i, 'studio'],
  [/analytic|metric|report|\bstats?\b|insight|tracking|telemetry|\blog/i, 'analytics'],
  [/data|database|\bdb\b|quer|record|storage|cache|saved|persist|repositor|schema|migration|postgres|mongo|redis/i, 'archive'],
  [/endpoint|route|gateway|\bapi\b|webhook|controller|handler|server|graphql|rpc/i, 'switchboard'],
  [/test|spec|\bqa\b|e2e/i, 'lab'],
  [/deploy|infra|docker|pipeline|\bci\b|monitor|terraform|k8s|kubernetes|cloud|hosting/i, 'controlroom'],
  [/config|setting|\benv\b|flag|constant/i, 'utility'],
  [/job|cron|schedule|queue|\brun|task|batch|worker/i, 'factory'],
];

const KIND_THEMES: Partial<Record<GraphNode['kind'], Exclude<ThemeId, 'office'>>> = {
  service: 'switchboard',
  worker: 'factory',
  library: 'workshop',
  data: 'archive',
  test: 'lab',
  infra: 'controlroom',
  config: 'utility',
  script: 'workshop',
};

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small seeded random generator (mulberry32). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OFFICE_STATIONS: StationKind[] = [
  'desk',
  'filingCabinet',
  'whiteboard',
  'monitors',
  'tallShelves',
  'workbench',
  'chartWall',
  'lockers',
  'readingDesk',
  'cubbies',
];
const OFFICE_ITEMS: ItemKind[] = ['folder', 'card', 'envelope', 'crate', 'book'];
const DECOR: DecorKind[] = ['plant', 'lamp', 'waterCooler', 'sofa', 'clock', 'chair'];

/** A procedural office for a part no theme fits: seeded stations, item and decor. */
function proceduralOffice(node: GraphNode): Theme {
  const rand = seeded(hashString(node.id));
  const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const pool = [...OFFICE_STATIONS];
  const stations: StationKind[] = [];
  for (let i = 0; i < 3; i += 1) stations.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  const accent = KIND_COLORS[node.kind] ?? '#8b949e';
  const floorTone = 0.16 + rand() * 0.05;
  return {
    id: 'office',
    place: node.kind === 'external' ? 'Partner office' : 'Office',
    role: pick(['clerk', 'coordinator', 'specialist', 'assistant']),
    floor: new Color(floorTone, floorTone * 0.95, floorTone * 0.9).getStyle(),
    wall: new Color(accent).multiplyScalar(0.18).getStyle(),
    accent,
    item: pick(OFFICE_ITEMS),
    stations,
    decor: [pick(DECOR), pick(DECOR), pick(DECOR), pick(DECOR)],
  };
}

/**
 * Picks the room for a part: label keywords first; screens under an app stay
 * shop floors; then summary keywords; then the part's kind; and finally a
 * seeded procedural office.
 */
export function pickTheme(graph: GraphData, id: string): Theme {
  const node = graph.nodes.find((n) => n.id === id);
  if (!node) return THEMES.workshop;
  const base = (): Theme => {
    for (const [re, theme] of RULES) if (re.test(node.label)) return THEMES[theme];
    let ancestor: GraphNode | undefined = node;
    while (ancestor) {
      if (ancestor.kind === 'ui') return THEMES.storefront;
      ancestor = graph.nodes.find((n) => n.id === ancestor!.parent);
    }
    // Summaries mention "the server" or "the API" in passing, so the generic
    // switchboard rule only counts when it is in the label.
    for (const [re, theme] of RULES) if (theme !== 'switchboard' && re.test(node.summary)) return THEMES[theme];
    const byKind = KIND_THEMES[node.kind];
    return byKind ? THEMES[byKind] : proceduralOffice(node);
  };
  const theme = base();
  if (theme.id === 'office') return theme;
  // Even themed rooms vary a little per part: station order and decor.
  const rand = seeded(hashString(node.id));
  const stations = rand() < 0.5 ? theme.stations : [...theme.stations].reverse();
  const decor = [...theme.decor].sort(() => rand() - 0.5);
  return { ...theme, stations, decor };
}

// ------------------------------------------------------------------ props

export interface Palette {
  wood: MeshStandardMaterial;
  metal: MeshStandardMaterial;
  dark: MeshStandardMaterial;
  accent: MeshStandardMaterial;
  glow: MeshStandardMaterial;
  paper: MeshStandardMaterial;
  item: MeshStandardMaterial;
  leaf: MeshStandardMaterial;
  screen: MeshStandardMaterial;
}

export function makePalette(theme: Theme): Palette {
  const accent = new Color(theme.accent);
  return {
    wood: new MeshStandardMaterial({ color: '#7a5a3a', roughness: 0.75 }),
    metal: new MeshStandardMaterial({ color: '#8b929c', roughness: 0.4, metalness: 0.6 }),
    dark: new MeshStandardMaterial({ color: '#2b2e35', roughness: 0.6 }),
    accent: new MeshStandardMaterial({ color: accent, roughness: 0.5 }),
    glow: new MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.4 }),
    paper: new MeshStandardMaterial({ color: '#e8e2d4', roughness: 0.9 }),
    item: new MeshStandardMaterial({ color: itemColor(theme.item), roughness: 0.5, metalness: 0.1 }),
    leaf: new MeshStandardMaterial({ color: '#2f7d4a', roughness: 0.8 }),
    screen: new MeshStandardMaterial({ color: '#0d1117', emissive: new Color('#9ecbff'), emissiveIntensity: 0.6 }),
  };
}

function itemColor(item: ItemKind): string {
  const colors: Record<ItemKind, string> = {
    crate: '#b08350',
    envelope: '#f2ecdf',
    receipt: '#f7f4ea',
    folder: '#d9a441',
    book: '#8e5bd6',
    card: '#c9d1d9',
    badge: '#58a6ff',
    vial: '#db61a2',
    gear: '#9aa3ad',
    bag: '#5b8def',
    photo: '#ffa657',
    tape: '#8b949e',
  };
  return colors[item];
}

const unitBox = new BoxGeometry(1, 1, 1);
const unitCylinder = new CylinderGeometry(0.5, 0.5, 1, 16);
const unitCone = new ConeGeometry(0.5, 1, 12);

function box(parent: Group, m: MeshStandardMaterial, w: number, h: number, d: number, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(unitBox, m);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y + h / 2, z);
  parent.add(mesh);
  return mesh;
}

function cylinder(parent: Group, m: MeshStandardMaterial, r: number, h: number, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(unitCylinder, m);
  mesh.scale.set(r * 2, h, r * 2);
  mesh.position.set(x, y + h / 2, z);
  parent.add(mesh);
  return mesh;
}

/** A small carried item, sized to sit in a worker's hands. Origin at its centre. */
export function makeItem(kind: ItemKind, p: Palette): Group {
  const g = new Group();
  switch (kind) {
    case 'crate':
      box(g, p.item, 0.28, 0.2, 0.22, 0, -0.1, 0);
      break;
    case 'envelope':
    case 'card':
    case 'badge':
      box(g, p.item, 0.24, 0.015, 0.16, 0, 0, 0);
      break;
    case 'receipt':
      box(g, p.item, 0.1, 0.01, 0.26, 0, 0, 0);
      break;
    case 'folder':
    case 'book':
      box(g, p.item, 0.24, 0.05, 0.3, 0, -0.025, 0);
      break;
    case 'photo':
      box(g, p.item, 0.2, 0.15, 0.02, 0, -0.07, 0);
      break;
    case 'vial':
      cylinder(g, p.item, 0.035, 0.18, 0, -0.09, 0);
      break;
    case 'gear':
    case 'tape': {
      const ring = new Mesh(new TorusGeometry(0.08, 0.03, 6, 10), p.item);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      break;
    }
    case 'bag':
      box(g, p.item, 0.2, 0.24, 0.1, 0, -0.12, 0);
      break;
  }
  return g;
}

/**
 * One station: origin on the floor, facing +Z (toward the room centre).
 * Workers stand about 0.75 m in front of it.
 */
export function makeStation(kind: StationKind, p: Palette): Group {
  const g = new Group();
  const shelfStack = (w: number, h: number, levels: number, fill: (y: number, level: number) => void) => {
    for (const x of [-w / 2, w / 2]) box(g, p.metal, 0.05, h, 0.5, x, 0, 0);
    for (let i = 0; i <= levels; i += 1) {
      const y = 0.15 + (i * (h - 0.25)) / levels;
      box(g, p.wood, w, 0.03, 0.5, 0, y, 0);
      if (i < levels) fill(y + 0.03, i);
    }
  };
  const table = (w: number, d: number, h = 0.75) => {
    box(g, p.wood, w, 0.04, d, 0, h - 0.04, 0);
    for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) {
      for (const z of [-d / 2 + 0.05, d / 2 - 0.05]) box(g, p.dark, 0.04, h - 0.04, 0.04, x, 0, z);
    }
  };
  const monitor = (x: number, y: number, z: number, w = 0.5, yaw = 0) => {
    box(g, p.dark, w, w * 0.66, 0.04, x, y, z).rotation.y = yaw;
    box(g, p.screen, w * 0.9, w * 0.56, 0.01, x, y + w * 0.05, z + 0.025).rotation.y = yaw;
  };

  switch (kind) {
    case 'rack':
    case 'tallShelves':
      shelfStack(1.6, 2.2, 4, (y, level) => {
        for (let i = 0; i < 4; i += 1) {
          if ((i + level) % 3 === 2) continue;
          if (kind === 'rack') box(g, p.item, 0.3, 0.25, 0.35, -0.6 + i * 0.4, y, 0);
          else for (let j = 0; j < 3; j += 1) box(g, (i + j) % 2 ? p.item : p.paper, 0.07, 0.3, 0.34, -0.66 + i * 0.4 + j * 0.08, y, 0);
        }
      });
      break;
    case 'pallets':
      box(g, p.wood, 1.2, 0.12, 1.0, 0, 0, 0);
      for (let i = 0; i < 6; i += 1) box(g, p.item, 0.34, 0.26, 0.4, -0.38 + (i % 3) * 0.38, 0.12 + Math.floor(i / 3) * 0.27, 0);
      break;
    case 'cubbies':
      box(g, p.wood, 1.8, 2.0, 0.4, 0, 0, -0.1);
      for (let r = 0; r < 5; r += 1) {
        for (let c = 0; c < 6; c += 1) {
          const filled = (r * 7 + c * 3) % 4 !== 0;
          box(g, filled ? p.item : p.dark, 0.24, filled ? 0.06 : 0.3, 0.02, -0.75 + c * 0.3, 0.2 + r * 0.36, 0.11);
        }
      }
      break;
    case 'lockers':
      for (let i = 0; i < 5; i += 1) {
        box(g, i % 2 ? p.metal : p.accent, 0.34, 1.9, 0.45, -0.72 + i * 0.36, 0, 0);
        box(g, p.dark, 0.2, 0.03, 0.01, -0.72 + i * 0.36, 1.6, 0.23);
      }
      break;
    case 'filingCabinet':
      for (let i = 0; i < 3; i += 1) {
        box(g, p.metal, 0.5, 1.3, 0.6, -0.55 + i * 0.55, 0, 0);
        for (let d = 0; d < 4; d += 1) box(g, p.dark, 0.18, 0.03, 0.01, -0.55 + i * 0.55, 0.2 + d * 0.3, 0.305);
      }
      box(g, p.paper, 0.3, 0.08, 0.22, -0.55, 1.3, 0);
      break;
    case 'cardCatalog':
      box(g, p.wood, 1.4, 1.1, 0.5, 0, 0, 0);
      for (let r = 0; r < 5; r += 1) for (let c = 0; c < 6; c += 1) box(g, p.paper, 0.12, 0.05, 0.01, -0.55 + c * 0.22, 0.15 + r * 0.2, 0.255);
      break;
    case 'register':
      // Cashier counter with a till, receipt roll and card reader.
      box(g, p.wood, 1.8, 1.0, 0.6, 0, 0, 0);
      box(g, p.accent, 1.84, 0.05, 0.64, 0, 1.0, 0);
      box(g, p.dark, 0.42, 0.14, 0.34, 0.35, 1.05, 0); // till drawer
      box(g, p.dark, 0.36, 0.22, 0.06, 0.35, 1.19, -0.08).rotation.x = -0.4; // keypad screen
      box(g, p.glow, 0.3, 0.12, 0.01, 0.35, 1.24, -0.045).rotation.x = -0.4;
      cylinder(g, p.paper, 0.05, 0.12, 0.65, 1.05, -0.05); // receipt roll
      box(g, p.dark, 0.1, 0.16, 0.06, -0.3, 1.05, 0.12); // card reader
      for (let i = 0; i < 3; i += 1) cylinder(g, p.item, 0.03, 0.003, -0.6 + i * 0.08, 1.05, 0.1);
      break;
    case 'accountingDesk':
      table(1.5, 0.75);
      monitor(-0.35, 0.75, -0.15, 0.45);
      box(g, p.dark, 0.26, 0.06, 0.32, 0.3, 0.75, 0.05); // adding machine
      box(g, p.paper, 0.1, 0.18, 0.01, 0.3, 0.81, -0.1).rotation.x = -0.3;
      for (let i = 0; i < 4; i += 1) box(g, p.paper, 0.22, 0.012, 0.3, 0.6, 0.75 + i * 0.013, 0.05);
      break;
    case 'sortingTable':
      table(1.4, 0.7);
      for (let i = 0; i < 5; i += 1) box(g, p.item, 0.22, 0.012, 0.15, -0.5 + i * 0.25, 0.75 + (i % 2) * 0.012, -0.1);
      break;
    case 'readingDesk':
      table(1.4, 0.7);
      box(g, p.paper, 0.4, 0.06, 0.3, 0.2, 0.75, 0);
      cylinder(g, p.accent, 0.08, 0.35, -0.45, 0.75, -0.15);
      break;
    case 'operatorDesk':
    case 'radioDesk':
      table(1.5, 0.7);
      box(g, p.dark, 0.9, 0.35, 0.3, 0, 0.75, -0.15);
      box(g, p.glow, 0.8, 0.12, 0.01, 0, 0.92, 0.005);
      if (kind === 'radioDesk') {
        cylinder(g, p.metal, 0.015, 0.9, 0.5, 0.75, -0.25); // antenna
        for (let i = 0; i < 4; i += 1) cylinder(g, p.accent, 0.03, 0.03, -0.3 + i * 0.2, 0.84, 0.16);
      }
      break;
    case 'guardDesk':
      box(g, p.dark, 1.6, 1.0, 0.6, 0, 0, 0);
      monitor(-0.4, 1.0, -0.1, 0.4, 0.2);
      monitor(0.1, 1.0, -0.15, 0.4);
      box(g, p.glow, 1.62, 0.03, 0.02, 0, 0.6, 0.31);
      break;
    case 'bench':
      table(1.4, 0.7);
      for (let i = 0; i < 5; i += 1) cylinder(g, p.glow, 0.03, 0.16, -0.5 + i * 0.25, 0.75, -0.1);
      break;
    case 'workbench':
      table(1.4, 0.7);
      box(g, p.metal, 0.3, 0.12, 0.2, -0.4, 0.75, 0);
      box(g, p.accent, 0.5, 0.05, 0.08, 0.3, 0.75, 0.1);
      break;
    case 'desk':
      table(1.3, 0.7);
      monitor(-0.2, 0.75, -0.15, 0.45);
      box(g, p.paper, 0.25, 0.03, 0.3, 0.4, 0.75, 0.05);
      cylinder(g, p.accent, 0.04, 0.1, 0.45, 0.75, -0.2);
      break;
    case 'counter':
      box(g, p.wood, 1.8, 1.0, 0.6, 0, 0, 0);
      box(g, p.accent, 1.84, 0.05, 0.64, 0, 1.0, 0);
      box(g, p.dark, 0.3, 0.25, 0.25, 0.5, 1.05, 0);
      box(g, p.glow, 0.24, 0.12, 0.01, 0.5, 1.18, 0.13);
      break;
    case 'display':
      shelfStack(1.4, 1.6, 3, (y) => {
        for (let i = 0; i < 4; i += 1) box(g, i % 2 ? p.item : p.accent, 0.18, 0.22, 0.2, -0.5 + i * 0.33, y, 0);
      });
      break;
    case 'securityGate':
      for (const x of [-0.45, 0.45]) box(g, p.metal, 0.18, 1.0, 0.8, x, 0, 0);
      box(g, p.accent, 0.7, 0.04, 0.04, 0, 0.85, 0);
      box(g, p.dark, 0.14, 0.2, 0.06, 0.45, 1.0, 0.2);
      box(g, p.glow, 0.1, 0.06, 0.01, 0.45, 1.1, 0.235);
      break;
    case 'patchPanel':
    case 'serverRack':
      box(g, p.dark, 1.4, 2.1, 0.4, 0, 0, -0.1);
      for (let r = 0; r < 9; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          if ((r * 5 + c * 3) % 4 === 0) continue;
          box(g, (r + c) % 3 ? p.glow : p.accent, 0.06, 0.04, 0.02, -0.54 + c * 0.18, 0.3 + r * 0.2, 0.11);
        }
      }
      break;
    case 'monitors':
      table(1.6, 0.7);
      for (let i = 0; i < 3; i += 1) monitor(-0.52 + i * 0.52, 0.8, -0.2, 0.5, (1 - i) * 0.25);
      break;
    case 'chartWall':
      box(g, p.paper, 2.0, 1.3, 0.05, 0, 0.6, -0.1);
      for (let i = 0; i < 6; i += 1) box(g, i % 2 ? p.accent : p.glow, 0.18, 0.2 + ((i * 37) % 9) * 0.1, 0.02, -0.75 + i * 0.3, 0.7, -0.06);
      break;
    case 'whiteboard':
      box(g, p.metal, 0.05, 1.8, 0.05, -1.0, 0, 0);
      box(g, p.metal, 0.05, 1.8, 0.05, 1.0, 0, 0);
      box(g, p.paper, 2.0, 1.1, 0.04, 0, 0.75, 0);
      for (let i = 0; i < 5; i += 1) box(g, p.accent, 0.3 + (i % 3) * 0.2, 0.03, 0.01, -0.5 + (i % 2) * 0.4, 1.0 + i * 0.14, 0.025);
      break;
    case 'conveyor':
      box(g, p.dark, 2.2, 0.08, 0.6, 0, 0.7, 0);
      for (let i = 0; i < 10; i += 1) {
        const roller = new Mesh(unitCylinder, p.metal);
        roller.scale.set(0.06, 0.6, 0.06);
        roller.rotation.x = Math.PI / 2;
        roller.position.set(-1 + i * 0.22, 0.79, 0);
        g.add(roller);
      }
      for (const x of [-1, 1]) box(g, p.metal, 0.08, 0.7, 0.5, x, 0, 0);
      for (let i = 0; i < 3; i += 1) box(g, p.item, 0.2, 0.14, 0.2, -0.6 + i * 0.6, 0.82, 0);
      break;
    case 'press':
      box(g, p.accent, 0.9, 1.9, 0.8, 0, 0, -0.1);
      box(g, p.dark, 0.6, 0.5, 0.5, 0, 0.8, 0.1);
      box(g, p.glow, 0.5, 0.05, 0.01, 0, 1.6, 0.31);
      break;
    case 'scanner':
      box(g, p.dark, 1.2, 0.9, 0.7, 0, 0, 0);
      box(g, p.glow, 0.9, 0.03, 0.5, 0, 0.9, 0);
      box(g, p.metal, 1.2, 0.1, 0.1, 0, 1.6, -0.3);
      break;
    case 'fuseBox':
      box(g, p.metal, 1.2, 1.6, 0.25, 0, 0.3, -0.1);
      for (let r = 0; r < 4; r += 1) for (let c = 0; c < 5; c += 1) box(g, (r + c) % 4 ? p.dark : p.glow, 0.12, 0.2, 0.02, -0.44 + c * 0.22, 0.5 + r * 0.33, 0.04);
      break;
    case 'toolWall':
      box(g, p.dark, 1.8, 1.8, 0.06, 0, 0.3, -0.2);
      for (let i = 0; i < 8; i += 1) box(g, i % 2 ? p.metal : p.accent, 0.06, 0.35 + (i % 3) * 0.1, 0.04, -0.7 + i * 0.2, 1.1, -0.15);
      break;
    case 'lightStand':
      for (const x of [-0.7, 0.7]) {
        cylinder(g, p.dark, 0.02, 1.8, x, 0, 0);
        const shade = new Mesh(unitCone, p.glow);
        shade.scale.set(0.4, 0.35, 0.4);
        shade.rotation.x = Math.PI / 2 + 0.4;
        shade.position.set(x, 1.85, 0.05);
        g.add(shade);
      }
      box(g, p.paper, 1.2, 1.6, 0.02, 0, 0.1, -0.4); // backdrop
      break;
  }
  return g;
}

/** Small background props that make each room feel lived in. Origin on the floor. */
export function makeDecor(kind: DecorKind, p: Palette): Group {
  const g = new Group();
  switch (kind) {
    case 'plant': {
      cylinder(g, p.dark, 0.16, 0.35, 0, 0, 0);
      const leaves = new Mesh(sphereGeometry, p.leaf);
      leaves.scale.set(0.55, 0.7, 0.55);
      leaves.position.y = 0.7;
      g.add(leaves);
      break;
    }
    case 'lamp':
      cylinder(g, p.dark, 0.15, 0.03, 0, 0, 0);
      cylinder(g, p.metal, 0.02, 1.5, 0, 0, 0);
      cylinder(g, p.glow, 0.17, 0.2, 0, 1.45, 0);
      break;
    case 'waterCooler':
      box(g, p.paper, 0.32, 0.9, 0.32, 0, 0, 0);
      cylinder(g, p.accent, 0.13, 0.4, 0, 0.9, 0);
      break;
    case 'bin':
      cylinder(g, p.metal, 0.15, 0.4, 0, 0, 0);
      break;
    case 'crateStack':
      box(g, p.item, 0.45, 0.4, 0.45, 0, 0, 0);
      box(g, p.item, 0.4, 0.35, 0.4, 0.05, 0.4, 0.02).rotation.y = 0.3;
      break;
    case 'chair':
      box(g, p.dark, 0.45, 0.06, 0.45, 0, 0.42, 0);
      box(g, p.dark, 0.45, 0.45, 0.05, 0, 0.48, -0.2);
      cylinder(g, p.metal, 0.03, 0.42, 0, 0, 0);
      break;
  }
  return g;
}

/** A plain sphere used for heads and foliage; exported so worker.ts shares it. */
export const sphereGeometry = new SphereGeometry(0.5, 16, 12);
export { unitBox, unitCylinder };
