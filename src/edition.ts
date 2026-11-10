/**
 * Which edition of the viewer this is.
 *
 * - `hackathon` (default): the competition build. It opens on a start menu of
 *   demo codebases, including MiroFish.
 * - `personal`: what the Codebase Diorama Claude plugin sets up on someone's
 *   machine (VITE_EDITION=personal in .env.local). No menu and no MiroFish:
 *   it opens straight onto their own maps.
 *
 * Read defensively: outside Vite (a Vercel function) import.meta.env does not
 * exist, and those only serve the hackathon build.
 */
function readEdition(): string {
  try {
    return import.meta.env.VITE_EDITION ?? 'hackathon';
  } catch {
    return 'hackathon';
  }
}

export const HACKATHON = readEdition() !== 'personal';
