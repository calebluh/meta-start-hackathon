# Devpost entry: Walkthrough

Paste each part into the matching Devpost field. Everything marked
`[FILL IN ...]` needs you before submitting; nothing else does.

## Short fields

| Field | Value |
| --- | --- |
| Project name | Walkthrough |
| Tagline | Take a walk through any codebase. Software becomes a little city on your desk: pinch a building, walk in, and ask the robots who run it how it works. Hands and voice only. |
| Track | Productivity |
| Division | New Experience |
| Special prize (if the form asks for one) | Best Agentic Interaction |
| Public link | https://diorama.calebluh.com |
| Demo video | `[FILL IN: YouTube or Vimeo link, public, under 3 minutes]` |
| Source code | https://github.com/calebluh/meta-start-hackathon (competition build), https://github.com/calebluh/codebase-diorama (public viewer and Claude Code plugin, AGPL-3.0) |
| Built with | IWSDK, WebXR, WebXR Plane Detection, WebXR Anchors (persistent), GitHub (public repositories), three.js, TypeScript, Vite, UIKit, Meta Model API, Web Audio, Vercel, Claude Code |

## Testing instructions (for the judges)

1. On a Meta Quest 3 or 3S, open the public link in the Quest Browser. (A
   Quest 2 works too, in VR only: it has no colour passthrough.)
2. Put the controllers down. Everything is done with bare hands.
3. Pinch **Allow microphone** if you would like to talk to the robots out
   loud (optional: every question can also be pinched from a list), then
   pinch **Mixed reality** to see the city on your own desk, or **Enter VR**
   for a fully virtual room. For mixed reality, sit at a table or desk. If
   the headset asks to share the layout of your room, allow it: that is how
   the city finds your table. (If your room has never been scanned, the city
   floats in front of you instead and you set it down yourself.)
   **Optional, and the best part: your own code.** Before entering, type any
   public GitHub repository (yours, or one you know) into the box under the
   buttons, or tap Flask, Express or SWR, and press Build city. About ten
   seconds later that repository is a city; Enter VR walks straight into it.
   Inside VR, the start menu (the **Demos** button) has the same one-tap
   Flask, Express and SWR, plus the last repository you built. A link like
   https://diorama.calebluh.com/?repo=facebook/react opens that city directly.
4. Stay seated. Three cards appear in front of you, within reach. Tap
   **Larder**, the small one, with a fingertip for a first visit. Buttons
   are tapped like a touch screen; things further away are pointed at and
   pinched. To move the city, pinch the grey bar under its buttons and drag.
   To turn it, pinch and hold one of the glowing pegs at its corners. Every
   panel, card and speech bubble has a small bar of its own: pinch it to put
   that thing where you like.
5. Follow the card that floats above the city. It teaches one thing at a
   time and takes about three minutes: pinch a building and its roof lifts
   to show its robots, pinch **Step inside** over it, pinch a robot, ask it
   something.
