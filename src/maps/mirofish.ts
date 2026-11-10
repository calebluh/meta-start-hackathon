import type { GraphData } from './types.js';
import data from './mirofish.json' with { type: 'json' };

/**
 * MiroFish (github.com/666ghj/MiroFish, AGPL-3.0), mapped at commit 7657031
 * by scripts/build-map.mjs from scripts/maps/mirofish.mjs. Regenerate rather
 * than editing the JSON by hand.
 */
export const mirofish = data as unknown as GraphData;
