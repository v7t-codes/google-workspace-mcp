import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ensureDownloadDir,
  resolveUniqueDownloadPath,
  sanitizeFilename,
} from "../policy.js";
import type { ToolDeps } from "./types.js";
import { runAuditedTool, toToolResult } from "./result.js";

export type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
};

export type DriveFileList = {
  files?: DriveFile[];
  nextPageToken?: string;
};

export type DriveDownloadResult = {
  fileId: string;
  filename: string;
  path: string;
  exportMimeType?: string;
};

const driveFields = "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)";

const searchDriveFilesSchema = z.object({
  query: z.string().optional(),
  pageSize: z.number().int().min(1).max(50).default(10),
  pageToken: z.string().optional(),
});

const downloadDriveFileSchema = z.object({
  fileId: z.string().min(1),
  filename: z.string().min(1),
  exportMimeType: z.string().optional(),
});

export async function searchDriveFiles(
  input: z.input<typeof searchDriveFilesSchema>,
  deps: Pick<ToolDeps, "runGwsJson">,
): Promise<DriveFileList> {
  const parsed = searchDriveFilesSchema.parse(input);
  const params: Record<string, unknown> = {};
  if (parsed.query) {
    params.q = parsed.query;
  }
  params.pageSize = parsed.pageSize;
  params.fields = driveFields;
  if (parsed.pageToken) {
    params.pageToken = parsed.pageToken;
  }

  return deps.runGwsJson<DriveFileList>([
    "drive",
    "files",
    "list",
    "--params",
    JSON.stringify(params),
  ]);
}

export async function downloadDriveFile(
  input: z.input<typeof downloadDriveFileSchema>,
  deps: Pick<ToolDeps, "policy" | "runGwsRaw">,
): Promise<DriveDownloadResult> {
  const parsed = downloadDriveFileSchema.parse(input);
  const filename = sanitizeFilename(parsed.filename);

  await ensureDownloadDir(deps.policy);
  const outputPath = resolveUniqueDownloadPath(deps.policy, filename);
  const args = parsed.exportMimeType
    ? [
        "drive",
        "files",
        "export",
        "--params",
        JSON.stringify({ fileId: parsed.fileId, mimeType: parsed.exportMimeType }),
        "--output",
        outputPath,
      ]
    : [
        "drive",
        "files",
        "get",
        "--params",
        JSON.stringify({ fileId: parsed.fileId, alt: "media" }),
        "--output",
        outputPath,
      ];

  await deps.runGwsRaw(args);

  const result = {
    fileId: parsed.fileId,
    filename,
    path: outputPath,
    exportMimeType: parsed.exportMimeType,
  };
  return result;
}

export function registerDriveTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "drive_search_files",
    {
      title: "Search Drive Files",
      description: "Search Google Drive files with bounded fields and pagination.",
      inputSchema: searchDriveFilesSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (input) => toToolResult(await runAuditedTool(
      deps.policy,
      "drive_search_files",
      input,
      () => searchDriveFiles(input, deps),
    ), deps.policy),
  );

  server.registerTool(
    "drive_download_file",
    {
      title: "Download Drive File",
      description: "Download a Drive file or export a Google Workspace file into the safe download directory.",
      inputSchema: downloadDriveFileSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => toToolResult(await runAuditedTool(
      deps.policy,
      "drive_download_file",
      input,
      () => downloadDriveFile(input, deps),
    ), deps.policy),
  );
}
