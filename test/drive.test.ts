import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { downloadDriveFile, searchDriveFiles } from "../src/tools/drive.js";
import { createPolicy } from "../src/policy.js";
import type { RunGwsJson, RunGwsRaw } from "../src/tools/types.js";

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

describe("searchDriveFiles", () => {
  it("calls gws with bounded fields and page size", async () => {
    const calls: unknown[] = [];
    const runGwsJson: RunGwsJson = async (args) => {
      calls.push(args);
      return { files: [{ id: "f1", name: "report.pdf" }] };
    };

    const result = await searchDriveFiles({ query: "name contains 'report'", pageSize: 5 }, { runGwsJson });

    expect(result.files).toEqual([{ id: "f1", name: "report.pdf" }]);
    expect(calls).toEqual([
      [
        "drive",
        "files",
        "list",
        "--params",
        '{"q":"name contains \'report\'","pageSize":5,"fields":"nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)"}',
      ],
    ]);
  });
});

describe("downloadDriveFile", () => {
  it("downloads binary files with alt=media into the safe directory", async () => {
    const downloadDir = await tempDir();
    const policy = createPolicy({ downloadDir });
    const calls: unknown[] = [];
    const runGwsRaw: RunGwsRaw = async (args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    };

    const result = await downloadDriveFile(
      { fileId: "f1", filename: "../report.pdf" },
      { policy, runGwsRaw },
    );

    expect(result.path).toMatch(new RegExp(`^${escapeRegExp(downloadDir)}/report-[0-9a-f-]+\\.pdf$`));
    expect(calls).toEqual([
      [
        "drive",
        "files",
        "get",
        "--params",
        '{"fileId":"f1","alt":"media"}',
        "--output",
        result.path,
      ],
    ]);
  });

  it("exports Google Workspace files when export MIME type is provided", async () => {
    const downloadDir = await tempDir();
    const policy = createPolicy({ downloadDir });
    const calls: unknown[] = [];
    const runGwsRaw: RunGwsRaw = async (args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    };

    await downloadDriveFile(
      {
        fileId: "doc1",
        filename: "doc.pdf",
        exportMimeType: "application/pdf",
      },
      { policy, runGwsRaw },
    );

    expect(calls[0]).toEqual([
      "drive",
      "files",
      "export",
      "--params",
      '{"fileId":"doc1","mimeType":"application/pdf"}',
      "--output",
      expect.stringMatching(new RegExp(`^${escapeRegExp(downloadDir)}/doc-[0-9a-f-]+\\.pdf$`)),
    ]);
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
