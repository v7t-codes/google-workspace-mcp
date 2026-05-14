import type { WorkspacePolicy } from "../policy.js";
import { writeAuditEvent } from "../policy.js";

export function toToolResult(data: unknown, policy: WorkspacePolicy) {
  const text = JSON.stringify(data, null, 2);
  const sizeBytes = Buffer.byteLength(text, "utf8");

  if (sizeBytes > policy.maxInlineBytes) {
    const summary = {
      truncated: true,
      reason: "response exceeded maxInlineBytes",
      sizeBytes,
      maxInlineBytes: policy.maxInlineBytes,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
      structuredContent: summary,
    };
  }

  return {
    content: [{ type: "text" as const, text }],
    structuredContent: toStructuredContent(data),
  };
}

export function toStructuredContent(data: unknown): Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : { result: data };
}

export async function runAuditedTool<T>(
  policy: WorkspacePolicy,
  tool: string,
  args: unknown,
  action: () => Promise<T>,
): Promise<T> {
  try {
    const output = await action();
    await writeAuditEvent(policy, {
      tool,
      status: "ok",
      args,
      output: summarizeOutput(output),
    });
    return output;
  } catch (error) {
    await writeAuditEvent(policy, {
      tool,
      status: "error",
      args,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function summarizeOutput(output: unknown): unknown {
  if (Array.isArray(output)) {
    return { count: output.length };
  }
  if (typeof output === "object" && output !== null) {
    const record = output as Record<string, unknown>;
    return {
      ...("path" in record ? { path: record.path } : {}),
      ...("size" in record ? { size: record.size } : {}),
      ...("files" in record && Array.isArray(record.files) ? { files: record.files.length } : {}),
      ...("messages" in record && Array.isArray(record.messages) ? { messages: record.messages.length } : {}),
      ...("attachments" in record && Array.isArray(record.attachments) ? { attachments: record.attachments.length } : {}),
      ...("saved" in record && Array.isArray(record.saved)
        ? {
            saved: record.saved.map((item) => {
              const saved = item as Record<string, unknown>;
              return {
                messageId: saved.messageId,
                attachmentId: saved.attachmentId,
                filename: saved.filename,
                path: saved.path,
                size: saved.size,
              };
            }),
          }
        : {}),
    };
  }
  return output;
}
