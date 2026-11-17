import { createSystem, type UIKit, type UIKitMLAsset, VisibilityState } from '@iwsdk/core';
import { click } from './audio/sound.js';
import { HACKATHON } from './edition.js';
import { CUSTOM_MAPS, MAPS } from './maps/index.js';
import { buildRepoCity, lastRepoMap, restoreRepoMap } from './maps/repo.js';
import { setPanelShown } from './panels.js';
import { app, chooseDemo, onChange } from './state.js';

/**
 * The start menu: a card per demo codebase over the desk. Pinch or poke a
 * card to open that city; the controls' Demos button brings the menu back.
 */
export class MenuSystem extends createSystem({}) {
  private shown: boolean | null = null;

  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('menu-panel');
    if (panel) {
      // The third card is this app, mapped by its own Claude skill. If that
      // skill has made a map of the user's code here, the card opens the
      // newest of those instead.
      const custom = Object.keys(CUSTOM_MAPS);
      const third = custom[0] ?? 'self';
      const cardFor = (id: string) => panel.getElementById(`card-${id === third ? 'custom' : id}`);
      const statsFor = (id: string) => (id === third ? 'custom-stats' : `stats-${id}`);
      if (custom.length) {
        const graph = CUSTOM_MAPS[custom[0]];
        const text = (id: string, value: string) => panel.getElementById<UIKit.Text>(id)?.setProperties({ text: value });
        text('custom-name', graph.project.name.slice(0, 22));
        const summary = graph.project.summary.split(/(?<=[.!?])\s/)[0] ?? '';
        text('custom-pitch', summary.length > 110 ? `${summary.slice(0, 107)}...` : summary);
        text('custom-go', custom.length > 1 ? `Tap to start (+${custom.length - 1} more via ?map=)` : 'Tap to start');
      }
      for (const id of [...Object.keys(MAPS).filter((m) => !CUSTOM_MAPS[m] && m !== 'self'), third]) {
        const card = cardFor(id);
        if (card) {
          const choose = () => {
            click();
            chooseDemo(id);
          };
          card.addEventListener('click', choose);
          this.cleanupFuncs.push(() => card.removeEventListener('click', choose));
        }
        const graph = MAPS[id];
        const lines = graph.files.reduce((n, f) => n + f.loc, 0);
        const parts = graph.nodes.filter((n) => n.kind !== 'external' && !graph.nodes.some((c) => c.parent === n.id)).length;
        panel
          .getElementById<UIKit.Text>(statsFor(id))
          ?.setProperties({ text: `${parts} rooms | ${graph.files.length} files | ${lines.toLocaleString('en-US')} lines` });
      }
    }
    if (panel) this.wireRepoChips(panel);
    // Meta VR Glasses are aimed with the eyes (gaze), not a pointing hand.
    const hint = panel?.getElementById<UIKit.Text>('menu-hint');
    if (hint) {
      this.cleanupFuncs.push(
        this.world.visibilityState.subscribe((state) => {
          if (state === VisibilityState.NonImmersive) return;
          const gaze = this.world.session?.enabledFeatures?.includes('gaze-tracking') ?? false;
          hint.setProperties({
            text: gaze
              ? 'Look at a card, then tap your thumb and finger together.'
              : 'Tap a card with a fingertip, or point at it and pinch your thumb and finger.',
          });
        }),
      );
    }
    this.cleanupFuncs.push(onChange(() => this.apply()));
    this.apply();
  }

  /**
   * GitHub repositories as cities, from inside the headset: one tap builds a
   * well-known repo's city on the server (server/repo-map.ts) and opens it.
   * Typing a repo of your own happens on the page before VR (landing.ts);
   * the last one built comes back here as its own chip.
   */
  private wireRepoChips(panel: UIKitMLAsset): void {
    if (!HACKATHON) return;
    const status = panel.getElementById<UIKit.Text>('repo-status');
    const say = (text: string) => status?.setProperties({ text });
    let busy = false;
    const open = async (repo: string, label: string) => {
      if (busy) return;
      busy = true;
      click();
      say(`Building ${label}: downloading the code and drawing the city, about 10 seconds...`);
      const result = await buildRepoCity(repo);
      busy = false;
      if ('error' in result) {
        say(`${label}: ${result.error}.`);
        return;
      }
      say('Tap one to build its city (about 10 seconds). To use your own, type it on the page before entering VR.');
      this.refreshLast(panel);
      chooseDemo(result.id);
    };
    const chips: [string, string, string][] = [
      ['repo-flask', 'pallets/flask', 'Flask'],
      ['repo-express', 'expressjs/express', 'Express'],
      ['repo-swr', 'vercel/swr', 'SWR'],
    ];
    for (const [id, repo, label] of chips) {
      const chip = panel.getElementById(id);
      if (!chip) continue;
      const onClick = () => void open(repo, label);
      chip.addEventListener('click', onClick);
      this.cleanupFuncs.push(() => chip.removeEventListener('click', onClick));
    }
    const last = panel.getElementById('repo-last');
    if (last) {
      const onLast = () => {
        const saved = lastRepoMap();
        if (!saved || busy) return;
        click();
        if (!MAPS[saved.id]) restoreRepoMap();
        if (MAPS[saved.id]) chooseDemo(saved.id);
      };
      last.addEventListener('click', onLast);
      this.cleanupFuncs.push(() => last.removeEventListener('click', onLast));
    }
    this.refreshLast(panel);
  }

  /** The last repo city built here, as a chip of its own (hidden until there is one). */
  private refreshLast(panel: UIKitMLAsset): void {
    const saved = lastRepoMap();
    panel.getElementById('repo-last')?.setProperties({ display: saved ? 'flex' : 'none' });
    if (saved) panel.getElementById<UIKit.Text>('repo-last-name')?.setProperties({ text: saved.name.slice(0, 14) });
  }

  private apply(): void {
    if (app.menu === this.shown) return;
    this.shown = app.menu;
    setPanelShown(this.world, 'menu-panel', app.menu);
  }
}
