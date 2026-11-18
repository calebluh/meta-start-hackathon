# Submitting Walkthrough

Entries close **Wednesday 18 November 2026 at 12:00 PM Pacific**. After that
the app and the Devpost page must not change, and the link must stay up and
free until winners are announced (around 11 December).

Do these in order. Each one names what is already done and what needs you.

## 1. Put it on a public link (about 10 minutes)

The code is ready and pushed. Only you can create the Vercel project,
because it needs your login and your API key.

1. Go to https://vercel.com/new and pick the team **schmalebloo's projects**.
2. Import `calebluh/meta-start-hackathon`. Name the project
   `codebase-diorama`. Leave every build setting as detected (Vite).
3. Before pressing Deploy, open **Environment Variables** and add:
   - `MODEL_API_KEY`: your Meta Model API key (the same one as in
     `.env.local`). Without it the robots still answer, from the map, but
     not with the model.
   - `OPENAI_API_KEY` (optional): gives the robots their better voices.
     Without it they use the browser's built-in voice.
4. Press **Deploy**.
5. In the project, open **Settings, Deployment Protection** and make sure
   the production address does not ask for a Vercel login. If it does, turn
   **Vercel Authentication** off.
6. Open `https://diorama.calebluh.com` (or the address Vercel gives
   you) in a private browser window. You should see the landing page with
   **Enter VR**.

Then check the four server functions from a terminal. Replace the address if
yours differs:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://diorama.calebluh.com/
curl -s https://diorama.calebluh.com/api/tts
curl -s -X POST https://diorama.calebluh.com/api/agent \
  -H 'Content-Type: application/json' \
  -d '{"mapId":"larder","nodeId":"api.payments","persona":{"name":"Eli","role":"cashier","place":"cashier office"},"question":"Take me to the kitchen.","history":[]}'
