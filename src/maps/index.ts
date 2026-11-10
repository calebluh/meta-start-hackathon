import { larder } from './larder.js';
import { mirofish } from './mirofish.js';
import { HACKATHON } from '../edition.js';
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

/** Custom maps by id (the file name), in file-name order. */
export const CUSTOM_MAPS: Record<string, GraphData> = Object.fromEntries(
  Object.entries(customFiles).map(([path, mod]) => [path.replace(/^.*\/|\.json$/g, ''), mod.default as GraphData]),
);

/**
 * Every map, by id. The server only answers about these. MiroFish is a
 * hackathon demo only; the personal edition has the user's own maps, plus the
 * small Larder sample so it is never empty.
 */
export const MAPS: Record<string, GraphData> = HACKATHON ? { mirofish, larder, ...CUSTOM_MAPS } : { ...CUSTOM_MAPS, larder };

/** The map shown first: the hackathon's headline demo, or the user's own map. */
export const DEFAULT_MAP = HACKATHON ? 'mirofish' : (Object.keys(CUSTOM_MAPS)[0] ?? 'larder');
