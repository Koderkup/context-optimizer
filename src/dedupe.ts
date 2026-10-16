import { sha256 } from './tokens.js';
import type { Fragment, MergeReason, OptimizationReport, Warning } from './types.js';

/** Output of the dedupe stage. */
export interface DedupeResult {
  fragments: Fragment[];
  merges: OptimizationReport['merges'];
  warnings: Warning[];
}

/** Kinds where near-duplicate (containment) merging is allowed at all. */
const NEAR_DUP_KINDS: ReadonlySet<Fragment['kind']> = new Set<Fragment['kind']>([
  'message',
  'tool_call',
  'error',
  'note',
  'test_result',
  'diff',
  'file',
]);

/** Lowercased, whitespace-collapsed text used for similarity comparisons. */
function similarityForm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Character trigram set of a string. */
function trigrams(text: string): Set<string> {
  const set = new Set<string>();
  const t = text.length >= 3 ? text : `  ${text}`;
  for (let i = 0; i <= t.length - 3; i++) set.add(t.slice(i, i + 3));
  return set;
}

/**
 * Containment similarity: |A ∩ B| / min(|A|, |B|) over trigram sets.
 * 1.0 means the shorter text is fully contained in the longer one.
 */
export function containmentSimilarity(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size === 0) return 0;
  let inter = 0;
  for (const g of small) if (large.has(g)) inter++;
  return inter / small.size;
}

/** Merge `src` (a duplicate) into `dst` (the kept canonical fragment). */
function mergeInto(dst: Fragment, src: Fragment, reason: MergeReason): void {
  dst.duplicateCount += src.duplicateCount;
  if (!dst.mergeReasons.includes(reason)) dst.mergeReasons.push(reason);
  for (const ref of src.provenance.mergedFrom) {
    if (!dst.provenance.mergedFrom.some((r) => r.recordId === ref.recordId && r.label === ref.label)) {
      dst.provenance.mergedFrom.push(ref);
    }
  }
  // Keep the highest priority and the latest timestamp.
  dst.priority = Math.max(dst.priority, src.priority);
  if (src.lastSeenAt && (!dst.lastSeenAt || src.lastSeenAt > dst.lastSeenAt)) {
    dst.lastSeenAt = src.lastSeenAt;
  }
}

/**
 * Stage 2: deduplication.
 *
 * 1. exact_duplicate - identical canonical text (same kind) via sha256.
 * 2. repeated_run    - same tool/test command with different outputs: keep the
 *                      latest run in full, compact the others into a run history
 *                      line that preserves exit codes and timestamps.
 * 3. extended_copy   - conservative containment (trigram) near-duplicates of
 *                      the same kind (and same path for files/diffs). The longer
 *                      text is kept; nothing is merged on error-type or filename
 *                      similarity alone.
 */
