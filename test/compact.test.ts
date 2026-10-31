import { describe, expect, it } from 'vitest';

import {
  compactCode,
  compactFragment,
  compactGeneralText,
  compactStackTrace,
  compactToolOutput,
  compactStage,
  DEFAULT_COMPACT_OPTIONS,
} from '../src/compact.js';
import type { Fragment, Provenance, RecordKind } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFragment(
  overrides: Partial<Fragment> & { kind: RecordKind; text: string },
): Fragment {
  const { kind, text, ...rest } = overrides;
  return {
    id: rest.id ?? 'fr_test',
    recordId: rest.recordId ?? `rec_${rest.id ?? 'fr_test'}`,
    recordIndex: rest.recordIndex ?? 0,
    kind,
    text,
    provenance: rest.provenance ?? ({} as Provenance),
    extracted: rest.extracted ?? {
      paths: [],
      symbols: [],
      errors: [],
      requirements: [],
      outcome: undefined,
      unresolved: false,
    },
    duplicateCount: rest.duplicateCount ?? 1,
    mergeReasons: rest.mergeReasons ?? [],
    priority: rest.priority ?? 0,
    ...rest,
  } as Fragment;
}
// ---------------------------------------------------------------------------
// compactCode
// ---------------------------------------------------------------------------

