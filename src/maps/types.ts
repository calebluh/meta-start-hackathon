/**
 * The subset of Floorplan's `floorplan/graph.json` (schema `floorplan/graph@1`)
 * that the diorama reads. Floorplan (MIT, github.com/haydenschmitty/floorplan)
 * writes this file when it maps a codebase; any field not listed here is ignored.
 *
 * References inside links, flows and recent work use Floorplan's prefixes:
 * `n:<node id>` for a part of the app and `f:<file path>` for a file.
 */

export type NodeKind =
  | 'ui'
  | 'service'
  | 'worker'
  | 'library'
  | 'feature'
  | 'data'
  | 'config'
  | 'test'
  | 'script'
  | 'infra'
  | 'external'
  | 'misc';

export interface GraphNode {
  id: string;
  parent: string | null;
  label: string;
  kind: NodeKind;
  summary: string;
  /** Files and lines assigned directly to this node (not its children). */
  stats?: { files: number; loc: number };
}

export interface GraphFile {
  /** Path. */
  p: string;
  /** Owning node id. */
  n: string;
  /** Plain-English name. */
  name: string;
  /** One-line description. */
  d: string;
  loc: number;
}

export interface GraphLink {
  a: string;
  b: string;
  /** import | call | http | rpc | event | queue | data | config */
  k: string;
  /** Strength: number of imports or calls folded into this link. */
  w: number;
  labels?: string[];
}

export interface FlowStep {
  ref: string;
  note: string;
}

export interface Flow {
  id: string;
  title: string;
  description: string;
  steps: FlowStep[];
}

export interface HealthIssue {
  id: string;
  kind: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail?: string;
  locations?: { file: string; line?: number }[];
}

export interface RecentItem {
  ref: string;
  change?: 'new' | 'changed';
  note: string;
}

export interface RecentTask {
  title: string;
  request: string;
  summary: string;
  items: RecentItem[];
}

export interface GraphData {
  schema: 'floorplan/graph@1';
  /** `logo` is our extension: a URL to the project's favicon, used on uniforms and badges. */
  project: { name: string; summary: string; logo?: string };
  /** Our extension: where the map came from, for the on-screen credit. */
  source?: { repo: string; commit: string; license?: string };
  nodes: GraphNode[];
  files: GraphFile[];
  links: GraphLink[];
  flows: Flow[];
  health?: { issues: HealthIssue[] };
  recent?: { tasks: RecentTask[] };
}
