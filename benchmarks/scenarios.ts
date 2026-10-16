import type { InputRecord } from '../src/index.js';

/**
 * Benchmark scenario: synthetic but realistic coding-session data.
 *
 * Required facts and relevance labels are defined UP FRONT (before running
 * any optimizer) so measurements cannot be tuned post-hoc.
 */
export interface Scenario {
  name: string;
  category: string;
  task: string;
  records: InputRecord[];
  /** Token budget for the candidate under test. */
  budget: number;
  /**
   * Facts that MUST appear in the final context (case-insensitive,
   * whitespace-normalized substring match).
   */
  requiredFacts: string[];
  /**
   * Record ids that a competent retriever should keep for this task
   * (labels for precision/recall). Ids must be set on the records.
   */
  relevantRecordIds: string[];
}

const T0 = '2026-03-01T10:00:00Z';
const T1 = '2026-03-01T10:05:00Z';
const T2 = '2026-03-01T10:30:00Z';

// ---------------------------------------------------------------------------
// 1. Repeated tool outputs
// ---------------------------------------------------------------------------

const RUN_OUTPUT =
  'RUN v2.1.0\n ❯ src/snapshot/render.test.ts (1 test)\n   × renders header\n     → snapshot mismatch: expected "<h1>App</h1>" received "<h1>App </h1>"\n Test Files  1 failed (1)\n      Tests  1 failed (8 passed)';

export const repeatedToolOutputs: Scenario = {
  name: 'repeated-tool-outputs',
  category: '1. Repeated tool outputs',
  task: 'Fix flaky snapshot mismatch in src/snapshot/render.test.ts',
  budget: 2_000,
  records: [
    {
      id: 't1-msg',
      kind: 'message',
      role: 'user',
      text: 'CI fails intermittently: snapshot mismatch in src/snapshot/render.test.ts',
      timestamp: T0,
    },
    ...Array.from({ length: 8 }, (_, i): InputRecord => ({
      id: `t1-run-${i}`,
      kind: 'tool_call',
      toolName: 'npm test -- snapshot',
      output: RUN_OUTPUT,
      exitCode: 1,
      timestamp: T1,
    })),
    {
      id: 't1-fix-hint',
      kind: 'note',
      text: 'The trailing space comes from template.ts line 42: `<h1>${title} </h1>`.',
      timestamp: T2,
    },
  ],
  requiredFacts: ['snapshot mismatch', 'template.ts', 'trailing space'],
  // t1-run-0 is the canonical (merged) run output: keeping ONE copy of the
  // repeated output with the actual mismatch detail is correct behavior.
  relevantRecordIds: ['t1-msg', 't1-run-0', 't1-fix-hint'],
};

// ---------------------------------------------------------------------------
// 2. Long debugging session
// ---------------------------------------------------------------------------

const chatter = Array.from({ length: 40 }, (_, i): InputRecord => ({
  id: `t2-chatter-${i}`,
  kind: 'message',
  role: i % 2 === 0 ? 'assistant' : 'user',
  text: `Chattering about hypothesis ${i}: maybe the cache, maybe the clock, maybe the moon phase. Let us look at more logs.`,
  timestamp: `2026-03-01T11:${String(i).padStart(2, '0')}:00Z`,
}));

export const longDebuggingSession: Scenario = {
  name: 'long-debugging-session',
  category: '2. Long debugging sessions',
  task: 'Stop the duplicate-charge bug in src/billing/charge.ts',
  budget: 2_500,
  records: [
    {
      id: 't2-msg',
      kind: 'message',
      role: 'user',
      text: 'Customers get charged twice when retrying; the duplicate originates in src/billing/charge.ts',
      timestamp: T0,
    },
    ...chatter,
    {
      id: 't2-error',
      kind: 'error',
      message:
        'DuplicateKeyError: duplicate key value violates unique constraint "charges_idempotency_key_key"\n    at chargeOnce (src/billing/charge.ts:88:11)',
      path: 'src/billing/charge.ts',
      timestamp: T2,
    },
    {
      id: 't2-decision',
      kind: 'decision',
      text: 'Idempotency keys must be generated per logical order, not per retry attempt',
      status: 'accepted',
      timestamp: T2,
    },
    {
      id: 't2-file',
      kind: 'file',
      path: 'src/billing/charge.ts',
      content:
        'export async function chargeOnce(order, retry) {\n  const key = `ord-${order.id}-retry-${retry.attempt}`;\n  return stripe.charges.create({ amount: order.total, idempotencyKey: key });\n}\n',
      timestamp: T2,
    },
    ...chatter.map((c) => ({ ...c, id: `${c.id}-b` })),
  ],
  requiredFacts: ['idempotency', 'retry.attempt', 'chargeOnce'],
  relevantRecordIds: ['t2-msg', 't2-error', 't2-decision', 't2-file'],
};

