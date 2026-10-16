import { describe, expect, it } from 'vitest';

import { normalizeStage } from '../src/normalize.js';
import { buildScoringContext, DEFAULT_WEIGHTS, scoreStage } from '../src/score.js';
import type { InputRecord } from '../src/types.js';

function score(records: InputRecord[], task: string, now?: number) {
  const fragments = normalizeStage(records).fragments;
  const ctx = buildScoringContext(
    fragments,
    task,
    undefined,
    now,
    7,
    { ...DEFAULT_WEIGHTS },
  );
  return scoreStage(fragments, ctx);
}

describe('scoreStage', () => {
  it('ranks task-relevant fragments above unrelated ones', () => {
    const scored = score(
      [
        { kind: 'note', text: 'auth token expiry handled in src/auth/token.ts' },
        { kind: 'note', text: 'office plants need water on Fridays' },
      ],
      'Fix the auth token expiry bug in src/auth/token.ts',
    );
    const [first, second] = scored;
    expect(first?.text).toContain('token expiry');
    expect(first?.score?.total).toBeGreaterThan(second?.score?.total ?? 0);
  });

  it('exposes a full score breakdown', () => {
    const scored = score([{ kind: 'note', text: 'auth token expiry in token.ts' }], 'fix auth token');
    const breakdown = scored[0]?.score;
    expect(breakdown).toBeDefined();
    expect(Object.keys(breakdown?.components ?? {}).sort()).toEqual(
      Object.keys(DEFAULT_WEIGHTS).sort(),
    );
    expect(breakdown?.components.lexicalOverlap.value).toBeGreaterThan(0);
  });

  it('keeps accepted decisions important despite old timestamps', () => {
    const scored = score(
      [
        {
          kind: 'decision',
          text: 'All auth tokens must use RS256 signing',
          status: 'accepted',
          timestamp: '2020-01-01T00:00:00Z',
        },
        {
          kind: 'message',
          role: 'assistant',
          text: 'maybe tokens could use HS256 who knows',
          timestamp: '2026-01-01T00:00:00Z',
        },
      ],
      'auth token signing',
      Date.parse('2026-01-02T00:00:00Z'),
    );
    const decision = scored.find((f) => f.kind === 'decision');
    expect(decision?.score?.components.recency.value).toBeGreaterThanOrEqual(0.7);
  });

  it('is deterministic and breaks ties by input order', () => {
    const records: InputRecord[] = [
      { kind: 'note', text: 'identical content for tie' },
      { kind: 'note', text: 'identical content for tie' },
    ];
    const a = score(records, 'tie');
    const b = score(records, 'tie');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a[0]?.recordIndex).toBe(0);
    expect(a[1]?.recordIndex).toBe(1);
  });

  it('penalizes redundant near-copies', () => {
    const long = 'auth token expiry repro: login with expired refresh token returns 500';
    const scored = score(
      [
        { kind: 'note', text: long },
        { kind: 'note', text: long },
      ],
      'auth token expiry',
    );
    expect(scored[1]?.score?.components.redundancyPenalty.value).toBeGreaterThan(0.8);
    expect(scored[1]?.score?.total).toBeLessThan(scored[0]?.score?.total ?? 0);
  });
});
