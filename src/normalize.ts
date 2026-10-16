import { shortHash } from './tokens.js';
import type {
  BuildContextInput,
  DecisionRecord,
  DiffRecord,
  ErrorRecord,
  FileRecord,
  Fragment,
  InputRecord,
  MessageRecord,
  Provenance,
  RecordKind,
  SourceRef,
  TestResultRecord,
  Warning,
} from './types.js';

/** Output of Stage 1. */
export interface NormalizeResult {
  records: InputRecord[];
  fragments: Fragment[];
  warnings: Warning[];
}

const RECORD_KINDS: ReadonlySet<string> = new Set<RecordKind>([
  'message',
  'tool_call',
  'error',
  'file',
  'diff',
  'test_result',
  'decision',
  'note',
]);

// ---------------------------------------------------------------------------
// Text normalization helpers
// ---------------------------------------------------------------------------

/** Normalize line endings and trim outer whitespace. Internal structure kept. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

/**
 * Collapse runs of >= `minRun` identical consecutive non-empty lines into a
 * single line plus a repeat marker. Applied only to conversational text and
 * tool output - never to file contents or diffs, where repeated lines are
 * meaningful (code, diff context).
 */
export function collapseRepeatedLines(text: string, minRun = 4): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    let j = i;
    while (j < lines.length && lines[j] === line) j++;
    const run = j - i;
    if (run >= minRun && line.trim().length >= 8) {
      out.push(line);
      out.push(`... (identical line repeated ${run} times in source)`);
    } else {
      for (let k = i; k < j; k++) out.push(lines[k] as string);
    }
    i = j;
  }
  return out.join('\n');
}

