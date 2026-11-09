import type { GraphData, GraphFile, GraphLink, GraphNode, NodeKind } from './types.js';

/**
 * Sample map: "Larder", a made-up meal-kit subscription shop, written in the
 * shape Floorplan's build step produces (`floorplan/graph.json`). It stands in
 * for a real scan so judges can open the experience without running anything.
 */

const node = (
  id: string,
  parent: string | null,
  label: string,
  kind: NodeKind,
  summary: string,
): GraphNode => ({ id, parent, label, kind, summary });

const nodes: GraphNode[] = [
  node('web', null, 'Customer website', 'ui', 'Where customers pick meals, pay and manage their plan.'),
  node('web.menu', 'web', 'Weekly menu', 'feature', 'Shows this week’s recipes and lets customers fill their box.'),
  node('web.checkout', 'web', 'Checkout', 'feature', 'Takes the address and card, then starts the subscription.'),
  node('web.account', 'web', 'Account pages', 'feature', 'Pause, skip a week, change plan or cancel.'),
  node('admin', null, 'Kitchen dashboard', 'ui', 'What the kitchen team uses to plan recipes and print packing lists.'),
  node('api', null, 'Main server', 'service', 'Answers both apps, takes payments and keeps the data.'),
  node('api.routes', 'api', 'Endpoints', 'feature', 'Everything the apps and Stripe can ask the server to do.'),
  node('api.orders', 'api', 'Orders and plans', 'library', 'Builds each week’s orders from active subscriptions.'),
  node('api.payments', 'api', 'Payments', 'library', 'Charges cards through Stripe and handles refunds.'),
  node('api.email', 'api', 'Emails', 'library', 'Sends receipts, delivery notices and reminders.'),
  node('api.data', 'api', 'Saved data', 'data', 'Reads and saves customers, recipes, boxes and orders.'),
  node('jobs', null, 'Weekly runs', 'worker', 'Jobs that run on a schedule: billing day and packing day.'),
  node('jobs.billing', 'jobs', 'Billing day', 'worker', 'Every Thursday, charges everyone with a box next week.'),
  node('jobs.packing', 'jobs', 'Packing day', 'worker', 'Every Saturday, turns paid orders into packing lists.'),
  node('shared', null, 'Shared helpers', 'library', 'Prices, dates and types both apps and the server use.'),
  node('tests', null, 'Tests', 'test', 'Checks that billing, skipping and checkout keep working.'),
  node('infra', null, 'Deploy setup', 'infra', 'How the apps and server are built and put online.'),
  node('stripe', null, 'Stripe', 'external', 'Charges and refunds cards.'),
  node('postgres', null, 'Database', 'external', 'Postgres, where customers, recipes and orders are kept.'),
  node('postmark', null, 'Postmark', 'external', 'Sends emails.'),
  node('storage', null, 'Photo storage', 'external', 'S3 bucket holding recipe photos.'),
];

