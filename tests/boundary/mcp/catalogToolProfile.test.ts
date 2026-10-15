import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  STDIO_DEFAULT_MAX_BUFFER_SIZE,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import { TOOL_CONTRACTS } from "../../../src/contracts/toolContracts.js";
import { CATALOG_SUMMARY_LIMIT_CHARS } from "../../../src/contracts/catalogToolContracts.js";
import { CATALOG_TOOL_NAMES } from "../../../src/config/mcpToolProfile.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { ToolResultDelivery } from "../../../src/server/toolResult.js";
import { toolRegistrationOptions } from "../../../src/server/toolRegistrationOptions.js";
import { registerCatalogTools } from "../../../src/server/registerCatalogTools.js";

interface AdvertisedTool {
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema?: Record<string, unknown> | undefined;
  readonly outputSchema?: Record<string, unknown> | undefined;
}

const serializedBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), "utf8");

const listToolsThroughTransport = async (
  server: EvidenceMcpServer,
): Promise<readonly AdvertisedTool[]> => {
  const client = new Client({ name: "catalog-profile", version: "0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return (await client.listTools()).tools;
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
};

const callTool = async (
  server: EvidenceMcpServer,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> => {
  const client = new Client({ name: "catalog-profile", version: "0" });
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

/** Register the complete contract catalog plus a deterministic echo stub. */
const buildServer = (compact: boolean): EvidenceMcpServer => {
  const server = new EvidenceMcpServer(
    { name: compact ? "catalog-compact" : "catalog-full", version: "0" },
    { capabilities: {} },
    undefined,
    new ToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE),
  );
  if (compact) server.advertiseOnly(CATALOG_TOOL_NAMES);
  for (const contract of TOOL_CONTRACTS)
    if (!(CATALOG_TOOL_NAMES as readonly string[]).includes(contract.name))
      server.registerTool(
        contract.name,
        toolRegistrationOptions(contract),
        async (input: unknown) => ({
          content: [],
          structuredContent: { registered: true, echoed_input: input },
        }),
      );
  registerCatalogTools(server);
  return server;
};

const catalogNames = TOOL_CONTRACTS.map((contract) => contract.name);

describe("REA compact MCP tool profile", () => {
  it("A. keeps every registered capability internally in both profiles", async () => {
    for (const compact of [false, true]) {
      const server = buildServer(compact);
      const registered = server.registeredOperationNames();
      for (const name of catalogNames) expect(registered).toContain(name);
      expect(registered.length).toBe(catalogNames.length);
      expect(new Set(registered).size).toBe(registered.length);
      await server.close();
    }
  });

  it("B. advertises three tools in compact mode and the full catalog otherwise", async () => {
    const full = await listToolsThroughTransport(buildServer(false));
    const compact = await listToolsThroughTransport(buildServer(true));
    const fullNames = full.map((tool) => tool.name);
    const compactNames = compact.map((tool) => tool.name);

    for (const name of catalogNames) expect(fullNames).toContain(name);
    for (const name of CATALOG_TOOL_NAMES) expect(fullNames).toContain(name);
    expect([...compactNames].sort()).toEqual([...CATALOG_TOOL_NAMES].sort());
    expect(compactNames.length).toBeLessThanOrEqual(128);

    const fullBytes = serializedBytes(full);
    const compactBytes = serializedBytes(compact);
    expect(compactBytes).toBeLessThan(fullBytes / 10);
    expect(fullNames.length).toBeGreaterThan(compactNames.length);
  });

  const probe = "search_procedures";

  it("C. discovers, describes and executes a capability through the dispatcher", async () => {
    const server = buildServer(true);

    const discovered = await callTool(server, "rea_discover", {
      query: probe,
    });
    expect(discovered.isError).not.toBe(true);
    const discovery = discovered.structuredContent as {
      entries: readonly { name: string; summary: string }[];
      catalog_count: number;
    };
    expect(discovery.entries.map((entry) => entry.name)).toContain(probe);
    expect(discovery.catalog_count).toBe(catalogNames.length);
    // Discovery routing entries carry a capped summary, never the full text.
    const entry = discovery.entries.find((item) => item.name === probe);
    expect(entry?.summary.length).toBeLessThanOrEqual(
      CATALOG_SUMMARY_LIMIT_CHARS,
    );
    expect(entry?.summary.length).toBeGreaterThan(0);

    const described = await callTool(server, "rea_describe", { name: probe });
    expect(described.isError).not.toBe(true);
    const description = described.structuredContent as {
      description: string;
      input_schema: Record<string, unknown>;
      output_schema: unknown;
    };
    expect(description.input_schema["properties"]).toHaveProperty("pattern");
    expect(description.output_schema).not.toBeNull();
    // The complete description is only available on demand.
    expect(description.description.length).toBeGreaterThan(
      entry?.summary.length ?? 0,
    );

    const executed = await callTool(server, "rea_execute", {
      name: probe,
      arguments: { pattern: "main" },
    });
    expect(executed.isError).not.toBe(true);
    const outcome = executed.structuredContent as {
      name: string;
      is_error: boolean;
      structured: { echoed_input: { pattern: string } } | null;
      text: string | null;
    };
    expect(outcome.name).toBe(probe);
    expect(outcome.is_error).toBe(false);
    // The dispatcher validated the arguments against the capability's own
    // input schema, so its defaults are applied before the handler runs.
    expect(outcome.structured?.echoed_input).toEqual({
      pattern: "main",
      case_sensitive: false,
      mode: "literal",
    });
    expect(outcome.text).toBeNull();

    await server.close();
  });

  it("D. denies unknown capabilities, unregistered names and invalid arguments", async () => {
    const server = buildServer(true);

    const unknown = await callTool(server, "rea_execute", {
      name: "not_a_capability",
      arguments: {},
    });
    expect(unknown.isError).toBe(true);

    const unregistered = await callTool(server, "rea_describe", {
      name: "not_a_capability",
    });
    expect(unregistered.isError).toBe(true);

    const invalid = await callTool(server, "rea_execute", {
      name: probe,
      arguments: {},
    });
    expect(invalid.isError).toBe(true);

    const invalidType = await callTool(server, "rea_execute", {
      name: probe,
      arguments: { pattern: 42 },
    });
    expect(invalidType.isError).toBe(true);

    const discovered = await callTool(server, "rea_discover", {
      kind: "not-a-family",
    });
    expect(discovered.isError).not.toBe(true);
    expect(
      (discovered.structuredContent as { entries: readonly unknown[] }).entries,
    ).toEqual([]);

    await server.close();
  });

  it("E. keeps the compact advertisement under the observed provider item cap", async () => {
    const compact = await listToolsThroughTransport(buildServer(true));
    expect(compact.length).toBe(3);
    expect(serializedBytes(compact)).toBeLessThan(64 * 1024);
    for (const name of CATALOG_TOOL_NAMES)
      expect(compact.map((tool) => tool.name)).toContain(name);
  });

  it("F. keeps the full catalog advertised when no profile is selected", async () => {
    const server = new EvidenceMcpServer(
      { name: "catalog-default", version: "0" },
      { capabilities: {} },
      undefined,
      new ToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE),
    );
    for (const contract of TOOL_CONTRACTS)
      if (!(CATALOG_TOOL_NAMES as readonly string[]).includes(contract.name))
        server.registerTool(
          contract.name,
          toolRegistrationOptions(contract),
          async () => ({ content: [] }),
        );
    registerCatalogTools(server);
    const advertised = await listToolsThroughTransport(server);
    expect(advertised.length).toBe(catalogNames.length);
    for (const name of catalogNames)
      expect(advertised.map((tool) => tool.name)).toContain(name);
    await server.close();
  });
});
