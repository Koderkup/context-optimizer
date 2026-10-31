# Installation and setup

This guide configures the MCP server separately from the Skill.

## Requirements

- Node.js 20+
- An MCP-compatible client
- Internet access during first-time package installation if using `npx`

## Option A: MCP clients using `mcpServers`

1. Copy `mcp-config.example.json` into the MCP configuration file used by your client.
2. Merge the `mcpServers` entry into the existing configuration; do not overwrite other servers.
3. Restart/reload the client or its MCP server connection.
4. Confirm these tools appear: `ingest_records`, `search_context`, `get_decisions`, `get_relevant_errors`, `get_file_history`, `build_context`.

The example uses `npx` to run the published package and make the MCP SDK dependencies available in the same invocation:

```json
{
  "mcpServers": {
    "mcp-context-optimizer": {
      "command": "npx",
      "args": [
        "-y",
        "-p",
        "mcp-context-optimizer",
        "-p",
        "@modelcontextprotocol/server",
        "-p",
        "zod",
        "mcp-ctx-optimizer"
      ]
    }
  }
}
```

This is a template for clients that accept the `mcpServers` key. Some clients use a different configuration schema or location; follow the host client's documentation and adapt the entry as needed.

## Option B: Claude Code

Run this command in a terminal:

```bash
claude mcp add mcp-context-optimizer -- npx -y -p mcp-context-optimizer -p @modelcontextprotocol/server -p zod mcp-ctx-optimizer
```

Then verify the server is listed in Claude Code and that its tools are available.

## If the server does not start

1. Check `node --version`; it should be 20 or newer.
2. Check `npx --version`.
3. Confirm the package/bin name is spelled `mcp-context-optimizer` / `mcp-ctx-optimizer` respectively.
4. Check the client's MCP logs for package resolution or peer dependency errors.
5. If the host requires a different config key or supports a different command runner, adapt the configuration to that host.

Do not put API keys in this configuration: the optimizer does not require them.

## Privacy and data handling

The optimizer itself is designed for local operation and does not make network requests during processing. The initial `npx` command may download the package and dependencies. Only provide records that are relevant and that you are permitted to share with the agent. The default store is in memory; restarting the server clears it.
