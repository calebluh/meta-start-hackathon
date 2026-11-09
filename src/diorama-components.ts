import { createComponent, Types } from '@iwsdk/core';

/** A building or tower on the diorama that stands for one part of the app. */
export const District = createComponent('District', {
  nodeId: { type: Types.String, default: '', label: 'Floorplan node id' },
});

/** A worker inside a room; pinch one to talk to it. */
export const Worker = createComponent('Worker', {
  nodeId: { type: Types.String, default: '', label: 'Floorplan node id' },
  name: { type: Types.String, default: '', label: 'Name' },
});
