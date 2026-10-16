import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * End-to-end smoke test of the built CLI over a real stdio pipe.
 * Skipped when dist/mcp/cli.js has not been built yet (npm run build).
 */
const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, '../dist/mcp/cli.js');
const built = existsSync(cliPath);

describe.skipIf(!built)('MCP CLI over stdio (requires npm run build)', () => {
  it('performs initialize + tools/list + tools/call handshake', async () => {
    const child = spawn(process.execPath, [cliPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    const messages: Array<Record<string, unknown>> = [];
    let buf = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.trim()) messages.push(JSON.parse(line) as Record<string, unknown>);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr += chunk));

    const send = (obj: unknown): void => {
      child.stdin.write(`${JSON.stringify(obj)}\n`);
    };

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'stdio-test', version: '0' },
      },
    });
    await new Promise((r) => setTimeout(r, 300));
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await new Promise((r) => setTimeout(r, 300));
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'build_context',
        arguments: {
          task: 'Fix token expiry in src/auth/token.ts',
          records: [
            {
              kind: 'error',
              message: 'Error: token expired\n    at verify (src/auth/token.ts:10:5)',
            },
          ],
        },
      },
    });
    await new Promise((r) => setTimeout(r, 500));
    child.kill();

    const init = messages.find((m) => m['id'] === 1) as
      | { result?: { serverInfo?: { name?: string } } }
      | undefined;
    const list = messages.find((m) => m['id'] === 2) as
      | { result?: { tools?: Array<{ name: string }> } }
      | undefined;
    const call = messages.find((m) => m['id'] === 3) as
      | { result?: { content?: Array<{ text: string }>; isError?: boolean } }
      | undefined;

    expect(init?.result?.serverInfo?.name).toBe('mcp-context-optimizer');
    expect(list?.result?.tools?.length).toBe(6);
    expect(call?.result?.isError).toBeFalsy();
    expect(call?.result?.content?.[0]?.text).toContain('# Task');
    expect(stderr).toContain('mcp-context-optimizer MCP server listening on stdio');
  }, 15_000);
});
