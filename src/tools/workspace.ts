import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "./types.js";
import { runAuditedTool, toToolResult } from "./result.js";

export type AuthStatus = {
  auth_method?: string;
  user?: string;
  token_valid?: boolean;
  client_config_exists?: boolean;
  encrypted_credentials_exists?: boolean;
  storage?: string;
  scope_count?: number;
  scopes?: string[];
  project_id?: string;
};

export async function getAuthStatus(
  deps: Pick<ToolDeps, "runGwsJson">,
): Promise<AuthStatus> {
  const status = await deps.runGwsJson<Record<string, unknown>>(["auth", "status"]);
  return {
    auth_method: readString(status.auth_method),
    user: readString(status.user),
    token_valid: readBoolean(status.token_valid),
    client_config_exists: readBoolean(status.client_config_exists),
    encrypted_credentials_exists: readBoolean(status.encrypted_credentials_exists),
    storage: readString(status.storage),
    scope_count: readNumber(status.scope_count),
    scopes: Array.isArray(status.scopes)
      ? status.scopes.filter((scope): scope is string => typeof scope === "string")
      : undefined,
    project_id: readString(status.project_id),
  };
}

export function registerWorkspaceTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "workspace_auth_status",
    {
      title: "Workspace Auth Status",
      description: "Check Google Workspace CLI authentication status without returning credential paths or secrets.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toToolResult(await runAuditedTool(
      deps.policy,
      "workspace_auth_status",
      input,
      () => getAuthStatus(deps),
    ), deps.policy),
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