// [path, owner, name, description, lines]
type FileRow = [string, string, string, string, number];
const fileRows: FileRow[] = [
  ['web/src/app/layout.tsx', 'web', 'Site frame', 'Header, footer and fonts around every page.', 88],
  ['web/src/lib/api.ts', 'web', 'Server client', 'Sends requests to the main server with the login token.', 142],
  ['web/src/config.ts', 'web', 'Website settings', 'Server address and payment keys for the website.', 31],
  ['web/src/app/menu/page.tsx', 'web.menu', 'Menu page', 'Lists this week’s recipes with photos and prices.', 214],
  ['web/src/app/menu/RecipeCard.tsx', 'web.menu', 'Recipe card', 'One recipe: photo, cook time and an Add button.', 126],
  ['web/src/app/menu/BoxTray.tsx', 'web.menu', 'Box tray', 'The box filling up as recipes are added.', 173],
  ['web/src/app/checkout/page.tsx', 'web.checkout', 'Checkout page', 'Address, delivery day and card details.', 268],
  ['web/src/app/checkout/CardForm.tsx', 'web.checkout', 'Card form', 'Stripe’s card field and the Pay button.', 154],
  ['web/src/app/checkout/confirm/page.tsx', 'web.checkout', 'Thank-you page', 'Confirms the first box and its delivery date.', 72],
  ['web/src/app/account/page.tsx', 'web.account', 'Account home', 'Upcoming boxes and plan details.', 196],
  ['web/src/app/account/SkipWeek.tsx', 'web.account', 'Skip a week', 'Skips or un-skips one upcoming delivery.', 118],
  ['web/src/app/account/PausePlan.tsx', 'web.account', 'Pause plan', 'Pauses deliveries until a chosen date.', 101],
  ['admin/src/pages/Recipes.tsx', 'admin', 'Recipe planner', 'Kitchen team picks next week’s recipes.', 287],
  ['admin/src/pages/Packing.tsx', 'admin', 'Packing lists', 'Prints what goes in each box.', 199],
  ['admin/src/pages/Refunds.tsx', 'admin', 'Refunds', 'Refunds a box that arrived damaged.', 143],
  ['admin/src/api.ts', 'admin', 'Server client', 'Staff requests to the main server.', 96],
  ['api/src/server.ts', 'api.routes', 'Server start', 'Starts the server and plugs in every endpoint.', 84],
  ['api/src/routes/menu.ts', 'api.routes', 'Menu endpoints', 'GET /menu: this week’s recipes.', 92],
  ['api/src/routes/checkout.ts', 'api.routes', 'Checkout endpoints', 'POST /checkout: starts a subscription.', 176],
  ['api/src/routes/account.ts', 'api.routes', 'Account endpoints', 'Skip, pause, change plan and cancel.', 203],
  ['api/src/routes/webhooks.ts', 'api.routes', 'Stripe webhooks', 'Stripe tells the server a payment went through or failed.', 158],
  ['api/src/routes/admin.ts', 'api.routes', 'Staff endpoints', 'Recipes, packing lists and refunds for the kitchen.', 231],
  ['api/src/orders/subscriptions.ts', 'api.orders', 'Subscription rules', 'Starts, pauses and skips plans.', 264],
  ['api/src/orders/weekly.ts', 'api.orders', 'Weekly orders', 'Turns active plans into next week’s orders.', 219],
  ['api/src/orders/pricing.ts', 'api.orders', 'Box prices', 'Works out a box price from size and add-ons.', 97],
  ['api/src/payments/stripe.ts', 'api.payments', 'Stripe calls', 'Creates customers, charges cards, issues refunds.', 241],
  ['api/src/payments/refunds.ts', 'api.payments', 'Refund rules', 'Decides how much to refund and records it.', 133],
  ['api/src/email/send.ts', 'api.email', 'Email sender', 'Sends one email through Postmark.', 64],
  ['api/src/email/templates.ts', 'api.email', 'Email wording', 'Receipts, delivery notices and reminders.', 188],
  ['api/src/db/schema.ts', 'api.data', 'Tables', 'Customers, plans, recipes, boxes and orders.', 172],
  ['api/src/db/queries.ts', 'api.data', 'Lookups', 'The reads and writes the server uses.', 296],
  ['api/src/db/migrations/0007_skips.sql', 'api.data', 'Skips table', 'Adds a table for skipped weeks.', 41],
  ['jobs/src/billing.ts', 'jobs.billing', 'Billing run', 'Charges every plan with a box next week.', 182],
  ['jobs/src/retry.ts', 'jobs.billing', 'Failed-card retries', 'Tries a declined card again two days later.', 109],
  ['jobs/src/packing.ts', 'jobs.packing', 'Packing run', 'Groups paid orders into packing lists.', 151],
  ['jobs/src/schedule.ts', 'jobs', 'Schedule', 'When each weekly run starts.', 38],
  ['shared/src/prices.ts', 'shared', 'Price helpers', 'Money formatting and tax.', 77],
  ['shared/src/dates.ts', 'shared', 'Delivery dates', 'Next delivery day and cut-off times.', 112],
  ['shared/src/types.ts', 'shared', 'Shared types', 'What a plan, box and order look like.', 134],
  ['tests/billing.test.ts', 'tests', 'Billing tests', 'Billing day charges the right people once.', 205],
  ['tests/skip.test.ts', 'tests', 'Skip tests', 'Skipping a week means no charge and no box.', 128],
  ['tests/checkout.test.ts', 'tests', 'Checkout tests', 'A first order creates a plan and a charge.', 164],
  ['infra/docker-compose.yml', 'infra', 'Local setup', 'Runs the server and database on a laptop.', 46],
  ['infra/deploy.yml', 'infra', 'Deploy pipeline', 'Builds and ships the apps on every merge.', 71],
];