// ---------------------------------------------------------------------------
// 3. Errors and stack traces
// ---------------------------------------------------------------------------

export const errorsAndStackTraces: Scenario = {
  name: 'errors-and-stack-traces',
  category: '3. Errors and stack traces',
  task: 'Fix TypeError when loading settings via loadSettings in src/config/load.ts',
  budget: 2_000,
  records: [
    {
      id: 't3-err1',
      kind: 'error',
      message:
        'TypeError: Cannot read properties of undefined (reading "timeout")\n    at loadSettings (src/config/load.ts:31:18)\n    at bootstrap (src/bootstrap.ts:12:5)',
      path: 'src/config/load.ts',
      errorType: 'TypeError',
      timestamp: T0,
    },
    {
      id: 't3-err2',
      kind: 'error',
      message: 'ReferenceError: process is not defined\n    at loadEnv (src/config/env.ts:4:3)',
      path: 'src/config/env.ts',
      errorType: 'ReferenceError',
      timestamp: T1,
    },
    {
      id: 't3-unrelated-err',
      kind: 'error',
      message: 'Error: 404 Not Found\n    at fetchUser (src/api/users.ts:55:9)',
      path: 'src/api/users.ts',
      timestamp: T1,
    },
    {
      id: 't3-msg',
      kind: 'message',
      role: 'user',
      text: 'App crashes on boot; the stack points at loadSettings reading config.timeout',
      timestamp: T0,
    },
    {
      id: 't3-file',
      kind: 'file',
      path: 'src/config/load.ts',
      content:
        'export function loadSettings(raw) {\n  const timeout = raw.network.timeout; // raw may be undefined\n  return { timeout };\n}\n',
      timestamp: T1,
    },
  ],
  requiredFacts: ['loadSettings', 'src/config/load.ts', 'TypeError'],
  relevantRecordIds: ['t3-err1', 't3-msg', 't3-file'],
};

// ---------------------------------------------------------------------------
// 4. Previous failed attempts
// ---------------------------------------------------------------------------

export const previousFailedAttempts: Scenario = {
  name: 'previous-failed-attempts',
  category: '4. Previous failed attempts',
  task: 'Make the websocket reconnect after a network drop in src/net/ws.ts',
  budget: 2_000,
  records: [
    {
      id: 't4-msg',
      kind: 'message',
      role: 'user',
      text: 'websocket does not reconnect after network drop in src/net/ws.ts',
      timestamp: T0,
    },
    {
      id: 't4-attempt1',
      kind: 'message',
      role: 'assistant',
      text: 'Attempt 1: increased the retry interval to 60s. Still fails after a network drop.',
      timestamp: T1,
    },
    {
      id: 't4-attempt2',
      kind: 'message',
      role: 'assistant',
      text: 'Attempt 2: called socket.start() on the "offline" event. Still fails with ECONNRESET.',
      timestamp: T2,
    },
    {
      id: 't4-attempt3',
      kind: 'message',
      role: 'assistant',
      text:
        'Attempt 3: rebuild the socket from scratch in the "online" handler AND clear the backoff timer. This finally reconnects.',
      timestamp: '2026-03-01T12:00:00Z',
    },
    {
      id: 't4-error',
      kind: 'error',
      message: 'Error: socket hang up (ECONNRESET)\n    at WS.onclose (src/net/ws.ts:74:13)',
      path: 'src/net/ws.ts',
      timestamp: T2,
    },
  ],
  requiredFacts: ['Attempt 2', 'ECONNRESET', 'backoff'],
  relevantRecordIds: ['t4-msg', 't4-attempt2', 't4-attempt3', 't4-error'],
};

