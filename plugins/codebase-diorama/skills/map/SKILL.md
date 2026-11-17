---
name: map
description: Turn a codebase into a walk-in VR diorama (Codebase Diorama for Meta Quest). Use when the user asks to map, visualize, tour or "step inside" a repository in VR or on a Quest, to build a Codebase Diorama map, or runs /codebase-diorama:map. Analyzes the repo read-only, writes a map of its parts, flows and files in plain English, then runs the viewer locally so robots in each room can answer questions about the code. Needs a shell with git and Node 20+ on the user's own machine.
---

# Codebase Diorama: map a repo

Codebase Diorama shows a codebase as a little city on a desk in VR. Each part
of the code is a building; step inside one and it becomes a themed room where
robot workers run that part and answer questions about it, powered by the
user's own Meta Model API key. Packets travel between rooms along the code's
real flows.

Your job: understand the target repository well enough to explain it to a
non-programmer, write that understanding as a map, build it, and launch the
viewer. The analysis is the product: the robots can only be as good as the
descriptions you write.

## Ground rules

- **Read the target repo; never run it.** No installs, builds, tests or
  scripts from the target. Reading files and `git` metadata is fine.
- **The user's keys never pass through the chat.** Ask them to paste keys
  into `.env.local` themselves.
- **Plain English.** Names of 2-4 words, one-sentence descriptions, no jargon
  a curious non-programmer would trip on. Say what a part *does for the
  user*, not how it is implemented.
- **Be accurate.** Every flow step and health note must point at real code
  you have read. Do not invent features.

## 1. Set up the viewer

The viewer is an open-source WebXR app (Meta IWSDK). Keep one copy in the
user's home directory and reuse it:

```bash
VIEWER_REPO=https://github.com/calebluh/codebase-diorama
VIEWER_DIR="$HOME/codebase-diorama"
if [ -d "$VIEWER_DIR/.git" ]; then git -C "$VIEWER_DIR" pull --ff-only; else git clone "$VIEWER_REPO" "$VIEWER_DIR"; fi
cd "$VIEWER_DIR" && npm install
```

Requires Node 20+ and git. If either is missing, tell the user what to install
and stop.

## 2. Survey the target repo

Default target: the current working directory. Confirm it with the user if it
is ambiguous. Build a picture before writing anything:

1. `git ls-files` (or a directory walk skipping `node_modules`, build output
   and vendored code). Count files per top-level folder and language.
2. Read the README, package manifests (`package.json`, `pyproject.toml`,
   `go.mod`, ...), entry points, routing tables and config.
3. Read every source file you will include, at least skimming. For repos over
   ~300 source files, map the product code only (skip generated code,
   fixtures, migrations and vendored libraries). If you can hand work to
   subagents, consider splitting the file descriptions across them by folder.

Pick a map id: the repo name in lowercase kebab-case, e.g. `acme-shop`.

## 3. Choose the parts

Group the code into **6 to 20 leaf parts** under **2 to 5 parents**
(e.g. `web`, `api`, `jobs`), plus `external` nodes for outside services the
code talks to (payment provider, LLM API, database service). A good part is
something a visitor can name: "Checkout", "Billing day", "Search index".
Every included file must belong to exactly one part.

Kinds (they set the building colour and room theme): `ui`, `service`,
`worker`, `library`, `feature`, `data`, `config`, `test`, `script`, `infra`,
`external`, `misc`. The room theme is also inferred from the label, so honest
labels like "Payments", "Inventory" or "Email" get fitting rooms.

## 4. Write the two map files

Run `mkdir -p "$VIEWER_DIR/maps-src/<id>"`, then create `map.mjs` and
`arch.json` in that folder. The exact formats, with a worked
example, are in [references/map-format.md](references/map-format.md). Read it
before writing. Start from the templates in `templates/`. (Both sit beside
this file. If you were given this file on its own, they are also in the
viewer, under `$VIEWER_DIR/plugins/codebase-diorama/skills/map/`.)

`arch.json` must cover:

- `projectSummary`: 2-3 sentences on what the product does and for whom;
- `nodeSummaries`: one or two sentences for **every** node, parents and
  externals included;
- `files`: a `{ "name", "d" }` entry for **every** included file;
- `flows`: 2-4 end-to-end journeys (a user action through to its result),
  4-8 steps each, every `ref` a real `f:<path>` or `n:<node id>`, every
  `note` one sentence of at most about 120 characters (it is shown on a
  small card and read out loud);
