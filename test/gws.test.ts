import { describe, expect, it } from "vitest";
import {
  GwsCommandError,
  parseJsonFromOutput,
  redactSecrets,
  runGwsJson,
  runGwsRaw,
  type ExecFile,
} from "../src/gws.js";

describe("parseJsonFromOutput", () => {
  it("parses JSON after gws status noise", () => {
    const parsed = parseJsonFromOutput('Using keyring backend: keyring\n{"ok":true}');

    expect(parsed).toEqual({ ok: true });
  });

  it("throws when command output has no JSON payload", () => {
    expect(() => parseJsonFromOutput("not json")).toThrow("No JSON payload");
  });
});

describe("redactSecrets", () => {
  it("redacts OAuth client secrets and refresh tokens", () => {
    const text =
      '{"client_secret":"GOCSPX-secret","refresh_token":"1//token","access_token":"ya29.token"}';

    expect(redactSecrets(text)).toContain('"client_secret":"[REDACTED]"');
    expect(redactSecrets(text)).toContain('"refresh_token":"[REDACTED]"');
    expect(redactSecrets(text)).toContain('"access_token":"[REDACTED]"');
  });
});

describe("runGwsJson", () => {
  it("runs gws and returns parsed JSON", async () => {
    const calls: unknown[] = [];
    const execFile: ExecFile = async (file, args, options) => {
      calls.push({ file, args, options });
      return { stdout: '{"files":[]}', stderr: "" };
    };

    const result = await runGwsJson<{ files: unknown[] }>([
      "drive",
      "files",
      "list",
    ], { execFile, timeoutMs: 1234 });

    expect(result).toEqual({ files: [] });
    expect(calls).toMatchObject([
      {
        file: "gws",
        args: ["drive", "files", "list"],
        options: { timeout: 1234 },
      },
    ]);
  });

  it("normalizes command failures and redacts secret output", async () => {
    const execFile: ExecFile = async () => {
      const error = new Error("failed") as Error & {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      error.code = 3;
      error.stdout = '{"client_secret":"GOCSPX-secret"}';
      error.stderr = "bad refresh_token=1//token";
      throw error;
    };

    await expect(runGwsJson(["auth", "status"], { execFile })).rejects.toMatchObject({
      name: "GwsCommandError",
      exitCode: 3,
      stdout: '{"client_secret":"[REDACTED]"}',
      stderr: "bad refresh_token=[REDACTED]",
    } satisfies Partial<GwsCommandError>);
  });

  it("redacts secrets embedded in command failure messages", async () => {
    const execFile: ExecFile = async () => {
      throw new Error("failed with client_secret=GOCSPX-secret");
    };

    await expect(runGwsJson(["auth", "status"], { execFile })).rejects.toMatchObject({
      message: "failed with client_secret=[REDACTED]",
    });
  });
});

describe("runGwsRaw", () => {
  it("returns raw stdout and stderr for non-JSON commands", async () => {
    const execFile: ExecFile = async () => ({ stdout: "ok", stderr: "note" });

    await expect(runGwsRaw(["drive", "files", "get"], { execFile })).resolves.toEqual({
      stdout: "ok",
      stderr: "note",
    });
  });
});
