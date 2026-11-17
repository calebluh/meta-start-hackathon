// Codebase Diorama map definition for <Project>. See references/map-format.md.
// Parts are listed most-specific first: each file goes to the first part whose
// globs match.

export default {
  name: '<Project name>',
  summary: '<One sentence: what it is.>',
  // logo: 'maps/<id>/logo.png',
  source: {
    repo: '<https://github.com/owner/repo>',
    commit: '<git rev-parse HEAD>',
    license: '<SPDX id>',
  },
  include: ['<src/**/*.ts>'],
  // python: { root: '<folder>' },
  // js: { alias: '<folder an @/ import points at>' },
  packages: [
    // { match: /^stripe/, node: 'stripe' },
  ],
  extraLinks: [
    // { from: 'f:<path>', to: 'f:<path>', kind: 'call', label: '<what passes>' },
  ],
  nodes: [
    // { id: 'app.feature', parent: 'app', label: '<Feature>', kind: 'feature', paths: ['<src/feature/**>'] },
    // { id: 'app', label: '<App>', kind: 'ui', paths: ['<src/**>'] },
    // { id: 'stripe', label: 'Stripe', kind: 'external', summary: '<What it is.>' },
  ],
};