const files: GraphFile[] = fileRows.map(([p, n, name, d, loc]) => ({ p, n, name, d, loc }));

// Fill node stats from the files they own, the way Floorplan's build does.
for (const n of nodes) {
  const own = files.filter((f) => f.n === n.id);
  n.stats = { files: own.length, loc: own.reduce((sum, f) => sum + f.loc, 0) };
}

const link = (a: string, b: string, k: string, w = 1, label?: string): GraphLink =>
  label ? { a, b, k, w, labels: [label] } : { a, b, k, w };

const links: GraphLink[] = [
  link('f:web/src/app/menu/page.tsx', 'f:api/src/routes/menu.ts', 'http', 2, 'GET /menu'),
  link('f:web/src/app/checkout/page.tsx', 'f:api/src/routes/checkout.ts', 'http', 2, 'POST /checkout'),
  link('f:web/src/app/account/SkipWeek.tsx', 'f:api/src/routes/account.ts', 'http', 3, 'POST /account/skip'),
  link('f:web/src/app/account/PausePlan.tsx', 'f:api/src/routes/account.ts', 'http', 1, 'POST /account/pause'),
  link('f:admin/src/pages/Packing.tsx', 'f:api/src/routes/admin.ts', 'http', 2, 'GET /admin/packing'),
  link('f:admin/src/pages/Refunds.tsx', 'f:api/src/routes/admin.ts', 'http', 1, 'POST /admin/refund'),
  link('f:admin/src/pages/Recipes.tsx', 'f:api/src/routes/admin.ts', 'http', 3, 'PUT /admin/recipes'),
  link('f:web/src/app/checkout/CardForm.tsx', 'n:stripe', 'import', 2),
  link('f:api/src/routes/checkout.ts', 'f:api/src/orders/subscriptions.ts', 'import', 3),
  link('f:api/src/routes/checkout.ts', 'f:api/src/payments/stripe.ts', 'import', 2),
  link('f:api/src/routes/account.ts', 'f:api/src/orders/subscriptions.ts', 'import', 4),
  link('f:api/src/routes/admin.ts', 'f:api/src/payments/refunds.ts', 'import', 1),
  link('f:api/src/routes/admin.ts', 'f:api/src/db/queries.ts', 'import', 3),
  link('f:api/src/routes/webhooks.ts', 'f:api/src/email/send.ts', 'import', 2),
  link('f:api/src/routes/webhooks.ts', 'f:api/src/orders/weekly.ts', 'import', 1),
  link('n:stripe', 'f:api/src/routes/webhooks.ts', 'http', 1, 'payment succeeded / failed'),
  link('f:api/src/orders/subscriptions.ts', 'f:api/src/db/queries.ts', 'import', 5),
  link('f:api/src/orders/weekly.ts', 'f:api/src/db/queries.ts', 'import', 3),
  link('f:api/src/payments/stripe.ts', 'n:stripe', 'import', 4),
  link('f:api/src/email/send.ts', 'n:postmark', 'http', 2, 'api.postmarkapp.com'),
  link('f:api/src/db/queries.ts', 'n:postgres', 'data', 6, 'reads/writes'),
  link('f:jobs/src/billing.ts', 'f:api/src/payments/stripe.ts', 'import', 2),
  link('f:jobs/src/billing.ts', 'f:api/src/orders/weekly.ts', 'import', 2),
  link('f:jobs/src/retry.ts', 'f:api/src/payments/stripe.ts', 'import', 1),
  link('f:jobs/src/packing.ts', 'f:api/src/db/queries.ts', 'import', 2),
  link('f:jobs/src/billing.ts', 'f:api/src/email/send.ts', 'import', 1),
  link('f:web/src/app/menu/RecipeCard.tsx', 'n:storage', 'http', 1, 'recipe photos'),
  link('f:admin/src/pages/Recipes.tsx', 'n:storage', 'http', 1, 'photo upload'),
  link('f:web/src/app/menu/BoxTray.tsx', 'f:shared/src/prices.ts', 'import', 2),
  link('f:api/src/orders/pricing.ts', 'f:shared/src/prices.ts', 'import', 2),
  link('f:api/src/orders/weekly.ts', 'f:shared/src/dates.ts', 'import', 2),
  link('f:tests/billing.test.ts', 'f:jobs/src/billing.ts', 'import', 1),
  link('f:tests/skip.test.ts', 'f:api/src/orders/subscriptions.ts', 'import', 1),
  link('f:tests/checkout.test.ts', 'f:api/src/routes/checkout.ts', 'import', 1),
];