export function dedupeStage(
  fragments: Fragment[],
  opts: { nearDuplicateThreshold: number },
): DedupeResult {
  const warnings: Warning[] = [];
  const merges: OptimizationReport['merges'] = [];
  let working = [...fragments];

  // --- 1. exact duplicates --------------------------------------------------
  const byExact = new Map<string, Fragment>();
  const exactKept: Fragment[] = [];
  for (const f of working) {
    const key = `${f.kind}|${f.text}`;
    const hash = sha256(key);
    const existing = byExact.get(hash);
    if (existing) {
      mergeInto(existing, f, 'exact_duplicate');
      const merge = merges.find((m) => m.kept === existing.id);
      if (merge) {
        merge.merged.push(...f.provenance.mergedFrom.map((r) => r.recordId));
        merge.count += 1;
      } else {
        merges.push({
          kept: existing.id,
          merged: f.provenance.mergedFrom.map((r) => r.recordId),
          reason: 'exact_duplicate',
          count: f.duplicateCount,
        });
      }
    } else {
      byExact.set(hash, f);
      exactKept.push(f);
    }
  }
  working = exactKept;

  // --- 2. repeated runs (tool calls / test results with same identity) ------
  const runGroups = new Map<string, Fragment[]>();
  for (const f of working) {
    let key: string | null = null;
    if (f.kind === 'tool_call' && f.meta?.toolName) key = `tool:${f.meta.toolName}`;
    else if (f.kind === 'test_result' && (f.meta?.command || f.meta?.exitCode !== undefined))
      key = `test:${f.meta?.command ?? '(unnamed)'}`;
    if (key) {
      const group = runGroups.get(key);
      if (group) group.push(f);
      else runGroups.set(key, [f]);
    }
  }
  const runKeptIds = new Set<string>();
  for (const [key, group] of runGroups) {
    if (group.length < 2) continue;
    // Latest run = greatest timestamp, else latest in input order.
    const sorted = [...group].sort((a, b) => a.recordIndex - b.recordIndex);
    let latestIdx = 0;
    for (let i = 1; i < sorted.length; i++) {
      const f = sorted[i] as Fragment;
      const cur = sorted[latestIdx] as Fragment;
      if (f.lastSeenAt && cur.lastSeenAt && f.lastSeenAt > cur.lastSeenAt) latestIdx = i;
      else if (f.lastSeenAt && !cur.lastSeenAt) latestIdx = i;
    }
    const latest = sorted[latestIdx] as Fragment;
    const others = sorted.filter((_, i) => i !== latestIdx);
    const history = others.map((f, i) => {
      const exit = f.meta?.exitCode !== undefined ? ` exit=${f.meta.exitCode}` : '';
      const ts = f.lastSeenAt ? ` at ${f.lastSeenAt}` : '';
      return `run ${i + 1}:${exit}${ts}`;
    });
    const historyLine = `\n\n[prior runs of ${key}: ${history.join('; ')}]`;
    const merged: Fragment = {
      ...latest,
      text: latest.text + historyLine,
      meta: { ...latest.meta, runHistoryLines: history.length } as Fragment['meta'],
    };
    for (const f of others) mergeInto(merged, f, 'repeated_run');
    merges.push({
      kept: merged.id,
      merged: others.flatMap((f) => f.provenance.mergedFrom.map((r) => r.recordId)),
      reason: 'repeated_run',
      count: group.length,
    });
    runKeptIds.add(merged.id);
    const groupSet = new Set(group);
    working = working.filter((f) => !groupSet.has(f));
    working.push(merged);
  }
  working.sort((a, b) => a.recordIndex - b.recordIndex || (a.id < b.id ? -1 : 1));

  // --- 3. extended copies (conservative containment near-duplicates) --------
  let nearDupMerges = 0;
  if (opts.nearDuplicateThreshold < 1) {
    const buckets = new Map<Fragment['kind'], Fragment[]>();
    for (const f of working) {
      if (!NEAR_DUP_KINDS.has(f.kind)) continue;
      const bucket = buckets.get(f.kind);
      if (bucket) bucket.push(f);
      else buckets.set(f.kind, [f]);
    }
    const MAX_BUCKET = 1000;
    for (const bucket of buckets.values()) {
      if (bucket.length > MAX_BUCKET) {
        warnings.push({
          code: 'NEAR_DUPLICATE_MERGE',
          message: `Near-duplicate scan skipped for a ${bucket.length}-fragment kind bucket (cap ${MAX_BUCKET}); exact dedup still applied.`,
        });
        continue;
      }
      const trigramCache = new Map<string, Set<string>>();
      const tris = (f: Fragment): Set<string> => {
        let t = trigramCache.get(f.id);
        if (!t) {
          t = trigrams(similarityForm(f.text));
          trigramCache.set(f.id, t);
        }
        return t;
      };
      const removed = new Set<Fragment>();
      for (let i = 0; i < bucket.length; i++) {
        const a = bucket[i] as Fragment;
        if (removed.has(a)) continue;
        for (let j = i + 1; j < bucket.length; j++) {
          const b = bucket[j] as Fragment;
          if (removed.has(b)) continue;
          // Files and diffs may only merge when they concern the same path.
          if ((a.kind === 'file' || a.kind === 'diff') && a.meta?.path !== b.meta?.path) continue;
          const sim = containmentSimilarity(tris(a), tris(b));
          if (sim < opts.nearDuplicateThreshold) continue;
          // Keep the longer text (more information); tie -> earlier record.
          const keep = a.text.length >= b.text.length ? a : b;
          const drop = keep === a ? b : a;
          mergeInto(keep, drop, 'extended_copy');
          merges.push({
            kept: keep.id,
            merged: drop.provenance.mergedFrom.map((r) => r.recordId),
            reason: 'extended_copy',
            count: 2,
          });
          removed.add(drop);
          nearDupMerges++;
        }
      }
      if (removed.size > 0) {
        for (const f of removed) {
          const idx = working.indexOf(f);
          if (idx >= 0) working.splice(idx, 1);
        }
      }
    }
  }

  if (nearDupMerges > 0) {
    warnings.push({
      code: 'NEAR_DUPLICATE_MERGE',
      message: `${nearDupMerges} near-duplicate fragment(s) merged at threshold ${opts.nearDuplicateThreshold} (longer text kept).`,
    });
  }

  working.sort((a, b) => a.recordIndex - b.recordIndex || (a.id < b.id ? -1 : 1));
  return { fragments: working, merges, warnings };
}



