#!/usr/bin/env node
/**
 * CLI entry for the mcp-context-optimizer.
 *
 * MCP server mode (default):
 *   mcp-ctx-optimizer [--persist <path>]
 *
 * Standalone build mode:
 *   mcp-ctx-optimizer build --task "Fix auth" --records session.json
 *   cat session.json | mcp-ctx-optimizer build --task "Fix auth" --stdin
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { startContextOptimizerStdio } from './server.js';
import { ContextOptimizer } from '../optimizer.js';
import type { InputRecord } from '../types.js';

function printHelp(): void {
  console.error(`mcp-context-optimizer CLI

Usage:
  mcp-ctx-optimizer [--persist <path>]     Start MCP server over stdio
  mcp-ctx-optimizer build [options]         Build compact context for a task

build options:
  --task <text>          Task description (required)
  --records <file>       JSON file with records array
  --stdin                Read records JSON from stdin
  --token-budget <n>     Token budget (default 12000)
  --query <text>         Additional relevance query
  --output <file>        Write context to file (default: stdout)

Examples:
  mcp-ctx-optimizer build --task "Fix auth" --records session.json
  cat session.json | mcp-ctx-optimizer build --task "Fix auth" --stdin
`);
}

interface BuildArgs {
  task?: string;
  records?: string;
  stdin?: boolean;
  tokenBudget?: string;
  query?: string;
  output?: string;
}

function parseBuildArgs(argv: string[]): BuildArgs {
  const args: BuildArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--task') args.task = argv[++i];
    else if (arg === '--records') args.records = argv[++i];
    else if (arg === '--stdin') args.stdin = true;
    else if (arg === '--token-budget') args.tokenBudget = argv[++i];
    else if (arg === '--query') args.query = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--help' || arg === '-h') args.task = 'help';
  }
  return args;
}

async function readRecordsFromStdin(): Promise<InputRecord[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? (parsed as InputRecord[]) : (parsed as { records?: InputRecord[] }).records ?? [];
}

async function runBuild(args: BuildArgs): Promise<void> {
  if (args.task === 'help') {
    printHelp();
    return;
  }

  if (!args.task) {
    console.error('Error: --task is required');
    printHelp();
    process.exitCode = 1;
    return;
  }

  // Load records
  let records: InputRecord[] = [];
  if (args.records) {
    if (!existsSync(args.records)) {
      console.error(`Error: records file not found: ${args.records}`);
      process.exitCode = 1;
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(args.records, 'utf8')) as unknown;
      records = Array.isArray(raw) ? (raw as InputRecord[]) : (raw as { records?: InputRecord[] }).records ?? [];
    } catch (err) {
      console.error(`Error: failed to parse records file: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
  } else if (args.stdin) {
    try {
      records = await readRecordsFromStdin();
    } catch (err) {
      console.error(`Error: failed to parse stdin: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
  }

  const optimizer = new ContextOptimizer({
    tokenBudget: args.tokenBudget ? Number(args.tokenBudget) : undefined,
  });

  const result = optimizer.buildContextSync({
    task: args.task,
    records,
    ...(args.query ? { query: args.query } : {}),
    ...(args.tokenBudget ? { tokenBudget: Number(args.tokenBudget) } : {}),
  });

  // Output
  if (args.output) {
    writeFileSync(args.output, result.context, 'utf8');
    console.error(`Context written to ${args.output}`);
  } else {
    process.stdout.write(result.context);
  }
  process.stderr.write(
    `[mcp-context-optimizer] ${result.stats.estimatedInputTokens} -> ${result.stats.estimatedOutputTokens} tokens (${(result.stats.reductionRatio * 100).toFixed(0)}% reduction)\n`,
  );
}

function parseMcpArgs(argv: string[]): { persist?: string } {
  const args: { persist?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--persist') args.persist = argv[++i];
  }
  return args;
}

function main(): void {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length > 0 && rawArgs[0] === 'build') {
    const buildArgs = parseBuildArgs(rawArgs.slice(1));
    runBuild(buildArgs).catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
    return;
  }

  const mcpArgs = parseMcpArgs(rawArgs);
  startContextOptimizerStdio({
    ...(mcpArgs.persist ? { persistPath: mcpArgs.persist } : {}),
  });
}

main();