import { describe, expect, it } from 'vitest';

import { dedupeStage } from '../src/dedupe.js';
import { normalizeStage } from '../src/normalize.js';
import type { InputRecord } from '../src/types.js';

function fragmentsOf(records: InputRecord[]) {
  return normalizeStage(records).fragments;
}

const OPTS = { nearDuplicateThreshold: 0.92 };

describe('dedupeStage - exact duplicates', () => {
  it('merges identical message copies and keeps provenance of both', () => {
    const frags = fragmentsOf([
      { kind: 'message', role: 'tool', text: 'SELECT * FROM users' },
      { kind: 'message', role: 'tool', text: 'SELECT * FROM users' },
    ]);
    const result = dedupeStage(frags, OPTS);
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]?.duplicateCount).toBe(2);
    expect(result.fragments[0]?.provenance.mergedFrom).toHaveLength(2);
    expect(result.merges[0]?.reason).toBe('exact_duplicate');
  });

  it('does not merge identical text across kinds', () => {
    const frags = fragmentsOf([
      { kind: 'note', text: 'same text here' },
      { kind: 'message', role: 'user', text: 'same text here' },
    ]);
    expect(dedupeStage(frags, OPTS).fragments).toHaveLength(2);
  });
});

describe('dedupeStage - similar but non-identical errors', () => {
  it('never merges errors that only share the error type', () => {
    const stack = '\n    at authenticate (src/auth.ts:12:9)';
    const frags = fragmentsOf([
      { kind: 'error', message: 'TypeError: user.email is undefined', stack },
      { kind: 'error', message: 'TypeError: user.password is undefined', stack },
    ]);
    const result = dedupeStage(frags, OPTS);
    expect(result.fragments).toHaveLength(2);
  });
});

describe('dedupeStage - extended copies', () => {
  it('merges a message fully contained in a longer one, keeping the longer text', () => {
    const frags = fragmentsOf([
      {
        kind: 'message',
        role: 'user',
        text: 'The login endpoint returns 500 when the token is expired. Reproduced on staging with an expired refresh token.',
      },
      {
        kind: 'message',
        role: 'user',
        text: 'The login endpoint returns 500 when the token is expired. Reproduced on staging with an expired refresh token. See logs in src/auth/login.ts for the exact stack.',
      },
    ]);
    const result = dedupeStage(frags, OPTS);
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0]?.text).toContain('See logs');
    expect(result.merges.some((m) => m.reason === 'extended_copy')).toBe(true);
  });

  it('never merges file fragments from different paths', () => {
    const content = 'export function main() {\n  return 1;\n}\n'.repeat(5);
    const frags = fragmentsOf([
      { kind: 'file', path: 'src/a.ts', content },
      { kind: 'file', path: 'src/b.ts', content },
    ]);
    expect(dedupeStage(frags, OPTS).fragments).toHaveLength(2);
  });
});

describe('dedupeStage - repeated runs', () => {
  it('merges repeated test runs keeping latest output and exit history', () => {
    const frags = fragmentsOf([
      {
        kind: 'test_result',
        command: 'npm test',
        failed: 1,
        exitCode: 1,
        timestamp: '2026-01-01T00:00:00Z',
      },
      {
        kind: 'test_result',
        command: 'npm test',
        passed: 10,
        failed: 0,
        exitCode: 0,
        timestamp: '2026-01-02T00:00:00Z',
      },
    ]);
    const result = dedupeStage(frags, OPTS);
    expect(result.fragments).toHaveLength(1);
    const kept = result.fragments[0];
    expect(kept?.text).toContain('passed=10');
    expect(kept?.text).toContain('prior runs of test:npm test');
    expect(kept?.text).toContain('exit=1');
    expect(kept?.meta?.exitCode).toBe(0);
    expect(result.merges.some((m) => m.reason === 'repeated_run')).toBe(true);
  });
});
