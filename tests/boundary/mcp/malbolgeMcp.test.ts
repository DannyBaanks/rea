import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import {
  MAX_MALBOLGE_SOURCE_BYTES,
  MalbolgeService,
} from "../../../src/application/malbolge/MalbolgeService.js";
import { TOOL_CONTRACTS } from "../../../src/contracts/toolContracts.js";
import { silentLogger } from "../../../src/logger.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { registerMalbolgeTools } from "../../../src/server/registerMalbolgeTools.js";
import { ToolResultDelivery } from "../../../src/server/toolResult.js";
import { HELLO_WORLD_SOURCE } from "../../fixtures/malbolgeHelloWorld.js";
import type { CallToolResult } from "@modelcontextprotocol/server";

const writeProgram = async (name: string, source: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "rea-malbolge-"));
  const path = join(directory, name);
  await writeFile(path, source, "utf8");
  return path;
};

const buildServer = (): EvidenceMcpServer => {
  const server = new EvidenceMcpServer(
    { name: "malbolge-boundary", version: "0" },
    { capabilities: {} },
    undefined,
    new ToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE),
  );
  registerMalbolgeTools(server, new MalbolgeService(), silentLogger);
  return server;
};

const callTool = async (
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> => {
  const server = buildServer();
  const client = new Client({ name: "malbolge-boundary", version: "0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return await client.callTool({ name, arguments: args });
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
};

const normalizedResult = (result: CallToolResult): Record<string, unknown> =>
  (result.structuredContent as Record<string, unknown>)[
    "normalized_result"
  ] as Record<string, unknown>;

describe("Malbolge MCP boundary", () => {
  it("A. registers the three Malbolge contracts from the canonical catalog", async () => {
    const server = buildServer();
    try {
      const registered = server.registeredOperationNames();
      const names = [
        "inspect_malbolge",
        "trace_malbolge",
        "decompile_malbolge",
      ];
      for (const name of names) {
        expect(registered).toContain(name);
        expect(TOOL_CONTRACTS.some((contract) => contract.name === name)).toBe(
          true,
        );
      }
    } finally {
      await server.close();
    }
  });

  it("B. inspects the golden program without executing it", async () => {
    const path = await writeProgram("hello.mal", HELLO_WORLD_SOURCE);
    const result = await callTool("inspect_malbolge", { path });
    expect(result.isError).not.toBe(true);
    const value = normalizedResult(result) as Record<string, unknown>;
    expect(value["program_length"]).toBe(88);
    const artifact = value["artifact"] as Record<string, unknown>;
    expect(artifact["path"]).toBe(path);
    expect(typeof artifact["sha256"]).toBe("string");
    const stats = value["stats"] as Record<string, number>;
    const total = Object.values(stats).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(88);
  });

  it("C. traces the golden program to Hello, world. at 48 steps", async () => {
    const path = await writeProgram("hello.mal", HELLO_WORLD_SOURCE);
    const result = await callTool("trace_malbolge", {
      path,
      max_steps: 1000,
    });
    expect(result.isError).not.toBe(true);
    const value = normalizedResult(result) as Record<string, unknown>;
    const run = value["run"] as Record<string, unknown>;
    expect(run["steps"]).toBe(48);
    expect(run["status"]).toBe("HALTED");
    expect(value["output_text"]).toBe("Hello, world.");
    const events = value["events"] as Record<string, unknown>[];
    expect(events).toHaveLength(48);
  });

  it("D. decompiles the golden program with an honest unknown family", async () => {
    const path = await writeProgram("hello.mal", HELLO_WORLD_SOURCE);
    const result = await callTool("decompile_malbolge", { path });
    expect(result.isError).not.toBe(true);
    const value = normalizedResult(result) as Record<string, unknown>;
    expect(value["family"]).toBe("unknown");
    expect(value["output_text"]).toBe("Hello, world.");
    const limitations = value["limitations"] as string[];
    expect(limitations.join(" ")).toContain("open problem");
  });

  it("E. refuses relative paths, missing files and invalid programs", async () => {
    const relative = await callTool("inspect_malbolge", {
      path: "relative/hello.mal",
    });
    expect(relative.isError).toBe(true);

    const missing = await callTool("trace_malbolge", {
      path: "/nonexistent/repo/hello.mal",
    });
    expect(missing.isError).toBe(true);

    const invalidPath = await writeProgram("bad.mal", "ok\u0001");
    const invalid = await callTool("decompile_malbolge", {
      path: invalidPath,
    });
    expect(invalid.isError).toBe(true);
  });

  it("F. traces carry a stable execution identity and the state transformation", async () => {
    const path = await writeProgram("hello.mal", HELLO_WORLD_SOURCE);
    const result = await callTool("trace_malbolge", {
      path,
      max_steps: 1000,
    });
    expect(result.isError).not.toBe(true);
    const value = normalizedResult(result) as Record<string, unknown>;
    expect(value["execution_id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
    const run = value["run"] as Record<string, unknown>;
    expect(run["writebacks"]).toBe(71);
    expect(run["representation_changes"]).toBe(71);
    expect(run["state_digest_before"]).toMatch(/^[a-f0-9]{64}$/u);
    expect(run["state_digest_after"]).toMatch(/^[a-f0-9]{64}$/u);
    expect(run["state_digest_before"]).not.toBe(run["state_digest_after"]);
    const events = value["events"] as Record<string, unknown>[];
    const firstWrites = events[0]?.["writes"] as Record<string, number>[];
    expect(firstWrites).toEqual([
      { position: 0, value_before: 40, value_after: 121 },
    ]);
    // The artifact digest is the identity anchor: executing the program
    // mutates the in-memory machine, never the source on disk.
    const artifact = value["artifact"] as Record<string, unknown>;
    const reread = await callTool("inspect_malbolge", { path });
    const rereadArtifact = (
      normalizedResult(reread) as Record<string, unknown>
    )["artifact"] as Record<string, unknown>;
    expect(rereadArtifact["sha256"]).toBe(artifact["sha256"]);
  });

  it("G. refuses oversized sources before reading them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rea-malbolge-cap-"));
    const path = join(directory, "huge.mb");
    await writeFile(path, "a".repeat(MAX_MALBOLGE_SOURCE_BYTES + 1), "utf8");
    const refused = await callTool("trace_malbolge", { path });
    expect(refused.isError).toBe(true);
  });
});
