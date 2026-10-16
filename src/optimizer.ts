import { dedupeStage } from './dedupe.js';
import { extractStage } from './extract.js';
import { collectRecords, normalizeStage } from './normalize.js';
import { renderContext } from './render.js';
import { buildScoringContext, DEFAULT_WEIGHTS, scoreStage } from './score.js';
import { selectStage } from './select.js';
import { defaultTokenEstimator, sha256 } from './tokens.js';
import type {
  BuildContextInput,
  Fragment,
  InputRecord,
  OptimizerOptions,
  OptimizedContext,
  OptimizationReport,
  ScoringWeights,
  TokenEstimator,
  Warning,
} from './types.js';

export const PIPELINE_VERSION = '1';

interface ResolvedOptions {
  tokenBudget: number;
  estimator: TokenEstimator;
  weights: ScoringWeights;
  recencyHalfLifeDays: number;
  nearDuplicateThreshold: number;
  maxFragments: number;
}

/**
 * Deterministic context optimizer.
 *
 * Pipeline: normalize -> extract -> dedupe -> score -> select -> render.
 * Identical inputs and configuration always produce identical outputs
 * (no wall-clock time, no randomness, stable tie-breaking).
 */
export class ContextOptimizer {
  private readonly opts: ResolvedOptions;
  private readonly configHash: string;

  constructor(options: OptimizerOptions = {}) {
    this.opts = {
      tokenBudget: options.tokenBudget ?? 12_000,
      estimator: options.tokenEstimator ?? defaultTokenEstimator,
      weights: { ...DEFAULT_WEIGHTS, ...options.weights },
      recencyHalfLifeDays: options.recencyHalfLifeDays ?? 7,
      nearDuplicateThreshold: options.nearDuplicateThreshold ?? 0.92,
      maxFragments: options.maxFragments ?? 5000,
    };
    this.configHash = sha256(
      JSON.stringify({
        v: PIPELINE_VERSION,
        tokenBudget: this.opts.tokenBudget,
        estimator: this.opts.estimator.name,
        weights: this.opts.weights,
        recencyHalfLifeDays: this.opts.recencyHalfLifeDays,
        nearDuplicateThreshold: this.opts.nearDuplicateThreshold,
        maxFragments: this.opts.maxFragments,
      }),
    ).slice(0, 16);
  }

  /** Resolved configuration (read-only view for diagnostics). */
  get config(): Readonly<ResolvedOptions> {
    return this.opts;
  }

  /**
   * Build a compact, task-specific context within the token budget.
   * Async for API stability (a future tokenizer may be async); the current
   * implementation is fully synchronous and deterministic.
   */
  async buildContext(input: BuildContextInput): Promise<OptimizedContext> {
    return this.buildContextSync(input);
  }

  /**
   * Mark fragments that must survive budget cuts:
   * - accepted decisions and their constraints;
   * - fragments carrying explicit requirements that mention task identifiers;
   * - error/test-failure fragments that directly match a task file path or symbol.
   * Never marks on error-type similarity alone.
   */
  private markMandatory(fragments: Fragment[], task: string, query: string): Fragment[] {
    const ctx = buildScoringContext(
      fragments,
      task,
      query || undefined,
      undefined,
      this.opts.recencyHalfLifeDays,
      this.opts.weights,
    );
    const { paths, symbols } = ctx.identifiers;
    return fragments.map((f) => {
      let mandatory = false;
      if (f.kind === 'decision' && f.meta?.decisionStatus === 'accepted') mandatory = true;
      if (f.extracted.requirements.length > 0 && f.score === undefined) {
        // Requirements are task-critical when they mention a task identifier
        // or when they come from a user/system message about the task.
        const mentionsIdentifier = f.extracted.paths.some((p) => paths.has(p.path));
        if (mentionsIdentifier) mandatory = true;
      }
      if (f.extracted.errors.length > 0 || f.extracted.outcome?.status === 'failure') {
        const directMatch =
          f.extracted.paths.some((p) => paths.has(p.path)) ||
          f.extracted.symbols.some((s) => symbols.has(s.name)) ||
          (f.meta?.path && paths.has(f.meta.path.replace(/\\/g, '/')));
        if (directMatch) mandatory = true;
      }
      return mandatory ? { ...f, mandatory: true } : f;
    });
  }

