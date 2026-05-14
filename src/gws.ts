import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

export type ExecFileOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
};

export type ExecFile = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>;

export type RunGwsOptions = {
  execFile?: ExecFile;
  timeoutMs?: number;
  maxBufferBytes?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

export class GwsCommandError extends Error {
  readonly exitCode?: number;
  readonly signal?: string;
  readonly stdout: string;
  readonly stderr: string;

  constructor(message: string, details: {
    exitCode?: number;
    signal?: string;
    stdout?: string;
    stderr?: string;
  }) {
    super(message);
    this.name = "GwsCommandError";
    this.exitCode = details.exitCode;
    this.signal = details.signal;
    this.stdout = details.stdout ?? "";
    this.stderr = details.stderr ?? "";
  }
}

const defaultExecFile = promisify(nodeExecFile) as ExecFile;
const defaultTimeoutMs = 30_000;
const defaultMaxBufferBytes = 20 * 1024 * 1024;

export function redactSecrets(text: string): string {
  return text
    .replace(/("?client_secret"?\s*:\s*")[^"]+(")/g, "$1[REDACTED]$2")
    .replace(/("?refresh_token"?\s*:\s*")[^"]+(")/g, "$1[REDACTED]$2")
    .replace(/("?access_token"?\s*:\s*")[^"]+(")/g, "$1[REDACTED]$2")
    .replace(/\b(client_secret|refresh_token|access_token)=\S+/g, "$1=[REDACTED]")
    .replace(/\bGOCSPX-[A-Za-z0-9_-]+/g, "GOCSPX-[REDACTED]");
}

export function parseJsonFromOutput<T = unknown>(stdout: string): T {
  const trimmed = stdout.trim();
  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);

  if (starts.length === 0) {
    throw new Error("No JSON payload found in gws output");
  }

  const start = Math.min(...starts);
  return JSON.parse(trimmed.slice(start)) as T;
}

export async function runGwsJson<T = unknown>(
  args: readonly string[],
  options: RunGwsOptions = {},
): Promise<T> {
  const { stdout } = await runGwsRaw(args, options);
  return parseJsonFromOutput<T>(stdout);
}

export async function runGwsRaw(
  args: readonly string[],
  options: RunGwsOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const execFile = options.execFile ?? defaultExecFile;

  try {
    return await execFile("gws", args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeoutMs ?? defaultTimeoutMs,
      maxBuffer: options.maxBufferBytes ?? defaultMaxBufferBytes,
    });
  } catch (error) {
    const details = error as Error & {
      code?: number;
      signal?: string;
      stdout?: string;
      stderr?: string;
    };

    throw new GwsCommandError(redactSecrets(details.message), {
      exitCode: details.code,
      signal: details.signal,
      stdout: redactSecrets(details.stdout ?? ""),
      stderr: redactSecrets(details.stderr ?? ""),
    });
  }
}
