# Demo video: script and shot list

Target length 2:45. The rules say the video must be **less than three
minutes** and that judges need not watch past 3:00, so do not go past 2:50.
They also ask for real footage from a Meta Quest device or an emulator, a
story first, and no AI-generated video.

## Before recording

- Record inside the headset: Camera, then Record video. Turn on the option to
  include microphone audio if it is offered, so your questions are heard.
- Sit at a real desk in a quiet room with good light, so hand tracking is
  steady. Keep your head still while recording: slow head turns read well on
  video, quick ones do not.
- Use the **Larder** map for the room scenes. Its answers are short.
- Do one full practice run first. The robots' answers differ each time, so
  record each conversation shot two or three times and keep the best.
- If you only have emulator footage for the glasses shot, label it on screen
  as "Meta VR Glasses emulator".
- Record the opening shot in **Mixed reality** (the white button on the
  landing page) on a **Quest 3 or 3S** if you can borrow one: it records the
  real room in colour. A Quest 2 shows grey passthrough in the headset but
  records it as black, so on a Quest 2 record the opening in VR instead.
- For the city to land on your real desk, the headset needs a scan of the
  room: Settings, Environment setup (Space setup), and mark the desk. Sit at
  it, then enter Mixed reality.
- No Quest 3: the emulator now has a furnished room (IWER's home office).
  Run `npm run dev`, press Mixed reality, and move the emulated headset to
  the desk to record the same shot there. Label it "emulator" on screen.
- For the glasses clip in the emulator, open the link with `?gaze` on the
  end. Eye tracking is only requested then.

## Shots

| Time | What is on screen | Voice-over |
| --- | --- | --- |
| 0:00 to 0:10 | Mixed reality: your real desk, empty. Pinch Mixed reality and the little glowing city is standing on it, square with the desk's edge. Your bare hands come into view over it. Slowly lean in. | "Every codebase is a place. You just can't see it." |
| 0:10 to 0:25 | Quick cut: a wall of code in an editor (a screen recording, 3 seconds), then back to the city. | "Joining a project means weeks of reading. But people don't learn places by reading. They walk around, and they ask someone who works there." |
| 0:25 to 0:45 | Menu: pinch the Larder card. The city rises. Reach out and pinch a building: its roof lifts, tiny robots look up from inside, and the side panel fills in. Hold the close-up for two seconds. | "This is Codebase Diorama. A real software project becomes a little city on your desk. Every building is one part of the code. Pinch one, and it opens up: here's what it does, in plain English, and here's who runs it." |
| 0:45 to 1:00 | Pinch Play flow. A packet travels between buildings. | "Play a flow, and you watch a real request travel through the code, step by step." |
| 1:00 to 1:15 | Pinch Step inside, floating over the open building. The building grows around you. Look across the room at the robots working. | "Then step inside. Each room is the real-world place that does the same job. Payments is a cashier's office." |
| 1:15 to 1:40 | Pinch a robot. It walks over and greets you. Ask out loud: "What happens in this room?" Your words appear as you speak; the robot answers aloud. | (No voice-over. Let the conversation play.) |
| 1:40 to 1:55 | Say: "Take me to the kitchen." The robot says goodbye, the view cuts to the kitchen and its robot greets you. | "The robots don't just answer. They act. Ask where the order goes next, and you're taken there." |
| 1:55 to 2:10 | Pinch Quiz me. The robot asks its first question; the side card now reads "Quiz in progress". Pinch a wrong answer on purpose: the panel turns amber and leaves the right answer standing while the robot corrects you. Answer the next one out loud. | "And when you think you've got it, the robot tests you. Get one wrong, and it puts you right." |
| (within 1:00 to 1:15, if time allows) | Pinch Street view: the city grows to life size around you. Pinch a building to walk to its door, then again to go in. | "Or walk its streets, and go in through the front door." |
| 2:10 to 2:18 | Say: "Take me back to the city." The room shrinks back onto the desk. Pinch the grey bar under the buttons and slide the city along your desk. | "No controllers anywhere. Hands and voice, sitting down, at your own desk." |
| 2:18 to 2:30 | Menu: the "This app" card, then its city. Optionally a 3 second screen recording of `/codebase-diorama:map` running in a terminal. | "And it works on your code. A plugin for Claude Code and other coding agents maps any repository into a city. This one is the diorama's own source." |
| 2:30 to 2:37 | Glasses emulator clip: the narrower view, a look and a pinch selecting a building. On-screen label: "Meta VR Glasses emulator". | "On Meta VR Glasses, the desk moves to fit the narrower view, and everything works with a look and a pinch." |
| 2:37 to 2:42 | Title card: "Codebase Diorama" and the public link. | "Codebase Diorama. Step inside your code." |

## If a shot will not behave

- A robot gives a long answer: ask something narrower, such as "What is this
  room for, in one sentence?"
- A robot does not move you: say the room's name as it is written on the
  building, for example "Take me to Payments."
- Hand tracking drops: bring your hands up into view and keep them apart.
