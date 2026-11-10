---
name: map
description: Turn a codebase into a walk-in VR diorama (Codebase Diorama for Meta Quest). Use when the user asks to map, visualize, tour or "step inside" a repository in VR or on a Quest, to build a Codebase Diorama map, or runs /codebase-diorama:map. Analyzes the repo read-only, writes a map of its parts, flows and files in plain English, then runs the viewer locally so robots in each room can answer questions about the code.
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
VIEWER_REPO=https://github.com/OWNER/codebase-diorama   # set by the plugin author
VIEWER_DIR="$HOME/codebase-diorama"
if [ -d "$VIEWER_DIR/.git" ]; then git -C "$VIEWER_DIR" pull --ff-only; else git clone "$VIEWER_REPO" "$VIEWER_DIR"; fi
cd "$VIEWER_DIR" && npm install
# Personal edition: opens straight onto the user's own maps (no demo menu).
grep -qs '^VITE_EDITION=' .env.local || printf 'VITE_EDITION=personal
' >> .env.local
```

The repository also contains a competition build with bundled demo maps. The
`VITE_EDITION=personal` line switches those off, so the viewer only shows maps
you make. It is not a secret, so you may write it; never write the user's
keys.

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
   fixtures, migrations and vendored libraries) and consider splitting the
   file descriptions across parallel subagents by folder.

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

Create `$VIEWER_DIR/maps-src/<id>/map.mjs` and
`$VIEWER_DIR/maps-src/<id>/arch.json`. The exact formats, with a worked
example, are in [references/map-format.md](references/map-format.md). Read it
before writing. Start from the templates in `templates/`.

`arch.json` must cover:

- `projectSummary`: 2-3 sentences on what the product does and for whom;
- `nodeSummaries`: one or two sentences for **every** node, parents and
  externals included;
- `files`: a `{ "name", "d" }` entry for **every** included file;
- `flows`: 2-4 end-to-end journeys (a user action through to its result),
  4-8 steps each, every `ref` a real `f:<path>` or `n:<node id>`;
- `health`: 0-6 real concerns worth a visitor's attention (security,
  reliability, dead code), each with `file` and `line`;
- `routes` / `frontendCalls` for web apps, so HTTP calls link the client
  files to the server files that handle them.

## 5. Build and check

```bash
cd "$VIEWER_DIR"
node scripts/build-map.mjs <target repo path> --map maps-src/<id>/map.mjs --arch maps-src/<id>/arch.json --out src/maps/custom/<id>.json
node "${CLAUDE_PLUGIN_ROOT}/skills/map/scripts/check-map.mjs" src/maps/custom/<id>.json
npm run typecheck
```

`build-map` throws if a file matches no part; reorder or widen part globs
(most specific first). Fix everything `check-map` reports until it prints
`ok`. If `CLAUDE_PLUGIN_ROOT` is unset, use the path this skill was loaded
from.

Logo (optional): if the repo has a square PNG logo or favicon, copy it to
`public/maps/<id>/logo.png` and set `logo: 'maps/<id>/logo.png'` in
`map.mjs`, then rebuild.

## 6. Keys

The robots answer using the Meta Model API. Ask the user to create a key at
https://dev.meta.ai and add this line to `$VIEWER_DIR/.env.local` themselves
(below the `VITE_EDITION` line):

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

Tell the user how to use it, briefly: point at a building and pinch to
inspect it, pinch Step inside to enter its room, point at a robot and pinch to
talk, and say or pinch a question. A short guided tour runs on first visit.

## Updating a map

When the code changes, re-read the changed files, update `map.mjs` and
`arch.json`, and rerun step 5. The dev server reloads the map automatically.
