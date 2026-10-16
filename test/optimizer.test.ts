import { describe, expect, it } from 'vitest';

import { ContextOptimizer } from '../src/optimizer.js';
import type { BuildContextInput } from '../src/types.js';

const TASK = 'Fix authentication after an access policy change';

function baseInput(): BuildContextInput {
  return {
    task: TASK,
    messages: [
      { role: 'user', text: 'The login flow fails with 401 after the policy change in src/auth/policy.ts' },
      { role: 'assistant', text: 'Looking at the policy configuration now.' },
    ],
    files: [
      {
        path: 'src/auth/policy.ts',
        content: 'export function checkPolicy(user) {\n  return user.claims.includes("access");\n}\n',
      },
    ],
    decisions: [
      { text: 'Policy checks must stay server-side only', status: 'accepted' },
    ],
    errors: [
      {
        message: 'Error: 401 Unauthorized\n    at checkPolicy (src/auth/policy.ts:2:10)',
        path: 'src/auth/policy.ts',
      },
    ],
  };
}

describe('ContextOptimizer end-to-end', () => {
  it('is deterministic: identical inputs give byte-identical output', async () => {
    const opt = new ContextOptimizer({ tokenBudget: 4000 });
    const a = await opt.buildContext(baseInput());
    const b = await opt.buildContext(baseInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('retains required facts and their sources', async () => {
    const opt = new ContextOptimizer({ tokenBudget: 4000 });
    const result = await opt.buildContext(baseInput());
    expect(result.context).toContain('Policy checks must stay server-side only');
    expect(result.context).toContain('401 Unauthorized');
    expect(result.context).toContain('# Task');
    // Source-reference integrity: every source tag in text maps to a fragment.
    const ids = new Set(result.sources.map((s) => s.fragment.id));
    for (const match of result.context.matchAll(/\[source: (fr_[0-9a-f]+)/g)) {
      expect(ids.has(match[1] as string)).toBe(true);
    }
  });

  it('reduces size while preserving the required facts', async () => {
    const noisy = baseInput();
    noisy.messages = noisy.messages ?? [];
    for (let i = 0; i < 60; i++) {
      noisy.messages.push({ role: 'assistant', text: `Unrelated musing number ${i} about weather and lunch.` });
      noisy.messages.push({ role: 'tool', text: 'SELECT * FROM users' }); // repeated tool output
    }
    const opt = new ContextOptimizer({ tokenBudget: 3000 });
    const result = await opt.buildContext(noisy);
    expect(result.stats.reductionRatio).toBeGreaterThan(0.5);
    expect(result.context).toContain('Policy checks must stay server-side only');
    expect(result.context).toContain('401 Unauthorized');
  });

  it('reports a budget conflict for impossible budgets instead of silent loss', async () => {
    const opt = new ContextOptimizer({ tokenBudget: 30 });
    const result = await opt.buildContext(baseInput());
    expect(result.report.budget.fitsBudget).toBe(false);
    expect(result.report.budget.conflict).toBeDefined();
    expect(result.report.warnings.some((w) => w.code === 'BUDGET_CONFLICT')).toBe(true);
    // Mandatory content is still present.
    expect(result.context).toContain('Policy checks must stay server-side only');
  });

  it('handles empty input gracefully', async () => {
    const opt = new ContextOptimizer();
    const result = await opt.buildContext({ task: 'Do anything' });
    expect(result.context).toContain('# Task');
    expect(result.sources).toHaveLength(0);
    expect(result.report.warnings.some((w) => w.code === 'EMPTY_INPUT')).toBe(true);
  });

  it('handles malformed records without crashing', async () => {
    const opt = new ContextOptimizer();
    const result = await opt.buildContext({
      task: 'x',
      records: [{ kind: 'file', path: '', content: 'oops' } as never],
    });
    expect(result.report.warnings.some((w) => w.code === 'MALFORMED_RECORD')).toBe(true);
  });

  it('works with unicode-heavy input', async () => {
    const opt = new ContextOptimizer({ tokenBudget: 1500 });
    const result = await opt.buildContext({
      task: 'Исправить авторизацию в login',
      messages: [
        { role: 'user', text: 'Ошибка 401 в файле src/login.ts — токен истёк ✓' },
        { role: 'tool', text: '日志：认证失败' },
      ],
    });
    expect(result.context).toContain('401');
    expect(result.context).toContain('истёк');
  });

  it('never performs network access', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('network access attempted');
    }) as typeof fetch;
    try {
      const opt = new ContextOptimizer();
      const result = await opt.buildContext(baseInput());
      expect(result.context.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fills the budget with relevant content when budget allows', async () => {
    const opt = new ContextOptimizer({ tokenBudget: 12_000 });
    const result = await opt.buildContext(baseInput());
    expect(result.report.budget.fitsBudget).toBe(true);
    expect(result.report.budget.used).toBeLessThanOrEqual(12_000);
    expect(result.report.budget.used).toBeGreaterThan(0);
  });
});
