import type { GraphData } from './types.js';
import data from './self.json' with { type: 'json' };

/**
 * This app, mapped by its own Claude Code skill (plugins/codebase-diorama).
 * Built by scripts/build-map.mjs from scripts/maps/self.mjs and
 * scripts/maps/self.arch.json. Regenerate rather than editing the JSON by hand.
 */
export const self = data as unknown as GraphData;
