import { access, mkdir, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { redactSecrets } from "./gws.js";

export type WorkspacePolicy = {
  downloadDir: string;
  maxInlineBytes: number;
  auditLogPath: string;
};

export type AuditEvent = {
  tool: string;
  status: "ok" | "error";
  args?: unknown;
  output?: unknown;
  error?: unknown;
};

export function createPolicy(overrides: Partial<WorkspacePolicy> = {}): WorkspacePolicy {
  const downloadDir =
    overrides.downloadDir ??
    process.env.GWORKSPACE_MCP_DOWNLOAD_DIR ??
    path.join(os.homedir(), "Downloads", "gworkspace-mcp");

  const requestedMaxInlineBytes =
    overrides.maxInlineBytes ??
    Number(process.env.GWORKSPACE_MCP_MAX_INLINE_BYTES ?? 256 * 1024);

  return {
    downloadDir: path.resolve(downloadDir),
    maxInlineBytes: isValidPositiveInteger(requestedMaxInlineBytes)
      ? requestedMaxInlineBytes
      : 256 * 1024,
    auditLogPath:
      overrides.auditLogPath ??
      process.env.GWORKSPACE_MCP_AUDIT_LOG ??
      path.join(path.resolve(downloadDir), "audit.jsonl"),
  };
}

export function sanitizeFilename(name: string | undefined, fallback = "download.bin"): string {
  const cleaned = (name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .split(/[\\/]+/)
    .filter((part) => part !== "" && part !== "." && part !== "..")
    .join("_")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .trim();

  const withoutLeadingDots = cleaned.replace(/^\.+/, "");
  return withoutLeadingDots.length > 0 ? withoutLeadingDots : fallback;
}

export function resolveDownloadPath(policy: WorkspacePolicy, requestedName: string): string {
  if (path.isAbsolute(requestedName)) {
    const absolute = path.resolve(requestedName);
    assertInsideDownloadDir(policy, absolute);
    return absolute;
  }

  const outputPath = path.join(policy.downloadDir, sanitizeFilename(requestedName));
  assertInsideDownloadDir(policy, outputPath);
  return outputPath;
}

export async function resolveAvailableDownloadPath(
  policy: WorkspacePolicy,
  requestedName: string,
): Promise<string> {
  const initialPath = resolveDownloadPath(policy, requestedName);
  if (!(await pathExists(initialPath))) {
    return initialPath;
  }

  const directory = path.dirname(initialPath);
  const extension = path.extname(initialPath);
  const basename = path.basename(initialPath, extension);

  for (let index = 1; index < 10_000; index += 1) {
    const candidate = path.join(directory, `${basename} (${index})${extension}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Could not find an available filename for ${requestedName}`);
}

export function resolveUniqueDownloadPath(
  policy: WorkspacePolicy,
  requestedName: string,
  uniqueId = randomUUID(),
): string {
  const safeName = sanitizeFilename(requestedName);
  const extension = path.extname(safeName);
  const basename = path.basename(safeName, extension);
  return resolveDownloadPath(policy, `${basename}-${uniqueId}${extension}`);
}

export function getOutputMode(
  policy: WorkspacePolicy,
  sizeBytes: number,
  forceFile: boolean,
): "inline" | "file" {
  return forceFile || sizeBytes > policy.maxInlineBytes ? "file" : "inline";
}

export async function ensureDownloadDir(policy: WorkspacePolicy): Promise<void> {
  await mkdir(policy.downloadDir, { recursive: true });
}

export async function writeAuditEvent(
  policy: WorkspacePolicy,
  event: AuditEvent,
): Promise<void> {
  await mkdir(path.dirname(policy.auditLogPath), { recursive: true });
  const payload = redactSecrets(JSON.stringify({
    timestamp: new Date().toISOString(),
    ...event,
  }));
  await appendFile(policy.auditLogPath, `${payload}\n`, "utf8");
}

function assertInsideDownloadDir(policy: WorkspacePolicy, outputPath: string): void {
  const base = path.resolve(policy.downloadDir);
  const target = path.resolve(outputPath);
  const relative = path.relative(base, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside the allowed download directory: ${target}`);
  }
}

async function pathExists(outputPath: string): Promise<boolean> {
  try {
    await access(outputPath);
    return true;
  } catch {
    return false;
  }
}

function isValidPositiveInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0;
}
