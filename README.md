# Codebase Diorama

Step inside a codebase. A real software project becomes a little city on
your desk in VR: every part of the code is a building, and you can walk into
any of them. Inside, robot workers run that part of the code. Packets of data
travel from room to room along the code's real flows. You can point at any
robot and ask it a question, out loud or with a pinch, and it answers about
the actual code.

Built with [Meta IWSDK](https://iwsdk.dev) (WebXR) for the Meta VR Start
Developer Competition. Everything works with bare hands on a Meta Quest:
point and pinch, or poke the panels with a fingertip.

## Try it

```sh
npm install
npm run dev
```

The dev server prints a network URL. Open it in the Quest browser on the same
Wi-Fi, accept the local certificate warning, and press Enter VR. On a desktop,
the managed browser runs a headset emulator.

Optional keys go in `.env.local`, which stays on your machine:

```sh
MODEL_API_KEY=LLM_...      # Meta Model API (dev.meta.ai): the robots' answers and speech recognition
OPENAI_API_KEY=sk-...      # natural robot voices; without it the browser's voice is used
```

Without a Meta key the robots still talk, using canned answers built from the
map.

## Map your own codebase with Claude Code

The `codebase-diorama` plugin teaches Claude Code to map any repository. It
reads the repo without running it and names its parts in plain English. It
describes every file, traces the main flows and notes real issues. Then it
builds the map and starts this viewer with your own key.

```sh
claude plugin marketplace add OWNER/codebase-diorama
claude plugin install codebase-diorama@codebase-diorama
```

Then, inside the repository you want to see, ask Claude Code:

```text
/codebase-diorama:map
```

You can also get the plugin as a zip from `public/downloads/codebase-diorama-plugin.zip`.
Its source is in [`plugins/codebase-diorama`](plugins/codebase-diorama).

Maps of your own code are written to `src/maps/custom/<id>.json`, which git
ignores. Open one at `/?map=<id>`, or pinch "Your code" on the start menu.

## How it is built

- `src/diorama.ts`: the tabletop city, its connections, flows and panels.
- `src/rooms/`: the walk-in rooms, their themes, props and robot workers.
- `src/agent/` and `server/`: the robots' conversations. Prompts are built on
  the server from the map, so the page never sees an API key.
- `src/guide-system.ts`, `src/menu.ts`, `src/atmosphere.ts`,
  `src/transition.ts`: the guided first visit, the start menu, the
  surroundings and the dive into a building.
- `scripts/build-map.mjs`: turns a repo plus a hand-written map into a map
  file (Floorplan's `floorplan/graph@1` format).

## Credits

- Demo codebase: [MiroFish](https://github.com/666ghj/MiroFish) (AGPL-3.0),
  mapped from a read-only snapshot. Its logo appears on the map's plaque.
- Map format: [Floorplan](https://github.com/haydenschmitty/floorplan) (MIT).
- Robot: "RobotExpressive" by Tomás Laulhé (Quaternius), CC0, via the
  three.js examples.
- Props: [Poly Haven](https://polyhaven.com), CC0. See
  `public/models/props/CREDITS.md`.
