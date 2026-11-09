import type { NodeKind } from './maps/types.js';

/** Colours per kind of part, matched loosely to Floorplan's 2D map. */
export const KIND_COLORS: Record<NodeKind, string> = {
  ui: '#5b8def',
  service: '#a371f7',
  worker: '#f0883e',
  library: '#3fb950',
  feature: '#58a6ff',
  data: '#e3b341',
  config: '#8b949e',
  test: '#db61a2',
  script: '#79c0ff',
  infra: '#6e7681',
  external: '#bc8cff',
  misc: '#6e7681',
};
