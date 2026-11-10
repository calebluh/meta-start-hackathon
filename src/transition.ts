/**
 * The "dive in" handshake between the tabletop and the rooms. Entering a room
 * from the table, the diorama grows around the chosen building until the
 * viewer is inside it, and the room fades in at the end. Leaving, the city
 * shrinks back down onto the desk as the room fades out.
 *
 * DioramaSystem drives the dive; RoomSystem waits on it before it darkens the
 * view and reports when its room is gone.
 */
export const dive = {
  /** A dive into a building is running. */
  active: false,
  /** 0 on the desk, 1 inside the building. */
  t: 0,
  /** RoomSystem: a room is built and on show. */
  roomShown: false,
  /** Development: freeze a dive at this point, to inspect it. */
  holdAt: null as number | null,
};

/** Seconds from the desk to inside the building. */
export const DIVE_SECONDS = 1.2;
/** How far into the dive the view starts to darken toward the room. */
export const DIVE_FADE_AT = 0.68;
