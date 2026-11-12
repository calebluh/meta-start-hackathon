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
| Public link | https://diorama.calebluh.com |
| Demo video | `[FILL IN: YouTube or Vimeo link, public, under 3 minutes]` |
| Source code | https://github.com/calebluh/meta-start-hackathon (competition build), https://github.com/calebluh/codebase-diorama (public viewer and Claude Code plugin, AGPL-3.0) |
| Built with | IWSDK, WebXR, three.js, TypeScript, Vite, UIKit, Meta Model API, Web Audio, Vercel, Claude Code |

## Testing instructions (for the judges)

1. On a Meta Quest 3 or 3S, open the public link in the Quest Browser.
2. Put the controllers down. Everything is done with bare hands.
3. Pinch **Allow microphone** if you would like to talk to the robots out
   loud (optional: every question can also be pinched from a list), then
   pinch **Mixed reality** to see the city on your own desk, or **Enter VR**
   for a fully virtual room.
4. Stay seated. A desk appears in front of you with three cards. Pinch or
   poke **Larder**, the small one, for a first visit. To move the desk,
   pinch the grey bar under its buttons and drag.
5. Follow the card that floats above the desk. It teaches one thing at a
   time and takes about three minutes: pinch a building, step inside, pinch a
   robot, ask it something.
6. Things worth saying to a robot:
   - "What happens in this room?"
   - "Take me to the kitchen."
   - "Show me what happens on billing day."
   - "Take me back to the city."
7. Back at the desk, pinch **Street view** to stand in the city at life
   size. Pinch the ground to walk, a building to go to its door, and the
   same building again to step in.
8. Pinch **Quiz me** on the question panel, or say "quiz me". The robot asks
   four questions about its room. Pinch an answer or say it in your own
   words; a wrong answer is corrected on the spot.
9. If the desk is ever in the wrong place, pinch **Recenter**.

No account, no install and no payment. The whole visit fits in ten minutes.
Controllers work too: the trigger is a pinch, and the right thumbstick spins
and resizes the city. On a computer, the same link shows a flat preview:
click to pick, WASD to move, right-drag to look.

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
  order in a shop, while each step is read aloud. It comes in through an
  Internet gateway, and every step shows whether it crosses the network
  (high and blue), touches stored data (amber) or is the code working on
  its own (a small white hop), so you see where a request really travels.
- **Street view.** Pinch **Street view** and the city grows to life size
  around you, starting at the Internet gateway. Point at the street and
  pinch to walk there; pinch a building to walk to its lit door, and pinch
  it again to go in. Leaving a room puts you back at that door. **Map view**
  shrinks the city back onto the desk.
- **Carry the request.** Inside a room during a flow, the robot hands you
  the request. Pinch it, then pinch the pipe it goes down next. Pick the
  wrong pipe and the robot tells you where that one leads.
- **The rooms.** Pinch **Step inside** and the building grows around you
  until you are standing in it. Each room looks like the real-world place
  that does the same job: payments is a cashier's office, storage is a
  warehouse, messaging is a post office. Robots work there.
- **The robots.** Pinch a robot, or just talk, and cut in whenever you
  like. It answers about the actual code in its room, in its own voice, and
  it acts on what you ask: it walks you to another room, plays a flow,
  points at the pipe that leads next door, hands you a card about a file, or
  takes you back to the city. When it sends you on, it names the colleague
  who will help, and that robot comes out of the pipe to meet you, already
  knowing what you asked.
- **The quiz.** Pinch **Quiz me** and the robot turns the tables: it tests
  you on its own room. What is this room's job, where does the work go next,
  which file lives here, what is the warning about. The room's notes are put
  away while it runs. Pinch one of three answers, or say it in your own
  words. A wrong answer is corrected straight away, with the right one left
  standing on the panel, and you get a score at the end.
- **Mixed reality.** Choose **Mixed reality** and the city sits on your own
  desk, in your own room, through the headset's passthrough cameras. The
  rooms you step into still surround you, with your real room around them.
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
- **Robots that keep their word.** A fast model sometimes says "I'll send
  you over" and then does nothing. The server reads the visitor's words and
  the robot's spoken answer, and when the request is plain it carries out
  the action itself, so "take me to the kitchen" always takes you there.
- **Without the AI.** If the model cannot be reached, the robots answer from
  the map instead, and asking to change room, watch a flow or leave still
  works. The quiz is written from the map too: its questions and pinched
  answers need no model at all, which only marks an answer spoken in your
  own words. The experience never stops on a network error.
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
- **Seated and still.** The desk places itself just in front of wherever you
  are sitting, and comes back in front of you each time you leave a room.
  A grab bar, like the one under a Quest window, drags it nearer, further or
  aside, and it keeps facing you. Rooms come to you: there is no walking.
- **Narrow views.** On Meta VR Glasses (open the link with `?gaze` on the
  end) the app asks for eye tracking, moves the desk farther away and a
  little higher, so the city, its buttons and the side panel fit in one
  look, and every target works with a look and a pinch. This was checked in
  the IWSDK glasses emulator and has not yet been run on glasses hardware.
- **A first five minutes without a wall of text.** One floating card, one
  short line at a time, and an arrow on the thing to pinch: get comfortable,
  pinch a building, step inside, talk to a robot, ask something, come back.
  Each step finishes when you do it.
- **Pause and resume.** Take the headset off or open the Quest menu and the
  robots stop talking, the microphone closes and the sound stops. Put it
  back on and it carries on where it was.
- **Frame rate.** `[FILL IN after testing on a headset: for example "Holds
  72 fps on Quest 3 in the city and in rooms." Delete this bullet if you
  could not measure it.]`

### Challenges

- **A browser that crashed on a Quest 2.** Asking the Quest Browser for eye
  tracking, which only Meta VR Glasses use, crashed the whole page on a
  Quest 2 before it drew a frame. Eye tracking is now only requested when
  the link asks for it.
- **Hand input is noisy.** One pinch often arrives twice, which made buttons
  start and stop at once and buildings select and deselect. Every control now
  ignores a repeat that arrives too soon.
- **A robot that talks has to stay visible.** Side panels, a speech bubble
  and the guide card all want the same space in front of you. The robot now
  walks to a spot between the panels, and the card drops to the desk.
- **Keeping an open microphone honest.** The robot's own voice must never be
  heard as your next question, so the microphone sends silence while a robot
  is speaking.
- **A robot that says one thing and does another.** With quick reasoning
  the model would promise to walk you somewhere and call no tool, or name
  one room aloud and pick a different one. A small resolver now checks what
  was asked against what was said, and makes the action match the words.
  It would also say one line, use a tool and stop mid-thought, so the server
  now gives it one more turn to finish the answer.
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
