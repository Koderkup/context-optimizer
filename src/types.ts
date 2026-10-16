/**
 * Public data types for the mcp-context-optimizer core SDK.
 *
 * Design rules:
 * - Everything is deterministic: identical inputs + config => identical outputs.
 * - Provenance is mandatory: every fragment links back to its origin record.
 * - Machine-readable metadata is kept separate from rendered context text.
 */

// ---------------------------------------------------------------------------
// Input records
// ---------------------------------------------------------------------------

/** Recognized kinds of input records. */
export type RecordKind =
  | 'message'
  | 'tool_call'
  | 'error'
  | 'file'
  | 'diff'
  | 'test_result'
  | 'decision'
  | 'note';

/** Conversation message roles. */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** Lifecycle state of a file snapshot. */
export type FileState = 'current' | 'modified' | 'deleted';

/** Decision status; superseded/rejected decisions stay available but score low. */
export type DecisionStatus = 'accepted' | 'rejected' | 'superseded' | 'proposed';

/** Common fields shared by every input record. */
export interface RecordBase {
  /** Optional caller-provided identifier. Synthesized deterministically if absent. */
  id?: string;
  /** ISO-8601 timestamp when the record was produced, if known. */
  timestamp?: string;
  /** Explicit caller priority hint in [0, 1]. Higher = more important. Default 0.5. */
  priority?: number;
  /** Free-form tags for filtering. */
  tags?: string[];
}

export interface MessageRecord extends RecordBase {
  kind: 'message';
  role: MessageRole;
  text: string;
  /** Optional speaker/tool name (e.g. "claude", "assistant", tool name). */
  name?: string;
}

export interface ToolCallRecord extends RecordBase {
  kind: 'tool_call';
  toolName: string;
  /** Serialized tool arguments (stringified deterministically for display). */
  input?: unknown;
  /** Tool output / stdout / stderr text. */
  output?: string;
  /** Process exit code if the tool ran a process. */
  exitCode?: number;
}

export interface ErrorRecord extends RecordBase {
  kind: 'error';
  message: string;
  stack?: string;
  exitCode?: number;
  /** File path the error points at, if known. */
  path?: string;
  /** Error type/name, e.g. "TypeError". */
  errorType?: string;
}

export interface FileRecord extends RecordBase {
  kind: 'file';
  path: string;
  content: string;
  /** Optional language hint; inferred from extension if absent. */
  language?: string;
  state?: FileState;
}

export interface DiffRecord extends RecordBase {
  kind: 'diff';
  /** Path of the changed file, if the diff is scoped to one file. */
  path?: string;
  diff: string;
  /** Diff stat summary if known, e.g. "3 files changed, 12 insertions". */
  summary?: string;
}

export interface TestFailure {
  name: string;
  message: string;
  file?: string;
  line?: number;
}

export interface TestResultRecord extends RecordBase {
  kind: 'test_result';
  /** Test framework label, e.g. "vitest", "pytest". */
  framework?: string;
  passed?: number;
  failed?: number;
  skipped?: number;
  failures?: TestFailure[];
  exitCode?: number;
  /** Command that produced the result, e.g. "npm test". */
  command?: string;
}

export interface DecisionRecord extends RecordBase {
  kind: 'decision';
  text: string;
  /** Explicit constraints recorded alongside the decision. */
  constraints?: string[];
  status: DecisionStatus;
  /** If this decision supersedes another record id. */
  supersedes?: string;
}

export interface NoteRecord extends RecordBase {
  kind: 'note';
  text: string;
  title?: string;
}

/** Union of all supported input records. */
export type InputRecord =
  | MessageRecord
  | ToolCallRecord
  | ErrorRecord
  | FileRecord
  | DiffRecord
  | TestResultRecord
  | DecisionRecord
  | NoteRecord;

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** Identifies the origin of a fragment. `id` is stable across runs. */
export interface SourceRef {
  /** Record kind of the origin. */
  kind: RecordKind;
  /** Record id of the origin. */
  recordId: string;
  /** File path when the record concerns a file. */
  path?: string;
  /** Human-readable label, e.g. "message #3 (user)". */
  label: string;
  /** 0-based index of the record in the normalized input array. */
  recordIndex: number;
}

/** Links a fragment to its origin, including merged origins. */
export interface Provenance {
  /** Primary origin of the retained (canonical) fragment text. */
  source: SourceRef;
  /** All origins merged into this fragment (including the primary). */
  mergedFrom: SourceRef[];
  /** Line range within the origin text (1-based, inclusive), when applicable. */
  lineRange?: [number, number];
  /** Sub-field of the record the fragment came from, e.g. "stack", "failures[0]". */
  field?: string;
}

// ---------------------------------------------------------------------------
// Extraction signals
// ---------------------------------------------------------------------------

/** A file path mentioned by a fragment. */
export interface ExtractedPath {
  path: string;
  line?: number;
  column?: number;
}

