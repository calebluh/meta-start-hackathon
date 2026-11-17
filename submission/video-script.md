# Demo video: script and shot list

Target length 2:45. The rules say the video must be **less than three
minutes** and that judges need not watch past 3:00, so do not go past 2:50.
They also ask for real footage from a Meta Quest device or an emulator, a
story first, and no AI-generated video.

The story in one line: **a codebase becomes a place you can walk into, the
robots who run it act for you, and what you work out with them lands in your
code.** Every shot below serves that line; cut anything that does not.

## Before recording

- Record inside the headset: Camera, then Record video. Turn on the option to
  include microphone audio, so your questions are heard.
- Sit at a real desk in a quiet room with good light, so hand tracking is
  steady. Keep your head still while recording: slow head turns read well on
  video, quick ones do not.
- **Voices:** the robots speak only where the server has `OPENAI_API_KEY`
  (the live site has it). Record on the live site, or add the key to your
  local `.env.local` first. Without it the robots' lines are silent.
- Use the **Larder** map for the room scenes (its answers are short) and
  **MiroFish** for the fix-and-notes scene (its Endpoints room has a real
  health warning).
- Before recording, clear old notes so the notes panel starts empty, or the
  shot shows test notes. (Open the notes room, Undo last until empty.)
- Do one full practice run first. The robots' answers differ each time, so
  record each conversation shot two or three times and keep the best.
- A Quest 2 records mixed reality as black. On a Quest 2 the whole video is
  in VR; that is fine. On a Quest 3 or 3S, record the opening in Mixed
  reality instead (the city lands on your real desk).

## Shots

| Time | What is on screen | Voice-over |
| --- | --- | --- |
| 0:00 to 0:08 | The little glowing city on the desk in front of you. Your bare hands come into view over it. Slowly lean in. | "Every codebase is a place. You just can't see it." |
| 0:08 to 0:18 | Quick cut: a wall of code in an editor (screen recording, 3 seconds), then back to the city. | "Joining a project means weeks of reading. But people don't learn places by reading. They walk around, and they ask someone who works there." |
| 0:18 to 0:35 | Menu: tap the Larder card with a fingertip. Point at a building and pinch: its roof lifts, tiny robots look up from inside, and the side panel fills in. Hold the close-up for two seconds. | "This is Codebase Diorama. A real project becomes a little city on your desk. Every building is one part of the code. Pinch one, and it opens up: what it does, in plain English, and who runs it." |
| 0:35 to 0:45 | Pinch and hold a glowing corner peg: the city turns slowly. Let go. | "Turn it, resize it, move it. No controllers anywhere: hands and voice, sitting down." |
| 0:45 to 0:58 | Pinch Step inside, floating over the open building. The building grows around you. Look across the room at the robots working. | "Then step inside. Each room is the real-world place that does the same job. Payments is a cashier's office." |
| 0:58 to 1:18 | Point at a robot and pinch. It walks over and greets you; the question panel folds away while you talk. Ask out loud: "What happens in this room?" It answers aloud. | (No voice-over. Let the conversation play.) |
| 1:18 to 1:30 | Say: "Take me to the kitchen." The robot says it is handing you over, the view cuts to the kitchen, and that robot greets you, already knowing what you asked. | "The robots don't just answer. They act: they move you, play a flow, hand you on to a colleague who knows the thread." |
| 1:30 to 1:55 | Tap Demos, open **MiroFish**, step into **Endpoints** (its building has a red warning). Ask its robot: "How would I fix the warning?" It names the line (119 in simulation.py) and the change, and says it has put it on your notes list. Then ask "Show me the line." A card opens beside the robot with the real code, line 119 lit. Hold on the card for two seconds. | "And they help you change the code. Ask how to fix something, and the robot points you to the exact line, and puts the fix on your list." |
| 1:55 to 2:15 | Tap **Notes** on the desk. The note taker greets you; the robot's fix is already on the wall. Say an idea of your own, e.g. "We should show people how long their report will take." The note taker talks it over in a sentence and writes it down tight; it appears on the panel. | "The notes room is for thinking out loud. Talk an idea over, or just dictate. Everything lands in one list, in your project." |
| 2:15 to 2:32 | Still in the headset, back at the table: your PC's terminal is on the monitor behind the city. Claude Code (typed beforehand: "work through my diorama notes") lists the notes, makes the first change, ticks it off, rebuilds the map. The building it changed glows on the desk in front of you. | "Your coding agent picks up the same list, makes the change, and updates the map. You watch it from inside: the city changes in front of you. The plugin works with Claude Code, Codex, Cursor and Gemini." |
| 2:32 to 2:40 | Mixed reality (Quest 3/3S, or the emulator clip `05-mixed-reality.mp4`): slide the city to another spot on your real desk with the grab bar, leave, pinch Mixed reality again. The city is back on that exact spot, with "Back where you left it" over it. | "And it's anchored to your room. Come back tomorrow, and it's waiting right where you left it." |
| 2:40 to 2:45 | Title card: "Codebase Diorama" and the public link. | "Codebase Diorama. Step inside your code." |

Optional, if a shot runs short: **Street view** (tap Street view; the city
grows to life size around you; pinch a disc on the street to walk to it, or a
Turn button to turn) with "Or walk its streets, without leaving your chair."
It fits in place of the corner-peg shot.

## If a shot will not behave

- A robot gives a long answer: ask something narrower, such as "What is this
  room for, in one sentence?"
- A robot does not move you: say the room's name as it is written on the
  building, for example "Take me to Payments."
- A robot does not offer a fix: ask "How would I fix the warning in here?"
  in a room whose building shows the red warning.
- The code card does not open: ask "Where exactly is the problem? Show me the
  line." In Endpoints, asking about the thread count lights line 499 instead
  of 119; either is fine on camera.
- Hand tracking drops: bring your hands up into view and keep them apart.
- The coding-agent shot needs the local viewer (the live link has no
  monitor): run the dev server, open its network address on the Quest, and
  on the PC open `https://localhost:8091/share` and share the terminal
  window. Use a large terminal font. Run the agent on a copy of the target
  repo. If the shot will not come together, fall back to a 15-second
  desktop screen recording of the same steps.
- For a local recording, add `OPENAI_API_KEY` to `.env.local` first, or the
  robots are silent there.
