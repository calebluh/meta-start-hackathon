import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { DioramaSystem } from './diorama.js';
import { RoomSystem } from './rooms/room.js';
import { pickTheme } from './rooms/themes.js';
import { app, cycleMap, enterRoom, leaveRoom, nextStep, select, startFlow } from './state.js';
import { unlock } from './audio/sound.js';
import { dive } from './transition.js';
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
      // j: freeze the next dive partway (0.35, then 0.6, then off) to inspect it.
      if (e.key === 'j') {
        dive.holdAt = dive.holdAt === null ? 0.35 : dive.holdAt < 0.5 ? 0.6 : null;
        console.log(`[dive] hold=${dive.holdAt}`);
      }
      if (e.key === 'k') {
        // Per-frame render cost, for the performance budget.
        const info = world.renderer.info;
        // Visible meshes by where they live, to see what the draw calls are.
        const counts: Record<string, number> = {};
        world.scene.traverseVisible((o) => {
          if (!(o as { isMesh?: boolean }).isMesh) return;
          let area = 'other';
          for (let p: typeof o | null = o; p; p = p.parent) {
            if (p.name.startsWith('worker:')) { area = 'workers'; break; }
            if (p.name === 'static') { area = 'room-static'; break; }
            if (p.name.startsWith('room:')) { area = 'room-dynamic'; break; }
            if (p.name === 'diorama') { area = 'diorama'; break; }
            if (/Panel$/.test(p.name)) { area = 'panels'; break; }
          }
          counts[area] = (counts[area] ?? 0) + 1;
        });
        console.log(`[perf] meshes ${JSON.stringify(counts)}`);
        console.log(
          `[perf] where=${app.mode === 'room' ? app.roomNode : 'table'} calls=${info.render.calls} tris=${info.render.triangles} geometries=${info.memory.geometries} textures=${info.memory.textures} programs=${info.programs?.length ?? '?'}`,
        );
      }
      if (e.key === 'v') world.getSystem(RoomSystem)?.debugAskText('Tell me about your stripe calls file');
    });
  }
});
