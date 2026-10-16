import { describe, expect, it } from 'vitest';

import { ContextOptimizer } from '../src/optimizer.js';
import { InMemoryContextStore } from '../src/store.js';
import type { InputRecord } from '../src/types.js';

describe('InMemoryContextStore', () => {
  it('adds, lists and clears records', () => {
    const store = new InMemoryContextStore();
    store.add([
      { kind: 'note', text: 'a' },
      { kind: 'note', text: 'b' },
    ]);
    expect(store.all()).toHaveLength(2);
    store.clear();
    expect(store.all()).toHaveLength(0);
  });

  it('ignores malformed records on add', () => {
    const store = new InMemoryContextStore();
    store.add([{ kind: 'note', text: '' } as InputRecord]);
    expect(store.all()).toHaveLength(0);
  });

  it('filters decisions, errors and file history', () => {
    const store = new InMemoryContextStore();
    store.add([
      { kind: 'decision', text: 'use postgres', status: 'accepted' },
      { kind: 'error', message: 'boom', path: 'src/db.ts' },
      { kind: 'file', path: 'src/db.ts', content: 'export const x = 1;' },
      { kind: 'tool_call', toolName: 'migrate', exitCode: 1, output: 'failed' },
      { kind: 'test_result', failed: 1, failures: [{ name: 't', message: 'm', file: 'src/db.test.ts' }] },
    ]);
    expect(store.getDecisions()).toHaveLength(1);
    expect(store.getErrors()).toHaveLength(3);
    expect(store.getByFile('src/db.ts').length).toBeGreaterThanOrEqual(2);
    expect(store.getByFile('db.ts')).toHaveLength(2); // suffix match incl. test failure
  });

  it('is fully in-memory: no file writes, no network', async () => {
    const store = new InMemoryContextStore();
    store.add([{ kind: 'note', text: 'local only' }]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('network access attempted');
    }) as typeof fetch;
    try {
      const opt = new ContextOptimizer();
      const result = await opt.buildContext({ task: 'list notes', records: store.all() });
      expect(result.context).toContain('local only');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