  /**
   * Rank all records against a query without budget selection. Returns the
   * top `limit` fragments with full score breakdowns and provenance.
   */
  search(input: { query: string; records?: InputRecord[]; limit?: number }): Array<{
    fragment: Fragment;
    score: NonNullable<Fragment['score']>;
  }> {
    const limit = input.limit ?? 10;
    const normalized = normalizeStage(input.records ?? []);
    let fragments = extractStage(normalized.fragments);
    if (fragments.length > this.opts.maxFragments) {
      fragments = fragments.slice(0, this.opts.maxFragments);
    }
    const deduped = dedupeStage(fragments, {
      nearDuplicateThreshold: this.opts.nearDuplicateThreshold,
    });
    let referenceNow: number | undefined;
    for (const r of normalized.records) {
      if (!r.timestamp) continue;
      const t = Date.parse(r.timestamp);
      if (!Number.isNaN(t) && (referenceNow === undefined || t > referenceNow)) referenceNow = t;
    }
    const ctx = buildScoringContext(
      deduped.fragments,
      input.query,
      undefined,
      referenceNow,
      this.opts.recencyHalfLifeDays,
      this.opts.weights,
    );
    const scored = scoreStage(deduped.fragments, ctx);
    return [...scored]
      .sort(
        (a, b) =>
          (b.score?.total ?? 0) - (a.score?.total ?? 0) ||
          a.recordIndex - b.recordIndex ||
          (a.id < b.id ? -1 : 1),
      )
      .slice(0, limit)
      .map((fragment) => ({ fragment, score: fragment.score as NonNullable<Fragment['score']> }));
  }

  /** Synchronous variant of {@link buildContext}. */
  buildContextSync(input: BuildContextInput): OptimizedContext {
    const warnings: Warning[] = [];
    const budget = input.tokenBudget ?? this.opts.tokenBudget;

    // Stage 1: normalize + classify.
    const rawRecords = collectRecords(input);
    const normalized = normalizeStage(rawRecords);
    warnings.push(...normalized.warnings);

    // Extraction (before dedup so dedupe can rely on signals if needed).
    let fragments = extractStage(normalized.fragments);

    // Deterministic fragment cap.
    if (fragments.length > this.opts.maxFragments) {
      fragments = fragments.slice(0, this.opts.maxFragments);
      warnings.push({
        code: 'FRAGMENT_CAP_APPLIED',
        message: `Fragment count capped at ${this.opts.maxFragments}; later records were dropped deterministically.`,
      });
    }

    // Stage 2: deduplication.
    const deduped = dedupeStage(fragments, {
      nearDuplicateThreshold: this.opts.nearDuplicateThreshold,
    });
    warnings.push(...deduped.warnings);

    // Reference "now" from data (never Date.now() - determinism).
    let referenceNow: number | undefined;
    for (const r of normalized.records) {
      if (!r.timestamp) continue;
      const t = Date.parse(r.timestamp);
      if (!Number.isNaN(t) && (referenceNow === undefined || t > referenceNow)) referenceNow = t;
    }

    // Mark mandatory fragments BEFORE scoring (recency floor uses the flag).
    const query = input.query ?? '';
    const withMandatory = this.markMandatory(deduped.fragments, input.task, query);

    // Stage 4: relevance scoring.
    const scoringCtx = buildScoringContext(
      withMandatory,
      input.task,
      query || undefined,
      referenceNow,
      this.opts.recencyHalfLifeDays,
      this.opts.weights,
    );
    const scored = scoreStage(withMandatory, scoringCtx);

    if (!this.opts.estimator.name.includes('exact')) {
      warnings.push({
        code: 'TOKEN_ESTIMATE_ONLY',
        message: `Token counts use the "${this.opts.estimator.name}" estimator (an estimate, not an exact tokenizer). Provide a custom TokenEstimator for exact counts.`,
      });
    }

    // Stage 5: budget-aware selection.
    const taskHeader = `# Task\n\n${input.task.trim()}`;
    const taskTokens = this.opts.estimator.estimate(taskHeader);
    const selection = selectStage(scored, {
      taskTokens,
      budget,
      estimator: this.opts.estimator,
    });
    warnings.push(...selection.warnings);

    // Stage 6: render + report.
    const context = renderContext(input.task, selection.selected);
    const estimatedOutput = this.opts.estimator.estimate(context);
    const estimatedInput = this.opts.estimator.estimate(
      normalized.records.map((r) => JSON.stringify(r)).join('\n'),
    );
    const reductionRatio =
      estimatedInput > 0 ? (estimatedInput - estimatedOutput) / estimatedInput : 0;

    const report: OptimizationReport = {
      totals: {
        recordsIn: normalized.records.length,
        fragmentsAfterExtraction: normalized.fragments.length,
        fragmentsAfterDedup: deduped.fragments.length,
        fragmentsSelected: selection.selected.length,
        fragmentsOmitted: selection.omitted.length,
      },
      tokens: {
        estimator: this.opts.estimator.name,
        estimatedInput,
        estimatedOutput,
        reductionRatio,
      },
      budget: selection.budget,
      merges: deduped.merges,
      omissions: selection.omitted.map((o) => ({
        id: o.id,
        reason: o.reason,
        ...(o.score !== undefined ? { score: o.score } : {}),
      })),
      warnings,
      configHash: this.configHash,
    };

    return {
      context,
      sources: selection.selected,
      omitted: selection.omitted,
      report,
      stats: {
        estimatedInputTokens: estimatedInput,
        estimatedOutputTokens: estimatedOutput,
        reductionRatio,
      },
    };
  }
}

