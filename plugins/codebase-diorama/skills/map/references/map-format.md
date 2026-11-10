# Map file formats

A map is built from two files you write, by `scripts/build-map.mjs` in the
viewer. It reads the target repo (file list, line counts, imports), combines
that with your files, and writes `src/maps/custom/<id>.json`.

## map.mjs: structure

An ES module with a default export:

```js
export default {
  name: 'Acme Shop',                       // shown on the menu and the desk
  summary: 'An online shop for ...',       // fallback if arch.json has no projectSummary
  logo: 'maps/acme-shop/logo.png',         // optional, relative to the viewer's public/
  source: {                                // optional, credited on screen
    repo: 'https://github.com/acme/shop',
    commit: '<full sha from git rev-parse HEAD>',
    license: 'MIT',
  },

  // Globs (relative to the repo root) of the files to map. Source code only:
  // leave out lockfiles, assets, generated code, fixtures and vendored code.
  // * matches within a folder, ** across folders.
  include: ['web/src/**/*.tsx', 'web/src/**/*.ts', 'server/**/*.py'],

  // Import resolution (optional; only what the repo needs):
  python: { root: 'server' },              // folder that absolute Python imports start from
  js: { alias: 'web/src' },                // what an '@/...' import points at

  // Imports of outside packages become links to external nodes.
  packages: [
    { match: /^stripe/, node: 'stripe' },
    { match: /^(openai|@anthropic-ai)/, node: 'llm' },
  ],

  // Links the imports cannot show: subprocesses, queues, IPC, config-wired calls.
  // from/to are 'f:<file path>' or 'n:<node id>'. kind: call | rpc | event | data | http.
  extraLinks: [
    { from: 'f:server/jobs/queue.py', to: 'f:server/jobs/worker.py', kind: 'event', label: 'jobs queued for the worker' },
  ],

  // Parts. Each file goes to the FIRST node whose paths match, so list
  // specific parts before their catch-all parent.
  nodes: [
    { id: 'web.checkout', parent: 'web', label: 'Checkout', kind: 'feature', paths: ['web/src/checkout/**'] },
    { id: 'web.catalog', parent: 'web', label: 'Catalog', kind: 'feature', paths: ['web/src/catalog/**'] },
    { id: 'web', label: 'Website', kind: 'ui', paths: ['web/**'] },

    { id: 'api.orders', parent: 'api', label: 'Orders', kind: 'service', paths: ['server/orders/**'] },
    { id: 'api.payments', parent: 'api', label: 'Payments', kind: 'service', paths: ['server/payments/**'] },
    { id: 'api', label: 'Server', kind: 'service', paths: ['server/**'] },

    { id: 'stripe', label: 'Stripe', kind: 'external', summary: 'Card payments provider.' },
  ],
};
```

Node rules:

- `id`: lowercase, dots for nesting by convention (`api.orders`); unique.
- `parent`: a parent's id, or omitted for top-level. One level of nesting is
  plenty. Parents become districts on the desk; leaves become buildings and
  rooms. A parent can also own files (its catch-all globs).
- `kind`: `ui`, `service`, `worker`, `library`, `feature`, `data`, `config`,
  `test`, `script`, `infra`, `external`, `misc`.
- `external` nodes have no `paths`; give them a `summary` here or in arch.json.

Import links are found automatically for Python and JS/TS (relative imports,
`@/` aliases, `require`, re-exports). Other languages get no automatic links,
so describe their important connections in `extraLinks`.

## arch.json: meaning

```json
{
  "projectSummary": "Acme Shop sells ... Customers ..., and every night ...",
  "nodeSummaries": {
    "web": "The website customers shop on.",
    "web.checkout": "Takes the customer's address and card, and places the order.",
    "stripe": "The card payments company the shop charges cards through."
  },
  "files": {
    "web/src/checkout/Checkout.tsx": { "name": "Checkout page", "d": "The page where customers enter their address and card and place the order." }
  },
  "flows": [
    {
      "id": "place-order",
      "title": "Placing an order",
      "description": "From pressing Buy to a paid order the kitchen can see.",
      "steps": [
        { "ref": "f:web/src/checkout/Checkout.tsx", "note": "The customer presses Place order; the page sends the basket and card token to the server." },
        { "ref": "f:server/orders/routes.py", "note": "The orders endpoint checks the basket and creates an unpaid order." },
        { "ref": "f:server/payments/charge.py", "note": "The payments service charges the card through Stripe." },
        { "ref": "n:stripe", "note": "Stripe approves the charge and returns a receipt id." }
      ]
    }
  ],
  "health": [
    { "id": "no-rate-limit", "severity": "medium", "kind": "review", "title": "Login has no rate limit", "detail": "Anyone can try passwords as fast as they like.", "file": "server/auth/login.py", "line": 42 }
  ],
  "routes": [
    { "method": "POST", "path": "/api/orders", "file": "server/orders/routes.py", "line": 18 }
  ],
  "frontendCalls": [
    { "method": "POST", "path": "/api/orders", "file": "web/src/checkout/api.ts", "line": 9 }
  ]
}
```

Field notes:

- `files`: one entry per included file. `name` is 2-4 plain words ("Checkout
  page", not "Checkout.tsx"); `d` is one sentence on what it does for the
  product. These are what robots quote and what the inspector shows.
- `flows[].steps[].ref`: `f:<exact included file path>` or `n:<node id>`.
  The packet travels room to room along these steps, so each consecutive pair
  should be a real hand-off in the code. Notes read aloud: write them as a
  short story beat.
- `health[].severity`: `high`, `medium` or `low`. Only real, specific issues.
- `routes` and `frontendCalls`: path parameters in any style (`:id`,
  `<id>`, `${id}`) match each other. Matching pairs become HTTP links.

## Good maps

- A visitor should recognise every building's name from using the product.
- Each leaf part should own a meaningful chunk of code; avoid one-file parts
  unless the file is central.
- Flows are the heart of the tour: pick the journeys a new teammate would
  most need to understand, and make the first flow the most important one
  (the guided tour points at its first stop).
