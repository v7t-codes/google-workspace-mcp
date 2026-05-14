import { describe, expect, it } from "vitest";
import { getAuthStatus } from "../src/tools/workspace.js";
import type { RunGwsJson } from "../src/tools/types.js";

describe("getAuthStatus", () => {
  it("redacts credential paths and returns auth status", async () => {
    const runGwsJson: RunGwsJson = async () => ({
      auth_method: "oauth2",
      user: "me@example.com",
      client_config: "/home/example/.config/gws/client_secret.json",
      encrypted_credentials: "/home/example/.config/gws/credentials.enc",
      token_valid: true,
    });

    const result = await getAuthStatus({ runGwsJson });

    expect(result).toEqual({
      auth_method: "oauth2",
      user: "me@example.com",
      token_valid: true,
      client_config_exists: undefined,
      encrypted_credentials_exists: undefined,
      storage: undefined,
      scope_count: undefined,
      scopes: undefined,
      project_id: undefined,
    });
  });
});