/** A code symbol (function/class/const) mentioned by a fragment. */
export interface ExtractedSymbol {
  name: string;
  /** Declaring/mentioning file path when known. */
  path?: string;
}

/** An error signature derived from an error fragment. */
export interface ExtractedError {
  errorType?: string;
  message: string;
  /** Normalized signature: errorType + first 200 chars of message, whitespace-collapsed. */
  signature: string;
  stackFrames: Array<{ fn?: string; path?: string; line?: number }>;
  resolved: boolean;
}

/** A sentence flagged as an explicit requirement/constraint. */
export interface ExtractedRequirement {
  text: string;
  /** Keyword that triggered detection, e.g. "must". */
  trigger: string;
}

/** Outcome of an attempted operation, strictly evidence-based. */
export interface OutcomeInfo {
  /**
   * 'failure' only with direct evidence of failure; 'success' only with
   * explicit success markers. Absent when there is no evidence either way.
   */
  status?: 'failure' | 'success';
  /** Evidence string, e.g. "exit code 1", "PASS". */
  evidence?: string;
}

/** Structured signals extracted from a fragment by deterministic means. */
export interface ExtractedSignals {
  paths: ExtractedPath[];
  symbols: ExtractedSymbol[];
  errors: ExtractedError[];
  requirements: ExtractedRequirement[];
  outcome?: OutcomeInfo;
  /** True when the fragment documents an unresolved problem (open error, failing test, TODO). */
  unresolved: boolean;
}

// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

/** How merges happened, for explainability. */
export type MergeReason = 'exact_duplicate' | 'extended_copy' | 'repeated_run';

/** A deduplicated unit of context with provenance and extracted signals. */
export interface Fragment {
  /** Stable fragment id derived from origin + content hash. */
  id: string;
  /** Record id of the primary origin. */
  recordId: string;
  /** Index of the primary origin record in the normalized array. */
  recordIndex: number;
  kind: RecordKind;
  /** Canonical text of the fragment (normalized line endings, collapsed repeats). */
  text: string;
  provenance: Provenance;
  extracted: ExtractedSignals;
  /** Number of records merged into this fragment (>= 1). */
  duplicateCount: number;
  /** How the merges happened, for explainability. */
  mergeReasons: MergeReason[];
  /** Latest timestamp across merged records, if any. */
  lastSeenAt?: string;
  /** Set when the fragment records an accepted constraint/decision or task-critical fact. */
  mandatory?: boolean;
  /** Caller priority carried over from the primary record. */
  priority: number;
  /**
   * Lightweight record metadata used by dedup/selection/reporting
   * (e.g. file path, tool name, test command, decision status).
   */
  meta?: FragmentMeta;
  /** Populated by the scoring stage. */
  score?: RelevanceScore;
}

