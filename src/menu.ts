import { createSystem, type UIKit, type UIKitMLAsset } from '@iwsdk/core';
import { click } from './audio/sound.js';
import { MAPS } from './maps/index.js';
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
      for (const id of Object.keys(MAPS)) {
        const card = panel.getElementById(`card-${id}`);
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
          .getElementById<UIKit.Text>(`stats-${id}`)
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