```

The first prints `200`. The last returns JSON with an `answer` and an
`actions` list holding `go_to_room`. If it returns `MODEL_API_KEY is not
set`, add the key in step 3 and redeploy.

Set a spending limit on both API accounts before sharing the link. The
server limits each visitor to 20 questions a minute and all visitors to 4000
a day, but a limit on the account is the real safety net.

## 2. Try it on a headset (about 20 minutes)

Nothing so far has run on a real headset: all testing was in the IWSDK
emulator. This is the most important step left.

1. Open the public link in the Quest Browser. Put the controllers down.
2. Go through the judge steps in [devpost.md](devpost.md) exactly as written.
   Three things are new since the last headset run and have only been seen
   in the emulator, so look at them first:
   - **Mixed reality on a real table.** Scan the room once (Settings,
     Environment setup), sit at a desk and pinch Mixed reality. The headset
     may ask to share the room's layout: allow it. The city should stand on
     the desk, square with its edge. If the page will not start, open the
     link with `?noplanes` on the end (it skips the room request) and tell
     Claude what happened.
   - **The city remembers its spot (new, 17 Nov evening).** Still in mixed
     reality, drag the city by its grab bar to another spot on the desk.
     Leave (Quest menu, Exit), pinch Mixed reality again: the city should
     come back to that exact spot, with "Back where you left it" over it for
     six seconds. If mixed reality will not start, try the link with
     `?noanchor` on the end and tell Claude. If it misbehaves, roll back
     (see the end of this file).
   - **Your own repository (new, 17 Nov night).** On the Quest Browser page,
     before entering, type a public GitHub repository (try one of yours) in
     the box under the buttons and press Build city, or tap Flask. After
     about ten seconds it says the city is ready; Enter VR should open that
     city. Pick a building, step inside, ask a robot: it should talk about
     that repository's real files. Check that typing with the Quest keyboard
     is comfortable. Then, in VR, tap Demos: the menu has Flask, Express and
     SWR chips and one with your repo; each should open its city.
   - **Review and work order (new, 17 Nov evening).** In any city tap Notes,
     pinch the note taker, then tap **Review this project for me**. Within
     about ten seconds three to five tasks should appear on the panel and
     the wall and she sums them up. Exit VR: the page should show "Your work
     order", **Open as a GitHub issue** (not for MiroFish) and **Copy for
     your coding agent**. Check the copy button works in the Quest Browser;
     if it cannot reach the clipboard it shows the text to select instead.
   - **Your own repository through the plugin (new, 17 Nov evening).** This
     is the product: not the public link. In your repo, run the plugin's map
     command in your coding agent. It writes the map into a `walkthrough/`
     folder in that repo (`map.mjs`, `arch.json`, `graph.json`, a README)
     and starts the viewer. Notes you make in VR, and the note taker's
     review, appear in `walkthrough/notes.md` as you make them, grouped by
     part with a count on top. The folder ignores itself, so `git status`
     should not list it. Then ask the agent to work through your notes.
   - **Code cards, and bubbles that keep clear (new, 17 Nov late evening).**
     In Larder, step into any room, pinch a robot and say "show me the
     code". A card of code should pop up to the right of the robot's speech
     bubble, coloured like an editor, touching nothing; the room's info
     panel steps aside while it is up and comes back after. In Endpoints say
     "show me the refund endpoint": the handler, with line 88 lit. On a long
     file say "show me more". Check the code is big enough to read in your
     headset and tell Claude if it is not (one number sets its size). Then
     look at the sign on the far wall and the plaques behind you: flat on
     the wall, no corner sunk into it, none overlapping. In Street view the
     tour card should sit low, just behind the buttons, and the Turn buttons
     should stay off the info panel.
   - **The roof.** Pinch a building: the roof lifts, small robots stand
     inside, and a **Step inside** button floats over it. Pinch the button.
   - **Reaching for a building.** Put your fingers right on a building and
     pinch quickly. It should be picked, and the city should not move.
3. Note anything that is hard to pinch, too small to read, or out of reach
   from a chair, and how smooth it feels in the city and in a room.
4. To see the frame rate: Quest menu, Settings, Developer, turn on the
   performance overlay (or use OVR Metrics Tool). The competition asks for at
   least 60 frames a second. Write the number you see into the
   **Frame rate** line of `devpost.md`, or delete that line.

The competition says entries must run on Quest 3 or 3S, and judges will use
those. The app uses nothing that only a Quest 3 has, so a Quest 2 is a fair
test of hands, reach and reading size, and a harder test of frame rate. If
you can borrow a Quest 3 or 3S for ten minutes, do. Whatever you test on,
only claim in the entry what you saw.

## 3. Record the video (about 1 hour)

Follow [video-script.md](video-script.md). Under 3 minutes, real headset
footage, public on YouTube or Vimeo.

## 4. Fill in the Devpost page (about 20 minutes)

Everything is written in [devpost.md](devpost.md). Search it for `FILL IN`:

- the public link,
- the video link,
- the frame rate line,
- the target launch date.

Upload the pictures in [screenshots/](screenshots/). They were captured in
the emulator; replace any of them with headset captures if you have better
ones. `02`, `03`, `05`, `08` and `09` show the city as it looks now (`08` is
the lifted roof, `09` the city on a real desk in the emulator's room, with
the emulator's outlined hands). `01`, `04`, `06` and `07` are from before and
still match: the menu and the rooms did not change.

Two things to decide while you paste:

- **"I" or "we".** The text says "I". Change it if you are entering as a
  team.
- **AI tools.** The text says the app was developed with Claude Code as a
  pair programmer. Check the competition's rules on AI assistance and keep
  or reword that sentence to match them.

## 5. Before you press Submit

- [ ] The public link opens in a private window with no login.
- [ ] `calebluh/meta-start-hackathon` is public, or judges have access, if
      the form asks for source.
- [x] `calebluh/codebase-diorama` is licensed AGPL-3.0-or-later. The
      competition repo has no licence on purpose: visible to judges, not
      for reuse.
- [ ] The video is set to public and is under 3:00.
- [ ] Every `[FILL IN ...]` in `devpost.md` is filled in or deleted,
      including the one about the real table in mixed reality.
- [ ] Track is **Productivity**, division is **New Experience**.
- [ ] Submitted before 12:00 PM Pacific on 18 November. Do not push to
      `main` after that: Vercel redeploys on every push.

## Rolling back the 17 November evening changes

The build before the "persistent anchor" work is tagged `safe-2026-11-17`.
If the new build misbehaves on the headset, undo the two anchor commits and push.
That redeploys the judged link in about a minute:

```bash
git revert --no-edit 0332232 6d07a17
git push
```

Or, without git: in Vercel, open the project, Deployments, find the
deployment of commit `c17d434`, and choose **Promote to Production** (instant
rollback).

### Rolling back the GitHub repository cities

If the repo box misbehaves, undo it alone (the anchor stays):

```bash
git revert --no-edit c9cd343 3e11a70 a54cf48 5df1dbb 88b3290 a985c1b a50d624
git push
```

Then take it out of `devpost.md`: the "Optional, and the best part" note in
testing step 3, the sentence "Any public GitHub repository: type its name..."
under What it does, the "Any repository, on the spot" bullet, and "GitHub
(public repositories)" under Built with. In `video-script.md`, put the 0:08
row back to: a wall of code in an editor, then back to the city, with the
voice-over "Joining a project means weeks of reading. But people don't learn
places by reading. They walk around, and they ask someone who works there."

### Rolling back the review and work order

```bash
git revert --no-edit 82d6a2d
git push
```

Then take out of `devpost.md` testing step 12 and the bullet "A review, and
a work order to leave with".

### Rolling back the code cards and the bubble placement

Both commits touch the same room code, so undo them together, newest first:

```bash
git revert --no-edit c020c5c 937e3ef
git push
```

That brings back the old file card (which could sit across a speech bubble)
and takes Larder's sample code away. Then take out of `devpost.md` the "Show
me the code" line in testing step 6, the bullet "The code itself", and the
words "with sample code written to match its map".

### Rolling back the walkthrough/ folder

Local and plugin use only; the public link does not use it.

```bash
git revert --no-edit b99552e
git push
```

### Rolling back the anchor

If you roll back, also take the anchor out of `devpost.md` before pasting it:
testing step 11, the sentences from "It also remembers that spot" to "Back
where you left it", the "Remembering the spot" bullet, the last clause of
"Passthrough with a purpose" ("and it is anchored there..."), and "WebXR
Anchors (persistent)" under Built with. In `video-script.md`, put back the
2:32 row: Menu, the "This app" card, then its city. Voice-over: "It maps any
repository. This one is Walkthrough's own source code."

If mixed reality starts but the city does not come back to its spot, try
once more after a few seconds in the room (the headset can be slow to find an
anchor) before rolling back. The anchor is optional: the rest of the app
works the same either way.
