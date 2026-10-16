/**
 * context-optimizer - deterministic, local-first context optimization.
 *
 * Public API surface. The core SDK has zero runtime dependencies and never
 * performs network requests.
 */

export { ContextOptimizer, PIPELINE_VERSION } from './optimizer.js';
export {
  defaultTokenEstimator,
  createTokenEstimator,
  sha256,
  shortHash,
} from './tokens.js';
export { DEFAULT_WEIGHTS, DECISION_RECENCY_FLOOR, tokenize, scoreStage } from './score.js';
export { renderContext, sourceTag } from './render.js';
export { selectStage, fragmentCost } from './select.js';
export { dedupeStage, containmentSimilarity } from './dedupe.js';
export {
  extractStage,
  extractSignals,
  extractPaths,
  extractSymbols,
  extractStackFrames,
  extractRequirements,
} from './extract.js';
export {
  normalizeStage,
  collectRecords,
  recordToFragment,
  normalizeText,
  collapseRepeatedLines,
  stableStringify,
  validateRecord,
} from './normalize.js';
export { InMemoryContextStore, filterByFile, filterDecisions, filterErrors } from './store.js';
export type { ContextStore } from './store.js';

export type {
  BuildContextInput,
  BudgetConflict,
  BudgetSummary,
  DecisionRecord,
  DecisionStatus,
  DiffRecord,
  ErrorRecord,
  ExtractedError,
  ExtractedPath,
  ExtractedRequirement,
  ExtractedSignals,
  ExtractedSymbol,
  FileRecord,
  FileState,
  Fragment,
  FragmentMeta,
  InputRecord,
  MessageRecord,
  MessageRole,
  MergeReason,
  NoteRecord,
  OmittedFragment,
  OmissionReason,
  OptimizerOptions,
  OptimizedContext,
  OptimizationReport,
  OutcomeInfo,
  Provenance,
  RecordBase,
  RecordKind,
  RelevanceScore,
  ScoringWeights,
  ScoreComponent,
  SelectedFragment,
  SelectionReason,
  SourceRef,
  TestFailure,
  TestResultRecord,
  TokenEstimator,
  ToolCallRecord,
  Warning,
  WarningCode,
} from './types.js';
