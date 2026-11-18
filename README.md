# Walkthrough

Step inside a codebase. A real software project becomes a little city on
your desk in VR: every part of the code is a building, and you can walk into
any of them. Inside, robot workers run that part of the code. Packets of data
travel from room to room along the code's real flows. You can point at any
robot and ask it a question, out loud or with a pinch, and it answers from
a map of the code: what each file is for, what talks to what, and the flows
through it. When you think you know a room, pinch **Quiz me**: the
robot tests you on it and corrects what you get wrong.

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
- "Quiz me." (four questions about the room; pinch an answer or say it)

Moving, playing a flow, leaving and the quiz also work with no AI key at
all; the key is only needed to mark a quiz answer said in your own words.

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

## Map your own codebase with your coding agent

The `walkthrough` plugin teaches a coding agent to map any repository. It
reads the repo without running it and names its parts in plain English. It
describes every file, traces the main flows and notes real issues. Then it
builds the map and starts this viewer with your own key.

In Claude Code:

```sh
claude plugin marketplace add calebluh/walkthrough
claude plugin install walkthrough@walkthrough
```

Then, inside the repository you want to see, ask Claude Code:

```text
/walkthrough:map
```

The same skill is packaged for Codex and the ChatGPT desktop app, Cursor,
Gemini CLI, Antigravity, GitHub Copilot and others. The install line for each
is in the README of [calebluh/walkthrough](https://github.com/calebluh/walkthrough).
The packaging follows each tool's published format and has been installed
only in Claude Code so far.

## Two repositories

- **This one, [meta-start-hackathon](https://github.com/calebluh/meta-start-hackathon),**
  is the competition build. It opens on a start menu of three demo
  codebases: MiroFish, Larder, and "This app", Walkthrough's own source
  mapped by its own plugin.
- **[walkthrough](https://github.com/calebluh/walkthrough)** is the
  public viewer and the plugin for coding agents, and it is what the plugin installs.
  It has no demo menu and no MiroFish. It opens straight onto your own maps.

To preview the public edition from this repository, add `VITE_EDITION=personal`
to `.env.local`.

## How it is built

- `src/diorama.ts`: the tabletop city, its connections, flows and panels.
- `src/rooms/`: the walk-in rooms, their themes, props and robot workers.
- `src/agent/` and `server/`: the robots' conversations. Prompts are built on
  the server from the map and the lines of code a question is about, so the
  page never sees an API key.
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
