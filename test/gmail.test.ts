import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  decodeBase64Url,
  downloadAttachment,
  listAttachmentsFromMessage,
  searchMessages,
  saveMatchingAttachments,
  type GmailMessage,
} from "../src/tools/gmail.js";
import { createPolicy } from "../src/policy.js";
import type { RunGwsJson } from "../src/tools/types.js";

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

describe("decodeBase64Url", () => {
  it("decodes Gmail base64url payloads with missing padding", () => {
    expect(decodeBase64Url("SGVsbG8td29ybGQ").toString("utf8")).toBe("Hello-world");
  });
});

describe("listAttachmentsFromMessage", () => {
  it("walks nested MIME parts and returns attachment metadata", () => {
    const message: GmailMessage = {
      id: "msg-1",
      payload: {
        parts: [
          {
            mimeType: "multipart/mixed",
            parts: [
              {
                filename: "report.pdf",
                mimeType: "application/pdf",
                body: { attachmentId: "att-1", size: 123 },
              },
            ],
          },
        ],
      },
    };

    expect(listAttachmentsFromMessage(message)).toEqual([
      {
        messageId: "msg-1",
        filename: "report.pdf",
        mimeType: "application/pdf",
        attachmentId: "att-1",
        size: 123,
      },
    ]);
  });
});

describe("searchMessages", () => {
  it("calls gws with a bounded Gmail search query", async () => {
    const calls: unknown[] = [];
    const runGwsJson: RunGwsJson = async (args) => {
      calls.push(args);
      return { messages: [{ id: "m1", threadId: "t1" }] };
    };

    const result = await searchMessages({ query: "has:attachment", maxResults: 5 }, { runGwsJson });

    expect(result.messages).toEqual([{ id: "m1", threadId: "t1" }]);
    expect(calls).toEqual([
      [
        "gmail",
        "users",
        "messages",
        "list",
        "--params",
        '{"userId":"me","q":"has:attachment","maxResults":5}',
      ],
    ]);
  });
});

describe("downloadAttachment", () => {
  it("returns small decoded payloads inline as standard base64", async () => {
    const policy = createPolicy({ maxInlineBytes: 500 });
    const runGwsJson: RunGwsJson = async () => ({
      data: "SGVsbG8",
      size: 5,
    });

    const result = await downloadAttachment(
      {
        messageId: "m1",
        attachmentId: "a1",
        filename: "hello.txt",
      },
      { policy, runGwsJson },
    );

    expect(result).toMatchObject({
      filename: "hello.txt",
      size: 5,
      encoding: "base64",
      dataBase64: "SGVsbG8=",
    });
  });

  it("saves large decoded payloads to the safe download directory", async () => {
    const downloadDir = await tempDir();
    const policy = createPolicy({ downloadDir, maxInlineBytes: 1 });
    const runGwsJson: RunGwsJson = async () => ({
      data: "SGVsbG8",
      size: 5,
    });

    const result = await downloadAttachment(
      {
        messageId: "m1",
        attachmentId: "a1",
        filename: "../hello.txt",
      },
      { policy, runGwsJson },
    );

    expect(result.path).toMatch(new RegExp(`^${escapeRegExp(downloadDir)}/hello-[0-9a-f-]+\\.txt$`));
    expect(await readFile(result.path!, "utf8")).toBe("Hello");
  });

  it("saves attachments when base64 JSON response would exceed the inline cap", async () => {
    const downloadDir = await tempDir();
    const policy = createPolicy({ downloadDir, maxInlineBytes: 80 });
    const runGwsJson: RunGwsJson = async () => ({
      data: "SGVsbG8td29ybGQ",
      size: 11,
    });

    const result = await downloadAttachment(
      {
        messageId: "m1",
        attachmentId: "a1",
        filename: "hello.txt",
      },
      { policy, runGwsJson },
    );

    expect(result.path).toBeDefined();
    expect(result.dataBase64).toBeUndefined();
  });

  it("uses the pretty-printed MCP response size for inline decisions", async () => {
    const downloadDir = await tempDir();
    const policy = createPolicy({ downloadDir, maxInlineBytes: 130 });
    const runGwsJson: RunGwsJson = async () => ({
      data: "SGVsbG8",
      size: 5,
    });

    const result = await downloadAttachment(
      {
        messageId: "m1",
        attachmentId: "a1",
        filename: "hello.txt",
      },
      { policy, runGwsJson },
    );

    expect(result.path).toBeDefined();
    expect(result.dataBase64).toBeUndefined();
  });
});

describe("saveMatchingAttachments", () => {
  it("searches messages, extracts attachments, and saves matching files", async () => {
    const downloadDir = await tempDir();
    const policy = createPolicy({ downloadDir, maxInlineBytes: 1 });
    const runGwsJson: RunGwsJson = async (args) => {
      if (args.includes("list")) {
        return { messages: [{ id: "m1" }] };
      }
      if (args.includes("get") && args.includes("messages") && !args.includes("attachments")) {
        return {
          id: "m1",
          payload: {
            parts: [
              {
                filename: "report.pdf",
                mimeType: "application/pdf",
                body: { attachmentId: "a1", size: 5 },
              },
            ],
          },
        };
      }
      return { data: "SGVsbG8", size: 5 };
    };

    const result = await saveMatchingAttachments(
      { query: "from:a@example.com", filenameIncludes: "report" },
      { policy, runGwsJson },
    );

    expect(result.saved).toHaveLength(1);
    expect(await readFile(result.saved[0]!.path!, "utf8")).toBe("Hello");
  });

  it("uses distinct paths for duplicate attachment filenames", async () => {
    const downloadDir = await tempDir();
    const policy = createPolicy({ downloadDir, maxInlineBytes: 1 });
    const runGwsJson: RunGwsJson = async (args) => {
      if (args.includes("list")) {
        return { messages: [{ id: "m1" }] };
      }
      if (args.includes("get") && args.includes("messages") && !args.includes("attachments")) {
        return {
          id: "m1",
          payload: {
            parts: [
              { filename: "report.pdf", body: { attachmentId: "a1", size: 5 } },
              { filename: "report.pdf", body: { attachmentId: "a2", size: 5 } },
            ],
          },
        };
      }
      return { data: "SGVsbG8", size: 5 };
    };

    const result = await saveMatchingAttachments(
      { query: "has:attachment", filenameIncludes: "report" },
      { policy, runGwsJson },
    );

    expect(result.saved).toHaveLength(2);
    expect(result.saved[0]!.path).not.toBe(result.saved[1]!.path);
    expect(result.saved[0]).toMatchObject({ messageId: "m1", attachmentId: "a1" });
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
