import { describe, expect, it } from "vitest";
import { createPolicy } from "../src/policy.js";
import { toToolResult } from "../src/tools/result.js";

describe("toToolResult", () => {
  it("returns bounded output when JSON exceeds the inline cap", () => {
    const policy = createPolicy({ maxInlineBytes: 10 });

    const result = toToolResult({ body: "this is too large" }, policy);

    expect(result.structuredContent).toMatchObject({
      truncated: true,
      reason: "response exceeded maxInlineBytes",
    });
    expect(result.content[0]?.text).toContain("truncated");
  });
});
