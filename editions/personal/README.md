# Codebase Diorama

Step inside your codebase. Your project becomes a little city on your desk in
VR: every part of the code is a building, and you can walk into any of them.
Inside, robot workers run that part of the code. Packets of data travel from
room to room along the code's real flows. You can point at any robot and ask
it a question, out loud or with a pinch, and it answers about your actual
code.

Built with [Meta IWSDK](https://iwsdk.dev) (WebXR). Everything works with bare
hands on a Meta Quest: point and pinch, or poke the panels with a fingertip.

## Map your codebase with Claude Code

This repository is also a Claude Code plugin marketplace. Install the plugin:

```sh
claude plugin marketplace add calebluh/codebase-diorama
claude plugin install codebase-diorama@codebase-diorama
```

Then, inside the repository you want to see, ask Claude Code:

```text
/codebase-diorama:map
```

Claude reads the repo without running it and names its parts in plain
English. It describes every file, traces the main flows and notes real issues.
Then it clones this viewer to `~/codebase-diorama`, builds the map and starts
the viewer. The plugin's source is in
[`plugins/codebase-diorama`](plugins/codebase-diorama).

## Keys

The keys go in `.env.local` in the viewer folder. Add them yourself; the file
stays on your machine and the browser never sees them.

```sh
MODEL_API_KEY=LLM_...      # Meta Model API (dev.meta.ai): the robots' answers and speech recognition
OPENAI_API_KEY=sk-...      # optional: natural robot voices; without it the browser's voice is used
```

Without a Meta key the robots still talk, using canned answers built from the
map.

## Running it

```sh
npm install
npm run dev
```

The dev server prints a network URL. Open it in the Quest browser on the same
Wi-Fi, accept the local certificate warning, and press Enter VR. On a desktop,
the managed browser runs a headset emulator.

Your maps are written to `src/maps/custom/<id>.json`, which git ignores. Open
one at `/?map=<id>`, or use Next map on the desk to switch between them. Until
you make one, a small sample shop called Larder is shown.

## How it is built

- `src/diorama.ts`: the tabletop city, its connections, flows and panels.
- `src/rooms/`: the walk-in rooms, their themes, props and robot workers.
- `src/agent/` and `server/`: the robots' conversations. Prompts are built on
  the server from the map, so the page never sees an API key.
- `src/guide-system.ts`, `src/atmosphere.ts`, `src/transition.ts`: the guided
  first visit, the surroundings and the dive into a building.
- `scripts/build-map.mjs`: turns a repo plus a hand-written map into a map
  file (Floorplan's `floorplan/graph@1` format).

## Credits

- Map format: [Floorplan](https://github.com/haydenschmitty/floorplan) (MIT).
- Robot: "RobotExpressive" by Tomás Laulhé (Quaternius), CC0, via the
  three.js examples.
- Props: [Poly Haven](https://polyhaven.com), CC0. See
  `public/models/props/CREDITS.md`.

## License

Copyright (C) 2026 Caleb Luh.

Codebase Diorama is free software under the
[GNU Affero General Public License v3.0](LICENSE) or any later version. You
can use, change and share it. If you share a changed version, or run one as a
service other people use over a network, you must make your changed source
available under the same license.

The license covers this viewer and plugin, not the code you map with them.
The plugin only reads your repository, and the maps it writes are kept in the
viewer folder.

Contributions are welcome: open an issue or a pull request.
