import { replaceMap } from './state.js';
import type { GraphData } from './maps/types.js';

/**
 * Development only: when a map file is rebuilt (a coding agent working
 * through the notes runs the map builder), the dev server sends the new map
 * here instead of reloading the page, so a visitor in VR stays in VR and
 * watches the city change.
 */
export function listenForMapUpdates(): void {
  if (!import.meta.hot) return;
  import.meta.hot.on('diorama:map', (data: { id: string; graph: GraphData }) => {
    if (!data?.id || !data.graph?.nodes) return;
    console.log(`[live] map ${data.id} updated`);
    replaceMap(data.id, data.graph);
  });
}
