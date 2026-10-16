import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createContextOptimizerServer } from '../src/mcp/server.js';
import { InMemoryContextStore } from '../src/store.js';
import type { DecisionRecord, InputRecord } from '../src/types.js';

type ToolContent = { type: string; text: string };

function parseJson(result: { content: ToolContent[] }): unknown {
  const text = result.content.find((c) => c.type === 'text')?.text ?? '';
  return JSON.parse(text);
}

describe('MCP adapter (in-memory transport)', () => {
  const store = new InMemoryContextStore();
  let client: Client;

  beforeAll(async () => {
    const server = createContextOptimizerServer({ store });
    client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  it('lists all expected tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'build_context',
      'get_decisions',
      'get_file_history',
      'get_relevant_errors',
      'ingest_records',
      'search_context',
    ]);
  });

  it('ingests valid records and reports rejected malformed ones', async () => {
    const result = await client.callTool({
      name: 'ingest_records',
      arguments: {
        records: [
          { kind: 'decision', text: 'Auth must use RS256 signing', status: 'accepted', id: 'd1' },
          { kind: 'error', message: 'TypeError: bad token at verify (src/auth.ts:9:3)', id: 'e1' },
          { kind: 'file', path: 'src/auth.ts', content: 'export const alg = "RS256";', id: 'f1' },
          { kind: 'note', text: '' }, // malformed: empty text
        ],
      },
    });
    const data = parseJson(result as { content: ToolContent[] }) as {
      accepted: string[];
      rejected: Array<{ index: number; reason: string }>;
      totalStored: number;
    };
    expect(data.accepted).toEqual(['d1', 'e1', 'f1']);
    expect(data.rejected).toHaveLength(1);
    expect(data.totalStored).toBe(3);
  });

  it('get_decisions returns stored decisions with status', async () => {
    const result = await client.callTool({ name: 'get_decisions', arguments: {} });
    const data = parseJson(result as { content: ToolContent[] }) as {
      decisions: Array<{ id: string; status: string }>;
    };
    expect(data.decisions).toHaveLength(1);
    expect(data.decisions[0]).toMatchObject({ id: 'd1', status: 'accepted' });
  });

  it('search_context ranks relevant fragments with score breakdowns', async () => {
    const result = await client.callTool({
      name: 'search_context',
      arguments: { query: 'RS256 signing', limit: 5 },
    });
    const data = parseJson(result as { content: ToolContent[] }) as {
      hits: Array<{ id: string; score: { total: number; components: Record<string, unknown> } }>;
    };
    expect(data.hits.length).toBeGreaterThan(0);
    expect(data.hits[0]?.score.total).toBeGreaterThan(0);
    expect(Object.keys(data.hits[0]?.score.components ?? {})).toContain('lexicalOverlap');
  });

  it('get_relevant_errors filters and ranks errors', async () => {
    const result = await client.callTool({
      name: 'get_relevant_errors',
      arguments: { query: 'token verify' },
    });
    const data = parseJson(result as { content: ToolContent[] }) as {
      errors: Array<{ text: string }>;
    };
    expect(data.errors.some((e) => e.text.includes('TypeError'))).toBe(true);
  });

  it('get_file_history returns records for a path', async () => {
    const result = await client.callTool({
      name: 'get_file_history',
      arguments: { path: 'src/auth.ts' },
    });
    const data = parseJson(result as { content: ToolContent[] }) as {
      records: Array<{ id: string }>;
    };
    expect(data.records.map((r) => r.id)).toContain('f1');
  });

  it('build_context returns context with provenance and report', async () => {
    const args = { task: 'Fix RS256 token verification in src/auth.ts', tokenBudget: 2000 };
    const result = await client.callTool({ name: 'build_context', arguments: args });
    const data = parseJson(result as { content: ToolContent[] }) as {
      context: string;
      sources: Array<{ id: string }>;
      report: { totals: unknown; tokens: unknown };
    };
    expect(data.context).toContain('# Task');
    expect(data.context).toContain('RS256');
    expect(data.sources.length).toBeGreaterThan(0);
    expect(data.report).toHaveProperty('tokens');
    // Determinism over the wire.
    const again = await client.callTool({ name: 'build_context', arguments: args });
    expect((again as { content: ToolContent[] }).content[0]?.text).toBe(
      (result as { content: ToolContent[] }).content[0]?.text,
    );
  });

  it('rejects invalid tool input before the handler runs', async () => {
    const result = await client.callTool({ name: 'build_context', arguments: {} });
    const text = (result as { content: ToolContent[] }).content[0]?.text ?? '';
    expect(text).toContain('Invalid arguments');
    expect((result as { isError?: boolean }).isError).toBe(true);
  });

  it('supports inline records without ingestion', async () => {
    const records: Array<InputRecord | DecisionRecord> = [
      {
        kind: 'message',
        role: 'user',
        text: 'payment webhook signature fails in src/payments/verify.ts',
      },
      {
        kind: 'decision',
        text: 'Webhook secrets must be compared in constant time',
        status: 'accepted',
      },
    ];
    const result = await client.callTool({
      name: 'build_context',
      arguments: { task: 'Fix payment webhook signature failure', records },
    });
    const data = parseJson(result as { content: ToolContent[] }) as { context: string };
    expect(data.context).toContain('constant time');
    expect(data.context).toContain('webhook signature');
  });

  it('never requires network access', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('network access attempted');
    }) as typeof fetch;
    try {
      const result = await client.callTool({ name: 'get_decisions', arguments: {} });
      expect(result).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

