import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPolicy,
  getOutputMode,
  resolveAvailableDownloadPath,
  resolveDownloadPath,
  resolveUniqueDownloadPath,
  sanitizeFilename,
  writeAuditEvent,
} from "../src/policy.js";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function tempDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "gworkspace-mcp-"));
  tempDirs.push(dir);
  return dir;
}

describe("sanitizeFilename", () => {
  it("removes path separators and unsafe control characters", () => {
    expect(sanitizeFilename("../bad/name\u0000.pdf")).toBe("bad_name.pdf");
  });

  it("uses a fallback when the filename is empty", () => {
    expect(sanitizeFilename("   ", "attachment.bin")).toBe("attachment.bin");
  });
});

describe("resolveDownloadPath", () => {
  it("keeps downloads inside the configured directory", async () => {
    const downloadDir = await tempDir();
    const policy = createPolicy({ downloadDir });

    expect(resolveDownloadPath(policy, "../report.pdf")).toBe(
      path.join(downloadDir, "report.pdf"),
    );
  });

  it("rejects absolute paths outside the download directory", async () => {
    const downloadDir = await tempDir();
    const policy = createPolicy({ downloadDir });

    expect(() => resolveDownloadPath(policy, "/tmp/secret.pdf")).toThrow(
      "outside the allowed download directory",
    );
  });
});

describe("resolveAvailableDownloadPath", () => {
  it("adds a stable suffix instead of overwriting existing files", async () => {
    const downloadDir = await tempDir();
    const policy = createPolicy({ downloadDir });
    await writeFile(path.join(downloadDir, "report.pdf"), "existing");

    await expect(resolveAvailableDownloadPath(policy, "report.pdf")).resolves.toBe(
      path.join(downloadDir, "report (1).pdf"),
    );
  });
});

describe("resolveUniqueDownloadPath", () => {
  it("adds a collision-resistant suffix before the extension", async () => {
    const downloadDir = await tempDir();
    const policy = createPolicy({ downloadDir });

    expect(resolveUniqueDownloadPath(policy, "report.pdf", "abc123")).toBe(
      path.join(downloadDir, "report-abc123.pdf"),
    );
  });
});

describe("getOutputMode", () => {
  it("inlines small payloads and saves larger payloads", () => {
    const policy = createPolicy({ maxInlineBytes: 10 });

    expect(getOutputMode(policy, 10, false)).toBe("inline");
    expect(getOutputMode(policy, 11, false)).toBe("file");
    expect(getOutputMode(policy, 1, true)).toBe("file");
  });
});

describe("createPolicy", () => {
  it("falls back to a safe inline cap when configured value is invalid", () => {
    const policy = createPolicy({ maxInlineBytes: Number.NaN });

    expect(policy.maxInlineBytes).toBe(256 * 1024);
  });
});

describe("writeAuditEvent", () => {
  it("writes redacted JSONL audit events", async () => {
    const downloadDir = await tempDir();
    const auditLogPath = path.join(downloadDir, "audit.jsonl");
    const policy = createPolicy({ downloadDir, auditLogPath });

    await writeAuditEvent(policy, {
      tool: "workspace_auth_status",
      status: "ok",
      args: { client_secret: "GOCSPX-secret" },
      output: { refresh_token: "1//token" },
    });

    const log = await readFile(auditLogPath, "utf8");
    expect(log).toContain('"tool":"workspace_auth_status"');
    expect(log).not.toContain("GOCSPX-secret");
    expect(log).not.toContain("1//token");
  });
});
