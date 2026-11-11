/**
 * Things the first-run guide cannot see in the shared app state: whether the
 * visitor has talked to a worker yet and heard an answer. RoomSystem reports
 * them; GuideSystem reads them.
 */
export const guideProgress = {
  talked: false,
  asked: false,
  /** The visitor has dragged the desk with its grab bar. */
  moved: false,
  /** Development: start the guide over. */
  restart: false,
};

export function guideNote(event: 'talked' | 'asked' | 'moved'): void {
  guideProgress[event] = true;
}

export function restartGuide(): void {
  guideProgress.talked = false;
  guideProgress.asked = false;
  guideProgress.moved = false;
  guideProgress.restart = true;
}
