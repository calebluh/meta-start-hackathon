/**
 * Mixed reality: the city remembers where it stood in your real room.
 *
 * When the city is set down (on a real table, or wherever the visitor drags
 * it), a WebXR anchor is made at that spot and the headset is asked to keep it
 * (a persistent anchor: Meta's spatial anchors). Its id is kept in the
 * browser. The next time the visitor enters mixed reality the headset finds
 * the anchor again and the city goes straight back to that spot, on that
 * desk, the way it was left.
 *
 * Everything here is optional. A browser without anchors, a refused feature,
 * an anchor the headset has forgotten, or `?noanchor` on the link all leave
 * the usual table search in charge (see WorkspaceSystem).
 */

const KEY = 'diorama.deskAnchor';

interface AnchorLike {
  anchorSpace: XRSpace;
  delete?: () => void;
  requestPersistentHandle?: () => Promise<string>;
}
type AnchorSession = XRSession & {
  restorePersistentAnchor?: (uuid: string) => Promise<AnchorLike>;
  deletePersistentAnchor?: (uuid: string) => Promise<void>;
};
type AnchorFrame = XRFrame & {
  createAnchor?: (pose: XRRigidTransform, space: XRSpace) => Promise<AnchorLike>;
};

/** What is kept between visits besides the anchor itself. */
export interface SavedSpot {
  id: string;
  /** The city was standing on a real table. */
  onTable: boolean;
  /** Which way that table's edges run (world yaw), to keep the tray square when dragged. */
  axis: number;
}

export const anchorsWanted = (): boolean => !new URLSearchParams(location.search).has('noanchor');

function readSpot(): SavedSpot | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<SavedSpot> | null;
    if (!raw || typeof raw.id !== 'string') return null;
    return { id: raw.id, onTable: raw.onTable === true, axis: typeof raw.axis === 'number' ? raw.axis : 0 };
  } catch {
    return null;
  }
}

function writeSpot(spot: SavedSpot | null): void {
  try {
    if (spot) localStorage.setItem(KEY, JSON.stringify(spot));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the city just will not be remembered next time.
  }
}

export class DeskAnchor {
  private session: AnchorSession | null = null;
  /** The anchor found again from a previous visit, once the headset has it. */
  private restored: AnchorLike | null = null;
  private restoredSpot: SavedSpot | null = null;
  /** The anchor this visit made last (deleted when replaced). */
  private current: AnchorLike | null = null;
  private saving = false;
  private queued: { position: DOMPointInit; orientation: DOMPointInit; onTable: boolean; axis: number } | null = null;

  /** Whether this session can make anchors at all. */
  get enabled(): boolean {
    return !!this.session && (this.session.enabledFeatures?.includes('anchors') ?? false) && anchorsWanted();
  }

  /** A new session: start finding last visit's anchor, if there is one. */
  begin(session: XRSession): void {
    this.end();
    this.session = session as AnchorSession;
    if (!this.enabled) return;
    const spot = readSpot();
    const restore = this.session.restorePersistentAnchor;
    if (!spot || !restore) return;
    const forSession = this.session;
    restore
      .call(forSession, spot.id)
      .then((anchor) => {
        if (this.session !== forSession) {
          anchor.delete?.();
          return;
        }
        this.restored = anchor;
        this.restoredSpot = spot;
        if (import.meta.env.DEV) console.log('[anchor] found last visit\'s spot');
      })
      .catch((e: unknown) => {
        // The headset no longer knows it (another room, or cleared): forget it.
        if (import.meta.env.DEV) console.log('[anchor] could not restore:', (e as Error)?.message ?? e);
        if (this.session === forSession) writeSpot(null);
      });
  }

  /** Whether last visit's spot is saved and this session can look for it. */
  get hasSaved(): boolean {
    return this.enabled && readSpot() !== null && !!this.session?.restorePersistentAnchor;
  }

  /**
   * The restored spot's pose in `space`, with what was saved alongside it,
   * or null while it is not (yet) known. Taken once: later calls return null.
   */
  takeRestored(frame: XRFrame, space: XRReferenceSpace): { matrix: Float32Array; spot: SavedSpot } | null {
    if (!this.restored || !this.restoredSpot) return null;
    const pose = frame.getPose(this.restored.anchorSpace, space);
    if (!pose) return null;
    const spot = this.restoredSpot;
    this.current = this.restored;
    this.restored = null;
    this.restoredSpot = null;
    return { matrix: pose.transform.matrix, spot };
  }

  /** Forgets a restored spot that was not used (out of reach, or the visitor moved first). */
  dropRestored(): void {
    this.restored = null;
    this.restoredSpot = null;
  }

  /**
   * Remembers this spot: `position` and `orientation` are in the session's
   * reference space. Saves run one at a time; the newest request wins.
   */
  save(frame: XRFrame, space: XRReferenceSpace, position: DOMPointInit, orientation: DOMPointInit, onTable: boolean, axis: number): void {
    if (!this.enabled) return;
    if (this.saving) {
      this.queued = { position, orientation, onTable, axis };
      return;
    }
    const create = (frame as AnchorFrame).createAnchor;
    if (!create) return;
    this.saving = true;
    const session = this.session;
    let made: Promise<AnchorLike>;
    try {
      made = create.call(frame, new XRRigidTransform(position, orientation), space);
    } catch {
      this.saving = false;
      return;
    }
    made
      .then(async (anchor) => {
        if (this.session !== session) {
          anchor.delete?.();
          return;
        }
        const before = this.current;
        this.current = anchor;
        before?.delete?.();
        if (!anchor.requestPersistentHandle) return;
        const id = await anchor.requestPersistentHandle();
        const old = readSpot();
        writeSpot({ id, onTable, axis });
        if (old && old.id !== id) await this.session?.deletePersistentAnchor?.(old.id).catch(() => undefined);
        if (import.meta.env.DEV) console.log(`[anchor] spot saved${onTable ? ' on the table' : ''}`);
      })
      .catch((e: unknown) => {
        if (import.meta.env.DEV) console.log('[anchor] could not save:', (e as Error)?.message ?? e);
      })
      .finally(() => {
        this.saving = false;
        const next = this.queued;
        this.queued = null;
        // A newer spot asked for while this one saved: save that one with the next frame.
        if (next) this.pendingSave = next;
      });
  }

  /** A save requested while another was running, made on the next frame (createAnchor needs a live frame). */
  pendingSave: { position: DOMPointInit; orientation: DOMPointInit; onTable: boolean; axis: number } | null = null;

  end(): void {
    this.restored = null;
    this.restoredSpot = null;
    this.current = null;
    this.queued = null;
    this.pendingSave = null;
    this.saving = false;
    this.session = null;
  }
}
