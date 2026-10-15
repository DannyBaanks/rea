import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import { CATALOG_SUMMARY_LIMIT_CHARS } from "../../../src/catalogDispatch.js";
import { createCatalogIdentity } from "../../../src/catalogIdentity.js";
import {
  CATALOG_TOOL_NAMES,
  parseMcpToolProfile,
} from "../../../src/config/mcpToolProfile.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import { TOOL_CONTRACTS } from "../../../src/contracts/toolContracts.js";
import { toolFamilyId } from "../../../src/contracts/toolFamilies.js";
import { installCompactDispatchCatalog } from "../../../src/server/CompactDispatchCatalog.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { carriesTargetContentMarker } from "../../../src/server/toolResultEncoding.js";
import { toolRegistrationOptions } from "../../../src/server/toolRegistrationOptions.js";

interface AdvertisedTool {
  readonly name: string;
}

const serializedBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), "utf8");

/** Register every canonical contract with a deterministic echo stub. */
const buildServer = (
  compact: boolean,
  families?: ReadonlySet<string>,
): EvidenceMcpServer => {
  const server = new EvidenceMcpServer(
    { name: compact ? "catalog-compact" : "catalog-full", version: "0" },
    { capabilities: {} },
    undefined,
    createToolResultDelivery(undefined),
    undefined,
    "full",
    createCatalogIdentity({ contracts: TOOL_CONTRACTS, promptContracts: [] }),
    families,
  );
  for (const contract of TOOL_CONTRACTS)
    server.registerTool(
      contract.name,
      toolRegistrationOptions(contract),
      async (input: unknown) => ({
        content: [],
        structuredContent: { registered: true, echoed_input: input },
      }),
    );
  if (compact) installCompactDispatchCatalog(server);
  return server;
};

