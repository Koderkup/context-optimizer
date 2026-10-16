import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

import { ContextOptimizer } from '../optimizer.js';
import { validateRecord } from '../normalize.js';
import { InMemoryContextStore, filterByFile, filterDecisions, filterErrors } from '../store.js';
import type { ContextStore } from '../store.js';
import type { DecisionRecord, InputRecord, OptimizerOptions } from '../types.js';

/**
 * MCP adapter exposing the context-optimizer core over the Model Context
 * Protocol. Optional: the core SDK never imports this module; only clients
 * that explicitly import `context-optimizer/mcp` (or run the CLI) load it.
 *
 * Limitation: MCP tools require explicit calls from the client. This server
 * does not intercept or rewrite model requests; a host agent must decide to
 * call these tools (or a native integration must be built into the agent).
 */

const recordSchema = z.looseObject({
  kind: z.enum([
    'message',
    'tool_call',
    'error',
    'file',
    'diff',
    'test_result',
    'decision',
    'note',
  ]),
});

/** Server-level instructions surfaced to MCP clients where supported. */
export const SERVER_INSTRUCTIONS = `Deterministic, local-first context optimizer.
Records must first be added with ingest_records (or passed inline to build_context).
This server never makes network requests and stores data in memory only (per process lifetime).`;

export interface McpAdapterOptions {
  /** Store backing the server. Defaults to a fresh in-memory store. */
  store?: ContextStore;
  /** Optimizer configuration (token budget, weights, ...). */
  optimizer?: OptimizerOptions;
  serverInfo?: { name?: string; version?: string };
}

/** Serialize a value as pretty JSON text content block. */
function jsonResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/**
 * Create an McpServer with all context-optimizer tools registered.
 * The returned server is not connected to any transport until the caller
 * wires one (use {@link startContextOptimizerStdio} for stdio).
 */
