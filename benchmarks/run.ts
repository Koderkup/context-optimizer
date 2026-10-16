import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ContextOptimizer } from '../src/index.js';
import { defaultTokenEstimator as est } from '../src/index.js';
import { ALL_SCENARIOS } from './scenarios.js';
import type { Scenario } from './scenarios.js';
import type { InputRecord } from '../src/index.js';

/**
 * Benchmark harness: Baseline A (raw), Baseline B (exact dedupe + head
 * truncation), Candidate C (ContextOptimizer). Latency and memory figures are
 * measured on the local machine and clearly separated from functional metrics.
 */

interface StrategyResult {
  strategy: 'A_raw' | 'B_dedupe_truncate' | 'C_optimizer';
  outputText: string;
  keptRecordIds: Set<string>;
  tokensBefore: number;
  tokensAfter: number;
  reductionRatio: number;
  factRetention: number;
  missingFacts: string[];
  precision: number;
  recall: number;
  budgetCompliance: boolean;
  attributionIntegrity: number | null;
  latencyMsMedian: number;
  heapDeltaKbApprox: number;
}

function normalizeForFactMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ');
}

function factRetention(outputText: string, facts: string[]): { ratio: number; missing: string[] } {
  const hay = normalizeForFactMatch(outputText);
  const missing = facts.filter((f) => !hay.includes(normalizeForFactMatch(f)));
  return { ratio: facts.length === 0 ? 1 : (facts.length - missing.length) / facts.length, missing };
}

function precisionRecall(kept: Set<string>, relevant: string[]): { p: number; r: number } {
  const rel = new Set(relevant);
  let tp = 0;
  for (const id of kept) if (rel.has(id)) tp++;
  const precision = kept.size === 0 ? 0 : tp / kept.size;
  const recall = rel.size === 0 ? 1 : tp / rel.size;
  return { p: precision, r: recall };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function recordText(r: InputRecord): string {
  return JSON.stringify(r, null, 2);
}

/** Baseline A: the original, unoptimized context. */
function baselineA(s: Scenario): Pick<StrategyResult, 'outputText' | 'keptRecordIds'> {
  return {
    outputText: s.records.map(recordText).join('\n\n'),
    keptRecordIds: new Set(s.records.map((r) => r.id as string)),
  };
}

/** Baseline B: exact dedupe by record text, then head truncation to budget. */
function baselineB(
  s: Scenario,
): Pick<StrategyResult, 'outputText' | 'keptRecordIds'> {
  const seen = new Set<string>();
  const blocks: Array<{ id: string; text: string }> = [];
  for (const r of s.records) {
    const text = recordText(r);
    const key = text.replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    blocks.push({ id: r.id as string, text });
  }
  const kept: string[] = [];
  const ids = new Set<string>();
  let used = 0;
  for (const b of blocks) {
    const cost = est.estimate(b.text);
    if (used + cost > s.budget) break;
    kept.push(b.text);
    ids.add(b.id);
    used += cost;
  }
  return { outputText: kept.join('\n\n'), keptRecordIds: ids };
}

/** Candidate C: ContextOptimizer. Measures median latency over `runs` tries. */
async function candidateC(
  s: Scenario,
  runs = 7,
): Promise<
  Pick<
    StrategyResult,
    'outputText' | 'keptRecordIds' | 'latencyMsMedian' | 'heapDeltaKbApprox'
  > & { sourceIds: Set<string> }
> {
  const optimizer = new ContextOptimizer({ tokenBudget: s.budget });
  const heapBefore = process.memoryUsage().heapUsed;
  const latencies: number[] = [];
  let last: ReturnType<ContextOptimizer['buildContextSync']> | undefined;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    last = optimizer.buildContextSync({ task: s.task, records: s.records });
    latencies.push(performance.now() - t0);
  }
  const heapDeltaKbApprox = Math.max(
    0,
    Math.round((process.memoryUsage().heapUsed - heapBefore) / 1024),
  );
  const result = last as NonNullable<typeof last>;
  const keptRecordIds = new Set(
    result.sources.map((src) => src.fragment.provenance.source.recordId),
  );
  const sourceIds = new Set(result.sources.map((x) => x.fragment.id));
  return {
    outputText: result.context,
    keptRecordIds,
    sourceIds,
    latencyMsMedian: median(latencies),
    heapDeltaKbApprox,
  };
}

