/**
 * Text compaction stage (Stage 3b).
 *
 * Reduces fragment text size without losing information needed for scoring,
 * provenance, or task-solving. Applied AFTER extraction (so structured
 * signals like stack frames and symbols are already captured) and BEFORE
 * dedup (so compacted text improves similarity matching).
 *
 * All functions are pure and deterministic.
 */

import type { Fragment } from './types.js';

// ---------------------------------------------------------------------------
// Compaction options
// ---------------------------------------------------------------------------

export interface CompactOptions {
  /** Maximum stack frames to keep per error fragment. */
  maxStackFrames: number;
  /** Maximum lines to keep from tool_call / test_result output. */
  maxToolOutputLines: number;
  /** Whether to strip blank lines and trailing whitespace from code files. */
  compactCode: boolean;
  /** Whether to truncate stack traces. */
  compactErrors: boolean;
  /** Whether to collapse verbose tool output. */
  compactToolOutput: boolean;
  /** Whether to trim boilerplate from conversational messages. */
  compactMessages: boolean;
}

export const DEFAULT_COMPACT_OPTIONS: CompactOptions = {
  maxStackFrames: 5,
  maxToolOutputLines: 15,
  compactCode: true,
  compactErrors: true,
  compactToolOutput: true,
  compactMessages: true,
};

export interface CompactResult {
  fragments: Fragment[];
  warnings: Array<{ code: 'COMPACT_TRUNCATED'; message: string }>;
  /** Per-fragment chars saved by compaction. */
  savings: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Individual compaction functions
// ---------------------------------------------------------------------------

/**
 * Compact code text: remove blank lines and trailing whitespace.
 * Safe for source files — only removes formatting whitespace that does
 * not change semantics (empty lines, trailing spaces/tabs).
 */
export function compactCode(text: string): string {
  const lines = text.split('\n');
  const result = lines
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .filter((l) => l.trim().length > 0);
  return result.join('\n');
}

/**
 * Compact a stack trace: keep the first line (error message) and the top
 * N application frames. Node-internal and library frames are filtered
 * so only relevant frames are retained.
 */
export function compactStackTrace(text: string, maxFrames: number = 5): string {
  const lines = text.split('\n');
  if (lines.length <= maxFrames + 2) return text;

  const errorLine = lines[0] ?? '';
  const rest = lines.slice(1);

  const kept: string[] = [];
  let skipped = 0;
  for (const line of rest) {
    if (kept.length >= maxFrames) {
      skipped++;
      continue;
    }
    if (/node:internal|node_modules|webpack:\/\//.test(line)) {
      skipped++;
      continue;
    }
    kept.push(line);
  }

  if (skipped === 0) return text;
  const suffix = `... (${skipped} frame(s) omitted)`;
  return [errorLine, ...kept, suffix].join('\n');
}

/**
 * Compact tool output: collapse trailing whitespace and truncate long
 * outputs while keeping the beginning and end (summary) for context.
 */
export function compactToolOutput(text: string, maxLines: number = 15): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return lines.map((l) => l.replace(/[ \t]+$/g, '')).join('\n');
  }

  const keepHead = Math.max(3, maxLines - 5);
  const head = lines.slice(0, keepHead);
  const tail = lines.slice(-5);
  const omitted = lines.length - head.length - tail.length;
  return [
    ...head.map((l) => l.replace(/[ \t]+$/g, '')),
    `... (${omitted} line(s) omitted)`,
    ...tail.map((l) => l.replace(/[ \t]+$/g, '')),
  ].join('\n');
}

/**
 * Compact general conversational text: collapse runs of blank lines to
 * a single blank line and trim trailing whitespace per line.
 */
export function compactGeneralText(text: string): string {
  return text
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Fragment-level compaction dispatcher
// ---------------------------------------------------------------------------

/**
 * Apply kind-specific compaction to a single fragment.
 * Returns a new fragment with compacted text (or the same fragment if
 * no reduction occurred). All structured signals (extracted paths,
 * symbols, stack frames) are preserved unchanged.
 */
export function compactFragment(fragment: Fragment, opts: CompactOptions): Fragment {
  const original = fragment.text;
  let compacted: string;

  switch (fragment.kind) {
    case 'file':
      compacted = opts.compactCode ? compactCode(original) : original;
      break;
    case 'error':
      compacted = opts.compactErrors
        ? compactStackTrace(original, opts.maxStackFrames)
        : original;
      break;
    case 'tool_call':
      compacted = opts.compactToolOutput
        ? compactToolOutput(original, opts.maxToolOutputLines)
        : original;
      break;
    case 'test_result':
      compacted = opts.compactToolOutput
        ? compactToolOutput(original, opts.maxToolOutputLines)
        : compactGeneralText(original);
      break;
    case 'message':
    case 'note':
      compacted = opts.compactMessages ? compactGeneralText(original) : original;
      break;
    case 'diff':
      compacted = compactGeneralText(original);
      break;
    case 'decision':
      compacted = original;
      break;
  }

  if (compacted === original) return fragment;

  return {
    ...fragment,
    text: compacted,
    meta: { ...fragment.meta, compacted: true },
    provenance: {
      ...fragment.provenance,
      originalLength: original.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Stage entry point
// ---------------------------------------------------------------------------

/**
 * Stage 3b: apply text compaction to all fragments.
 * Returns new fragments (does not mutate input).
 */
export function compactStage(
  fragments: Fragment[],
  opts: CompactOptions = DEFAULT_COMPACT_OPTIONS,
): CompactResult {
  const warnings: CompactResult['warnings'] = [];
  const savings = new Map<string, number>();
  const result: Fragment[] = [];

  for (const f of fragments) {
    const compacted = compactFragment(f, opts);
    result.push(compacted);
    const saved = f.text.length - compacted.text.length;
    if (saved > 0) {
      savings.set(f.id, saved);
    }
  }

  const totalSaved = [...savings.values()].reduce((a, b) => a + b, 0);
  if (totalSaved > 0) {
    warnings.push({
      code: 'COMPACT_TRUNCATED',
      message: `Text compaction saved ~${Math.ceil(totalSaved / 4)} est. tokens across ${savings.size} fragment(s).`,
    });
  }

  return { fragments: result, warnings, savings };
}

