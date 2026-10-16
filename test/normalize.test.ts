import { describe, expect, it } from 'vitest';

import {
  collapseRepeatedLines,
  collectRecords,
  normalizeStage,
  normalizeText,
  stableStringify,
  validateRecord,
} from '../src/normalize.js';
import type { InputRecord } from '../src/types.js';

describe('normalizeText', () => {
  it('normalizes CRLF and trims outer whitespace', () => {
    expect(normalizeText('  a\r\nb\r\n  ')).toBe('a\nb');
  });

  it('preserves internal structure and unicode', () => {
    expect(normalizeText('héllo wörld\n\nÜnïcode ✓')).toBe('héllo wörld\n\nÜnïcode ✓');
  });
});

describe('collapseRepeatedLines', () => {
  it('collapses runs of identical lines with a marker', () => {
    const text = 'start\nretrying...\nretrying...\nretrying...\nretrying...\nend';
    const out = collapseRepeatedLines(text);
    expect(out).toContain('repeated 4 times');
    expect(out.split('\n').filter((l) => l === 'retrying...')).toHaveLength(1);
    expect(out).toContain('start');
    expect(out).toContain('end');
  });

  it('keeps short identical lines (code-like content)', () => {
    const text = '}\n}\n}\n}';
    expect(collapseRepeatedLines(text)).toBe(text);
  });
});

describe('stableStringify', () => {
  it('sorts object keys deterministically', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a": 2, "b": 1}');
    expect(stableStringify({ a: 2, b: 1 })).toBe(stableStringify({ b: 1, a: 2 }));
  });
});

describe('validateRecord', () => {
  it('accepts valid records of every kind', () => {
    const records: InputRecord[] = [
      { kind: 'message', role: 'user', text: 'hi' },
      { kind: 'tool_call', toolName: 'bash', output: 'ok' },
      { kind: 'error', message: 'boom' },
      { kind: 'file', path: 'a.ts', content: '' },
      { kind: 'diff', diff: '--- a\n+++ b' },
      { kind: 'test_result', failed: 1, failures: [{ name: 't', message: 'm' }] },
      { kind: 'decision', text: 'use sql', status: 'accepted' },
      { kind: 'note', text: 'remember' },
    ];
    for (const r of records) expect(validateRecord(r)).toBeNull();
  });

  it('rejects malformed records', () => {
    expect(validateRecord({ kind: 'message', role: 'nope', text: 'x' } as unknown as InputRecord)).toMatch(/role/);
    expect(validateRecord({ kind: 'file', path: '', content: 'x' } as InputRecord)).toMatch(/path/);
    expect(validateRecord({ kind: 'alien', text: 'x' } as unknown as InputRecord)).toMatch(/unknown/);
  });
});

describe('normalizeStage', () => {
  it('assigns deterministic ids and warns on malformed input', () => {
    const input = [
      { kind: 'message', role: 'user', text: 'hello' },
      { kind: 'file', path: '', content: 'bad' },
      { kind: 'note', text: 'n' },
    ] as unknown as InputRecord[];
    const a = normalizeStage(input);
    const b = normalizeStage(input);
    expect(a.records.map((r) => r.id)).toEqual(['r0', 'r2']);
    expect(a.warnings.some((w) => w.code === 'MALFORMED_RECORD')).toBe(true);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('collapses duplicate caller ids deterministically', () => {
    const input = [
      { kind: 'note', text: 'a', id: 'x' },
      { kind: 'note', text: 'b', id: 'x' },
    ] as InputRecord[];
    const { records } = normalizeStage(input);
    expect(records.map((r) => r.id)).toEqual(['x', 'x~dup']);
  });

  it('splits test failures into separate fragments with field provenance', () => {
    const input: InputRecord[] = [
      {
        kind: 'test_result',
        framework: 'vitest',
        passed: 3,
        failed: 2,
        failures: [
          { name: 't1', message: 'assert failed', file: 'test/a.test.ts', line: 10 },
          { name: 't2', message: 'timeout' },
        ],
      },
    ];
    const { fragments } = normalizeStage(input);
    expect(fragments).toHaveLength(3);
    expect(fragments[1]?.provenance.field).toBe('failures[0]');
    expect(fragments[2]?.provenance.field).toBe('failures[1]');
  });

  it('warns when no record has a timestamp', () => {
    const { warnings } = normalizeStage([
      { kind: 'note', text: 'a' },
      { kind: 'note', text: 'b' },
    ]);
    expect(warnings.some((w) => w.code === 'MISSING_METADATA')).toBe(true);
  });
});

describe('collectRecords', () => {
  it('merges convenience arrays into records', () => {
    const records = collectRecords({
      task: 't',
      messages: [{ role: 'user', text: 'm' }],
      files: [{ path: 'a.ts', content: 'x' }],
      diffs: [{ diff: 'd' }],
      errors: [{ message: 'e' }],
      decisions: [{ text: 'd', status: 'accepted' }],
      testResults: [{ failed: 0, passed: 1 }],
    });
    expect(records.map((r) => r.kind)).toEqual([
      'message',
      'file',
      'diff',
      'test_result',
      'error',
      'decision',
    ]);
  });
});
