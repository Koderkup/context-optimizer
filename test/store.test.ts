import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { ContextOptimizer } from '../src/optimizer.js';
import { FileContextStore, InMemoryContextStore } from '../src/store.js';
import type { InputRecord } from '../src/types.js';

const tmpDir = join(tmpdir(), `mcp-store-test-${Date.now()}`);
afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

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

describe('FileContextStore', () => {
  it('starts empty when the file does not exist', () => {
    const path = join(tmpDir, 'empty.json');
    const store = new FileContextStore(path);
    expect(store.all()).toHaveLength(0);
  });

  it('persists records to disk and restores them on restart', () => {
    const path = join(tmpDir, 'persist.json');
    const store1 = new FileContextStore(path);
    store1.add([
      { kind: 'note', text: 'hello' },
      { kind: 'decision', text: 'use TS', status: 'accepted' },
    ]);
    expect(store1.all()).toHaveLength(2);

    // Simulate a server restart: new instance, same path.
    const store2 = new FileContextStore(path);
    expect(store2.all()).toHaveLength(2);
    expect(store2.all()[0]?.kind).toBe('note');
    expect(store2.getDecisions()).toHaveLength(1);
  });

  it('ignores malformed records on add', () => {
    const path = join(tmpDir, 'malformed.json');
    const store = new FileContextStore(path);
    store.add([{ kind: 'note', text: '' } as InputRecord]);
    expect(store.all()).toHaveLength(0);
  });

  it('clear() removes persisted records', () => {
    const path = join(tmpDir, 'clear.json');
    const store = new FileContextStore(path);
    store.add([{ kind: 'note', text: 'x' }]);
    store.clear();
    expect(store.all()).toHaveLength(0);
    // Reload to confirm the file was cleared too.
    const reloaded = new FileContextStore(path);
    expect(reloaded.all()).toHaveLength(0);
  });

  it('recovers gracefully from corrupt file content', () => {
    const path = join(tmpDir, 'corrupt.json');
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(path, 'not json{', 'utf8');
    const store = new FileContextStore(path);
    expect(store.all()).toHaveLength(0);
  });
});
