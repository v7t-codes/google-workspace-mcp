#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPolicy } from "./policy.js";
import { defaultDeps } from "./tools/types.js";
import { registerGmailTools } from "./tools/gmail.js";
import { registerDriveTools } from "./tools/drive.js";
import { registerWorkspaceTools } from "./tools/workspace.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "google-workspace-mcp",
    version: "0.1.0",
  });
  const deps = defaultDeps(createPolicy());

  registerWorkspaceTools(server, deps);
  registerGmailTools(server, deps);
  registerDriveTools(server, deps);

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
