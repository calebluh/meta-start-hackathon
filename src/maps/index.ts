import { larder } from './larder.js';
import { mirofish } from './mirofish.js';
import type { GraphData } from './types.js';

/** Every bundled map, by id. The server only answers about these. */
export const MAPS: Record<string, GraphData> = { mirofish, larder };

/** The map shown first. */
export const DEFAULT_MAP = 'mirofish';
