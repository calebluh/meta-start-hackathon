import { larder } from './larder.js';
import type { GraphData } from './types.js';

/** Every bundled map, by id. The server only answers about these. */
export const MAPS: Record<string, GraphData> = { larder };