describe('compactCode', () => {
  it('removes blank lines', () => {
    const input = 'line1\n\n\nline2\n';
    expect(compactCode(input)).toBe('line1\nline2');
  });

  it('strips trailing whitespace', () => {
    const input = 'line1   \nline2\t\n';
    expect(compactCode(input)).toBe('line1\nline2');
  });

  it('preserves meaningful content', () => {
    const input = 'const x = 1;\nconst y = 2;\n';
    expect(compactCode(input)).toBe('const x = 1;\nconst y = 2;');
  });

  it('handles code with many blank lines', () => {
    const input = 'a\n\nb\n\n\nc\n\n\nd\n';
    expect(compactCode(input)).toBe('a\nb\nc\nd');
  });

  it('returns empty for whitespace-only input', () => {
    expect(compactCode('   \n  \n  ')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// compactStackTrace
// ---------------------------------------------------------------------------

describe('compactStackTrace', () => {
  const stack = [
    'Error: Something went wrong',
    '    at checkPolicy (src/auth/policy.ts:2:10)',
    '    at verifyToken (src/auth/token.ts:15:5)',
    '    at handleRequest (src/server/index.ts:42:12)',
    '    at processTicksAndRejections (node:internal/process/task_queues:104:5)',
    '    at Server.emit (node:internal/process/task_queues:200:10)',
    '    at /node_modules/express/lib/router/layer.js:123:45',
    '    at next (/node_modules/express/lib/router/route.js:56:7)',
    '    at /node_modules/body-parser/lib/parse.js:10:12)',
    '    at onResFinished (node_modules/middleware/index.js:45:6)',
    '    at Layer.handle (src/server/middleware.ts:10:3)',
    '    at processTicksAndRejections (node:internal/process/task_queues:92:18)',
    '    at ServerResponse.send (node:internal/http.js:500:12)',
    '    at afterWrite (node:internal/streams/writable.js:5:10)',
  ].join('\n');

  it('keeps the error message line', () => {
    const result = compactStackTrace(stack, 5);
    expect(result.startsWith('Error: Something went wrong')).toBe(true);
  });

  it('truncates to max frames', () => {
    const result = compactStackTrace(stack, 5);
    const lines = result.split('\n');
    expect(lines.length).toBeLessThanOrEqual(7);
  });

  it('adds truncation suffix when frames omitted', () => {
    const result = compactStackTrace(stack, 3);
    expect(result).toContain('omitted');
  });

  it('filters node:internal frames', () => {
    const result = compactStackTrace(stack, 5);
    expect(result).not.toContain('node:internal');
    expect(result).not.toContain('node_modules');
  });

  it('does not modify short stack traces', () => {
    const short = 'Error: boom\n    at foo (src/foo.ts:1:1)';
    expect(compactStackTrace(short, 5)).toBe(short);
  });

  it('handles default maxFrames parameter', () => {
    const result = compactStackTrace(stack);
    const lines = result.split('\n');
    expect(lines.length).toBeLessThanOrEqual(7);
  });
});

// ---------------------------------------------------------------------------
// compactToolOutput
// ---------------------------------------------------------------------------

describe('compactToolOutput', () => {
  it('preserves short output', () => {
    const input = 'line1\nline2\nline3';
    expect(compactToolOutput(input, 15)).toBe('line1\nline2\nline3');
  });

  it('truncates long output with head and tail', () => {
    const input = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const result = compactToolOutput(input, 15);
    expect(result).toContain('line 0');
    expect(result).toContain('line 49');
    expect(result).toContain('omitted');
    const lines = result.split('\n');
    expect(lines.length).toBeLessThanOrEqual(20);
  });

  it('strips trailing whitespace', () => {
    const input = 'data   \ninfo\t';
    expect(compactToolOutput(input, 5)).toBe('data\ninfo');
  });

  it('handles exactly maxLines', () => {
    const input = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    const result = compactToolOutput(input, 10);
    expect(result).toBe(input.replace(/[ \t]+$/gm, ''));
  });

  it('collapses output longer than maxLines with head and tail preservation', () => {
    const input = Array.from({ length: 100 }, (_, i) => `row ${i}`).join('\n');
    const result = compactToolOutput(input, 10);
    const lines = result.split('\n');
    expect(lines.length).toBeLessThan(input.split('\n').length);
    expect(result).toContain('row 0');
    expect(result).toContain('row 99');
  });
});

// ---------------------------------------------------------------------------
// compactGeneralText
// ---------------------------------------------------------------------------

describe('compactGeneralText', () => {
  it('collapses multiple blank lines', () => {
    const input = 'para1\n\n\n\n\npara2';
    expect(compactGeneralText(input)).toBe('para1\n\npara2');
  });

  it('strips trailing whitespace', () => {
    const input = 'hello   \nworld\t\n';
    expect(compactGeneralText(input)).toBe('hello\nworld');
  });

  it('trims overall whitespace', () => {
    const input = '  hello  ';
    expect(compactGeneralText(input)).toBe('hello');
  });

  it('preserves single blank lines between paragraphs', () => {
    const input = 'first\n\nsecond';
    expect(compactGeneralText(input)).toBe('first\n\nsecond');
  });
});

// ---------------------------------------------------------------------------
// compactFragment
// ---------------------------------------------------------------------------

describe('compactFragment', () => {
  it('compacts file fragments by stripping blank lines', () => {
    const frag = makeFragment({
      kind: 'file',
      text: 'line1\n\nline2\n\n\nline3',
    });
    const result = compactFragment(frag, DEFAULT_COMPACT_OPTIONS);
    expect(result.text).toBe('line1\nline2\nline3');
    expect(result.meta?.compacted).toBe(true);
    expect(result.provenance.originalLength).toBe('line1\n\nline2\n\n\nline3'.length);
  });

  it('compacts error fragments by truncating stack traces', () => {
    const stackText = Array.from({ length: 30 }, (_, i) =>
      `    at func_${i} (src/code.ts:${i + 1}:${i + 1})`,
    ).join('\n');
    const frag = makeFragment({
      kind: 'error',
      text: `Error: failed\n${stackText}`,
    });
    const result = compactFragment(frag, DEFAULT_COMPACT_OPTIONS);
    expect(result.text).not.toBe(`Error: failed\n${stackText}`);
    expect(result.meta?.compacted).toBe(true);
    expect(result.provenance.originalLength).toBeDefined();
  });

  it('compacts tool_call fragments by limiting lines', () => {
    const output = Array.from({ length: 50 }, (_, i) => `row${i}`).join('\n');
    const frag = makeFragment({
      kind: 'tool_call',
      text: output,
    });
    const result = compactFragment(frag, DEFAULT_COMPACT_OPTIONS);
    expect(result.text.length).toBeLessThan(output.length);
    expect(result.meta?.compacted).toBe(true);
  });

  it('compacts test_result fragments', () => {
    const text = Array.from({ length: 30 }, (_, i) => `test output row ${i}`).join('\n');
    const frag = makeFragment({
      kind: 'test_result',
      text,
    });
    const result = compactFragment(frag, DEFAULT_COMPACT_OPTIONS);
    expect(result.text.length).toBeLessThan(text.length);
    expect(result.meta?.compacted).toBe(true);
  });

  it('compacts message fragments', () => {
    const text = 'hello\n\n\n\nworld';
    const frag = makeFragment({
      kind: 'message',
      text,
    });
    const result = compactFragment(frag, DEFAULT_COMPACT_OPTIONS);
    expect(result.text).toBe('hello\n\nworld');
    expect(result.meta?.compacted).toBe(true);
  });

  it('does not compact decision fragments', () => {
    const text = 'Must stay server-side\n\n\n';
    const frag = makeFragment({
      kind: 'decision',
      text,
    });
    const result = compactFragment(frag, DEFAULT_COMPACT_OPTIONS);
    expect(result.text).toBe(text);
    expect(result.meta?.compacted).toBeUndefined();
  });

  it('preserves extracted signals unchanged', () => {
    const frag = makeFragment({
      kind: 'file',
      text: 'line1\n\nline2',
      extracted: {
        paths: [{ path: 'src/file.ts', line: 1, column: 0 }],
        symbols: [{ name: 'myFunc', path: 'src/file.ts' }],
        errors: [],
        requirements: [],
        outcome: undefined,
      unresolved: false,
      },
    });
    const result = compactFragment(frag, DEFAULT_COMPACT_OPTIONS);
    expect(result.extracted.paths).toEqual(frag.extracted.paths);
    expect(result.extracted.symbols).toEqual(frag.extracted.symbols);
  });

  it('preserves kind and recordId', () => {
    const frag = makeFragment({
      kind: 'file',
      text: 'a\n\nb',
    });
    const result = compactFragment(frag, DEFAULT_COMPACT_OPTIONS);
    expect(result.kind).toBe('file');
    expect(result.recordId).toBe(frag.recordId);
  });

  it('respects compactCode: false', () => {
    const frag = makeFragment({
      kind: 'file',
      text: 'line1\n\nline2',
    });
    const result = compactFragment(frag, { ...DEFAULT_COMPACT_OPTIONS, compactCode: false });
    expect(result.text).toBe('line1\n\nline2');
    expect(result.meta?.compacted).toBeUndefined();
  });

  it('respects compactErrors: false', () => {
    const stack = 'Error: x\n' + Array.from({ length: 20 }, (_, i) => `    at f${i}`).join('\n');
    const frag = makeFragment({
      kind: 'error',
      text: stack,
    });
    const result = compactFragment(frag, { ...DEFAULT_COMPACT_OPTIONS, compactErrors: false });
    expect(result.text).toBe(stack);
  });

  it('returns same fragment when no compaction occurs', () => {
    const frag = makeFragment({
      kind: 'file',
      text: 'const x = 1;',
    });
    const result = compactFragment(frag, DEFAULT_COMPACT_OPTIONS);
    expect(result.text).toBe('const x = 1;');
    expect(result.meta?.compacted).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// compactStage
// ---------------------------------------------------------------------------

describe('compactStage', () => {
  it('compacts all fragments in a batch', () => {
    const fragments: Fragment[] = [
      makeFragment({ kind: 'file', text: 'line1\n\nline2\n\n\nline3', id: 'fr_a' }),
      makeFragment({ kind: 'message', text: 'hello\n\n\n\nworld', id: 'fr_b' }),
    ];
    const result = compactStage(fragments);
    expect(result.fragments).toHaveLength(2);
    expect(result.fragments[0]!. text).toBe('line1\nline2\nline3');
    expect(result.fragments[1]!.text).toBe('hello\n\nworld');
  });

  it('reports savings map', () => {
    const fragments: Fragment[] = [
      makeFragment({ kind: 'file', text: 'a\n\nb\n\nc', id: 'fr_a' }),
    ];
    const result = compactStage(fragments);
    expect(result.savings.size).toBe(1);
    expect(result.savings.get('fr_a')).toBeGreaterThan(0);
  });

  it('emits a summary warning when savings > 0', () => {
    const fragments: Fragment[] = [
      makeFragment({ kind: 'file', text: 'a\n\nb\n\nc', id: 'fr_a' }),
    ];
    const result = compactStage(fragments);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]!.code).toBe('COMPACT_TRUNCATED');
    expect(result.warnings[0]!.message).toContain('est. tokens');
  });

  it('does not emit a warning when no savings', () => {
    const fragments: Fragment[] = [
      makeFragment({ kind: 'file', text: 'const x = 1;', id: 'fr_a' }),
    ];
    const result = compactStage(fragments);
    expect(result.warnings.length).toBe(0);
  });

  it('does not mutate input fragments', () => {
    const fragments: Fragment[] = [
      makeFragment({ kind: 'file', text: 'a\n\nb', id: 'fr_a' }),
    ];
    const originalText = fragments[0]!.text;
    compactStage(fragments);
    expect(fragments[0]!.text).toBe(originalText);
  });

  it('uses custom options', () => {
    const longOutput = Array.from({ length: 50 }, (_, i) => `row ${i}`).join('\n');
    const fragments: Fragment[] = [
      makeFragment({ kind: 'tool_call', text: longOutput, id: 'fr_a' }),
    ];
    const result = compactStage(fragments, {
      maxStackFrames: 10,
      maxToolOutputLines: 5,
      compactCode: true,
      compactErrors: true,
      compactToolOutput: true,
      compactMessages: true,
    });
    expect(result.fragments[0]!. text.split('\n').length).toBeLessThan(longOutput.split('\n').length);
  });

  it('handles empty input', () => {
    const result = compactStage([]);
    expect(result.fragments).toHaveLength(0);
    expect(result.savings.size).toBe(0);
    expect(result.warnings.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: compaction preserves structured signals
// ---------------------------------------------------------------------------

describe('compaction signal preservation', () => {
  it('compactFragment preserves extracted error info', () => {
    const frag = makeFragment({
      kind: 'error',
      text: 'Error: 401\n    at auth (src/auth.ts:2:10)\n    at login (src/login.ts:5:3)\n' +
        Array.from({ length: 20 }, (_, i) => `    at extra${i} (src/extra.ts:${i}:${i})`).join('\n'),
      extracted: {
        paths: [{ path: 'src/auth.ts', line: 2, column: 6 }],
        symbols: [],
        errors: [{ message: '401', signature: '401', stackFrames: [], resolved: false }],
        requirements: [],
        outcome: undefined,
      unresolved: false,
      },
    });
    const result = compactFragment(frag, DEFAULT_COMPACT_OPTIONS);
    expect(result.extracted.errors).toHaveLength(1);
    expect(result.extracted.errors[0]!.message).toBe('401');
    expect(result.extracted.paths).toHaveLength(1);
  });
});
