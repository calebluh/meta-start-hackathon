// Map definition for MiroFish (github.com/666ghj/MiroFish, AGPL-3.0), used by
// scripts/build-map.mjs. Parts are listed most-specific first: each file goes
// to the first part whose globs match.

export default {
  name: 'MiroFish',
  summary: 'A swarm-intelligence engine that predicts how events play out by simulating many AI agents.',
  // The project's own favicon (frontend/public/icon.png), credited on screen.
  logo: 'maps/mirofish/logo.png',
  source: {
    repo: 'https://github.com/666ghj/MiroFish',
    commit: '7657031ac01184afe2cb220f5ee3545573b5e843',
    license: 'AGPL-3.0',
  },
  include: [
    'backend/app/**/*.py',
    'backend/run.py',
    'backend/scripts/*.py',
    'backend/tests/*.py',
    'frontend/src/**/*.vue',
    'frontend/src/**/*.js',
    'frontend/vite.config.js',
    'scripts/*.py',
    'tests/*.py',
  ],
  python: { root: 'backend' },
  js: { alias: 'frontend/src' },
  packages: [
    { match: /^zep_cloud/, node: 'zep' },
    { match: /^openai/, node: 'llm' },
    { match: /^(camel|oasis)/, node: 'oasis' },
  ],
  extraLinks: [
    // The simulation runner starts these scripts as separate processes.
    { from: 'f:backend/app/services/simulation_runner.py', to: 'f:backend/scripts/run_parallel_simulation.py', kind: 'call', label: 'starts simulation process' },
    { from: 'f:backend/app/services/simulation_runner.py', to: 'f:backend/scripts/run_twitter_simulation.py', kind: 'call', label: 'starts simulation process' },
    { from: 'f:backend/app/services/simulation_runner.py', to: 'f:backend/scripts/run_reddit_simulation.py', kind: 'call', label: 'starts simulation process' },
    { from: 'f:backend/app/services/simulation_ipc.py', to: 'f:backend/scripts/run_parallel_simulation.py', kind: 'rpc', label: 'commands and status' },
  ],
  nodes: [
    { id: 'web.screens', parent: 'web', label: 'Screens', kind: 'feature', paths: ['frontend/src/views/**'] },
    { id: 'web.wizard', parent: 'web', label: 'Five-step wizard', kind: 'feature', paths: ['frontend/src/components/Step*.vue'] },
    { id: 'web.panels', parent: 'web', label: 'Graph and history panels', kind: 'feature', paths: ['frontend/src/components/**'] },
    { id: 'web.client', parent: 'web', label: 'Server client', kind: 'library', paths: ['frontend/src/api/**'] },
    { id: 'web', label: 'Web app', kind: 'ui', paths: ['frontend/**'] },

    { id: 'api.routes', parent: 'api', label: 'Endpoints', kind: 'feature', paths: ['backend/app/api/**'] },
    {
      id: 'api.intake',
      parent: 'api',
      label: 'Document intake',
      kind: 'library',
      paths: ['backend/app/services/ontology_generator.py', 'backend/app/services/text_processor.py', 'backend/app/utils/file_parser.py', 'backend/app/utils/ontology.py'],
    },
    {
      id: 'api.graph',
      parent: 'api',
      label: 'Knowledge graph',
      kind: 'data',
      paths: ['backend/app/services/graph_builder.py', 'backend/app/services/zep_*.py', 'backend/app/utils/zep*.py'],
    },
    {
      id: 'api.personas',
      parent: 'api',
      label: 'Agent personas',
      kind: 'library',
      paths: ['backend/app/services/oasis_profile_generator.py', 'backend/app/services/simulation_config_generator.py'],
    },
    { id: 'api.simulation', parent: 'api', label: 'Simulation control', kind: 'worker', paths: ['backend/app/services/simulation_*.py'] },
    { id: 'api.report', parent: 'api', label: 'Report agent', kind: 'library', paths: ['backend/app/services/report_agent.py'] },
    { id: 'api.core', parent: 'api', label: 'Shared plumbing', kind: 'library', paths: ['backend/app/models/**', 'backend/app/utils/**', 'backend/app/services/__init__.py'] },
    { id: 'api', label: 'Backend server', kind: 'service', paths: ['backend/app/**', 'backend/run.py'] },

    { id: 'runners', label: 'Simulation runners', kind: 'worker', paths: ['backend/scripts/run_*.py', 'backend/scripts/action_logger.py'] },
    { id: 'tools', label: 'Maintenance scripts', kind: 'script', paths: ['backend/scripts/**'] },
    { id: 'tests', label: 'Tests', kind: 'test', paths: ['backend/tests/**'] },
    // Root scripts/ and tests/ only build the README's star-history chart, not the product.
    { id: 'upkeep', label: 'Repo upkeep', kind: 'script', summary: 'Scripts (and their tests) that build the star-history chart shown in the README.', paths: ['scripts/**', 'tests/**'] },

    { id: 'zep', label: 'Zep Cloud', kind: 'external', summary: 'Hosted memory and knowledge-graph service.' },
    { id: 'llm', label: 'LLM provider', kind: 'external', summary: 'Any OpenAI-compatible language model API.' },
    { id: 'oasis', label: 'OASIS simulator', kind: 'external', summary: 'Open-source social-media simulation engine the agents run inside.' },
  ],
};
