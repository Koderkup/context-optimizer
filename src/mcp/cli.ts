#!/usr/bin/env node
/**
 * CLI entry for the mcp-context-optimizer MCP server (stdio transport).
 *
 * Usage from an MCP client:
 *   { "command": "mcp-context-optimizer-mcp" }
 * or during development:
 *   npx tsx src/mcp/cli.ts
 */
import { startContextOptimizerStdio } from './server.js';

startContextOptimizerStdio();