// ---------------------------------------------------------------------------
// 5. Technical decisions and constraints
// ---------------------------------------------------------------------------

export const decisionsAndConstraints: Scenario = {
  name: 'decisions-and-constraints',
  category: '5. Technical decisions and constraints',
  task: 'Add a caching layer for the product search endpoint',
  budget: 1_500,
  records: [
    {
      id: 't5-old-decision',
      kind: 'decision',
      text: 'All persistence goes through the repository layer (decision from 2024, still binding)',
      status: 'accepted',
      constraints: ['No direct SQL outside src/repositories', 'ORM upgrades require an ADR'],
      timestamp: '2024-06-01T00:00:00Z',
    },
    {
      id: 't5-superseded',
      kind: 'decision',
      text: 'Use Redis for all caching',
      status: 'superseded',
      timestamp: '2025-01-01T00:00:00Z',
    },
    {
      id: 't5-new-decision',
      kind: 'decision',
      text: 'Search results cache must be in-process only until we have a cache ADR',
      status: 'accepted',
      constraints: ['Do not add new infra dependencies this quarter'],
      timestamp: T0,
    },
    { id: 't5-noise1', kind: 'note', text: 'Standup at 9:30. Coffee machine is broken again.', timestamp: T1 },
    { id: 't5-noise2', kind: 'note', text: 'Reminder: ping the design team about dark mode.', timestamp: T1 },
    {
      id: 't5-msg',
      kind: 'message',
      role: 'user',
      text: 'Search endpoint /api/search is slow; we need caching for product search',
      timestamp: T0,
    },
  ],
  requiredFacts: ['repository layer', 'in-process', 'Do not add new infra'],
  relevantRecordIds: ['t5-old-decision', 't5-new-decision', 't5-msg'],
};

// ---------------------------------------------------------------------------
// 6. Multi-file changes and dependency relationships
// ---------------------------------------------------------------------------

export const multiFileDependencies: Scenario = {
  name: 'multi-file-dependencies',
  category: '6. Multi-file changes and dependencies',
  task: 'Rename the User entity fields to match the new API contract (emailAddress)',
  budget: 2_500,
  records: [
    {
      id: 't6-msg',
      kind: 'message',
      role: 'user',
      text: 'The API contract renamed User.email to User.emailAddress; update our code',
      timestamp: T0,
    },
    {
      id: 't6-entity',
      kind: 'file',
      path: 'src/domain/user.ts',
      content: 'export interface User {\n  id: string;\n  email: string;\n}\n',
      timestamp: T1,
    },
    {
      id: 't6-repo',
      kind: 'file',
      path: 'src/repositories/userRepo.ts',
      content:
        'import { User } from "../domain/user.js";\nexport function findByEmail(users: User[], email: string) {\n  return users.find((u) => u.email === email);\n}\n',
      timestamp: T1,
    },
    {
      id: 't6-api',
      kind: 'file',
      path: 'src/api/userRoutes.ts',
      content:
        'import { findByEmail } from "../repositories/userRepo.js";\nexport function handler(req) {\n  return findByEmail(req.db.users, req.body.email);\n}\n',
      timestamp: T1,
    },
    {
      id: 't6-unrelated-a',
      kind: 'file',
      path: 'src/ui/theme.css',
      content: '.btn { color: #333; }\n.card { border: 1px solid #eee; }\n',
      timestamp: T1,
    },
    {
      id: 't6-unrelated-b',
      kind: 'file',
      path: 'scripts/release.sh',
      content: '#!/usr/bin/env bash\nnpm version "$1"\n',
      timestamp: T1,
    },
    {
      id: 't6-test',
      kind: 'test_result',
      framework: 'vitest',
      command: 'npm test',
      failed: 1,
      exitCode: 1,
      failures: [
        {
          name: 'findByEmail matches by emailAddress',
          message: 'expected undefined to be user@example.com',
          file: 'test/userRepo.test.ts',
          line: 14,
        },
      ],
      timestamp: T2,
    },
  ],
  requiredFacts: ['src/domain/user.ts', 'src/repositories/userRepo.ts', 'findByEmail'],
  relevantRecordIds: ['t6-msg', 't6-entity', 't6-repo', 't6-api', 't6-test'],
};

