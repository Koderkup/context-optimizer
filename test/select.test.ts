import { describe, expect, it } from 'vitest';

import { normalizeStage } from '../src/normalize.js';
import { defaultTokenEstimator } from '../src/tokens.js';
import { selectStage } from '../src/select.js';
import { DEFAULT_WEIGHTS, buildScoringContext, scoreStage } from '../src/score.js';
import type { InputRecord } from '../src/types.js';

function scored(records: InputRecord[], task: string) {
  const fragments = normalizeStage(records).fragments;
  const ctx = buildScoringContext(fragments, task, undefined, undefined, 7, { ...DEFAULT_WEIGHTS });
  return scoreStage(fragments, ctx).map((f) =>
    f.kind === 'decision' && f.meta?.decisionStatus === 'accepted' ? { ...f, mandatory: true } : f,
  );
}

describe('selectStage', () => {
  it('includes mandatory fragments even when budget is tiny, and reports conflict', () => {
    const frags = scored(
      [
        { kind: 'decision', text: 'Must keep API stable', status: 'accepted' },
        { kind: 'note', text: 'random chatter about coffee' },
      ],
      'api',
    );
    const result = selectStage(frags, {
      taskTokens: 10,
      budget: 25,
      estimator: defaultTokenEstimator,
    });
    expect(result.selected.some((s) => s.fragment.kind === 'decision')).toBe(true);
    expect(result.budget.fitsBudget).toBe(false);
    expect(result.budget.conflict).toBeDefined();
    expect(result.warnings.some((w) => w.code === 'BUDGET_CONFLICT')).toBe(true);
  });

  it('keeps whole records together (no partial record selection)', () => {
    const frags = scored(
      [
        {
          kind: 'test_result',
          framework: 'vitest',
          failed: 2,
          failures: [
            { name: 't1', message: 'assert auth works', file: 'src/auth.ts' },
            { name: 't2', message: 'assert policy works', file: 'src/policy.ts' },
          ],
        },
      ],
      'auth',
    );
    const result = selectStage(frags, {
      taskTokens: 5,
      budget: 10_000,
      estimator: defaultTokenEstimator,
    });
    const selectedIds = result.selected.map((s) => s.fragment.id);
    const allFrags = frags.map((f) => f.id);
    for (const id of allFrags) {
      expect(selectedIds.includes(id)).toBe(true);
    }
  });

  it('selects deterministically with stable tie-breaking', () => {
    const records: InputRecord[] = Array.from({ length: 10 }, (_, i) => ({
      kind: 'note' as const,
      text: `note number ${i} about the same topic`,
    }));
    const frags = scored(records, 'topic');
    const a = selectStage(frags, { taskTokens: 5, budget: 200, estimator: defaultTokenEstimator });
    const b = selectStage(frags, { taskTokens: 5, budget: 200, estimator: defaultTokenEstimator });
    expect(a.selected.map((s) => s.fragment.id)).toEqual(b.selected.map((s) => s.fragment.id));
  });

  it('marks superseded decisions as omitted', () => {
    const frags = scored(
      [
        { kind: 'decision', text: 'old rule', status: 'superseded' },
        { kind: 'decision', text: 'new rule that supersedes it', status: 'accepted' },
      ],
      'rule',
    );
    const result = selectStage(frags, {
      taskTokens: 5,
      budget: 5000,
      estimator: defaultTokenEstimator,
    });
    expect(result.selected.some((s) => s.fragment.text.includes('new rule'))).toBe(true);
    expect(result.omitted.some((o) => o.reason === 'superseded')).toBe(true);
  });
});
