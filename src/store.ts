import { normalizeStage } from './normalize.js';
import type { DecisionRecord, InputRecord } from './types.js';

/**
 * Minimal local persistence interface.
 *
 * The default implementation is in-memory only: nothing is written to disk,
 * no network calls are made, and no telemetry is collected. If you need
 * persistence, implement this interface yourself (e.g. backed by a local
 * JSON file) - the SDK never writes files on its own.
 */
export interface ContextStore {
  /** Add records to the store. Records are validated defensively. */
  add(records: InputRecord[]): void;
  /** All stored records in insertion order. */
  all(): InputRecord[];
  /** Remove all records. */
  clear(): void;
  /** Optional: decision records. Implement for fast get_decisions. */
  getDecisions?(): DecisionRecord[];
  /** Optional: errors and failed attempts. Implement for fast get_relevant_errors. */
  getErrors?(): InputRecord[];
  /** Optional: records touching a file path. Implement for fast get_file_history. */
  getByFile?(path: string): InputRecord[];
}

/** Filter helpers used when a store does not implement the optional queries. */
export function filterDecisions(records: InputRecord[]): DecisionRecord[] {
  return records.filter((r): r is DecisionRecord => r.kind === 'decision');
}

export function filterErrors(records: InputRecord[]): InputRecord[] {
  return records.filter(
    (r) =>
      r.kind === 'error' ||
      (r.kind === 'tool_call' && r.exitCode !== undefined && r.exitCode !== 0) ||
      (r.kind === 'test_result' && (r.failed ?? 0) > 0),
  );
}

export function filterByFile(records: InputRecord[], path: string): InputRecord[] {
  const canon = path.replace(/\\/g, '/').toLowerCase();
  const suffix = canon.split('/').pop() ?? canon;
  const matches = (p: string | undefined): boolean => {
    if (!p) return false;
    const rp = p.replace(/\\/g, '/').toLowerCase();
    return rp === canon || rp.endsWith(`/${suffix}`);
  };
  return records.filter((r) => {
    if (r.kind === 'file' || r.kind === 'diff' || r.kind === 'error') {
      return matches(r.path);
    }
    if (r.kind === 'test_result') {
      return (r.failures ?? []).some((f) => matches(f.file));
    }
    return false;
  });
}

/**
 * In-memory store. Validation reuses the Stage 1 rules: malformed records
 * are ignored rather than corrupting the store.
 */
export class InMemoryContextStore implements ContextStore {
  private readonly records: InputRecord[] = [];

  add(records: InputRecord[]): void {
    const { records: valid } = normalizeStage(records);
    this.records.push(...valid);
  }

  all(): InputRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records.length = 0;
  }

  /** Decision records (any status), in insertion order. */
  getDecisions(): DecisionRecord[] {
    return filterDecisions(this.records);
  }

  /** Error records plus failed tool calls/test results. */
  getErrors(): InputRecord[] {
    return filterErrors(this.records);
  }

  /** Records associated with a file path (exact or suffix match). */
  getByFile(path: string): InputRecord[] {
    return filterByFile(this.records, path);
  }
}
