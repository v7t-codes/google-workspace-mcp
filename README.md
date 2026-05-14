# Google Workspace MCP

Local-first MCP server for Google Workspace workflows. It wraps the authenticated `gws` CLI and exposes curated tools for Gmail attachments and Drive downloads to agent harnesses.

## Tools

- `workspace_auth_status`: Check auth state without returning credential paths or secrets.
- `gmail_search_messages`: Search Gmail with a bounded Gmail query.
- `gmail_get_message`: Fetch one Gmail message by ID.
- `gmail_list_attachments`: Extract attachment metadata from nested MIME parts.
- `gmail_download_attachment`: Decode one Gmail attachment and return it inline or save it to disk.
- `gmail_save_matching_attachments`: Search messages and save matching attachments.
- `drive_search_files`: Search Drive with bounded fields.
- `drive_download_file`: Download binary Drive files or export Workspace files.

## Quick Start

```bash
npm install
npm run build
node dist/server.js
```

The server expects `gws` to already be authenticated:

```bash
gws auth status
gws auth login
```

Run the cross-machine bootstrap:

```bash
./scripts/setup.sh
```

## Safety Defaults

- Downloads are confined to `~/Downloads/gworkspace-mcp` unless `GWORKSPACE_MCP_DOWNLOAD_DIR` is set.
- Large outputs are saved to disk instead of returned inline.
- OAuth secrets, refresh tokens, and credential paths are not exposed by tools.
- Tool calls write local JSONL audit events to the download directory.
- v1 does not include send, delete, or admin mutation tools.

## Configuration

See [`docs/harnesses.md`](docs/harnesses.md) for Cursor, Claude Code, and generic stdio examples.
