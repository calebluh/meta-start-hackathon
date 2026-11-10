# Codebase Diorama

Step inside a codebase. A real software project becomes a little city on
your desk in VR: every part of the code is a building, and you can walk into
any of them. Inside, robot workers run that part of the code. Packets of data
travel from room to room along the code's real flows. You can point at any
robot and ask it a question, out loud or with a pinch, and it answers about
the actual code.

Built with [Meta IWSDK](https://iwsdk.dev) (WebXR) for the Meta VR Start
Developer Competition. Everything works with bare hands on a Meta Quest,
sitting down: point and pinch, or poke the panels with a fingertip. On Meta
VR Glasses the desk moves to fit the narrower view, and a look and a pinch
do the same job.

## Things to say to a robot

The robots act on what you ask, so most of a visit can be done by voice:

- "What happens in this room?"
- "Take me to the kitchen." (any room, by name or by what it is)
- "Where does the money go next? Take me there."
- "Show me what happens on billing day." (plays that flow)
- "Take me back to the city."

Moving, playing a flow and leaving also work with no AI key at all.

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
claude plugin marketplace add calebluh/codebase-diorama
claude plugin install codebase-diorama@codebase-diorama
```

Then, inside the repository you want to see, ask Claude Code:

```text
/codebase-diorama:map
```

## Two repositories

- **This one, [meta-start-hackathon](https://github.com/calebluh/meta-start-hackathon),**
  is the competition build. It opens on a start menu of three demo
  codebases: MiroFish, Larder, and "This app", the diorama's own source
  mapped by its own plugin. The Devpost text, video script and a submission
  checklist are in [submission/](submission/).
- **[codebase-diorama](https://github.com/calebluh/codebase-diorama)** is the
  public viewer and the Claude Code plugin, and it is what the plugin installs.
  It has no demo menu and no MiroFish. It opens straight onto your own maps.

All work happens here. `node scripts/export-personal.mjs <folder>` writes the
public repository into a checkout of it. It leaves out the hackathon-only
files and applies the replacements in `editions/personal/`. To preview the
public edition without exporting, add `VITE_EDITION=personal` to `.env.local`.

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
