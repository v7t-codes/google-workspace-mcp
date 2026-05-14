import type { WorkspacePolicy } from "../policy.js";
import { runGwsJson, runGwsRaw } from "../gws.js";

export type RunGwsJson = <T = unknown>(args: readonly string[]) => Promise<T>;
export type RunGwsRaw = (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;

export type ToolDeps = {
  policy: WorkspacePolicy;
  runGwsJson: RunGwsJson;
  runGwsRaw: RunGwsRaw;
};

export function defaultDeps(policy: WorkspacePolicy): ToolDeps {
  return {
    policy,
    runGwsJson,
    runGwsRaw,
  };
}
