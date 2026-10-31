---
name: mcp-context-optimizer-pro
description: Pro version of mcp-context-optimizer with advanced profiles, reference fixtures, and automation scripts.
---

# MCP Context Optimizer — Pro Skill

## Purpose

Use the `mcp-context-optimizer` MCP server to select task-relevant evidence, reduce duplicate context, and produce a compact context with source provenance and an optimization report.

This Pro version extends the Free Skill with:
The server is deterministic and local-first. It does not call an external AI model or automatically inspect the user's workspace or conversation. The agent must explicitly provide records or pass records inline to the available tools.

## Before using it

1. Confirm the MCP server is connected and its tools are available.
2. If the tools are unavailable, explain that the server must be installed and configured separately.
3. Do not send secrets, credentials, private keys, or unrelated sensitive data to the optimizer.
4. Only pass file contents or session data that are already available to you and relevant to the user's task.

## Recommended workflow

### 1. Choose an optimization profile

Pro version provides pre-defined profiles in `profiles/` folder:
- `debug.json` — optimizes for retaining error traces and test failures
- `review.json` — balances code context with user decisions and constraints
- `refactor.json` — maximizes file history and diff retention within budget

Use these profiles to pre-configure `tokenBudget` and `query` parameters before calling `build_context`.

### 2. Gather only relevant records

Use information available in the current agent session. Supported record kinds:
- `message`: role + text
- `tool_call`: toolName + output
- `error`: message + optional path
- `file`: path + content
- `diff`: diff + optional path
- `test_result`: command + failed count
Prefer `build_context` for a task-specific result. Provide:
- `task`: the concrete task to solve;
- optionally `query`: extra terms or identifiers;
- optionally `tokenBudget`: the desired budget (use profiles from `profiles/` folder);
- optionally `records`: relevant records to include inline.

### 4. Inspect the result before relying on it

Review:
- `context`: the compact context text;
- `sources`: what was retained and why;
- `omitted`: what was left out and the reason;
- `report` and `stats`: reduction and budget information.

Pro tip: Use the `scripts/analyze-report.ts` tool to visualize the optimization report.

### 5. Use the result responsibly

- Treat the generated context as an aid, not as proof that the task is solved.
- Preserve accepted decisions, user requirements, and security constraints.
- Verify important claims against the original source when possible.
- Do not claim exact token counts unless a real tokenizer was configured.

## Available MCP tools

- `ingest_records` — add validated records to the in-memory store.
- `search_context` — search stored records, optionally adding inline records.
- `get_decisions` — retrieve recorded decisions and constraints.
- `get_relevant_errors` — retrieve errors and failed attempts.
- `get_file_history` — retrieve stored records associated with a file path.
- `build_context` — build compact task-specific context.

## Pro Features

### Optimization Profiles
Located in `profiles/`:
- `debug.json` — optimized for debugging sessions
- `review.json` — optimized for code reviews
- `refactor.json` — optimized for refactoring tasks

### Reference Fixtures
Located in `references/fixtures/`:
- `sample-errors.json` — realistic error log samples
- `sample-test-results.json` — test failure patterns

### Automation Scripts
Located in `scripts/`:
- `analyze-report.ts` — visualizes optimization reports
- `prepare-context.ts` — prepares records from files

## Limitations

This Skill is instruction text, not an MCP server implementation. It does not add tools, install dependencies, persist records, or intercept model requests.
- `decision`: text + status + constraints
- `note`: text

### 3. Build the context
- Pre-defined optimization profiles (`debug`, `review`, `refactor`)
- Reference fixtures and sample data for testing
- Automation scripts and advanced usage patterns