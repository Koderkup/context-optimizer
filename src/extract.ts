import type {
  DecisionStatus,
  ExtractedError,
  ExtractedSignals,
  Fragment,
  RecordKind,
} from './types.js';

// ---------------------------------------------------------------------------
// Regexes (deterministic, conservative)
// ---------------------------------------------------------------------------

/** File paths with an extension, unix or windows separators, optional :line[:col]. */
const PATH_RE =
  /((?:[A-Za-z]:)?[\\/]?(?:[\p{L}\p{N}_.\-~@+]+[\\/])+[\p{L}\p{N}_.\-~@+]+\.([\p{L}]{1,8}))(?::(\d+))?(?::(\d+))?/gu;
/** Node-style stack frames: "at fn (path:line:col)" or "at path:line:col". */
const NODE_FRAME_RE = /^\s*at (?:(.+?) \((.+?):(\d+):(\d+)\)|(.+?):(\d+):(\d+))\s*$/gm;
/** Python-style frames: 'File "path", line N'. */
const PY_FRAME_RE = /^\s*File "([^"]+)", line (\d+)/gm;
/** "ErrorType: message" on a line start (plain "Error:" also accepted). */
const ERROR_TYPE_RE = /^([A-Za-z_$][\w$]*(?:Error|Exception|Failure|Warning)|Error)\s*:\s*(.*)$/;
/** Code declaration symbols, per language family. */
const SYMBOL_RES: RegExp[] = [
  /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
  /\bdef\s+([A-Za-z_$][\w$]*)/g,
  /\bfunc\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:pub\s+)?fn\s+([A-Za-z_$][\w$]*)/g,
];
/** Requirement/constraint trigger words. */
const REQUIREMENT_TRIGGERS = [
  'must',
  'shall',
  'required',
  'requirement',
  'do not',
  "don't",
  'never',
  'always',
  'should not',
  'must not',
  'cannot',
  "can't",
  'ensure',
  'avoid',
  'keep ',
  'only ',
] as const;

const FAILURE_EVIDENCE_RE =
  /\b(exit code [1-9]\d*|exited with code [1-9]\d*|traceback \(most recent call last\)|fatal:|panicked at|assertion failed|failed to|error:|errno|✗|×\s*fail)/i;