export function createContextOptimizerServer(options: McpAdapterOptions = {}): McpServer {
  const store = options.store ?? new InMemoryContextStore();
  const optimizer = new ContextOptimizer(options.optimizer ?? {});
  const server = new McpServer({
    name: options.serverInfo?.name ?? 'context-optimizer',
    version: options.serverInfo?.version ?? '0.1.0',
  });

  server.registerTool(
    'ingest_records',
    {
      description:
        'Add structured records (messages, tool calls, errors, files, diffs, test results, decisions, notes) to the local in-memory context store. Records are validated; malformed entries are reported and skipped.',
      inputSchema: z.object({
        records: z
          .array(recordSchema)
          .min(1)
          .describe('Array of records; each must have a "kind" field plus kind-specific fields.'),
      }),
    },
    async ({ records }) => {
      const accepted: string[] = [];
      const rejected: Array<{ index: number; reason: string }> = [];
      for (const [index, rec] of records.entries()) {
        const error = validateRecord(rec as unknown as InputRecord);
        if (error) {
          rejected.push({ index, reason: error });
          continue;
        }
        store.add([rec as unknown as InputRecord]);
        accepted.push((rec as { id?: string }).id ?? `#${index}`);
      }
      return jsonResult({ accepted, rejected, totalStored: store.all().length });
    },
  );

  server.registerTool(
    'search_context',
    {
      description:
        'Retrieve fragments relevant to a query, ranked by the explainable relevance model. Returns fragments with score breakdowns and provenance (never modifies sources).',
      inputSchema: z.object({
        query: z.string().min(1).describe('Natural-language query or task description.'),
        limit: z.number().int().min(1).max(100).optional().describe('Max fragments to return (default 10).'),
        records: z
          .array(recordSchema)
          .optional()
          .describe('Optional records to search inline, in addition to stored records.'),
      }),
    },
    async ({ query, limit, records }) => {
      const all = [...store.all(), ...((records as unknown as InputRecord[]) ?? [])];
      const hits = optimizer.search({ query, records: all, ...(limit ? { limit } : {}) });
      return jsonResult({
        query,
        count: hits.length,
        hits: hits.map((h) => ({
          id: h.fragment.id,
          kind: h.fragment.kind,
          text: h.fragment.text,
          provenance: h.fragment.provenance,
          score: h.score,
        })),
      });
    },
  );

  server.registerTool(
    'get_decisions',
    {
      description:
        'Retrieve previously recorded technical decisions and constraints (accepted, proposed, superseded, rejected).',
      inputSchema: z.object({}),
    },
    async () => {
      const decisions: DecisionRecord[] = store.getDecisions?.() ?? filterDecisions(store.all());
      return jsonResult({
        count: decisions.length,
        decisions: decisions.map((d) => ({
          id: d.id,
          status: d.status,
          text: d.text,
          constraints: d.constraints ?? [],
          timestamp: d.timestamp ?? null,
          supersedes: d.supersedes ?? null,
        })),
      });
    },
  );

  server.registerTool(
    'get_relevant_errors',
    {
      description:
        'Retrieve related errors, failed attempts and diagnostic information (error records, failed tool calls, failing tests). Optionally ranked by a query.',
      inputSchema: z.object({
        query: z.string().optional().describe('Optional relevance query; omit for all errors.'),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async ({ query, limit }) => {
      const errors = store.getErrors?.() ?? filterErrors(store.all());
      if (!query) {
        return jsonResult({
          count: errors.length,
          errors: errors.map((e) => ({ id: e.id, kind: e.kind, record: e })),
        });
      }
      const hits = optimizer.search({
        query,
        records: errors,
        ...(limit ? { limit } : {}),
      });
      return jsonResult({
        count: hits.length,
        errors: hits.map((h) => ({
          id: h.fragment.id,
          kind: h.fragment.kind,
          text: h.fragment.text,
          provenance: h.fragment.provenance,
          score: h.score,
        })),
      });
    },
  );

  server.registerTool(
    'get_file_history',
    {
      description:
        'Retrieve context associated with a particular file: file snapshots, diffs, errors and test failures pointing at that path.',
      inputSchema: z.object({
        path: z.string().min(1).describe('File path (absolute, relative, or basename).'),
      }),
    },
    async ({ path }) => {
      const records = store.getByFile?.(path) ?? filterByFile(store.all(), path);
      return jsonResult({
        path,
        count: records.length,
        records: records.map((r) => ({ id: r.id, kind: r.kind, record: r })),
      });
    },
  );

  server.registerTool(
    'build_context',
    {
      description:
        'Construct a compact, task-specific context under a token budget. Combines stored records with any inline records; returns the rendered context plus provenance, omissions and a reproducible optimization report. Token counts are estimates unless a custom estimator is configured server-side.',
      inputSchema: z.object({
        task: z.string().min(1).describe('The current task description.'),
        query: z.string().optional().describe('Additional relevance terms.'),
        tokenBudget: z.number().int().min(1).optional().describe('Override the server token budget.'),
        records: z
          .array(recordSchema)
          .optional()
          .describe('Optional inline records to include in addition to stored records.'),
      }),
    },
    async ({ task, query, tokenBudget, records }) => {
      const all = [...store.all(), ...((records as unknown as InputRecord[]) ?? [])];
      const result = optimizer.buildContextSync({
        task,
        ...(query ? { query } : {}),
        records: all,
        ...(tokenBudget ? { tokenBudget } : {}),
      });
      return jsonResult({
        context: result.context,
        stats: result.stats,
        sources: result.sources.map((s) => ({
          id: s.fragment.id,
          recordId: s.fragment.recordId,
          kind: s.fragment.kind,
          label: s.fragment.provenance.source.label,
          selectionReason: s.selectionReason,
          score: s.fragment.score?.normalized ?? null,
        })),
        omitted: result.omitted,
        report: result.report,
      });
    },
  );

  return server;
}

/**
 * Start the adapter over stdio. stdout is reserved for the JSON-RPC
 * protocol; any diagnostics must go to stderr.
 */
export function startContextOptimizerStdio(options: McpAdapterOptions = {}): void {
  serveStdio(() => createContextOptimizerServer(options));
  console.error(
    'context-optimizer MCP server listening on stdio (in-memory store; no network access)',
  );
}


