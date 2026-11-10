# Submitting Codebase Diorama

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
6. Open `https://codebase-diorama.vercel.app` (or the address Vercel gives
   you) in a private browser window. You should see the landing page with
   **Enter VR**.

Then check the four server functions from a terminal. Replace the address if
yours differs:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://codebase-diorama.vercel.app/
curl -s https://codebase-diorama.vercel.app/api/tts
curl -s -X POST https://codebase-diorama.vercel.app/api/agent \
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
ones.

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
- [ ] `calebluh/codebase-diorama` has a licence file if you want others to
      use the plugin (MIT is the usual choice).
- [ ] The video is set to public and is under 3:00.
- [ ] Track is **Productivity**, division is **New Experience**.
- [ ] Submitted before 12:00 PM Pacific on 18 November. Do not push to
      `main` after that: Vercel redeploys on every push.