/** Record-level metadata preserved on fragments for grouping and reporting. */
export interface FragmentMeta {
  path?: string;
  toolName?: string;
  command?: string;
  decisionStatus?: DecisionStatus;
  role?: MessageRole;
  exitCode?: number;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Weights for the relevance model. All non-negative. Documented in README. */
export interface ScoringWeights {
  /** Token overlap between task/query and fragment. */
  lexicalOverlap: number;
  /** Fragment mentions file paths or symbols that appear in the task/query. */
  identifierMatch: number;
  /** Fragment is an error/failing test relevant to the task. */
  errorRelevance: number;
  /** Fragment states a requirement, constraint or accepted decision. */
  constraint: number;
  /** Fragment documents a failed attempt. */
  failedAttempt: number;
  /** Timestamp-based recency (bounded; constraints/decisions get a floor). */
  recency: number;
  /** Conversation-role weighting (user/system > assistant chatter). */
  role: number;
  /** Redundancy penalty (novelty). Applied as a negative contribution. */
  redundancyPenalty: number;
  /** Explicit caller priority hint. */
  callerPriority: number;
}

export interface ScoreComponent {
  /** Raw signal value in [0, 1]. */
  value: number;
  /** Weight applied. */
  weight: number;
  /** value * weight (signed; redundancy is negative). */
  contribution: number;
}

/** Explainable relevance score of a fragment. */
export interface RelevanceScore {
  /** Weighted sum of all components. */
  total: number;
  /** total / sum of positive weights, clamped to [0, 1]. */
  normalized: number;
  components: Record<keyof ScoringWeights, ScoreComponent>;
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Pluggable token estimator. The default is a character-based heuristic which
 * produces ESTIMATES, not exact tokenizer counts. Provide your own estimator
 * (e.g. backed by a real tokenizer) when exact counts matter.
 */
export interface TokenEstimator {
  /** Name shown in reports, e.g. "chars/4". */
  name: string;
  /** Estimate the number of tokens in `text`. Must be deterministic. */
  estimate(text: string): number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface OptimizerOptions {
  /** Default token budget for the optimized context (rendered text + task). */
  tokenBudget?: number;
  /** Token estimator. Defaults to the chars/4 heuristic. */
  tokenEstimator?: TokenEstimator;
  /** Override individual scoring weights (merged with defaults). */
  weights?: Partial<ScoringWeights>;
  /** Half-life in days for the recency signal. Default 7. */
  recencyHalfLifeDays?: number;
  /**
   * Near-duplicate detection: minimum trigram containment similarity in [0,1]
   * required to consider two same-kind fragments near-duplicates. Default 0.92.
   * Set to 1 to disable near-duplicate merging (exact dedup still runs).
   */
  nearDuplicateThreshold?: number;
  /** Safety cap on fragments after extraction (deterministic truncation with warning). Default 5000. */
  maxFragments?: number;
}

// ---------------------------------------------------------------------------
// Pipeline I/O
// ---------------------------------------------------------------------------

export interface BuildContextInput {
  /** The current task description. Always retained as mandatory context. */
  task: string;
  /** Additional relevance query terms beyond the task. */
  query?: string;
  /** Raw records of any supported kind. */
  records?: InputRecord[];
  /** Convenience: conversation messages. */
  messages?: Array<{
    role: MessageRole;
    text: string;
    name?: string;
    timestamp?: string;
    id?: string;
  }>;
  /** Convenience: file snapshots. */
  files?: Array<{
    path: string;
    content: string;
    language?: string;
    timestamp?: string;
    id?: string;
  }>;
  /** Convenience: git diffs. */
  diffs?: Array<{ path?: string; diff: string; summary?: string; timestamp?: string; id?: string }>;
  /** Convenience: test results. */
  testResults?: Array<Partial<TestResultRecord>>;
  /** Convenience: error records. */
  errors?: Array<Omit<ErrorRecord, 'kind'>>;
  /** Convenience: decision records. */
  decisions?: Array<Omit<DecisionRecord, 'kind'>>;
  /** Override the token budget for this call. */
  tokenBudget?: number;
}

export type SelectionReason =
  | 'task'
  | 'mandatory'
  | 'high_relevance'
  | 'budget_fill'
  | 'related_to_selected';

export interface SelectedFragment {
  fragment: Fragment;
  /** Why this fragment was selected. */
  selectionReason: SelectionReason;
}

export type OmissionReason = 'low_relevance' | 'budget_exhausted' | 'superseded';

export interface OmittedFragment {
  id: string;
  recordId: string;
  kind: RecordKind;
  /** Short text preview for debugging (max 120 chars). */
  preview: string;
  reason: OmissionReason;
  score?: number;
}

export interface BudgetConflict {
  /** Estimated tokens of all mandatory content. */
  mandatoryTokens: number;
  /** Requested budget. */
  budget: number;
  /** Mandatory fragments that did not fit, in render order. */
  overflow: Array<{ fragmentId: string; label: string; tokens: number }>;
  message: string;
}

export type WarningCode =
  | 'BUDGET_CONFLICT'
  | 'BUDGET_EXCEEDED'
  | 'FRAGMENT_CAP_APPLIED'
  | 'MALFORMED_RECORD'
  | 'MISSING_METADATA'
  | 'NEAR_DUPLICATE_MERGE'
  | 'SUPERSEDED_DECISION'
  | 'EMPTY_INPUT'
  | 'TOKEN_ESTIMATE_ONLY';

export interface Warning {
  code: WarningCode;
  message: string;
}

export interface BudgetSummary {
  requested: number;
  used: number;
  fitsBudget: boolean;
  conflict?: BudgetConflict;
}

/**
 * Reproducible, machine-readable optimization report.
 * Contains no timing data: durations are non-deterministic and are measured
 * by the benchmark harness instead.
 */
export interface OptimizationReport {
  totals: {
    recordsIn: number;
    fragmentsAfterExtraction: number;
    fragmentsAfterDedup: number;
    fragmentsSelected: number;
    fragmentsOmitted: number;
  };
  tokens: {
    estimator: string;
    estimatedInput: number;
    estimatedOutput: number;
    /** (estimatedInput - estimatedOutput) / estimatedInput, 0 when input is 0. */
    reductionRatio: number;
  };
  budget: BudgetSummary;
  /** Merged fragment groups (kept + merged origins + reason). */
  merges: Array<{
    kept: string;
    merged: string[];
    reason: MergeReason;
    count: number;
  }>;
  omissions: Array<{ id: string; reason: OmissionReason; score?: number }>;
  warnings: Warning[];
  /** Configuration fingerprint (hash) for reproducibility checks. */
  configHash: string;
}

/** Final result of a context build. */
export interface OptimizedContext {
  /** Rendered, compact context text (machine metadata excluded). */
  context: string;
  /** Selected fragments with provenance, signals and score breakdowns. */
  sources: SelectedFragment[];
  /** Fragments that were dropped, with reasons. */
  omitted: OmittedFragment[];
  /** Reproducible optimization report. */
  report: OptimizationReport;
  stats: {
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    reductionRatio: number;
  };
}



