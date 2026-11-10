import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { DioramaSystem } from './diorama.js';
import { RoomSystem } from './rooms/room.js';
import { pickTheme } from './rooms/themes.js';
import { app, cycleMap, enterRoom, leaveRoom, nextStep, select, startFlow } from './state.js';
import { unlock } from './audio/sound.js';
import { WorkspaceSystem } from './workspace.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(WorkspaceSystem);
  world.registerSystem(DioramaSystem);
  world.registerSystem(RoomSystem);

  // Browsers allow audio only after a gesture: the first press, or entering VR.
  window.addEventListener('pointerdown', unlock);
  world.visibilityState.subscribe(() => unlock());

  // Development shortcuts for testing without a headset. Stripped from builds.
  if (import.meta.env.DEV) {
    console.log(
      '[rooms] ' +
        app.graph.nodes.map((n) => `${n.label} -> ${pickTheme(app.graph, n.id).place}`).join(' | '),
    );
    window.addEventListener('keydown', (e) => {
      if (e.key === 'i') enterRoom(app.selected ?? 'api.payments');
      if (e.key === 't') leaveRoom();
      if (e.key === 'p') startFlow();
      if (e.key === 'n') nextStep();
      if (e.key === 'o') select('api.orders');
      if (e.key === 'f') select('api.payments');
      if (e.key === 'h') select('shared');
      if (e.key === 'w') world.getSystem(RoomSystem)?.debugTalk();
      if (e.key === 'q') world.getSystem(RoomSystem)?.debugAsk(0);
      if (e.key === 'e') world.getSystem(RoomSystem)?.debugAsk(2);
      if (e.key === 'g') world.getSystem(RoomSystem)?.debugAskText('Can you take me to billing day?');
      // 1-9: jump straight into rooms of different kinds.
      const rooms = app.graph.nodes.filter((n) => !app.graph.nodes.some((c) => c.parent === n.id)).map((n) => n.id);
      const digit = Number(e.key);
      if (digit >= 1 && digit <= 9) enterRoom(rooms[digit - 1]);
      if (e.key === 'm') cycleMap();
      if (e.key === 'v') world.getSystem(RoomSystem)?.debugAskText('Tell me about your stripe calls file');
    });
  }
});
