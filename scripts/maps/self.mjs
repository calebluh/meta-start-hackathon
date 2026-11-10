// The map of this app itself, made with its own Claude Code skill (plugins/codebase-diorama).
// Build: node scripts/build-map.mjs . --arch scripts/maps/self.arch.json --map scripts/maps/self.mjs --out src/maps/self.json
// Every file is claimed by an explicit path in a leaf part; the four parents own no files.

export default {
  name: 'Codebase Diorama',
  summary: 'A virtual reality app that shows a software project as a miniature city on a desk, with rooms you can step into and robots you can ask.',
  source: {
    repo: 'https://github.com/calebluh/meta-start-hackathon',
    commit: '80947659a8e20b500aa8851591ab45cdc487ff97',
  },

  // The build script has no exclude list, so these globs are kept narrow on
  // purpose: they must not match src/maps/mirofish.*, src/maps/custom/**,
  // src/vite-env.d.ts, scripts/maps/** or the skill's templates.
  include: [
    'src/assets.ts',
    'src/atmosphere.ts',
    'src/colors.ts',
    'src/components.ts',
    'src/diorama-components.ts',
    'src/diorama.ts',
    'src/edition.ts',
    'src/guide-system.ts',
    'src/guide.ts',
    'src/index.ts',
    'src/landing.ts',
    'src/layout.ts',
    'src/menu.ts',
    'src/panels.ts',
    'src/pause.ts',
    'src/rays.ts',
    'src/state.ts',
    'src/transition.ts',
    'src/workspace.ts',
    'src/placement.ts',
    'src/agent/*.ts',
    'src/audio/*.ts',
    'src/rooms/*.ts',
    'src/scene-assets/*.ts',
    'src/maps/index.ts',
    'src/maps/larder.ts',
    'src/maps/types.ts',
    'index.html',
    'server/*.ts',
    'api/*.ts',
    'scripts/*.mjs',
    'vite.config.ts',
    'public/ui/*.uikitml',
    'plugins/codebase-diorama/skills/map/scripts/*.mjs',
  ],

  // Outside services are reached by web address, not through imported
  // packages, so they are linked in extraLinks instead.
  packages: [],

  // Links the imports cannot show. The label is what travels along the link;
  // visitors see it on the packet, so it is written in plain words. Where two
  // parts share several links, the one listed first names the packet.
  extraLinks: [
    // A conversation in a room.
    { from: 'f:src/rooms/room.ts', to: 'f:src/agent/client.ts', kind: 'call', label: 'question and answer' },
    { from: 'f:src/rooms/room.ts', to: 'f:public/ui/ask.uikitml', kind: 'call', label: 'suggested questions' },
    { from: 'f:src/rooms/room.ts', to: 'f:src/agent/voice.ts', kind: 'call', label: 'lines to say aloud' },
    { from: 'f:src/agent/live-mic.ts', to: 'f:src/rooms/room.ts', kind: 'event', label: 'your spoken words' },
    { from: 'f:src/state.ts', to: 'f:src/rooms/room.ts', kind: 'event', label: 'which room to open' },
    { from: 'f:src/rooms/room.ts', to: 'f:src/rooms/themes.ts', kind: 'call', label: 'the look of the room' },

    // Opening a map. These repeat imports so the packets carry plain words.
    { from: 'f:src/index.ts', to: 'f:src/maps/index.ts', kind: 'call', label: 'the maps on offer' },
    { from: 'f:src/index.ts', to: 'f:src/state.ts', kind: 'call', label: 'the map to open' },

    // Live speech travels over an open line, which the route list cannot describe.
    { from: 'f:src/agent/live-mic.ts', to: 'f:vite.config.ts', kind: 'event', label: 'live microphone audio' },
    { from: 'f:src/agent/live-mic.ts', to: 'f:api/asr.ts', kind: 'event', label: 'live microphone audio' },
    { from: 'f:src/agent/recorder.ts', to: 'f:vite.config.ts', kind: 'http', label: 'a recorded sentence' },
    { from: 'f:src/agent/recorder.ts', to: 'f:api/transcribe.ts', kind: 'http', label: 'a recorded sentence' },

    // The same requests when the app is hosted online instead of run locally.
    { from: 'f:src/agent/client.ts', to: 'f:api/agent.ts', kind: 'http', label: 'your question' },
    { from: 'f:src/agent/voice.ts', to: 'f:api/tts.ts', kind: 'http', label: 'a line to speak' },

    // What the local server hands to each helper. The imports are found
    // automatically; these add the words shown on the packet.
    { from: 'f:vite.config.ts', to: 'f:server/agent-core.ts', kind: 'call', label: 'your question' },
    { from: 'f:vite.config.ts', to: 'f:server/asr-relay.ts', kind: 'call', label: 'live microphone audio' },
    { from: 'f:vite.config.ts', to: 'f:server/transcribe-core.ts', kind: 'call', label: 'a recorded sentence' },
    { from: 'f:vite.config.ts', to: 'f:server/tts-core.ts', kind: 'call', label: 'a line to speak' },

    // Outside services.
    { from: 'f:server/agent-core.ts', to: 'n:meta', kind: 'http', label: 'question and answer' },
    { from: 'f:server/asr-relay.ts', to: 'n:meta', kind: 'event', label: 'speech in, words out' },
    { from: 'f:server/transcribe-core.ts', to: 'n:meta', kind: 'http', label: 'a recorded sentence' },
    { from: 'f:server/tts-core.ts', to: 'n:openai', kind: 'http', label: 'a line to speak' },

    // Making a map.
    { from: 'n:claude-code', to: 'f:scripts/build-map.mjs', kind: 'call', label: 'a project and its descriptions' },
    { from: 'n:claude-code', to: 'f:plugins/codebase-diorama/skills/map/scripts/check-map.mjs', kind: 'call', label: 'a map to look over' },
    { from: 'f:scripts/build-map.mjs', to: 'f:src/maps/index.ts', kind: 'data', label: 'the finished map' },
    { from: 'f:scripts/fetch-props.mjs', to: 'f:src/rooms/props.ts', kind: 'data', label: 'downloaded furniture' },

    // Cards and buttons are wired up by name, not imported.
    { from: 'f:src/diorama.ts', to: 'f:public/ui/controls.uikitml', kind: 'call', label: 'button presses' },
    { from: 'f:src/diorama.ts', to: 'f:public/ui/inspector.uikitml', kind: 'call', label: "a building's facts" },
    { from: 'f:src/workspace.ts', to: 'f:public/ui/controls.uikitml', kind: 'call', label: 'button presses' },
    { from: 'f:src/menu.ts', to: 'f:public/ui/menu.uikitml', kind: 'call', label: 'the map you chose' },
  ],

  nodes: [
    // The tabletop
    {
      id: 'table.city',
      parent: 'table',
      label: 'Miniature city',
      kind: 'feature',
      paths: [
        'src/diorama.ts',
        'src/layout.ts',
        'src/state.ts',
        'src/transition.ts',
        'src/colors.ts',
        'src/diorama-components.ts',
        'src/components.ts',
      ],
    },
    {
      id: 'table.desk',
      parent: 'table',
      label: 'Desk and controls',
      kind: 'ui',
      paths: [
        'src/workspace.ts',
        'src/placement.ts',
        'src/atmosphere.ts',
        'src/panels.ts',
        'src/rays.ts',
        'src/scene-assets/*.ts',
        'public/ui/controls.uikitml',
        'public/ui/inspector.uikitml',
      ],
    },
    {
      id: 'table.welcome',
      parent: 'table',
      label: 'Welcome and tour',
      kind: 'ui',
      paths: [
        'index.html',
        'src/index.ts',
        'src/landing.ts',
        'src/assets.ts',
        'src/edition.ts',
        'src/pause.ts',
        'src/menu.ts',
        'src/guide.ts',
        'src/guide-system.ts',
        'public/ui/menu.uikitml',
      ],
    },
    { id: 'table', label: 'The tabletop', kind: 'feature' },

    // Inside the rooms
    {
      id: 'rooms.builder',
      parent: 'rooms',
      label: 'Room builder',
      kind: 'feature',
      paths: ['src/rooms/room.ts', 'src/rooms/dressing.ts', 'src/rooms/merge.ts'],
    },
    {
      id: 'rooms.themes',
      parent: 'rooms',
      label: 'Themes and furniture',
      kind: 'library',
      paths: ['src/rooms/themes.ts', 'src/rooms/stations.ts', 'src/rooms/props.ts'],
    },
    {
      id: 'rooms.robots',
      parent: 'rooms',
      label: 'Robot crew',
      kind: 'feature',
      paths: ['src/rooms/character.ts', 'src/rooms/worker.ts', 'src/rooms/lines.ts'],
    },
    { id: 'rooms', label: 'Inside the rooms', kind: 'feature' },

    // Talking with robots
    {
      id: 'talk.answers',
      parent: 'talk',
      label: 'AI answers',
      kind: 'service',
      paths: ['src/agent/client.ts', 'src/agent/prompt.ts', 'server/agent-core.ts', 'public/ui/ask.uikitml'],
    },
    {
      id: 'talk.listening',
      parent: 'talk',
      label: 'Listening to you',
      kind: 'service',
      paths: ['src/agent/live-mic.ts', 'src/agent/recorder.ts', 'server/asr-relay.ts', 'server/transcribe-core.ts'],
    },
    {
      id: 'talk.voices',
      parent: 'talk',
      label: 'Voices and sound',
      kind: 'feature',
      paths: ['src/agent/voice.ts', 'server/tts-core.ts', 'src/audio/*.ts'],
    },
    {
      id: 'talk.server',
      parent: 'talk',
      label: 'Server front door',
      kind: 'infra',
      paths: ['vite.config.ts', 'api/*.ts', 'server/rate-limit.ts'],
    },
    { id: 'talk', label: 'Talking with robots', kind: 'feature' },

    // Maps and upkeep
    {
      id: 'maps.builder',
      parent: 'maps',
      label: 'Map builder',
      kind: 'script',
      paths: ['scripts/build-map.mjs', 'plugins/codebase-diorama/skills/map/scripts/*.mjs'],
    },
    {
      id: 'maps.collection',
      parent: 'maps',
      label: 'Map collection',
      kind: 'data',
      paths: ['src/maps/index.ts', 'src/maps/larder.ts', 'src/maps/types.ts'],
    },
    {
      id: 'maps.upkeep',
      parent: 'maps',
      label: 'Project housekeeping',
      kind: 'script',
      paths: ['scripts/export-personal.mjs', 'scripts/fetch-props.mjs'],
    },
    { id: 'maps', label: 'Maps and upkeep', kind: 'script' },

    // Outside services
    { id: 'meta', label: 'Meta Model API', kind: 'external', summary: "Meta's AI service: it writes the robots' answers and turns spoken words into text." },
    { id: 'openai', label: 'OpenAI voices', kind: 'external', summary: 'An optional outside service that gives each robot a natural speaking voice.' },
    { id: 'claude-code', label: 'Claude Code', kind: 'external', summary: 'The AI coding assistant the map-making plugin works inside.' },
  ],
};
