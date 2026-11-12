import { createComponent, Types } from '@iwsdk/core';

/** A building or tower on the diorama that stands for one part of the app. */
export const District = createComponent('District', {
  nodeId: { type: Types.String, default: '', label: 'Floorplan node id' },
});

/** The request a worker hands the visitor during a flow; pinch it to take it. */
export const Carryable = createComponent('Carryable', {
  nodeId: { type: Types.String, default: '', label: 'Room node id' },
});

/** A pipe in a room's wall leading to another part; pinch it to send the request there. */
export const Pipe = createComponent('Pipe', {
  nodeId: { type: Types.String, default: '', label: 'Leads to node id' },
});

/** A worker inside a room; pinch one to talk to it. */
export const Worker = createComponent('Worker', {
  nodeId: { type: Types.String, default: '', label: 'Floorplan node id' },
  name: { type: Types.String, default: '', label: 'Name' },
});