const SUCCESS_EVIDENCE_RE =
  /\b(exit code 0|tests? passed|all tests passed|build succeeded|passing\b|✓|ok \()/i;
const RESOLVED_EVIDENCE_RE =
  /\b(fixed|resolved|now passes|working again|passes now|solved)\b/i;
const UNRESOLVED_MARKER_RE = /\b(TODO|FIXME|unresolved|still failing|does not work|broken)\b/;

const MAX_PATHS = 60;
const MAX_SYMBOLS = 60;

export interface ExtractOptions {
  kind: RecordKind;
  text: string;
  /** Primary file path from the record, if any. */
  recordPath?: string;
  exitCode?: number;
  decisionStatus?: DecisionStatus;
}

function basename(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

/** Extract file path mentions (canonical forward-slash form). */
export function extractPaths(text: string): Array<{ path: string; line?: number; column?: number }> {
  const seen = new Set<string>();
  const out: Array<{ path: string; line?: number; column?: number }> = [];
  PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_RE.exec(text)) !== null && out.length < MAX_PATHS) {
    const raw = m[1] as string;
    const ext = (m[2] ?? '').toLowerCase();
    // Require a source-ish extension to avoid matching "v1.2" or "file.txt.bak" noise.
    if (!/^[a-z][a-z0-9]{0,7}$/.test(ext)) continue;
    const path = raw.replace(/\\/g, '/');
    const key = `${path}:${m[3] ?? ''}:${m[4] ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry: { path: string; line?: number; column?: number } = { path };
    if (m[3]) entry.line = Number(m[3]);
    if (m[4]) entry.column = Number(m[4]);
    out.push(entry);
  }
  return out;
}

/** Extract declared/mentioned code symbols (conservative language patterns). */
export function extractSymbols(text: string): Array<{ name: string; path?: string }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; path?: string }> = [];
  for (const re of SYMBOL_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null && out.length < MAX_SYMBOLS) {
      const name = m[1] as string;
      if (name.length < 2 || seen.has(name)) continue;
      seen.add(name);
      out.push({ name });
    }
  }
  return out;
}

/** Parse stack frames (node + python) from an error text. */
export function extractStackFrames(
  text: string,
): Array<{ fn?: string; path?: string; line?: number }> {
  const frames: Array<{ fn?: string; path?: string; line?: number }> = [];
  NODE_FRAME_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NODE_FRAME_RE.exec(text)) !== null && frames.length < 40) {
    if (m[2]) {
      frames.push({ fn: m[1], path: (m[2] as string).replace(/\\/g, '/'), line: Number(m[3]) });
    } else if (m[5] && !/\binternal\/|node:/.test(m[5])) {
      frames.push({ path: (m[5] as string).replace(/\\/g, '/'), line: Number(m[6]) });
    }
  }
  PY_FRAME_RE.lastIndex = 0;
  while ((m = PY_FRAME_RE.exec(text)) !== null && frames.length < 40) {
    frames.push({ path: (m[1] as string).replace(/\\/g, '/'), line: Number(m[2]) });
  }
  return frames;
}

/** Build a normalized error signature (type + message head, whitespace collapsed). */
export function errorSignature(errorType: string | undefined, message: string): string {
  const head = message.replace(/\s+/g, ' ').trim().slice(0, 200);
  return errorType ? `${errorType}: ${head}` : head;
}

/** Sentence split that keeps requirement detection deterministic. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Detect explicit requirements/constraints in a text. */
export function extractRequirements(text: string): Array<{ text: string; trigger: string }> {
  const out: Array<{ text: string; trigger: string }> = [];
  const lower = text.toLowerCase();
  for (const sentence of splitSentences(text)) {
    if (out.length >= 20) break;
    const s = sentence.toLowerCase();
    for (const trigger of REQUIREMENT_TRIGGERS) {
      if (s.includes(trigger)) {
        out.push({ text: sentence.slice(0, 400), trigger: trigger.trim() });
        break;
      }
    }
  }
  // Guard against pathological input where sentence split returns one blob.
  if (out.length === 0 && lower.length === 0) return out;
  return out;
}

/**
 * Stage 3: structured extraction of signals from a fragment.
 * Purely deterministic; never invents facts. Outcome is set only with
 * explicit evidence (exit codes, error markers).
 */
export function extractSignals(opts: ExtractOptions): ExtractedSignals {
  const { kind, text, recordPath, exitCode, decisionStatus } = opts;

  const paths = extractPaths(text);
  if (recordPath) {
    const canon = recordPath.replace(/\\/g, '/');
    if (!paths.some((p) => p.path === canon)) paths.unshift({ path: canon });
  }

  const symbols = extractSymbols(text);
  const stackFrames = kind === 'error' ? extractStackFrames(text) : [];
  for (const frame of stackFrames) {
    if (frame.fn && !symbols.some((s) => s.name === frame.fn)) symbols.push({ name: frame.fn });
  }

  const errors: ExtractedError[] = [];
  if (kind === 'error') {
    const firstLine = text.split('\n', 1)[0] ?? '';
    const m = ERROR_TYPE_RE.exec(firstLine);
    const errorType = m?.[1];
    const message = m?.[2] ? `${errorType}: ${m[2]}` : firstLine;
    errors.push({
      ...(errorType ? { errorType } : {}),
      message: message || firstLine,
      signature: errorSignature(errorType, message || firstLine),
      stackFrames,
      resolved: RESOLVED_EVIDENCE_RE.test(text),
    });
  } else {
    const firstLine = text.split('\n', 1)[0] ?? '';
    const m = ERROR_TYPE_RE.exec(firstLine);
    if (m && FAILURE_EVIDENCE_RE.test(text)) {
      const errorType = m[1] as string;
      const message = `${errorType}: ${m[2] ?? ''}`.trim();
      errors.push({
        errorType,
        message,
        signature: errorSignature(errorType, message),
        stackFrames: [],
        resolved: RESOLVED_EVIDENCE_RE.test(text),
      });
    }
  }

  const requirements =
    kind === 'message' || kind === 'note' || kind === 'decision'
      ? extractRequirements(text)
      : [];

  // Outcome: evidence-based only.
  let outcome: ExtractedSignals['outcome'];
  if (typeof exitCode === 'number' && exitCode !== 0) {
    outcome = { status: 'failure', evidence: `exit code ${exitCode}` };
  } else if (typeof exitCode === 'number' && exitCode === 0) {
    outcome = { status: 'success', evidence: 'exit code 0' };
  } else if (FAILURE_EVIDENCE_RE.test(text)) {
    outcome = { status: 'failure', evidence: 'failure marker in text' };
  } else if (SUCCESS_EVIDENCE_RE.test(text)) {
    outcome = { status: 'success', evidence: 'success marker in text' };
  }

  // Unresolved: open errors, failing states, explicit unresolved markers.
  let unresolved = false;
  if (kind === 'error' && !RESOLVED_EVIDENCE_RE.test(text)) unresolved = true;
  if (outcome?.status === 'failure' && !RESOLVED_EVIDENCE_RE.test(text)) unresolved = true;
  if (UNRESOLVED_MARKER_RE.test(text) && !RESOLVED_EVIDENCE_RE.test(text)) unresolved = true;
  if (decisionStatus === 'accepted') unresolved = false;

  return { paths, symbols, errors, requirements, ...(outcome ? { outcome } : {}), unresolved };
}

/** Run Stage 3 over all fragments (mutates fragment.extracted in place on copies). */
export function extractStage(fragments: Fragment[]): Fragment[] {
  return fragments.map((f) => ({
    ...f,
    extracted: extractSignals({
      kind: f.kind,
      text: f.text,
      ...(f.meta?.path ? { recordPath: f.meta.path } : {}),
      ...(typeof f.meta?.exitCode === 'number' ? { exitCode: f.meta.exitCode } : {}),
      ...(f.meta?.decisionStatus ? { decisionStatus: f.meta.decisionStatus } : {}),
    }),
  }));
}

export { basename };

