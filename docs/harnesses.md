# Harness Setup

Use the stdio server for local harnesses:

```bash
node /Users/vsasi/dev/google-workspace-mcp/dist/server.js
```

Run `npm run build` first.

## Cursor

Project or global `mcp.json`:

```json
{
  "mcpServers": {
    "gworkspace": {
      "command": "node",
      "args": ["/Users/vsasi/dev/google-workspace-mcp/dist/server.js"],
      "env": {
        "GWORKSPACE_MCP_DOWNLOAD_DIR": "/Users/vsasi/Downloads/gworkspace-mcp"
      }
    }
  }
}
```

Keep approval prompts enabled for write-like tools. If you allowlist, allowlist granular tool names such as `gworkspace:gmail_search_messages`, not the entire server.

## Claude Code

Use the same stdio command in the MCP server config:

```json
{
  "mcpServers": {
    "gworkspace": {
      "command": "node",
      "args": ["/Users/vsasi/dev/google-workspace-mcp/dist/server.js"],
      "env": {
        "GWORKSPACE_MCP_DOWNLOAD_DIR": "/Users/vsasi/Downloads/gworkspace-mcp"
      }
    }
  }
}
```

## Generic Stdio Harness

Any MCP client that supports stdio can launch:

```bash
GWORKSPACE_MCP_DOWNLOAD_DIR="$HOME/Downloads/gworkspace-mcp" \
node /Users/vsasi/dev/google-workspace-mcp/dist/server.js
```

## CLI Fallback

Harnesses without MCP can still use `gws` directly. The MCP server is intentionally a safer, typed wrapper around commands like:

```bash
gws gmail users messages list --params '{"userId":"me","q":"has:attachment","maxResults":10}'
gws drive files list --params '{"pageSize":10}'
```

## Future HTTP Transport

Stdio is v1. Add Streamable HTTP later when the same tools need to run in hosted or team contexts. HTTP should add server-side identity, per-user Google token storage, bearer auth, and the same policy checks already enforced locally.
