import { writeFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ensureDownloadDir,
  getOutputMode,
  resolveUniqueDownloadPath,
  sanitizeFilename,
} from "../policy.js";
import type { ToolDeps } from "./types.js";
import { runAuditedTool, toToolResult } from "./result.js";

export type GmailMessageSummary = {
  id: string;
  threadId?: string;
};

export type GmailMessageList = {
  messages?: GmailMessageSummary[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

export type GmailPart = {
  partId?: string;
  filename?: string;
  mimeType?: string;
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId?: string;
  payload?: GmailPart;
};

export type GmailAttachment = {
  messageId: string;
  filename: string;
  mimeType?: string;
  attachmentId: string;
  size?: number;
};

export type DownloadAttachmentInput = {
  messageId: string;
  attachmentId: string;
  filename?: string;
  saveAs?: string;
  forceFile?: boolean;
};

export type DownloadAttachmentResult = {
  messageId: string;
  attachmentId: string;
  filename: string;
  size: number;
  encoding?: "base64";
  dataBase64?: string;
  path?: string;
};

const searchSchema = z.object({
  query: z.string().min(1).describe("Gmail search query, e.g. has:attachment newer_than:30d"),
  maxResults: z.number().int().min(1).max(50).default(10),
  pageToken: z.string().optional(),
});

const getMessageSchema = z.object({
  messageId: z.string().min(1),
  format: z.enum(["full", "metadata", "raw", "minimal"]).default("full"),
});

const listAttachmentsSchema = z.object({
  messageId: z.string().min(1),
});

const downloadAttachmentSchema = z.object({
  messageId: z.string().min(1),
  attachmentId: z.string().min(1),
  filename: z.string().optional(),
  saveAs: z.string().optional(),
  forceFile: z.boolean().default(false),
});

const saveMatchingAttachmentsSchema = z.object({
  query: z.string().min(1),
  filenameIncludes: z.string().optional(),
  maxMessages: z.number().int().min(1).max(25).default(10),
});

export function decodeBase64Url(data: string): Buffer {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

export async function searchMessages(
  input: z.input<typeof searchSchema>,
  deps: Pick<ToolDeps, "runGwsJson">,
): Promise<GmailMessageList> {
  const parsed = searchSchema.parse(input);
  const params: Record<string, unknown> = {
    userId: "me",
    q: parsed.query,
    maxResults: parsed.maxResults,
  };
  if (parsed.pageToken) {
    params.pageToken = parsed.pageToken;
  }

  return deps.runGwsJson<GmailMessageList>([
    "gmail",
    "users",
    "messages",
    "list",
    "--params",
    JSON.stringify(params),
  ]);
}

export async function getMessage(
  input: z.input<typeof getMessageSchema>,
  deps: Pick<ToolDeps, "runGwsJson">,
): Promise<GmailMessage> {
  const parsed = getMessageSchema.parse(input);
  return deps.runGwsJson<GmailMessage>([
    "gmail",
    "users",
    "messages",
    "get",
    "--params",
    JSON.stringify({
      userId: "me",
      id: parsed.messageId,
      format: parsed.format,
    }),
  ]);
}

export function listAttachmentsFromMessage(message: GmailMessage): GmailAttachment[] {
  const attachments: GmailAttachment[] = [];

  function walk(part: GmailPart | undefined): void {
    if (!part) {
      return;
    }

    if (part.body?.attachmentId) {
      attachments.push({
        messageId: message.id,
        filename: part.filename || "attachment.bin",
        mimeType: part.mimeType,
        attachmentId: part.body.attachmentId,
        size: part.body.size,
      });
    }

    for (const child of part.parts ?? []) {
      walk(child);
    }
  }

  walk(message.payload);
  return attachments;
}

export async function downloadAttachment(
  input: DownloadAttachmentInput,
  deps: ToolDeps,
): Promise<DownloadAttachmentResult> {
  const parsed = downloadAttachmentSchema.parse(input);
  const response = await deps.runGwsJson<{ data?: string; size?: number }>([
    "gmail",
    "users",
    "messages",
    "attachments",
    "get",
    "--params",
    JSON.stringify({
      userId: "me",
      messageId: parsed.messageId,
      id: parsed.attachmentId,
    }),
  ]);

  const bytes = decodeBase64Url(response.data ?? "");
  const size = response.size ?? bytes.byteLength;
  const filename = sanitizeFilename(parsed.saveAs ?? parsed.filename, "attachment.bin");
  const dataBase64 = bytes.toString("base64");
  const inlineCandidate = {
    messageId: parsed.messageId,
    attachmentId: parsed.attachmentId,
    filename,
    size,
    encoding: "base64" as const,
    dataBase64,
  };
  const estimatedInlineBytes = Buffer.byteLength(JSON.stringify(inlineCandidate, null, 2), "utf8");
  const mode = getOutputMode(deps.policy, estimatedInlineBytes, parsed.forceFile);

  if (mode === "inline") {
    const result = inlineCandidate;
    return result;
  }

  await ensureDownloadDir(deps.policy);
  const outputPath = resolveUniqueDownloadPath(deps.policy, filename);
  await writeFile(outputPath, bytes);
  const result = {
    messageId: parsed.messageId,
    attachmentId: parsed.attachmentId,
    filename,
    size,
    path: outputPath,
  };
  return result;
}

export async function saveMatchingAttachments(
  input: z.input<typeof saveMatchingAttachmentsSchema>,
  deps: ToolDeps,
): Promise<{ saved: DownloadAttachmentResult[] }> {
  const parsed = saveMatchingAttachmentsSchema.parse(input);
  const messages = await searchMessages(
    { query: parsed.query, maxResults: parsed.maxMessages },
    deps,
  );
  const saved: DownloadAttachmentResult[] = [];

  for (const messageSummary of messages.messages ?? []) {
    const message = await getMessage({ messageId: messageSummary.id, format: "full" }, deps);
    const attachments = listAttachmentsFromMessage(message).filter((attachment) =>
      parsed.filenameIncludes
        ? attachment.filename.toLowerCase().includes(parsed.filenameIncludes.toLowerCase())
        : true,
    );

    for (const attachment of attachments) {
      saved.push(await downloadAttachment({
        messageId: attachment.messageId,
        attachmentId: attachment.attachmentId,
        filename: attachment.filename,
        forceFile: true,
      }, deps));
    }
  }

  return { saved };
}

export function registerGmailTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "gmail_search_messages",
    {
      title: "Search Gmail Messages",
      description: "Search Gmail messages with bounded result counts.",
      inputSchema: searchSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (input) => toToolResult(await runAuditedTool(
      deps.policy,
      "gmail_search_messages",
      input,
      () => searchMessages(input, deps),
    ), deps.policy),
  );

  server.registerTool(
    "gmail_get_message",
    {
      title: "Get Gmail Message",
      description: "Fetch one Gmail message by ID.",
      inputSchema: getMessageSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (input) => toToolResult(await runAuditedTool(
      deps.policy,
      "gmail_get_message",
      input,
      () => getMessage(input, deps),
    ), deps.policy),
  );

  server.registerTool(
    "gmail_list_attachments",
    {
      title: "List Gmail Attachments",
      description: "List attachment metadata for a Gmail message.",
      inputSchema: listAttachmentsSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      const parsed = listAttachmentsSchema.parse(input);
      const result = await runAuditedTool(
        deps.policy,
        "gmail_list_attachments",
        input,
        async () => {
          const message = await getMessage({ messageId: parsed.messageId, format: "full" }, deps);
          return { attachments: listAttachmentsFromMessage(message) };
        },
      );
      return toToolResult(result, deps.policy);
    },
  );

  server.registerTool(
    "gmail_download_attachment",
    {
      title: "Download Gmail Attachment",
      description: "Download and decode one Gmail attachment, returning small data inline or saving larger data to disk.",
      inputSchema: downloadAttachmentSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => toToolResult(await runAuditedTool(
      deps.policy,
      "gmail_download_attachment",
      input,
      () => downloadAttachment(input, deps),
    ), deps.policy),
  );

  server.registerTool(
    "gmail_save_matching_attachments",
    {
      title: "Save Matching Gmail Attachments",
      description: "Search Gmail and save matching attachments to the configured safe download directory.",
      inputSchema: saveMatchingAttachmentsSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => toToolResult(await runAuditedTool(
      deps.policy,
      "gmail_save_matching_attachments",
      input,
      () => saveMatchingAttachments(input, deps),
    ), deps.policy),
  );
}