export const larder: GraphData = {
  schema: 'floorplan/graph@1',
  project: {
    name: 'Larder',
    summary:
      'A meal-kit subscription shop: customers fill a weekly box on the website, the server charges them on billing day, and the kitchen packs the boxes.',
  },
  nodes,
  files,
  links,
  flows: [
    {
      id: 'first-order',
      title: 'A first order',
      description: 'What happens from Pay to the first box being booked.',
      steps: [
        { ref: 'f:web/src/app/checkout/page.tsx', note: 'The customer fills in their address and taps Pay.' },
        { ref: 'f:api/src/routes/checkout.ts', note: 'The server receives the order and checks the delivery day.' },
        { ref: 'f:api/src/orders/subscriptions.ts', note: 'It starts a weekly plan for the customer.' },
        { ref: 'f:api/src/payments/stripe.ts', note: 'It asks Stripe to charge the first box.' },
        { ref: 'n:stripe', note: 'Stripe charges the card.' },
        { ref: 'f:api/src/routes/webhooks.ts', note: 'Stripe reports back that the payment went through.' },
        { ref: 'f:api/src/email/send.ts', note: 'A receipt goes out through Postmark.' },
      ],
    },
    {
      id: 'billing-day',
      title: 'Billing day',
      description: 'The Thursday run that charges next week’s boxes.',
      steps: [
        { ref: 'f:jobs/src/billing.ts', note: 'Thursday morning, the billing run wakes up.' },
        { ref: 'f:api/src/orders/weekly.ts', note: 'It builds next week’s orders from every active plan.' },
        { ref: 'f:api/src/db/queries.ts', note: 'Skipped and paused weeks are left out.' },
        { ref: 'f:api/src/payments/stripe.ts', note: 'Each order is charged through Stripe.' },
        { ref: 'f:jobs/src/retry.ts', note: 'Declined cards are queued to try again in two days.' },
      ],
    },
  ],
  health: {
    issues: [
      {
        id: 'secret:web/src/config.ts',
        kind: 'secret',
        severity: 'high',
        title: 'A secret Stripe key is written into config.ts',
        detail: 'The website ships its settings to every visitor’s browser, so anyone can read this key and charge or refund cards.',
        locations: [{ file: 'web/src/config.ts', line: 12 }],
      },
      {
        id: 'unguarded:api/src/routes/admin.ts',
        kind: 'auth',
        severity: 'medium',
        title: 'The refund endpoint does not check for a staff login',
        detail: 'POST /admin/refund can be called by anyone who knows the address.',
        locations: [{ file: 'api/src/routes/admin.ts', line: 88 }],
      },
    ],
  },
  recent: {
    tasks: [
      {
        title: 'Skip a week',
        request: 'Let customers skip a week from their account page',
        summary: 'Customers can now skip any upcoming week. Billing day leaves skipped weeks out, and the kitchen never sees them.',
        items: [
          { ref: 'f:web/src/app/account/SkipWeek.tsx', change: 'new', note: 'New: the Skip button on each upcoming box.' },
          { ref: 'f:api/src/orders/subscriptions.ts', change: 'changed', note: 'Records skipped weeks against the plan.' },
          { ref: 'f:api/src/db/migrations/0007_skips.sql', change: 'new', note: 'New table for skipped weeks.' },
          { ref: 'f:tests/skip.test.ts', change: 'new', note: 'Proves a skipped week is never charged.' },
        ],
      },
    ],
  },
};
