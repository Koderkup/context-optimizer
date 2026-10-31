# MCP Context Optimizer — Pro Skill

A professional workflow for using the `mcp-context-optimizer` MCP server with advanced optimization profiles, reference fixtures, automation scripts, and real benchmark data.

## What is included

- `SKILL.md` — agent-facing workflow and tool guidance (Pro version with advanced workflows)
- `README.md` — overview of the Pro package
- `AGENSI-LISTING-PRO.md` — listing description for Agensi marketplace
- `CASE-STUDY.md` — real benchmark data showing token savings
- `bench/token-comparison.json` — structured benchmark data
- `setup/INSTALLATION.md` — setup notes and client configuration examples
- `setup/mcp-config.example.json` — template for MCP configuration
- `setup/claude-code-command.txt` — Claude Code CLI setup command
- `profiles/debug.json` — optimization profile for debugging sessions
- `profiles/review.json` — optimization profile for code reviews
- `profiles/refactor.json` — optimization profile for refactoring tasks
- `references/tool-reference.md` — complete tool reference
- `references/troubleshooting.md` — common issues and solutions
- `references/fixtures/sample-errors.json` — sample error data
- `references/fixtures/sample-test-results.json` — sample test data
- `scripts/analyze-report.ts` — report visualization tool
- `scripts/prepare-context.ts` — context preparation automation
- `examples/pro-debugging-session.md` — advanced example scenario

## Requirements

- Node.js 20 or newer
- The npm package `mcp-context-optimizer`
- An MCP-compatible client (Claude Code, Cursor, Copilot, etc.)

## Installation

1. Configure the MCP server using `setup/INSTALLATION.md`
2. Import this Pro Skill using the conventions of your agent or marketplace
3. Confirm the six MCP tools are visible
4. Try the case study in `CASE-STUDY.md`
5. Use the profiles in `profiles/` to optimize your workflow

## Benchmark Results

Real measurements from `bench-real.ts`:

| Scenario | Input Tokens | Output Tokens | Savings |
| -------- | ------------ | ------------- | ------- |
| Debugging Session | 2,223 | 976 | **56%** |
| Code Review | 1,309 | 1,085 | **17%** |
| **Average** | **1,766** | **1,031** | **37%** |

Average savings based on real tests: **37%**. 
Higher savings (up to 56%) with heavy duplication.

See `CASE-STUDY.md` for full analysis and cost calculation.

## Pro Features

### Optimization Profiles

Pre-defined configurations for common scenarios:

- **debug.json**: Retains error traces, stack traces, and failed test outputs
- **review.json**: Balances code context with decisions and constraints
- **refactor.json**: Maximizes file history and diff retention

### Reference Fixtures

Sample data to help you understand record structures:

- `sample-errors.json`: Realistic error log samples
- `sample-test-results.json`: Test failure patterns

### Automation Scripts

Helper scripts for enhanced workflows:

- `analyze-report.ts`: Visualizes optimization reports
- `prepare-context.ts`: Prepares records from files before calling `build_context`

## License

MIT — Skill materials in this archive are also offered under MIT.

Repository: [https://github.com/Koderkup/context-optimizer](https://github.com/Koderkup/context-optimizer)  
npm package: [https://www.npmjs.com/package/mcp-context-optimizer](https://www.npmjs.com/package/mcp-context-optimizer)
