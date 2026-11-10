import { createSystem, type UIKit, type UIKitMLAsset } from '@iwsdk/core';
import { click } from './audio/sound.js';
import { CUSTOM_MAPS, MAPS } from './maps/index.js';
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
      // The "Your code" card opens the newest map the Claude skill made, if any.
      const custom = Object.keys(CUSTOM_MAPS);
      const cardFor = (id: string) => panel.getElementById(`card-${CUSTOM_MAPS[id] ? 'custom' : id}`);
      const statsFor = (id: string) => (CUSTOM_MAPS[id] ? 'custom-stats' : `stats-${id}`);
      if (custom.length) {
        const graph = CUSTOM_MAPS[custom[0]];
        const text = (id: string, value: string) => panel.getElementById<UIKit.Text>(id)?.setProperties({ text: value });
        text('custom-name', graph.project.name.slice(0, 22));
        const summary = graph.project.summary.split(/(?<=[.!?])\s/)[0] ?? '';
        text('custom-pitch', summary.length > 110 ? `${summary.slice(0, 107)}...` : summary);
        text('custom-go', custom.length > 1 ? `Pinch to start (+${custom.length - 1} more via ?map=)` : 'Pinch to start');
      }
      for (const id of [...Object.keys(MAPS).filter((m) => !CUSTOM_MAPS[m]), ...custom.slice(0, 1)]) {
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
        const parts = graph.nodes.filter((n) => !graph.nodes.some((c) => c.parent === n.id)).length;
        panel
          .getElementById<UIKit.Text>(statsFor(id))
          ?.setProperties({ text: `${parts} rooms | ${graph.files.length} files | ${lines.toLocaleString('en-US')} lines` });
      }
    }
    this.cleanupFuncs.push(onChange(() => this.apply()));
    this.apply();
  }

  private apply(): void {
    if (app.menu === this.shown) return;
    this.shown = app.menu;
    setPanelShown(this.world, 'menu-panel', app.menu);
  }
}
