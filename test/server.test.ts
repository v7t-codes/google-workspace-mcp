import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

describe("createServer", () => {
  it("constructs the MCP server", () => {
    const server = createServer();

    expect(server).toBeDefined();
  });
});
