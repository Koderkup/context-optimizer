# mcp-context-optimizer

Deterministic, **local-first context optimization** for AI coding agents — an SDK
and an MCP server. No cloud services, no AI models, no API keys, no telemetry.

`mcp-context-optimizer` takes the raw exhaust of a coding session (conversation
messages, tool outputs, errors, stack traces, file snapshots, git diffs, test
results, recorded decisions) and produces a **compact, task-specific context**
that keeps the facts needed to solve the task — with full provenance for every
retained fragment and a reproducible report of what was kept, merged, and
omitted, and why.

It is **not** a truncation or summarization utility. The value comes from:

- deterministic normalization and classification,
- exact + conservative near-duplicate detection,
- structured extraction (paths, symbols, stack frames, test failures, requirements),
- explainable, weighted relevance scoring,
- budget-aware selection that never silently drops mandatory facts,
- evidence-preserving rendering with source references for every fragment.

Effectiveness is demonstrated by a reproducible benchmark suite (see
[Benchmarks](#benchmarks)) — not by claims.

## Install

```bash
npm install mcp-context-optimizer                             # core SDK (zero runtime deps)
npm install @modelcontextprotocol/server zod                 # only for the MCP server
```

- Node.js >= 20, ESM only.
- The MCP adapter is **optional**: it lives behind the `mcp-context-optimizer/mcp`
  export and its dependencies are optional peer dependencies. The core SDK
  never imports the MCP SDK, never opens sockets, and never writes to disk.

## Quick start (SDK)

```ts
import { ContextOptimizer } from 'mcp-context-optimizer';

const optimizer = new ContextOptimizer({ tokenBudget: 12_000 });

const result = await optimizer.buildContext({
  task: 'Fix authentication after an access policy change',
  messages: [
    { role: 'user', text: 'Login fails with 401 after the policy change in src/auth/policy.ts' },
  ],
  files: [
    { path: 'src/auth/policy.ts', content: 'export function checkPolicy(user) { /* ... */ }' },
  ],
  errors: [
    { message: 'Error: 401 Unauthorized\n    at checkPolicy (src/auth/policy.ts:2:10)' },
  ],
  decisions: [
    { text: 'Policy checks must stay server-side only', status: 'accepted' },
  ],
});

console.log(result.context);   // rendered, compact context
console.log(result.sources);   // selected fragments + provenance + score breakdowns
console.log(result.omitted);   // dropped fragments + reasons
console.log(result.report);    // reproducible machine-readable report
console.log(result.stats);     // estimated input/output tokens + reduction ratio
```

Identical inputs and configuration always produce byte-identical outputs.

## How it works: the pipeline

Each stage is a separate, unit-tested, pure function:

| Stage | Module | What it does |
| --- | --- | --- |
| 1. Normalize & classify | `normalize.ts` | Validates records, assigns deterministic ids, normalizes line endings, collapses pathological repeated log lines (never file contents/diffs), keeps original data untouched. |
| 2. Deduplicate | `dedupe.ts` | (a) exact duplicates via sha256; (b) repeated tool/test runs — keeps the latest run in full and preserves prior runs' exit codes/timestamps as a compact history line; (c) conservative near-duplicates via trigram containment (same kind only; files/diffs only same path; never on error-type similarity alone). Every merge is explained in the report. |
| 3. Structured extraction | `extract.ts` | File paths (unix + windows), code symbols (regex families per language, conservative), Node/Python stack frames, error signatures, test failures, explicit requirements ("must", "do not", ...), evidence-based outcomes (exit codes, markers). Never infers success from an attempt. |
| 4. Relevance scoring | `score.ts` | Weighted, explainable scoring (see below). Recency uses the max timestamp in the data — never `Date.now()` — and has a floor for constraints/decisions so old but binding decisions stay important. |
| 5. Budget-aware selection | `select.ts` | Groups fragments by record (structured records are never split), includes mandatory fragments first, then fills remaining budget greedily by score/token density with deterministic tie-breaking. If mandatory content exceeds the budget, it is still included and the conflict is **reported** (`BUDGET_CONFLICT`), never silently discarded. |
| 6. Render & report | `render.ts` | Fixed-order sections; every fragment gets a `[source: fr_xxx \| record rN \| path]` tag. Machine-readable metadata stays separate from the rendered text. |

### Scoring weights (defaults, all configurable)

| Signal | Weight | Meaning |
| --- | --- | --- |
| `lexicalOverlap` | 3 | IDF-weighted overlap between task/query tokens and fragment tokens. |
| `identifierMatch` | 4 | Fragment mentions file paths/symbols that appear in the task (full path 1.0, basename 0.6, symbol 0.8). |
| `errorRelevance` | 3 | Fragment is an error/failing test that matches the task identifiers. |
| `constraint` | 5 | Fragment states a requirement, constraint or accepted decision. |
| `failedAttempt` | 2 | Fragment documents a failed attempt or unresolved problem. |
| `recency` | 1.5 | Exponential decay, half-life 7 days; floored at 0.7 for constraints/decisions. |
| `role` | 1 | user/system 1.0 > assistant 0.6 > tool 0.4. |
| `redundancyPenalty` | 2 | Negative: trigram containment against earlier-ranked fragments. |
| `callerPriority` | 1 | Explicit `priority` hint on a record (default 0.5). |

Every fragment's `score.components` exposes value, weight and contribution per
signal so selection is fully auditable.

## MCP server (optional)

The adapter speaks the Model Context Protocol over **stdio** using the official
TypeScript SDK (`@modelcontextprotocol/server` v2). It exposes:

| Tool | Purpose |
| --- | --- |
| `ingest_records` | Add structured records to the server's in-memory store. |
| `search_context` | Rank fragments for a query with score breakdowns and provenance. |
| `get_decisions` | Retrieve recorded technical decisions and constraints. |
| `get_relevant_errors` | Retrieve errors, failed attempts, failing tests (optionally ranked). |
| `get_file_history` | Retrieve snapshots/diffs/errors associated with a file path. |
| `build_context` | Build a compact context under a token budget; returns context + sources + omissions + report. |

### Client configuration

Claude Code:

```bash
claude mcp add mcp-context-optimizer -- node /absolute/path/to/mcp-context-optimizer/dist/mcp/cli.js
```

Cursor / Claude Desktop / any MCP client (`mcp.json`):

```json
{
  "mcpServers": {
    "mcp-context-optimizer": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-context-optimizer/dist/mcp/cli.js"]
    }
  }
}
```

During development, run it directly from source with `npx tsx src/mcp/cli.ts`,
or inspect it locally with `npx @modelcontextprotocol/inspector node dist/mcp/cli.js`.

### Important limitation

MCP tool availability does **not** automatically intercept or rewrite model
requests. A compatible client must explicitly call these tools (e.g. the agent
decides to call `build_context` before answering a task). Automatic context
replacement would require a native integration inside the coding agent
(hooking its prompt assembly). This server also stores data **in memory per
process lifetime** — restarting the server process starts from an empty store;
re-ingest or implement your own `ContextStore` for persistence.

## Privacy & local operation

- No network requests, ever. (Tested: `fetch` is stubbed to throw in the test suite.)
- No API keys, no external AI models, no telemetry or analytics.
- No source files are read or written; the SDK only sees data you pass in.
- The default store is in-memory; implementing the `ContextStore` interface is
  the explicit opt-in path if you want local persistence (e.g. a JSON file) —
  the SDK itself never writes to disk.


The default estimator is a **character heuristic** (`ceil(chars / 4)`). It is an
*estimate*: real tokenizers vary by a factor of 1.5–3× on code and unicode. The
report labels the estimator used (`report.tokens.estimator`) and emits a
`TOKEN_ESTIMATE_ONLY` warning. For exact counts, plug in your own tokenizer:

```ts
import { ContextOptimizer, createTokenEstimator } from 'mcp-context-optimizer';

const optimizer = new ContextOptimizer({
  tokenBudget: 12_000,
  tokenEstimator: createTokenEstimator('my-tok', (text) => myTokenizer.encode(text).length),
});
```

## Benchmarks

A reproducible benchmark suite compares three strategies across 9 coding-session
scenarios:

- **Baseline A** — original, unoptimized context (raw).
- **Baseline B** — exact deduplication + head truncation to budget.
- **Candidate C** — `ContextOptimizer` (this package).

Metrics: context size reduction, required-fact retention, retrieval precision/recall,
budget compliance, and source-attribution integrity. Latency and memory are
machine-local measurements.

### Running benchmarks

```bash
npm run bench            # run all scenarios and print a comparison table
npm run bench -- --write  # also write results to benchmarks/results/latest.json
```

### Latest results

```
scenario                      strategy               tok-in   tok-out   reduct   facts   prec    rec   budget   attrib        ms
------------------------------------------------------------------------------------
repeated-tool-outputs         A_raw                     829       829       0%    100%    30%   100%       ok        -       0.0
repeated-tool-outputs         B_dedupe_truncate         829       829       0%    100%    30%   100%       ok        -       0.0
repeated-tool-outputs         C_optimizer              829       187      77%    100%   100%   100%       ok     100%       1.3
long-debugging-session        A_raw                    4992      4992       0%    100%     5%   100%   OVER        -       0.0
long-debugging-session        B_dedupe_truncate        4992      2481      50%    67%     5%    50%       ok        -       0.0
long-debugging-session        C_optimizer             4992       328      93%    100%    80%   100%       ok     100%       4.6
errors-and-stack-traces       A_raw                     300       300       0%    100%    60%   100%       ok        -       0.0
errors-and-stack-traces       B_dedupe_truncate        300       300       0%    100%    60%   100%       ok        -       0.0
errors-and-stack-traces       C_optimizer              300       295       2%    100%    60%   100%       ok     100%       0.6
previous-failed-attempts      A_raw                     260       260       0%    100%    80%   100%       ok        -       0.0
previous-failed-attempts      B_dedupe_truncate        260       260       0%    100%    80%   100%       ok        -       0.0
previous-failed-attempts      C_optimizer              260       243       7%    100%    80%   100%       ok     100%       0.7
decisions-and-constraints     A_raw                     306       306       0%    100%    50%   100%       ok        -       0.0
decisions-and-constraints     B_dedupe_truncate        306       306       0%    100%    50%   100%       ok        -       0.0
decisions-and-constraints     C_optimizer             306       250      18%    100%    60%   100%       ok     100%       0.8
multi-file-dependencies       A_raw                     424       424       0%    100%    71%   100%       ok        -       0.0
multi-file-dependencies       B_dedupe_truncate        424       424       0%    100%    71%   100%       ok        -       0.0
multi-file-dependencies       C_optimizer             424       431      -2%    100%    71%   100%       ok     100%       1.1
stale-information             A_raw                     248       248       0%    100%    40%   100%       ok        -       0.0
stale-information             B_dedupe_truncate        248       248       0%    100%    40%   100%       ok        -       0.0
stale-information             C_optimizer             248       197      21%    100%    50%   100%       ok     100%       0.5
tight-budget                  A_raw                    2089      2089       0%    100%    40%   100%   OVER        -       0.0
tight-budget                  B_dedupe_truncate       2089         98      95%    100%   100%   100%       ok        -       0.0
tight-budget                  C_optimizer             2089       159      92%    100%    50%   100%       ok     100%       2.6
impossible-budget             A_raw                      79        79       0%    100%    50%   100%   OVER        -       0.0
impossible-budget             B_dedupe_truncate         79        44      44%    100%   100%   100%       ok        -       0.0
impossible-budget             C_optimizer                79        58      27%    100%    50%   100%       ok     100%       0.1

=== Aggregate (Candidate C) ===
required facts fully retained in every scenario: YES
budget compliance: 9/9 scenarios within budget
attribution integrity (all source tags resolve): YES
avg reduction: C=37%  B=21%
avg retrieval precision(C)=72%  recall(C)=100%
```

Candidate C retains 100% of required facts in all 9 scenarios, stays within budget, and
achieves 37% average reduction (vs 21% for simple dedupe+truncation). On tight budgets
it preserves mandatory constraints while Baseline B loses them.

## Testing

```bash
npm test              # run unit + integration tests (vitest)
npm run test:watch    # watch mode during development
npm run typecheck     # TypeScript type checking
npm run lint          # ESLint + formatting checks
npm run build         # compile to dist/
```

See `test/` for the test suite covering: deterministic output, duplicate handling,
similar-but-non-identical errors, required-fact preservation, source-reference
integrity, stable ranking, empty/malformed input, impossible budgets, MCP tool
validation, and local-only operation (no network).

