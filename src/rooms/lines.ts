import type { ThemeId } from './themes.js';

/**
 * Things a worker says instantly while the real answer is being worked out,
 * so a 2-4 second model call feels like someone thinking, not a frozen screen.
 * Each room type has its own; any room falls back to the general ones.
 */
const GENERAL = [
  'Good question. Give me a second.',
  'Hmm, let me think about that.',
  'Oh, I know this one. One moment.',
  "Let me check, I don't want to tell you wrong.",
];

const BY_THEME: Partial<Record<ThemeId, string[]>> = {
  finance: ['Let me check the ledger.', 'One sec, pulling up the receipts.', 'Hang on, let me count that up.'],
  warehouse: ['Let me check the shelves.', 'Hang on, checking the manifest.', 'One sec, let me look on the pallet.'],
  postoffice: ['Let me check the outgoing mail.', 'One moment, sorting through the sacks.'],
  archive: ['Let me pull that file.', 'Give me a second to check the records.'],
  library: ['Let me look that up.', 'One moment, checking the catalogue.'],
  switchboard: ['Let me check the lines.', 'Hold, please. Just kidding, one second.'],
  security: ['Let me check the logbook.', 'One second, checking who has access.'],
  radio: ['Stand by, checking the channels.', 'One sec, tuning in.'],
  analytics: ['Let me pull up the numbers.', 'Hmm, let me check the charts.'],
  thinktank: ['Ooh, interesting. Let me think.', 'Let me sketch that out in my head.'],
  studio: ['Let me check the contact sheet.', 'One moment, flipping through the shots.'],
  factory: ['Let me check the line.', 'Hang on, checking the work orders.'],
  lab: ['Let me check my notes.', 'One sec, running that through the scanner.'],
  controlroom: ['Let me check the dashboards.', 'One moment, pulling up the logs.'],
  utility: ['Let me check the fuse box.', 'Hang on, checking the settings sheet.'],
  storefront: ['Let me check with the front desk.', 'One moment, checking the shelves.'],
  workshop: ['Let me check the workbench.', 'Hmm, let me find the right tool for that.'],
};

let counter = 0;

/** A different reaction each time, cycling through the room's lines. */
export function thinkingLine(theme: ThemeId): string {
  const lines = [...(BY_THEME[theme] ?? []), ...GENERAL];
  counter += 1;
  return lines[counter % lines.length];
}