// ---------------------------------------------------------------------------
// 7. Stale information contradicted by newer evidence
// ---------------------------------------------------------------------------

export const staleInformation: Scenario = {
  name: 'stale-information',
  category: '7. Stale information contradicted by newer evidence',
  task: 'Update the session TTL configuration for the auth service',
  budget: 1_500,
  records: [
    {
      id: 't7-old-msg',
      kind: 'message',
      role: 'assistant',
      text: 'Session TTL is 24 hours; configured in src/auth/session.ts as SESSION_TTL_H = 24.',
      timestamp: '2026-02-01T10:00:00Z',
    },
    {
      id: 't7-old-decision',
      kind: 'decision',
      text: 'Long sessions (24h) are fine for internal tools',
      status: 'superseded',
      timestamp: '2026-02-01T10:05:00Z',
    },
    {
      id: 't7-new-decision',
      kind: 'decision',
      text: 'Security review: session TTL must be 1 hour, refresh tokens 7 days',
      status: 'accepted',
      constraints: ['SESSION_TTL_H must equal 1', 'Refresh token rotation must stay enabled'],
      timestamp: '2026-03-01T09:00:00Z',
    },
    {
      id: 't7-new-msg',
      kind: 'message',
      role: 'user',
      text: 'Security asked us to shorten sessions; update src/auth/session.ts accordingly',
      timestamp: '2026-03-01T09:10:00Z',
    },
    { id: 't7-noise', kind: 'note', text: 'Lunch plan: ramen.', timestamp: '2026-03-01T12:00:00Z' },
  ],
  requiredFacts: ['SESSION_TTL_H must equal 1', 'refresh tokens 7 days'],
  relevantRecordIds: ['t7-new-decision', 't7-new-msg'],
};

// ---------------------------------------------------------------------------
// 8. Tight context budgets
// ---------------------------------------------------------------------------

const bigFileContent = Array.from(
  { length: 120 },
  (_, i) => `export const value${i} = compute${i}({ retries: 3, delay: 100 });`,
).join('\n');

export const tightBudget: Scenario = {
  name: 'tight-budget',
  category: '8. Tight context budgets',
  task: 'Find why compute7 rejects in src/lib/compute.ts',
  budget: 700,
  records: [
    {
      id: 't8-msg',
      kind: 'message',
      role: 'user',
      text: 'compute7 rejects with an assertion error; see src/lib/compute.ts',
      timestamp: T0,
    },
    {
      id: 't8-error',
      kind: 'error',
      message:
        'AssertionError: expected positive delay\n    at compute7 (src/lib/compute.ts:8:11)',
      path: 'src/lib/compute.ts',
      timestamp: T1,
    },
    {
      id: 't8-bigfile',
      kind: 'file',
      path: 'src/lib/compute.ts',
      content: bigFileContent,
      timestamp: T1,
    },
    { id: 't8-noise1', kind: 'note', text: 'Remember to water the plants.', timestamp: T1 },
    { id: 't8-noise2', kind: 'note', text: 'The quarterly report is due Friday.', timestamp: T1 },
  ],
  requiredFacts: ['compute7', 'AssertionError'],
  relevantRecordIds: ['t8-msg', 't8-error'],
};

// ---------------------------------------------------------------------------
// 9. Impossible budget (conflict reporting)
// ---------------------------------------------------------------------------

export const impossibleBudget: Scenario = {
  name: 'impossible-budget',
  category: '8b. Impossible budget (conflict reporting)',
  task: 'Keep the payment constraint while using a tiny budget',
  budget: 60,
  records: [
    {
      id: 't9-decision',
      kind: 'decision',
      text: 'Payment idempotency keys must be unique per order',
      status: 'accepted',
      timestamp: T0,
    },
    { id: 't9-noise', kind: 'note', text: 'Some noise that should lose to the constraint.', timestamp: T1 },
  ],
  requiredFacts: ['Payment idempotency keys must be unique per order'],
  relevantRecordIds: ['t9-decision'],
};

export const ALL_SCENARIOS: Scenario[] = [
  repeatedToolOutputs,
  longDebuggingSession,
  errorsAndStackTraces,
  previousFailedAttempts,
  decisionsAndConstraints,
  multiFileDependencies,
  staleInformation,
  tightBudget,
  impossibleBudget,
];