function attributionOf(
  outputText: string,
  sourceIds: Set<string> | null,
): number | null {
  if (!sourceIds) return null;
  let total = 0;
  let resolved = 0;
  for (const m of outputText.matchAll(/\[source: (fr_[0-9a-f]+)/g)) {
    total++;
    if (sourceIds.has(m[1] as string)) resolved++;
  }
  return total === 0 ? 1 : resolved / total;
}

async function runScenario(s: Scenario): Promise<{ a: StrategyResult; b: StrategyResult; c: StrategyResult }> {
  const tokensBefore = est.estimate(s.records.map(recordText).join('\n\n'));

  const a0 = baselineA(s);
  const aRetention = factRetention(a0.outputText, s.requiredFacts);
  const aPR = precisionRecall(a0.keptRecordIds, s.relevantRecordIds);
  const a: StrategyResult = {
    strategy: 'A_raw',
    outputText: a0.outputText,
    keptRecordIds: a0.keptRecordIds,
    tokensBefore,
    tokensAfter: est.estimate(a0.outputText),
    reductionRatio: 0,
    factRetention: aRetention.ratio,
    missingFacts: aRetention.missing,
    precision: aPR.p,
    recall: aPR.r,
    budgetCompliance: est.estimate(a0.outputText) <= s.budget,
    attributionIntegrity: null,
    latencyMsMedian: 0,
    heapDeltaKbApprox: 0,
  };
  a.reductionRatio = (a.tokensBefore - a.tokensAfter) / Math.max(1, a.tokensBefore);

  const b0 = baselineB(s);
  const bRetention = factRetention(b0.outputText, s.requiredFacts);
  const bPR = precisionRecall(b0.keptRecordIds, s.relevantRecordIds);
  const b: StrategyResult = {
    strategy: 'B_dedupe_truncate',
    outputText: b0.outputText,
    keptRecordIds: b0.keptRecordIds,
    tokensBefore,
    tokensAfter: est.estimate(b0.outputText),
    reductionRatio: 0,
    factRetention: bRetention.ratio,
    missingFacts: bRetention.missing,
    precision: bPR.p,
    recall: bPR.r,
    budgetCompliance: est.estimate(b0.outputText) <= s.budget,
    attributionIntegrity: null,
    latencyMsMedian: 0,
    heapDeltaKbApprox: 0,
  };
  b.reductionRatio = (b.tokensBefore - b.tokensAfter) / Math.max(1, b.tokensBefore);

  const c0 = await candidateC(s);
  const cRetention = factRetention(c0.outputText, s.requiredFacts);
  const cPR = precisionRecall(c0.keptRecordIds, s.relevantRecordIds);
  const cTokensAfter = est.estimate(c0.outputText);
  const c: StrategyResult = {
    strategy: 'C_optimizer',
    outputText: c0.outputText,
    keptRecordIds: c0.keptRecordIds,
    tokensBefore,
    tokensAfter: cTokensAfter,
    reductionRatio: (tokensBefore - cTokensAfter) / Math.max(1, tokensBefore),
    factRetention: cRetention.ratio,
    missingFacts: cRetention.missing,
    precision: cPR.p,
    recall: cPR.r,
    budgetCompliance: cTokensAfter <= s.budget,
    attributionIntegrity: attributionOf(c0.outputText, c0.sourceIds),
    latencyMsMedian: c0.latencyMsMedian,
    heapDeltaKbApprox: c0.heapDeltaKbApprox,
  };
  return { a, b, c };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
const num = (x: number, d = 0): string => x.toFixed(d);

function printTable(
  rows: Array<{ scenario: string; r: StrategyResult }>,
): void {
  const header = [
    'scenario'.padEnd(28),
    'strategy'.padEnd(20),
    'tok-in'.padStart(7),
    'tok-out'.padStart(8),
    'reduct'.padStart(7),
    'facts'.padStart(6),
    'prec'.padStart(5),
    'rec'.padStart(5),
    'budget'.padStart(7),
    'attrib'.padStart(7),
    'ms'.padStart(8),
  ].join('  ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const { scenario, r } of rows) {
    console.log(
      [
        scenario.padEnd(28),
        r.strategy.padEnd(20),
        num(r.tokensBefore).padStart(7),
        num(r.tokensAfter).padStart(8),
        pct(r.reductionRatio).padStart(7),
        pct(r.factRetention).padStart(6),
        pct(r.precision).padStart(5),
        pct(r.recall).padStart(5),
        (r.budgetCompliance ? 'ok' : 'OVER').padStart(7),
        (r.attributionIntegrity === null ? '-' : pct(r.attributionIntegrity)).padStart(7),
        num(r.latencyMsMedian, 1).padStart(8),
      ].join('  '),
    );
  }
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const rows: Array<{ scenario: string; r: StrategyResult }> = [];
  const perScenario: Array<{ name: string; category: string; a: StrategyResult; b: StrategyResult; c: StrategyResult }> = [];

  for (const s of ALL_SCENARIOS) {
    const { a, b, c } = await runScenario(s);
    perScenario.push({ name: s.name, category: s.category, a, b, c });
    rows.push({ scenario: s.name, r: a }, { scenario: s.name, r: b }, { scenario: s.name, r: c });
  }
  printTable(rows);

  // Aggregate checks (candidate C).
  const allC = perScenario.map((p) => p.c);
  const totalFacts = ALL_SCENARIOS.reduce((acc, s) => acc + s.requiredFacts.length, 0);
  const factScenariosPerfect = allC.every((r) => r.factRetention === 1);
  const budgetOkCount = allC.filter((r) => r.budgetCompliance).length;
  const attributionOk = allC.every((r) => r.attributionIntegrity === 1);
  const avgReductionC = allC.reduce((acc, r) => acc + r.reductionRatio, 0) / allC.length;
  const avgReductionB = perScenario.reduce((acc, p) => acc + p.b.reductionRatio, 0) / perScenario.length;
  const avgRecallC = allC.reduce((acc, r) => acc + r.recall, 0) / allC.length;
  const avgPrecisionC = allC.reduce((acc, r) => acc + r.precision, 0) / allC.length;

  console.log('\n=== Aggregate (Candidate C) ===');
  console.log(`required facts fully retained in every scenario: ${factScenariosPerfect ? 'YES' : `NO (${totalFacts} facts at stake)`}`);
  console.log(`budget compliance: ${budgetOkCount}/${allC.length} scenarios within budget`);
  console.log(`attribution integrity (all source tags resolve): ${attributionOk ? 'YES' : 'NO'}`);
  console.log(`avg reduction: C=${pct(avgReductionC)}  B=${pct(avgReductionB)}`);
  console.log(`avg retrieval precision(C)=${pct(avgPrecisionC)}  recall(C)=${pct(avgRecallC)}`);
  for (const p of perScenario) {
    if (p.c.missingFacts.length > 0) {
      console.log(`  MISSING in ${p.name}: ${p.c.missingFacts.join(' | ')}`);
    }
  }

  if (write) {
    const here = dirname(fileURLToPath(import.meta.url));
    const outDir = join(here, 'results');
    mkdirSync(outDir, { recursive: true });
    const payload = {
      generatedBy: 'benchmarks/run.ts',
      note: 'Latency and heap figures are machine-local measurements; functional metrics are deterministic.',
      node: process.version,
      scenarios: perScenario.map((p) => ({
        name: p.name,
        category: p.category,
        A: { ...p.a, outputText: undefined, keptRecordIds: [...p.a.keptRecordIds] },
        B: { ...p.b, outputText: undefined, keptRecordIds: [...p.b.keptRecordIds] },
        C: { ...p.c, outputText: undefined, keptRecordIds: [...p.c.keptRecordIds] },
      })),
    };
    writeFileSync(join(outDir, 'latest.json'), JSON.stringify(payload, null, 2), 'utf8');
    console.log('\nWrote benchmarks/results/latest.json');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