- `health`: 0-6 real concerns worth a visitor's attention (security,
  reliability, dead code), each with `file` and `line`;
- `routes` / `frontendCalls` for web apps, so HTTP calls link the client
  files to the server files that handle them. Links the builder cannot see
  for itself (a WebSocket, a queue, a file one part writes and another
  reads) go in `extraLinks` in `map.mjs`.

In `map.mjs`, leave out `license` when the repo has no license file, and
leave out `source` altogether for a private repo the user does not want
named on screen.

## 5. Build and check

```bash
cd "$VIEWER_DIR"
node scripts/build-map.mjs "<target repo path>" --map maps-src/<id>/map.mjs --arch maps-src/<id>/arch.json --out src/maps/custom/<id>.json
node plugins/codebase-diorama/skills/map/scripts/check-map.mjs src/maps/custom/<id>.json
npm run typecheck
```

`build-map` throws if a file matches no part; reorder or widen part globs
(most specific first). Fix everything `check-map` reports until it prints
`ok`. (The checker ships inside the viewer, so that path works from
`$VIEWER_DIR` whichever agent you are.)

Logo (optional): if the repo has a square PNG logo or favicon, copy it to
`public/maps/<id>/logo.png` and set `logo: 'maps/<id>/logo.png'` in
`map.mjs`, then rebuild. With no logo, leave the line out: the viewer draws
a plain badge instead.

## 6. Keys

The robots answer using the Meta Model API. Ask the user to create a key at
https://dev.meta.ai and add this line to `$VIEWER_DIR/.env.local` themselves:

```
MODEL_API_KEY=LLM_...
```

Without a key the robots still talk, from canned answers built from your
descriptions. Optional: `OPENAI_API_KEY=...` gives each robot a natural voice
(otherwise the browser's built-in voice is used).

## 7. Launch

```bash
cd "$VIEWER_DIR" && npm run dev
```

This starts the server and opens a browser with a headset emulator. Then:

- **On a Quest:** run `npx @iwsdk/cli dev status` and use a URL from
  `runtimeUrls.network`, adding `?map=<id>`, e.g.
  `https://192.168.1.20:8081/?map=acme-shop`. The Quest must be on the same
  Wi-Fi. Accept the certificate warning (it is the local development
  certificate), then press Enter VR.
- **On the desktop:** open `https://localhost:8081/?map=<id>`.

Without `?map=` the viewer opens the user's first map; the Next map button on
the desk's control strip switches between their maps.

Tell the user how to use it, briefly: point at a building and pinch, and
its roof lifts to show the robots inside; pinch Step inside, over the
building, to enter its room; point at a robot and pinch to talk, and say or
pinch a question. Mixed reality stands the city on their real desk. A short
guided tour runs on first visit.

## Updating a map

When the code changes, re-read the changed files, update `map.mjs` and
`arch.json`, and rerun step 5. The dev server reloads the map automatically.

## Notes from the headset

In the headset the user talks ideas over in the Notes room, and the robots
put fixes they suggest on the same list. The viewer writes that list to
`$VIEWER_DIR/notes/<id>.md`, one checklist line per note:

```
- [ ] Return a short error instead of the full traceback in simulation.py, report.py and graph.py. _(Endpoints, talked over, 2026-11-17 02:14)_
```

The part of the app in brackets (here Endpoints) is where the note was made
or what it names. When the user asks you to work through their notes (or
runs this skill and a notes file exists for the map):

1. Read the file and show the open items (`- [ ]`) as a short numbered list.
   Ask which to do; do not start on all of them unasked.
2. For each one chosen: treat it as a suggestion, not a spec. A robot's fix
   is drawn from the map alone (it has not seen the code), so check it
   against the real code first and say plainly if it is wrong or already
   done. Then make the change in the target repo as you normally would.
3. Tick the line (`- [ ]` to `- [x]`) once the change is in. The viewer
   keeps ticked lines ticked when it next writes the file.
4. Update the map for the files you changed (see Updating a map) so the
   city shows the change; a fix that clears a health warning should remove
   that warning from `arch.json`. While the viewer runs, the rebuilt map
   reaches the headset in place: the user stays in VR and the parts you
   changed glow.

To watch you work from inside the headset, the user can open
`https://localhost:8081/share` on this computer and share the terminal
window: it appears on a monitor behind the city. Mention this when they
ask you to work through the notes with the headset on.
