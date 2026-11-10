import { larder } from './larder.js';
import { mirofish } from './mirofish.js';
import type { GraphData } from './types.js';

/**
 * Maps made by the Codebase Diorama Claude skill land in ./custom/<id>.json
 * and are picked up here. Vite resolves the glob at build time; outside Vite
 * (a Vercel function) there are none.
 */
let customFiles: Record<string, { default: unknown }> = {};
try {
  // Vite replaces this call with the matching files at build time.
  customFiles = import.meta.glob('./custom/*.json', { eager: true });
} catch {
  // Not built by Vite: import.meta.glob does not exist, so no custom maps.
}

/** Custom maps by id (the file name), newest skill output first in the menu. */
export const CUSTOM_MAPS: Record<string, GraphData> = Object.fromEntries(
  Object.entries(customFiles).map(([path, mod]) => [path.replace(/^.*\/|\.json$/g, ''), mod.default as GraphData]),
);

/** Every map, by id. The server only answers about these. */
export const MAPS: Record<string, GraphData> = { mirofish, larder, ...CUSTOM_MAPS };

/** The map shown first. */
export const DEFAULT_MAP = 'mirofish';
