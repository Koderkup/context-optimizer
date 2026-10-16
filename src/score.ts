import { extractPaths, extractSymbols } from './extract.js';
import type { Fragment, RelevanceScore, ScoringWeights } from './types.js';

/** Default scoring weights (documented in README). */
export const DEFAULT_WEIGHTS: ScoringWeights = {
  lexicalOverlap: 3,
  identifierMatch: 4,
  errorRelevance: 3,
  constraint: 5,
  failedAttempt: 2,
  recency: 1.5,
  role: 1,
  redundancyPenalty: 2,
  callerPriority: 1,
};

/** Recency floor for constraints/decisions: old decisions stay important. */
export const DECISION_RECENCY_FLOOR = 0.7;

const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are',
  'be', 'this', 'that', 'it', 'as', 'at', 'by', 'from', 'you', 'your', 'our', 'we', 'i',
  'me', 'my', 'can', 'will', 'not', 'no', 'if', 'then', 'than', 'when', 'so', 'use',
  'using', 'used', 'do', 'does', 'did', 'has', 'have', 'had', 'was', 'were', 'been',
  'being', 'there', 'here', 'they', 'them', 'their', 'what', 'which', 'who', 'how', 'why',
  'all', 'any', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own',
  'same', 'too', 'very', 'just', 'about', 'into', 'over', 'under', 'again', 'once',
]);

/** Lowercase word tokens, stopwords removed. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_$]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

export interface TaskIdentifiers {
  paths: Set<string>;
  basenames: Set<string>;
  symbols: Set<string>;
}

/** Extract identifier targets (paths, symbols) from the task/query text. */
export function extractTaskIdentifiers(text: string): TaskIdentifiers {
  const paths = new Set<string>();
  const basenames = new Set<string>();
  const symbols = new Set<string>();
  for (const p of extractPaths(text)) {
    paths.add(p.path);
    const base = p.path.split('/').pop();
    if (base) basenames.add(base);
  }
  for (const s of extractSymbols(text)) symbols.add(s.name);
  return { paths, basenames, symbols };
}

export interface ScoringContext {
  /** Query token -> idf weight (rare query tokens count more). */
  queryIdf: Map<string, number>;
  /** Sum of idf weights of all query tokens (normalizer). */
  queryWeightTotal: number;
  identifiers: TaskIdentifiers;
  /** Reference "now": max timestamp across records (ms), or undefined. */
  now?: number;
  halfLifeDays: number;
  weights: ScoringWeights;
}

/**
 * Build the scoring context. `referenceNow` must be derived from the data
 * (max record timestamp) - never Date.now() - to keep runs deterministic.
 */
