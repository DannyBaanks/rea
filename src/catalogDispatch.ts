import { createHash } from "node:crypto";
import { z } from "zod";

import type { createCatalogIdentity } from "./catalogIdentity.js";
import { jsonObjectSchema } from "./domain/jsonValue.js";

/**
 * Compact dispatch catalog (fork: `REA_MCP_TOOL_PROFILE=compact`).
 *
 * Like `discover_tools` in the hot/cold profile, these three tools are a
 * transport-level catalog surface: they are not canonical tool contracts,
 * belong to no family, and run no analysis of their own. Unlike hot/cold,
 * they need no client catalog refresh: `rea_execute` dispatches to the named
 * registration, so clients that never refresh `tools/list` still reach every
 * in-scope capability.
 */

/** Longest discovery summary; the complete text stays in rea_describe. */
export const CATALOG_SUMMARY_LIMIT_CHARS = 160;

/**
 * Project one capability description into a discovery summary: its first
 * sentence, capped at {@link CATALOG_SUMMARY_LIMIT_CHARS}. Discovery stays a
 * routing surface, so the complete description is read only on demand.
 */
export const catalogEntrySummary = (description: string): string => {
  const sentenceEnd = description.search(/[.!?]\s/u);
  const first =
    sentenceEnd === -1 ? description : description.slice(0, sentenceEnd + 1);
  return first.length <= CATALOG_SUMMARY_LIMIT_CHARS
    ? first
    : `${first.slice(0, CATALOG_SUMMARY_LIMIT_CHARS - 3).trimEnd()}...`;
};

/** Immutable discovery entry: identity and routing facts, never full schemas. */
const catalogEntrySchema = z.strictObject({
  name: z.string(),
  title: z.string(),
  kind: z.string(),
  summary: z
    .string()
    .describe(
      `First sentence of the description, capped at ${CATALOG_SUMMARY_LIMIT_CHARS} characters. Read the complete description with rea_describe.`,
    ),
  returns_target_content: z.boolean(),
});

const discoverInputSchema = z.strictObject({
  query: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Case-insensitive substring matched against capability name, title and description. Omit to list the catalog.",
    ),
  kind: z
    .string()
    .optional()
    .describe(
      "Exact adapter family filter, one of the catalog kinds (for example native-provider, application, session). Omit for every family.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(50)
    .describe("Maximum discovery entries returned in one response."),
});

const discoverOutputSchema = z.strictObject({
  count: z.number().int().min(0),
  entries: z.array(catalogEntrySchema),
  truncated: z.boolean(),
  catalog_count: z.number().int().min(0),
});

const describeInputSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .describe("Exact capability name returned by rea_discover."),
});

const describeOutputSchema = z.strictObject({
  name: z.string(),
  title: z.string(),
  kind: z.string(),
  description: z.string(),
  input_schema: jsonObjectSchema,
  output_schema: jsonObjectSchema.nullable(),
  returns_target_content: z.boolean(),
  examples: z.array(
    z.strictObject({ title: z.string(), input: jsonObjectSchema }),
  ),
});

const executeInputSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .describe("Exact registered capability name returned by rea_discover."),
  arguments: jsonObjectSchema.describe(
    "Arguments validated against the named capability's own input schema before execution.",
  ),
});

const executeOutputSchema = z.strictObject({
  name: z.string(),
  is_error: z.boolean(),
  structured: jsonObjectSchema.nullable(),
  text: z.string().nullable(),
});

export const REA_DISCOVER = {
  name: "rea_discover",
  description:
    "Search the REA capability catalog by name, title, description, or adapter family and return compact routing entries with a short summary, never input or output schemas. Request the complete contract, including the full description, with rea_describe. Discovery neither grants nor removes execution authority.",
  inputSchema: discoverInputSchema,
  outputSchema: discoverOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

export const REA_DESCRIBE = {
  name: "rea_describe",
  description:
    "Return the complete advertised contract for one named capability: description, input schema, output schema, examples, and target-content provenance. Use it before rea_execute when the arguments need the full schema; the returned input schema is the same contract the capability validates against.",
  inputSchema: describeInputSchema,
  outputSchema: describeOutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

export const REA_EXECUTE = {
  name: "rea_execute",
  description:
    "Invoke one in-scope capability by name with caller-supplied arguments. Arguments are validated against that capability's own input schema before dispatch, an unknown, unregistered or family-excluded name is refused, and the real capability handler runs with its own admission, authority, and Sentinel decisions unchanged. The result follows the executed capability's contract and keeps its target-content provenance.",
  inputSchema: executeInputSchema,
  outputSchema: executeOutputSchema,
  // Dispatch reaches every effect the named capability has, including
  // foreign-code execution and device or filesystem mutation.
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
} as const;

/** The compact profile's complete advertisement, in tools/list order. */
export const COMPACT_DISPATCH_TOOLS = [
  REA_DISCOVER,
  REA_DESCRIBE,
  REA_EXECUTE,
] as const;

export type CatalogIdentity = ReturnType<typeof createCatalogIdentity>;
const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Identity covers the dispatchable inventory and the compact policy. */
export const compactCatalogIdentity = (
  base: CatalogIdentity,
): CatalogIdentity => {
  const policy = {
    profile: "compact",
    tools: COMPACT_DISPATCH_TOOLS.map((tool) => ({
      ...tool,
      inputSchema: z.toJSONSchema(tool.inputSchema, { io: "input" }),
      outputSchema: z.toJSONSchema(tool.outputSchema),
    })),
  };
  const tools_sha256 = digest({ base: base.digests.tools_sha256, policy });
  return {
    counts: {
      ...base.counts,
      mcp_tools: base.counts.mcp_tools + COMPACT_DISPATCH_TOOLS.length,
    },
    digests: {
      tools_sha256,
      prompts_sha256: base.digests.prompts_sha256,
      combined_sha256: digest({
        base: base.digests.combined_sha256,
        tools_sha256,
      }),
    },
  };
};
