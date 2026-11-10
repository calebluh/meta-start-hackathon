# Devpost entry: Codebase Diorama

Paste each part into the matching Devpost field. Everything marked
`[FILL IN ...]` needs you before submitting; nothing else does.

## Short fields

| Field | Value |
| --- | --- |
| Project name | Codebase Diorama |
| Tagline | Step inside a codebase. Software becomes a little city on your desk: pinch a building, walk in, and ask the robots who run it how it works. Hands and voice only. |
| Track | Productivity |
| Division | New Experience |
| Special prize (if the form asks for one) | Best Agentic Interaction |
| Public link | `[FILL IN: https://codebase-diorama.vercel.app, or whatever Vercel gives you]` |
| Demo video | `[FILL IN: YouTube or Vimeo link, public, under 3 minutes]` |
| Source code | https://github.com/calebluh/meta-start-hackathon (competition build), https://github.com/calebluh/codebase-diorama (public viewer and Claude Code plugin) |
| Built with | IWSDK, WebXR, three.js, TypeScript, Vite, UIKit, Meta Model API, Web Audio, Vercel, Claude Code |

## Testing instructions (for the judges)

1. On a Meta Quest 3 or 3S, open the public link in the Quest Browser.
2. Put the controllers down. Everything is done with bare hands.
3. Pinch **Allow microphone** if you would like to talk to the robots out
   loud (optional: every question can also be pinched from a list), then
   pinch **Enter VR**.
4. Stay seated. A desk appears in front of you with three cards. Pinch or
   poke **Larder**, the small one, for a first visit.
5. Follow the card that floats above the desk. It teaches one thing at a
   time and takes about three minutes: pinch a building, step inside, pinch a
   robot, ask it something.
6. Things worth saying to a robot:
   - "What happens in this room?"
   - "Take me to the kitchen."
   - "Show me what happens on billing day."
   - "Take me back to the city."
7. If the desk is ever in the wrong place, pinch **Recenter**.

No account, no install and no payment. The whole visit fits in ten minutes.
On a computer, the same link shows a flat preview you can click through.

## About the project

### Inspiration

Joining a codebase is like moving to a city with no map. The knowledge is
all there, but it is spread over thousands of files, and the only way in is
to read. People do not learn places by reading. They learn them by walking
around, and by asking someone who works there.

So the question was: what if a codebase really was a place? Small enough to
see whole on a desk, big enough to walk into, and staffed by people you can
simply ask.

### What it does

Codebase Diorama turns a real software project into a little city on your
desk.

- **The city.** Every part of the code is a building, sized by how much code
  it holds and joined to the parts it talks to. Pinch a building and a panel
  says, in plain English, what that part does, which files it holds and what
  is wrong with it.
- **The flows.** Pinch **Play flow** and a packet of data travels from
  building to building along a real path through the code, such as a first
  order in a shop, while each step is read aloud.
- **The rooms.** Pinch **Step inside** and the building grows around you
  until you are standing in it. Each room looks like the real-world place
  that does the same job: payments is a cashier's office, storage is a
  warehouse, messaging is a post office. Robots work there.
- **The robots.** Pinch a robot, or just talk. It answers about the actual
  code in its room, in its own voice, and it acts on what you ask: it walks
  you to another room, plays a flow, points at the pipe that leads next
  door, hands you a card about a file, or takes you back to the city.
- **Your own code.** A Claude Code plugin maps any repository into a city.
  The third demo, **This app**, is the diorama's own source code, mapped by
  that plugin.

The public link opens on three codebases: MiroFish (an open-source
prediction engine), Larder (a small meal-kit shop) and this app itself.

### How it was built

It is a WebXR app built with Meta's Immersive Web SDK (IWSDK) in TypeScript,
so it runs from a link in the Quest Browser with nothing to install.

- **Map.** A codebase is described by one map file: its parts, how they
  connect, the main flows and any health notes. The Claude Code plugin writes
  that file by reading a repository without running it. The city, the rooms,
  the robots' names and jobs, and every answer are generated from the map.