export function buildScoringContext(
  fragments: Fragment[],
  task: string,
  query: string | undefined,
  referenceNow: number | undefined,
  halfLifeDays: number,
  weights: ScoringWeights,
): ScoringContext {
  const queryText = query ? `${task}\n${query}` : task;
  const queryTokens = [...new Set(tokenize(queryText))];
  const df = new Map<string, number>();
  for (const f of fragments) {
    for (const t of new Set(tokenize(f.text))) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = Math.max(1, fragments.length);
  const queryIdf = new Map<string, number>();
  let total = 0;
  for (const t of queryTokens) {
    const w = Math.log(1 + n / (1 + (df.get(t) ?? 0)));
    queryIdf.set(t, w);
    total += w;
  }
  return {
    queryIdf,
    queryWeightTotal: total,
    identifiers: extractTaskIdentifiers(queryText),
    ...(referenceNow !== undefined ? { now: referenceNow } : {}),
    halfLifeDays,
    weights,
  };
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function trigramSet(text: string): Set<string> {
  const set = new Set<string>();
  const t = text.length >= 3 ? text : `  ${text}`;
  for (let i = 0; i <= t.length - 3; i++) set.add(t.slice(i, i + 3));
  return set;
}

function recencyValue(fragment: Fragment, ctx: ScoringContext): number {
  if (ctx.now === undefined || !fragment.lastSeenAt) return 0.5;
  const t = Date.parse(fragment.lastSeenAt);
  if (Number.isNaN(t)) return 0.5;
  const ageDays = Math.max(0, (ctx.now - t) / 86_400_000);
  const decay = Math.exp((-ageDays / ctx.halfLifeDays) * Math.LN2);
  const isConstraintLike =
    fragment.kind === 'decision' ||
    fragment.mandatory === true ||
    fragment.extracted.requirements.length > 0;
  return isConstraintLike ? Math.max(decay, DECISION_RECENCY_FLOOR) : decay;
}

function lexicalValue(fragment: Fragment, ctx: ScoringContext): number {
  if (ctx.queryWeightTotal === 0) return 0;
  const tokens = new Set(tokenize(fragment.text));
  let hit = 0;
  for (const [t, w] of ctx.queryIdf) {
    if (tokens.has(t)) hit += w;
  }
  return clamp01(hit / ctx.queryWeightTotal);
}

function identifierValue(fragment: Fragment, ctx: ScoringContext): number {
  const { paths, basenames, symbols } = ctx.identifiers;
  if (paths.size === 0 && symbols.size === 0) return 0;
  let best = 0;
  for (const p of fragment.extracted.paths) {
    if (paths.has(p.path)) best = Math.max(best, 1);
    else {
      const base = p.path.split('/').pop();
      if (base && basenames.has(base)) best = Math.max(best, 0.6);
    }
  }
  if (fragment.meta?.path) {
    const canon = fragment.meta.path.replace(/\\/g, '/');
    if (paths.has(canon)) best = Math.max(best, 1);
    else {
      const base = canon.split('/').pop();
      if (base && basenames.has(base)) best = Math.max(best, 0.6);
    }
  }
  for (const s of fragment.extracted.symbols) {
    if (symbols.has(s.name)) best = Math.max(best, 0.8);
  }
  return best;
}

function errorRelevanceValue(fragment: Fragment, ctx: ScoringContext): number {
  const errors = fragment.extracted.errors;
  const isTestFailure =
    fragment.kind === 'test_result' && fragment.extracted.outcome?.status === 'failure';
  if (errors.length === 0 && !isTestFailure) return 0;
  const idv = identifierValue(fragment, ctx);
  if (idv > 0) return clamp01(0.5 + 0.5 * idv);
  return clamp01(lexicalValue(fragment, ctx));
}

function roleValue(fragment: Fragment): number {
  if (fragment.kind !== 'message') return 0.5;
  switch (fragment.meta?.role) {
    case 'system':
    case 'user':
      return 1;
    case 'assistant':
      return 0.6;
    case 'tool':
      return 0.4;
    default:
      return 0.5;
  }
}

function constraintValue(fragment: Fragment): number {
  if (fragment.kind === 'decision') {
    const status = fragment.meta?.decisionStatus;
    if (status === 'accepted') return 1;
    if (status === 'proposed') return 0.4;
    return 0; // rejected / superseded
  }
  if (fragment.extracted.requirements.length > 0) {
    return clamp01(0.5 + 0.25 * fragment.extracted.requirements.length);
  }
  return 0;
}

/** Max trigram containment vs earlier-scored fragments (redundancy signal). */
function redundancyValue(fragment: Fragment, earlier: Fragment[]): number {
  if (earlier.length === 0 || earlier.length > 400) return 0;
  const mine = trigramSet(fragment.text.toLowerCase().replace(/\s+/g, ' '));
  let max = 0;
  for (const e of earlier) {
    if (e.kind !== fragment.kind) continue;
    const other = trigramSet(e.text.toLowerCase().replace(/\s+/g, ' '));
    const [small, large] = mine.size <= other.size ? [mine, other] : [other, mine];
    if (small.size === 0) continue;
    let inter = 0;
    for (const g of small) if (large.has(g)) inter++;
    max = Math.max(max, inter / small.size);
    if (max > 0.95) break;
  }
  return max > 0.8 ? max : 0;
}

/**
 * Score one fragment. `earlier` holds fragments that rank earlier in input
 * order, used for the redundancy (novelty) signal. Every component is exposed
 * so users can see exactly why a fragment scored what it did.
 */
export function scoreFragment(
  fragment: Fragment,
  ctx: ScoringContext,
  earlier: Fragment[],
): RelevanceScore {
  const w = ctx.weights;
  const values: Record<keyof ScoringWeights, number> = {
    lexicalOverlap: lexicalValue(fragment, ctx),
    identifierMatch: identifierValue(fragment, ctx),
    errorRelevance: errorRelevanceValue(fragment, ctx),
    constraint: constraintValue(fragment),
    failedAttempt:
      fragment.extracted.outcome?.status === 'failure' ? 0.9 : fragment.extracted.unresolved ? 0.6 : 0,
    recency: recencyValue(fragment, ctx),
    role: roleValue(fragment),
    redundancyPenalty: redundancyValue(fragment, earlier),
    callerPriority: fragment.priority,
  };
  const components = {} as RelevanceScore['components'];
  let total = 0;
  let positiveWeight = 0;
  for (const key of Object.keys(w) as Array<keyof ScoringWeights>) {
    const weight = key === 'redundancyPenalty' ? -Math.abs(w[key]) : Math.abs(w[key]);
    const contribution = values[key] * weight;
    components[key] = { value: values[key], weight, contribution };
    total += contribution;
    if (weight > 0) positiveWeight += weight;
  }
  const normalized = positiveWeight > 0 ? clamp01(total / positiveWeight) : 0;
  return { total, normalized, components };
}

/**
 * Stage 4: score all fragments. Mutates nothing; returns copies with
 * `score` attached, sorted by (normalized desc, recordIndex asc).
 */
export function scoreStage(fragments: Fragment[], ctx: ScoringContext): Fragment[] {
  const ordered = [...fragments].sort(
    (a, b) => a.recordIndex - b.recordIndex || (a.id < b.id ? -1 : 1),
  );
  const scored: Fragment[] = [];
  const earlier: Fragment[] = [];
  for (const f of ordered) {
    scored.push({ ...f, score: scoreFragment(f, ctx, earlier) });
    earlier.push(f);
  }
  return scored;
}