/** Deterministic JSON stringify: object keys sorted recursively. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value);
    return s === undefined ? String(value) : s;
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(', ')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}: ${stableStringify(obj[k])}`).join(', ')}}`;
}

// ---------------------------------------------------------------------------
// Record collection
// ---------------------------------------------------------------------------

/** Merge the convenience arrays of BuildContextInput into a single record list. */
export function collectRecords(input: BuildContextInput): InputRecord[] {
  const out: InputRecord[] = [];
  if (input.records) out.push(...input.records);
  for (const m of input.messages ?? []) {
    const rec: MessageRecord = { kind: 'message', role: m.role, text: m.text };
    if (m.name !== undefined) rec.name = m.name;
    if (m.timestamp !== undefined) rec.timestamp = m.timestamp;
    if (m.id !== undefined) rec.id = m.id;
    out.push(rec);
  }
  for (const f of input.files ?? []) {
    const rec: FileRecord = { kind: 'file', path: f.path, content: f.content };
    if (f.language !== undefined) rec.language = f.language;
    if (f.timestamp !== undefined) rec.timestamp = f.timestamp;
    if (f.id !== undefined) rec.id = f.id;
    out.push(rec);
  }
  for (const d of input.diffs ?? []) {
    const rec: DiffRecord = { kind: 'diff', diff: d.diff };
    if (d.path !== undefined) rec.path = d.path;
    if (d.summary !== undefined) rec.summary = d.summary;
    if (d.timestamp !== undefined) rec.timestamp = d.timestamp;
    if (d.id !== undefined) rec.id = d.id;
    out.push(rec);
  }
  for (const t of input.testResults ?? []) {
    out.push({ ...t, kind: 'test_result' } as TestResultRecord);
  }
  for (const e of input.errors ?? []) {
    out.push({ ...e, kind: 'error' } as ErrorRecord);
  }
  for (const d of input.decisions ?? []) {
    out.push({ ...d, kind: 'decision' } as DecisionRecord);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stage 1: normalize + classify
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Validate a record's required fields. Returns an error message or null. */
export function validateRecord(record: InputRecord): string | null {
  if (!record || typeof record !== 'object' || !('kind' in record)) {
    return 'record is not an object with a "kind" field';
  }
  if (!RECORD_KINDS.has(record.kind)) return `unknown record kind: ${String(record.kind)}`;
  switch (record.kind) {
    case 'message':
      if (!isNonEmptyString(record.text)) return 'message.text must be a non-empty string';
      if (!['system', 'user', 'assistant', 'tool'].includes(record.role))
        return `message.role must be system|user|assistant|tool, got ${String(record.role)}`;
      return null;
    case 'tool_call':
      if (!isNonEmptyString(record.toolName)) return 'tool_call.toolName must be a non-empty string';
      if (record.output !== undefined && typeof record.output !== 'string')
        return 'tool_call.output must be a string';
      return null;
    case 'error':
      if (!isNonEmptyString(record.message)) return 'error.message must be a non-empty string';
      return null;
    case 'file':
      if (!isNonEmptyString(record.path)) return 'file.path must be a non-empty string';
      if (typeof record.content !== 'string') return 'file.content must be a string';
      return null;
    case 'diff':
      if (!isNonEmptyString(record.diff)) return 'diff.diff must be a non-empty string';
      return null;
    case 'test_result':
      if (
        record.passed === undefined &&
        record.failed === undefined &&
        (!record.failures || record.failures.length === 0)
      )
        return 'test_result needs passed, failed or failures';
      return null;
    case 'decision':
      if (!isNonEmptyString(record.text)) return 'decision.text must be a non-empty string';
      if (!['accepted', 'rejected', 'superseded', 'proposed'].includes(record.status))
        return `decision.status must be accepted|rejected|superseded|proposed, got ${String(record.status)}`;
      return null;
    case 'note':
      if (!isNonEmptyString(record.text)) return 'note.text must be a non-empty string';
      return null;
    default:
      return 'unknown record kind';
  }
}

function sourceLabel(record: InputRecord, index: number): string {
  switch (record.kind) {
    case 'message':
      return `message #${index} (${record.role}${record.name ? `, ${record.name}` : ''})`;
    case 'tool_call':
      return `tool_call #${index} (${record.toolName})`;
    case 'error':
      return `error #${index}${record.path ? ` (${record.path})` : ''}`;
    case 'file':
      return `file #${index} (${record.path})`;
    case 'diff':
      return `diff #${index}${record.path ? ` (${record.path})` : ''}`;
    case 'test_result':
      return `test_result #${index}${record.command ? ` (${record.command})` : ''}`;
    case 'decision':
      return `decision #${index} (${record.status})`;
    case 'note':
      return `note #${index}${record.title ? ` (${record.title})` : ''}`;
  }
}

function makeSourceRef(record: InputRecord, index: number): SourceRef {
  const ref: SourceRef = {
    kind: record.kind,
    recordId: record.id as string,
    label: sourceLabel(record, index),
    recordIndex: index,
  };
  if (record.kind === 'file' || record.kind === 'error' || record.kind === 'diff') {
    if (record.path) ref.path = record.path;
  }
  return ref;
}

function makeFragment(
  record: InputRecord,
  index: number,
  text: string,
  field: string | undefined,
  meta: Fragment['meta'],
  lineRange?: [number, number],
): Fragment {
  const source = makeSourceRef(record, index);
  const provenance: Provenance = { source, mergedFrom: [source] };
  if (field) provenance.field = field;
  if (lineRange) provenance.lineRange = lineRange;
  const fragment: Fragment = {
    id: shortHash('fr', `${record.id}|${field ?? '-'}|${text}`),
    recordId: record.id as string,
    recordIndex: index,
    kind: record.kind,
    text,
    provenance,
    extracted: { paths: [], symbols: [], errors: [], requirements: [], unresolved: false },
    duplicateCount: 1,
    mergeReasons: [],
    priority: typeof record.priority === 'number' ? Math.min(1, Math.max(0, record.priority)) : 0.5,
  };
  if (record.timestamp) fragment.lastSeenAt = record.timestamp;
  if (meta) fragment.meta = meta;
  return fragment;
}

/**
 * Convert one validated record into one or more fragments.
 * A test_result record yields a summary fragment plus one fragment per failure.
 */
export function recordToFragment(record: InputRecord, index: number): Fragment[] {
  switch (record.kind) {
    case 'message': {
      const text = collapseRepeatedLines(normalizeText(record.text));
      return [makeFragment(record, index, text, undefined, { role: record.role })];
    }
    case 'tool_call': {
      const inputPart = record.input !== undefined ? stableStringify(record.input) : '';
      const output = record.output ? collapseRepeatedLines(normalizeText(record.output)) : '';
      const exitPart = record.exitCode !== undefined ? ` -> exit code ${record.exitCode}` : '';
      const text =
        `Tool: ${record.toolName}(${inputPart})${exitPart}` + (output ? `\n${output}` : '');
      const meta: Fragment['meta'] = { toolName: record.toolName };
      if (record.exitCode !== undefined) meta.exitCode = record.exitCode;
      return [makeFragment(record, index, text, undefined, meta)];
    }
    case 'error': {
      const message = normalizeText(record.message);
      const stack = record.stack ? normalizeText(record.stack) : '';
      const text = stack ? `${message}\n${stack}` : message;
      const meta: Fragment['meta'] = {};
      if (record.path) meta.path = record.path;
      if (record.exitCode !== undefined) meta.exitCode = record.exitCode;
      return [makeFragment(record, index, text, undefined, meta)];
    }
    case 'file': {
      const content = normalizeText(record.content);
      const text = `${record.path}\n${'-'.repeat(Math.min(60, record.path.length))}\n${content}`;
      return [makeFragment(record, index, text, undefined, { path: record.path })];
    }
    case 'diff': {
      const diff = normalizeText(record.diff);
      const text = record.summary
        ? `${record.summary}\n\n${diff}`
        : record.path
          ? `Diff for ${record.path}:\n${diff}`
          : diff;
      return [makeFragment(record, index, text, undefined, record.path ? { path: record.path } : undefined)];
    }
    case 'test_result': {
      const parts: string[] = [];
      if (record.framework) parts.push(`framework: ${record.framework}`);
      if (record.command) parts.push(`command: ${record.command}`);
      const counts: string[] = [];
      if (record.passed !== undefined) counts.push(`passed=${record.passed}`);
      if (record.failed !== undefined) counts.push(`failed=${record.failed}`);
      if (record.skipped !== undefined) counts.push(`skipped=${record.skipped}`);
      if (record.exitCode !== undefined) counts.push(`exit code ${record.exitCode}`);
      if (counts.length > 0) parts.push(counts.join(', '));
      const meta: Fragment['meta'] = {};
      if (record.command) meta.command = record.command;
      if (record.exitCode !== undefined) meta.exitCode = record.exitCode;
      const fragments = [makeFragment(record, index, `Test result: ${parts.join('; ')}`, undefined, meta)];
      for (const [fi, failure] of (record.failures ?? []).entries()) {
        const loc = failure.file
          ? ` (${failure.file}${failure.line !== undefined ? `:${failure.line}` : ''})`
          : '';
        const fText = `FAIL ${failure.name}${loc}\n${failure.message}`;
        const fMeta: Fragment['meta'] = { ...meta };
        if (failure.file) fMeta.path = failure.file;
        fragments.push(makeFragment(record, index, fText, `failures[${fi}]`, fMeta));
      }
      return fragments;
    }
    case 'decision': {
      const lines = [`[${record.status}] ${normalizeText(record.text)}`];
      for (const c of record.constraints ?? []) lines.push(`- constraint: ${normalizeText(c)}`);
      if (record.supersedes) lines.push(`(supersedes ${record.supersedes})`);
      return [makeFragment(record, index, lines.join('\n'), undefined, { decisionStatus: record.status })];
    }
    case 'note': {
      const text = record.title
        ? `${normalizeText(record.title)}\n${normalizeText(record.text)}`
        : normalizeText(record.text);
      return [makeFragment(record, index, text, undefined, undefined)];
    }
  }
}

/**
 * Stage 1 entry point: validate, normalize and classify raw records into
 * fragments. Original records are returned normalized (ids assigned) and are
 * never mutated in place.
 */
export function normalizeStage(rawRecords: InputRecord[]): NormalizeResult {
  const warnings: Warning[] = [];
  const records: InputRecord[] = [];
  const fragments: Fragment[] = [];
  const seenIds = new Set<string>();
  let malformed = 0;

  for (const [index, raw] of rawRecords.entries()) {
    const error = validateRecord(raw);
    if (error) {
      malformed++;
      continue;
    }
    const record = { ...raw } as InputRecord;
    let id = typeof record.id === 'string' && record.id.length > 0 ? record.id : `r${index}`;
    while (seenIds.has(id)) id = `${id}~dup`;
    record.id = id;
    seenIds.add(id);
    records.push(record);
    fragments.push(...recordToFragment(record, index));
  }

  if (malformed > 0) {
    warnings.push({
      code: 'MALFORMED_RECORD',
      message: `${malformed} record(s) failed validation and were skipped (originals preserved by caller).`,
    });
  }
  if (records.length === 0) {
    warnings.push({ code: 'EMPTY_INPUT', message: 'No valid records were provided.' });
  }
  const missingMeta = records.filter((r) => !r.timestamp).length;
  if (missingMeta > 0 && missingMeta === records.length && records.length > 1) {
    warnings.push({
      code: 'MISSING_METADATA',
      message: 'No record has a timestamp; the recency signal is neutral for this run.',
    });
  }
  return { records, fragments, warnings };
}

