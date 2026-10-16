import { describe, expect, it } from 'vitest';

import {
  errorSignature,
  extractPaths,
  extractRequirements,
  extractSignals,
  extractStackFrames,
  extractSymbols,
} from '../src/extract.js';

describe('extractPaths', () => {
  it('finds unix paths with line numbers', () => {
    const paths = extractPaths('Error in src/auth/login.ts:42:5 near foo');
    expect(paths[0]).toEqual({ path: 'src/auth/login.ts', line: 42, column: 5 });
  });

  it('normalizes windows separators', () => {
    const paths = extractPaths('at fn (D:\\proj\\src\\index.js:10:3)');
    expect(paths.some((p) => p.path === 'D:/proj/src/index.js' && p.line === 10)).toBe(true);
  });

  it('does not match version numbers or extensions longer than 8 chars', () => {
    expect(extractPaths('bumped to v1.2 and file.backupimage')).toHaveLength(0);
  });

  it('handles unicode and multiline text', () => {
    const paths = extractPaths('файл\nсм. src/utils/пример.ts:7');
    expect(paths[0]?.path).toBe('src/utils/пример.ts');
  });
});

describe('extractSymbols', () => {
  it('finds function and class declarations', () => {
    const syms = extractSymbols('class AuthService {}\nfunction login() {}\nconst token = 1;');
    const names = syms.map((s) => s.name);
    expect(names).toContain('AuthService');
    expect(names).toContain('login');
    expect(names).toContain('token');
  });

  it('finds python defs', () => {
    expect(extractSymbols('def verify_password(x):').map((s) => s.name)).toContain('verify_password');
  });
});

describe('extractStackFrames', () => {
  it('parses node frames and skips node internals', () => {
    const frames = extractStackFrames(
      'TypeError: x is not a function\n    at authenticate (src/auth.ts:12:9)\n    at node:internal/main:1:1',
    );
    expect(frames).toEqual([{ fn: 'authenticate', path: 'src/auth.ts', line: 12 }]);
  });

  it('parses python frames', () => {
    const frames = extractStackFrames('Traceback:\n  File "app/main.py", line 20, in run');
    expect(frames[0]).toEqual({ path: 'app/main.py', line: 20 });
  });
});

describe('extractRequirements', () => {
  it('flags sentences with requirement triggers', () => {
    const reqs = extractRequirements('You must keep the public API stable. It is sunny today.');
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.trigger).toBe('must');
  });
});

describe('errorSignature', () => {
  it('collapses whitespace and truncates', () => {
    expect(errorSignature('TypeError', 'a   b\nc')).toBe('TypeError: a b c');
  });
});

describe('extractSignals', () => {
  it('extracts error signals with outcome=failure from exit code', () => {
    const sig = extractSignals({
      kind: 'error',
      text: 'Error: boom\n    at run (src/run.ts:3:1)',
      exitCode: 1,
    });
    expect(sig.errors[0]?.errorType).toBe('Error');
    expect(sig.outcome).toEqual({ status: 'failure', evidence: 'exit code 1' });
    expect(sig.unresolved).toBe(true);
  });

  it('does not invent success without explicit evidence', () => {
    const sig = extractSignals({ kind: 'message', text: 'I tried to fix the login flow yesterday' });
    expect(sig.outcome).toBeUndefined();
  });

  it('detects explicit success markers', () => {
    const sig = extractSignals({ kind: 'tool_call', text: 'Tool: test()\nAll tests passed ✓' });
    expect(sig.outcome?.status).toBe('success');
  });

  it('marks resolved errors as resolved', () => {
    const sig = extractSignals({ kind: 'error', text: 'Error: boom (fixed in latest run)' });
    expect(sig.errors[0]?.resolved).toBe(true);
    expect(sig.unresolved).toBe(false);
  });

  it('does not merge concepts: similar errors get distinct signatures', () => {
    const a = extractSignals({ kind: 'error', text: 'TypeError: user.email is undefined' });
    const b = extractSignals({ kind: 'error', text: 'TypeError: user.password is undefined' });
    expect(a.errors[0]?.signature).not.toBe(b.errors[0]?.signature);
  });
});
