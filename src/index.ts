import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { DioramaSystem } from './diorama.js';
import { RoomSystem } from './rooms/room.js';
import { pickTheme } from './rooms/themes.js';
import { MAPS } from './maps/index.js';
import { app, chooseDemo, cycleMap, enterRoom, leaveRoom, nextStep, select, startFlow } from './state.js';
import { stopSpeaking } from './agent/client.js';
import { warmVoice } from './agent/voice.js';
import { pauseAudio, resumeAudio, unlock } from './audio/sound.js';
import { isPaused, onPause, setPaused } from './pause.js';
import { dive } from './transition.js';
import { AtmosphereSystem } from './atmosphere.js';
import { GuideSystem } from './guide-system.js';
import { landingFailed, landingReady } from './landing.js';
import { MenuSystem } from './menu.js';
import { restartGuide } from './guide.js';
import { WorkspaceSystem } from './workspace.js';

// Eye tracking is only for Meta VR Glasses (open with ?gaze). Asking for it
// crashes the Quest 2 browser at page load, and Quest has no eye tracking.
// ?nooffer stops the browser's own Enter VR prompt (for troubleshooting).
const params = new URLSearchParams(location.search);
const options = { ...projectOptions } as typeof projectOptions;
if (options.xr) {
  const xr = { ...options.xr, features: { ...options.xr.features } };
  if (!params.has('gaze')) delete (xr.features as Record<string, unknown>).gazeTracking;
  if (params.has('nooffer')) xr.offer = 'none';
  options.xr = xr;
}

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  options,
).then((world) => {
  world.registerSystem(WorkspaceSystem);
  world.registerSystem(DioramaSystem);
  world.registerSystem(RoomSystem);
  world.registerSystem(GuideSystem);
  world.registerSystem(AtmosphereSystem);
  world.registerSystem(MenuSystem);

  // A link straight to one map (the Claude skill prints one) skips the menu.
  const wanted = new URLSearchParams(location.search).get('map');
  if (wanted && MAPS[wanted]) chooseDemo(wanted);

  // A Quest 2 has about a third of a Quest 3's graphics power: draw slightly
  // fewer pixels there so turning the head stays smooth.
  if (/Quest 2/.test(navigator.userAgent)) world.renderer.xr.setFramebufferScaleFactor(0.85);

  // Browsers allow audio only after a gesture: the first press, or entering VR.
  window.addEventListener('pointerdown', unlock);
  // A pinch in VR counts as a gesture too. This matters when the visitor
  // entered through the browser's own Enter VR prompt, not the page button.
  world.renderer.xr.addEventListener('sessionstart', () => {
    world.renderer.xr.getSession()?.addEventListener('selectstart', unlock);
  });

  // Pause cleanly. In VR that is the headset coming off or the system menu
  // opening over the app; outside VR it is the browser tab going to the
  // background. Nothing talks, listens or hums until the visitor is back.
  const updatePaused = () => {
    const state = world.visibilityState.peek();
    setPaused(state === VisibilityState.NonImmersive ? document.hidden : state !== VisibilityState.Visible);
    unlock();
  };
  world.visibilityState.subscribe(updatePaused);
  document.addEventListener('visibilitychange', updatePaused);
  onPause((paused) => {
    if (import.meta.env.DEV) console.log(`[pause] ${paused}`);
    if (paused) {
      stopSpeaking();
      pauseAudio();
    } else resumeAudio();
  });

  // Find out now whether natural voices are available, not at the first hello.
  warmVoice();

  void landingReady(world);

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
      if (e.key === 'a') select('admin');
      if (e.key === 'w') world.getSystem(RoomSystem)?.debugTalk();
      if (e.key === 'q') world.getSystem(RoomSystem)?.debugAsk(0);
      if (e.key === 'e') world.getSystem(RoomSystem)?.debugAsk(2);
      if (e.key === 'g') world.getSystem(RoomSystem)?.debugAskText('Can you take me to billing day?');
      // 1-9: jump straight into rooms of different kinds.
      const rooms = app.graph.nodes.filter((n) => !app.graph.nodes.some((c) => c.parent === n.id)).map((n) => n.id);
      const digit = Number(e.key);
      if (digit >= 1 && digit <= 9) enterRoom(rooms[digit - 1]);
      if (e.key === 'm') cycleMap();
      if (e.key === 'u') restartGuide();
      // z: pretend the headset came off (and again: back on).
      if (e.key === 'z') setPaused(!isPaused());
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
      if (e.key === 'b') world.getSystem(RoomSystem)?.debugAskText('Thanks, can you take me back to the city?');
      if (e.key === 'y') world.getSystem(RoomSystem)?.debugAskText('Show me what happens on billing day.');
      // Quiz: l starts or stops it, r pinches the right answer, x a wrong one,
      // c and d answer out loud (a paraphrase for the model to mark, and "quiz me").
      if (e.key === 'l') world.getSystem(RoomSystem)?.debugQuiz();
      if (e.key === 'r') world.getSystem(RoomSystem)?.debugQuizAnswer(true);
      if (e.key === 'x') world.getSystem(RoomSystem)?.debugQuizAnswer(false);
      if (e.key === 'c') world.getSystem(RoomSystem)?.debugHear('I think it takes the card payments and gives refunds');
      if (e.key === 'd') world.getSystem(RoomSystem)?.debugHear('ok quiz me');
    });
  }
}).catch((error) => {
  console.error(error);
  landingFailed();
});