const withClient = async <T>(
  server: EvidenceMcpServer,
  use: (client: Client) => Promise<T>,
): Promise<T> => {
  const client = new Client({ name: "catalog-profile", version: "0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return await use(client);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
};

const listTools = (server: EvidenceMcpServer) =>
  withClient(server, async (client) => (await client.listTools()).tools);

const call = (
  server: EvidenceMcpServer,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> =>
  withClient(
    server,
    async (client) =>
      (await client.callTool({ name, arguments: args })) as CallToolResult,
  );

const structured = <T>(result: CallToolResult): T =>
  result.structuredContent as T;

const catalogNames = TOOL_CONTRACTS.map(({ name }) => name);
const PROBE = "search_procedures";

describe("compact dispatch catalog (REA_MCP_TOOL_PROFILE=compact)", () => {
  it("A. keeps every canonical registration, disabled, and none of the catalog tools", () => {
    const server = buildServer(true);
    const registered = [...server.registeredTools().keys()];
    expect([...registered].sort()).toEqual([...catalogNames].sort());
    for (const tool of server.registeredTools().values())
      expect(tool.enabled).toBe(false);
    for (const name of CATALOG_TOOL_NAMES)
      expect(registered).not.toContain(name);
  });

  it("B. advertises exactly three tools in compact mode and the plain catalog otherwise", async () => {
    const compact: readonly AdvertisedTool[] = await listTools(
      buildServer(true),
    );
    const full: readonly AdvertisedTool[] = await listTools(buildServer(false));
    expect(compact.map(({ name }) => name).sort()).toEqual(
      [...CATALOG_TOOL_NAMES].sort(),
    );
    expect(full.map(({ name }) => name).sort()).toEqual(
      [...catalogNames].sort(),
    );
    expect(serializedBytes(compact)).toBeLessThan(serializedBytes(full) / 10);
    expect(serializedBytes(compact)).toBeLessThan(64 * 1024);
  });

  it("C. discovers, describes and executes a capability through the dispatcher", async () => {
    const discovered = await call(buildServer(true), "rea_discover", {
      query: "procedure",
      limit: 1000,
    });
    expect(discovered.isError).not.toBe(true);
    const discovery = structured<{
      entries: { name: string; summary: string }[];
      catalog_count: number;
    }>(discovered);
    expect(discovery.catalog_count).toBe(catalogNames.length);
    const entry = discovery.entries.find(({ name }) => name === PROBE);
    expect(entry).toBeDefined();
    expect(entry!.summary.length).toBeGreaterThan(0);
    expect(entry!.summary.length).toBeLessThanOrEqual(
      CATALOG_SUMMARY_LIMIT_CHARS,
    );

    const described = await call(buildServer(true), "rea_describe", {
      name: PROBE,
    });
    expect(described.isError).not.toBe(true);
    const description = structured<{
      input_schema: Record<string, unknown>;
      output_schema: unknown;
    }>(described);
    expect(description.input_schema["properties"]).toHaveProperty("pattern");
    expect(description.output_schema).not.toBeNull();

    const executed = await call(buildServer(true), "rea_execute", {
      name: PROBE,
      arguments: { pattern: "main" },
    });
    expect(executed.isError).not.toBe(true);
    const outcome = structured<{
      name: string;
      is_error: boolean;
      structured: { echoed_input?: Record<string, unknown> } | null;
      text: string | null;
    }>(executed);
    expect(outcome.name).toBe(PROBE);
    expect(outcome.is_error).toBe(false);
    expect(outcome.structured?.echoed_input).toMatchObject({ pattern: "main" });
    expect(outcome.text).toBeNull();
  });

  it("D. refuses unknown names and arguments that fail the capability's own schema", async () => {
    const unknown = await call(buildServer(true), "rea_execute", {
      name: "no_such_capability",
      arguments: {},
    });
    expect(unknown.isError).toBe(true);
    const describeUnknown = await call(buildServer(true), "rea_describe", {
      name: "no_such_capability",
    });
    expect(describeUnknown.isError).toBe(true);
    const invalid = await call(buildServer(true), "rea_execute", {
      name: PROBE,
      arguments: { pattern: 42 },
    });
    expect(invalid.isError).toBe(true);
  });

  it("E. respects REA_MCP_TOOL_FAMILIES: excluded families are neither discoverable nor executable", async () => {
    const scope = new Set(["malbolge"]);
    const inScope = catalogNames.filter(
      (name) => toolFamilyId(name) === "malbolge",
    );
    expect(inScope.length).toBeGreaterThan(0);
    const discovered = await call(buildServer(true, scope), "rea_discover", {
      limit: 1000,
    });
    const discovery = structured<{
      entries: { name: string }[];
      catalog_count: number;
    }>(discovered);
    expect(discovery.catalog_count).toBe(inScope.length);
    expect(discovery.entries.map(({ name }) => name).sort()).toEqual(
      [...inScope].sort(),
    );
    const excluded = await call(buildServer(true, scope), "rea_execute", {
      name: PROBE,
      arguments: { pattern: "main" },
    });
    expect(excluded.isError).toBe(true);
  });

  it("F. keeps target-content provenance on dispatched results", async () => {
    const quoting = TOOL_CONTRACTS.find(
      (contract) =>
        contract.returnsTargetContent && contract.examples.length > 0,
    );
    if (quoting === undefined) throw new Error("No target-content example");
    const executed = await call(buildServer(true), "rea_execute", {
      name: quoting.name,
      arguments: quoting.examples[0]!.input as Record<string, unknown>,
    });
    expect(executed.isError).not.toBe(true);
    expect(carriesTargetContentMarker(executed)).toBe(true);
  });

  it("G. a compact-hidden tool is not directly callable; dispatch is the route", async () => {
    // The SDK refuses a disabled registration at the protocol layer.
    await expect(
      call(buildServer(true), PROBE, { pattern: "main" }),
    ).rejects.toThrow(/disabled/u);
  });

  it("H. configuration: invalid values and compact + hot-cold fail closed", () => {
    expect(parseMcpToolProfile("compact").ok).toBe(true);
    expect(parseMcpToolProfile("tiny").ok).toBe(false);
    expect(
      parseConfig({
        REA_MCP_TOOL_PROFILE: "compact",
        REA_MCP_TOOL_CATALOG_PROFILE: "hot-cold",
      }).ok,
    ).toBe(false);
    expect(parseConfig({ REA_MCP_TOOL_PROFILE: "compact" }).ok).toBe(true);
  });
});