6. Things worth saying to a robot:
   - "What happens in this room?"
   - "Take me to the kitchen."
   - "Show me what happens on billing day."
   - "Show me the code." A card of code pops up beside the robot: the whole
     function, coloured like an editor. Name one ("show me the refund
     endpoint") or say "show me more" to read on. Then ask about it ("what
     does line 30 do?"): the robot has read the same lines.
   - "Take me back to the city."
7. Back at the desk, tap **Street view** to stand in the city at life
   size, still seated. Pinch a glowing disc on the street to move to it, a
   **Turn** arrow to turn, a building to go to its door, and the same
   building again to step in. (With controllers: the left stick glides, the
   right stick turns.)
8. Tap **Demos** and open **MiroFish**. Step into **Endpoints** (its
   building shows a red warning) and ask its robot "How would I fix the
   warning?". It suggests a fix and puts it on your notes list. Then tap
   **Notes** on the desk: the note taker greets you with the robot's fix
   already on the wall. Say an idea of your own and it writes it down,
   word for word or after talking it over with you. Try "billing day should
   retry a declined card three times": it reads the retry code, tells you
   what it does today, and the note ends with the file and function.
9. Tap **Quiz me** on the question panel, or say "quiz me". The robot asks
   four questions about its room. Tap an answer or say it in your own
   words; a wrong answer is corrected on the spot.
10. If the desk is ever in the wrong place, tap **Recenter**.
11. In mixed reality, slide the city somewhere else on your desk with the
    grab bar, then leave (Quest menu, Exit) and pinch **Mixed reality**
    again. The city comes back to the spot you left it on ("Back where you
    left it"): the headset kept a spatial anchor there.
12. Tap **Notes** on the desk, then **Review this project for me**. The note
    taker goes through the code's warnings and biggest files and writes a
    short work order on the wall, most urgent first, each item naming a file
    and line. Take the headset off: the page shows the same list, with
    **Open as a GitHub issue** and **Copy for your coding agent**.

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

Walkthrough turns a real software project into a little city on your
desk. Any public GitHub repository: type its name on the page, and about ten
seconds later you are walking into it.

- **The city.** Every part of the code is a building of dark glass and lit
  windows on a circuit-board tray, sized by how much code it holds and
  joined to the parts it talks to. Pinch a building and a panel says, in
  plain English, what that part does, which files it holds and what is
  wrong with it. Only the names that matter show: groups, the building you
  point at, and the parts it talks to.
- **Lift the roof.** The building you pinch opens like a doll's house: its
  roof lifts and there, in miniature, are the robots who work inside, with a
  **Step inside** button floating over them. You see who you are about to
  meet before you go in.
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
  like. It answers from a map of the code in its room (what each file is
  for, what it talks to, the flows through it), in its own voice, and
  it acts on what you ask: it walks you to another room, plays a flow,
  points at the pipe that leads next door, holds up the code you ask for, or
  takes you back to the city. When it sends you on, it names the colleague
  who will help, and that robot comes out of the pipe to meet you, already
  knowing what you asked.
- **The code itself.** Say "show me the code" and the robot holds up a card
  beside its speech bubble with the real lines: the whole function, class or
  statement you named, in an editor's colours with line numbers. Ask about a
  warning and its line is lit. A class too long for the card shows as an
  outline. A function or file too long for it is cut between statements,
  and "show me more" carries on from there. The robot reads those same lines
  before it answers, so it tells you what the code actually does, cites the
  line numbers and bases a fix on them. Ask "what does line 41 do?" or "what
  happens to an order that is already paid?" and it finds the function that
  answers, reads it and explains it. The lines come straight from the
  repository or, for your own project through the plugin, from your disk.
- **Put things where you want them.** Every panel, card and speech bubble
  has a small grab bar, like the one under the desk. Pinch it and the thing
  follows your hand, stays facing you, and stays where you leave it.
  **Recenter** puts everything back.
- **The quiz.** Pinch **Quiz me** and the robot turns the tables: it tests
  you on its own room. What is this room's job, where does the work go next,
  which file lives here, what is the warning about. The room's notes are put
  away while it runs. Pinch one of three answers, or say it in your own
  words. A wrong answer is corrected straight away, with the right one left
  standing on the panel, and you get a score at the end.
- **Mixed reality.** Choose **Mixed reality** and the city is set down on
  your own desk, in your own room. The app asks the headset for the flat
  surfaces it knows in the room, picks the table in front of you, and stands
  the tray on it: square with the table's edges, inside them, with a soft
  shadow on the real wood. The grab bar slides it along the table top. In a
  room with no table, or one the headset has never scanned, the city floats
  within reach and you place it yourself. Step into a room and it surrounds
  you completely; come back out and the city is on your table where you left
  it. It also remembers that spot between visits: the headset keeps a
  spatial anchor where the city stands, so tomorrow, in the same room, the
  city goes straight back to that place on your desk ("Back where you left
  it").
  `[FILL IN after trying it on a Quest 3 or 3S: keep the table sentences
  only if the city landed on your real desk, and the anchor sentences ("It
  also remembers...", the "Remembering the spot" bullet, the end of
  "Passthrough with a purpose", testing step 11 and "WebXR Anchors" under
  Built with) only if the city came back to its spot after leaving and
  re-entering. The anchor was verified only in the emulator (17 Nov). So far this was verified in the
  IWSDK emulator's furnished room, where the emulated headset's desk, side
  table, couch and walls are reported the same way.]`
- **Robots that help you change the code.** Ask a robot how to fix
  something, such as the warning on its building, and it works out a
  concrete fix from what it knows about its room, names the files, and puts
  the fix on your notes list. In the demo maps, which were built from the
  code, the robots cite the function names and the warning's line from the
  code itself, and hold up the code with the flagged line lit. If the AI
  cannot be reached, the warning itself still goes on the list.
- **The notes room.** Tap **Notes** and step into a room for thinking out
  loud. Say an idea and the note taker writes it down, either word for word
  or after talking it over with you in a sentence or two. It looks the idea
  up in the code first: say "let people pause for a week" and it answers "I
  had a look: that is pausePlan, and it already takes an until date", then
  ends the note with the place to change, such as [pausePlan,
  api/src/orders/subscriptions.ts line 129], so a coding agent can go
  straight there. "Scratch that" takes it back, "read them back" reads the
  list. The robots' fixes land on the same list, pinned to the wall.
- **A review, and a work order to leave with.** One tap on **Review this
  project for me** and the note taker does the job a new joiner would ask a
  senior for: it goes through the warnings, the longest files, the part
  everything else leans on and whether there are tests, and writes three to
  five tasks on the wall, most urgent first, each naming the file and line.
  When the headset comes off, the page shows that work order with two ways
  out: a GitHub issue already filled in for the repository, and a prompt to
  paste into a coding agent. You walk in with a repository name and walk
  out with a filed issue.
- **Your coding agent picks up the list.** Running the viewer on your own
  computer (the Claude Code plugin sets it up), the list is saved into your
  repository as it is said: a checklist in `walkthrough/notes.md`, in a
  folder that also holds the map and keeps itself out of git. Ask your coding agent to work through your
  walkthrough notes: it checks each one against the real code, makes the
  change, ticks the line and updates the map.
- **Your screen and a live city.** In that same local setup, open `/share`
  on the computer and its screen appears on a monitor behind the city, so
  you can watch the agent work without taking the headset off. When the
  agent updates the map, the city changes in front of you, still in VR, and
  the parts that changed glow.
- **Your own code.** A Claude Code plugin maps any repository into a city.
  The third demo, **This app**, is Walkthrough's own source code, mapped by
  that plugin.

The public link opens on three codebases: MiroFish (an open-source
prediction engine), Larder (a small made-up meal-kit shop, with sample code
written to match its map) and this app itself.

### How it was built

It is a WebXR app built with Meta's Immersive Web SDK (IWSDK) in TypeScript,
so it runs from a link in the Quest Browser with nothing to install.

- **Map.** A codebase is described by one map file: its parts, how they
  connect, the main flows and any health notes. The Claude Code plugin writes
  that file by reading a repository without running it. The city, the rooms
  and the robots' names and jobs are generated from the map; the robots
  answer from the map and from the lines of code a question is about.
- **City and rooms.** Buildings, rooms and props are built in code from
  simple shapes, with a few CC0 models. Sound effects are synthesized in
  the browser and placed in 3D, so a till rings from where the till stands;
  the robots' voices come from a text-to-speech service, or the browser's
  own voice when that is not set up.
  The whole city's neon edges are one mesh and its pools of light another,
  so the look costs two draw calls, not two per building.
- **The real room.** Mixed reality uses WebXR plane detection, the browser's
  view of the headset's scene understanding. Each frame the headset lists
  the room's surfaces with a label, an outline and a pose. The app skips
  floors, couches and walls, keeps horizontal surfaces at table height within
  reach, prefers ones labelled table or desk, and fits the tray and its
  buttons inside the outline. It asks for this only in mixed reality, as an
  optional feature, so plain VR never prompts and a headset without a room
  scan still works.
- **Remembering the spot.** When the city is set down (on the table it
  found, by the grab bar, or with Recenter) the app makes a WebXR anchor
  there and asks the headset to keep it (a persistent anchor), saving only
  its id in the browser. On the next mixed-reality visit the anchor is
  restored and wins over the table search; nothing is saved over it while it
  is still being looked for. If the headset has forgotten it, or the spot is
  out of reach from where you now sit, the table search takes over as
  before.
- **Any repository, on the spot.** The server downloads the repository as
  one tarball (size capped, nothing in it is run) and builds the city from
  the code itself: folders become districts, the biggest files get buildings
  of their own, tests and docs one each, line counts size them, imports
  between files become the roads, and well-known packages (Stripe,
  Postgres, Redis, OpenAI...) become outside services. Each file's function
  and class names come along with their lines, so the robots can name real
  code, and very long files or clusters of TODO notes light warning beacons
  that a robot can talk you through fixing. Meta's model then
  names the buildings in plain English, sums the project up and writes the
  journeys a request takes, choosing only from the parts it is given; if it
  is slow, the plain city stands. The map is signed by the server, and the
  robots answer about it only when the signature checks out, so their
  prompts are built from the map the server made and the repository's own
  files, never from text a visitor sends.
- **Robots.** Answers come from Meta's Model API. The server writes the
  prompt itself from the map and the room, and adds the lines of the file a
  question is about, marked as a file's text that is never to be taken as
  instructions. So a robot knows its own room, the directory of the building
  and the code it was handed, and its tools are real actions in the world.
  Speech recognition streams through Meta's realtime
  transcription, so your words appear as you say them and a turn ends half a
  second after you stop. API keys stay on the server.
- **Robots that keep their word.** A fast model sometimes says "I'll send
  you over" and then does nothing. The server reads the visitor's words and
  the robot's spoken answer, and when the request is plain it carries out
  the action itself, so "take me to the kitchen" always takes you there.
  The same goes for notes: when you ask how to fix or improve something, or
  a robot says it put a fix on your notes list, the server makes sure the
  suggestion is there and says which file and lines it is about. And a
  robot that stops after one line to use a tool is given the turn back
  until it has said its answer.
- **Without the AI.** If the model cannot be reached, the robots answer from
  the map instead, and asking to change room, watch a flow or leave still
  works. The quiz is written from the map too: its questions and pinched
  answers need no model at all, which only marks an answer spoken in your
  own words. The experience never stops on a network error.
- **Hosting.** A static site plus four small server functions on Vercel,
  each rate limited.

Development was done with Claude Code as a pair programmer.

### Designed for hands, a seat and a narrow view

- **Hands only.** Buttons are tapped with a fingertip, like a touch screen:
  with bare hands the panels come within arm's reach for that. Things
  further away, such as robots and buildings, are pointed at and pinched,
  and whatever you point at lights up before you pinch, so a miss shows
  before it happens. The landing page's buttons are large enough to
  pinch in the Quest Browser, and the microphone prompt is answered there,
  before the session starts, instead of in the middle of a conversation.
- **Point at it or reach for it.** A building can be pinched from a distance
  or with your fingers right on it. The button that takes you inside appears
  at the building you are looking at, not on a far panel.
- **Passthrough with a purpose.** In mixed reality your own table is the play
  surface. The city takes its place, height and direction from the real
  furniture, so the experience is different in every room, and it is
  anchored there: come back another day and it is waiting on the same spot.
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
  start and stop at once and buildings select and deselect. The buttons that
  switch something on and off, and picking a building, now ignore a repeat
  that arrives too soon.
- **A pinch that picked up the whole city.** Reaching out and pinching a
  building, the most natural thing to do, took hold of the board instead,
  because a pinch made close to the city is a grab. The city no longer takes
  a grab at all: a pinch on or near a building picks it, and the city turns
  and resizes with four pegs at its corners (hold one to turn it, two to
  resize it).
- **A pointer that jumps when you pinch.** Closing your fingers to pinch
  swings the hand's pointing ray, so a pinch aimed at a small peg or a far
  disc often landed beside it. The app now remembers what each hand was
  pointing at a moment before the pinch, and uses that.
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
  walked there, and asking how to fix something puts the fix on your list.
- The loop closes: what you work out in the headset lands in your project,
  your coding agent acts on it, and you watch the city change.
- It maps itself: the app's own code is one of the demos.

### What is next

- Live cities for everyone: today the city updates when your coding agent
  rebuilds the map on your own computer. Next, watch a repository directly,
  with open pull requests shown as building sites.
- Guided tours: a teammate records a walk through the code for a new joiner.
- Two people at the same desk.
- Testing and tuning on Meta VR Glasses hardware.
- More room themes, more languages, and a high-contrast mode.

### Target launch date

Out now as a public beta, from 17 November 2026: free in the Quest Browser
at the public link, with mapping of your own code through the Claude Code
plugin. The beta grows into a full release, with the items above, through
2027.

### Credits

- Demo codebase: MiroFish (github.com/666ghj/MiroFish, AGPL-3.0), mapped from
  a read-only snapshot. Its map quotes the few lines of code around each
  warning, and the names of its functions.
- Map format: Floorplan (github.com/haydenschmitty/floorplan, MIT).
- Robot model: "RobotExpressive" by Tomás Laulhé (Quaternius), CC0.
- Props: Poly Haven, CC0.