- **City and rooms.** Buildings, rooms and props are built in code from
  simple shapes, with a few CC0 models. Sound is all synthesized in the
  browser and placed in 3D, so a till rings from where the till stands.
- **Robots.** Answers come from Meta's Model API. The server writes the
  prompt itself from the map and the room, so a robot only knows its own
  room and the directory of the building, and its tools are real actions in
  the world. Speech recognition streams through Meta's realtime
  transcription, so your words appear as you say them and a turn ends half a
  second after you stop. API keys stay on the server.
- **Without the AI.** If the model cannot be reached, the robots answer from
  the map instead, and asking to leave still works. The experience never
  stops on a network error.
- **Hosting.** A static site plus four small server functions on Vercel,
  each rate limited.

Development was done with Claude Code as a pair programmer.

### Designed for hands, a seat and a narrow view

- **Hands only.** Every action is a pinch on something you point at, or a
  fingertip poke on a panel. The landing page's buttons are large enough to
  pinch in the Quest Browser, and the microphone prompt is answered there,
  before the session starts, instead of in the middle of a conversation.
- **Voice as a second way in.** Anything a pinch can do inside a room can
  also be said: ask a question, change room, play a flow, leave.
- **Seated and still.** The desk places itself within arm's reach of wherever
  you are sitting, and stays put. Rooms come to you: there is no walking and
  no turning. Everything is inside a two-foot reach.
- **Narrow views.** On Meta VR Glasses the app detects gaze tracking and
  moves the desk farther away and a little higher, so the city, its buttons
  and the side panel fit in one look, and every target works with a look and
  a pinch. This was checked in the IWSDK glasses emulator and has not yet
  been run on glasses hardware.
- **A first five minutes without a wall of text.** One floating card, one
  short line at a time, and an arrow on the thing to pinch. Each step
  finishes when you do it.
- **Pause and resume.** Take the headset off or open the Quest menu and the
  robots stop talking, the microphone closes and the sound stops. Put it
  back on and it carries on where it was.
- **Frame rate.** `[FILL IN after testing on a headset: for example "Holds
  72 fps on Quest 3 in the city and in rooms." Delete this bullet if you
  could not measure it.]`

### Challenges

- **Hand input is noisy.** One pinch often arrives twice, which made buttons
  start and stop at once and buildings select and deselect. Every control now
  ignores a repeat that arrives too soon.
- **A robot that talks has to stay visible.** Side panels, a speech bubble
  and the guide card all want the same space in front of you. The robot now
  walks to a spot between the panels, and the card drops to the desk.
- **Keeping an open microphone honest.** The robot's own voice must never be
  heard as your next question, so the microphone sends silence while a robot
  is speaking.
- **A public link that spends real credits.** The page never sends a prompt.
  It names a room, the server builds the prompt, and every input is capped,
  so the link cannot be used as a free chatbot.

### What I am proud of

- You can learn how an unfamiliar codebase works without reading a line of
  it, and without touching a controller.
- The robots do things. Asking "where does the money go next?" gets you
  walked there.
- It maps itself: the app's own code is one of the demos.

### What is next

- Live cities: watch a repository and rebuild the city as the code changes,
  with open pull requests shown as building sites.
- Guided tours: a teammate records a walk through the code for a new joiner.
- Two people at the same desk.
- Testing and tuning on Meta VR Glasses hardware.
- More room themes, more languages, and a high-contrast mode.

### Target launch date

`[FILL IN. Suggestion: "January 2027 as a free web app at the public link,
with mapping of your own code through the Claude Code plugin available
today."]`

### Credits

- Demo codebase: MiroFish (github.com/666ghj/MiroFish, AGPL-3.0), mapped from
  a read-only snapshot.
- Map format: Floorplan (github.com/haydenschmitty/floorplan, MIT).
- Robot model: "RobotExpressive" by Tomás Laulhé (Quaternius), CC0.
- Props: Poly Haven, CC0.
