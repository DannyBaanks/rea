import { z } from "zod";

import { jsonObjectSchema } from "../domain/jsonValue.js";
import type { ToolContract } from "./toolContractTypes.js";
import { toolContractMetadata } from "./toolEffects.js";
import { requireOutputSchema } from "./toolOutputSchemaPrimitives.js";
import { examplesFor } from "./toolContractHelpers.js";

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
export const catalogEntrySchema = z.strictObject({
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

/** Complete advertised contract for one capability, resolved on demand. */
export const catalogDescriptionSchema = z.strictObject({
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

/** Executed capability result; `structured` follows the target tool's contract. */
export const catalogExecutionResultSchema = z.strictObject({
  name: z.string(),
  is_error: z.boolean(),
  structured: jsonObjectSchema.nullable(),
  text: z.string().nullable(),
});

export const catalogDiscoverInputSchema = z.strictObject({
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

export const catalogDiscoverOutputSchema = z.strictObject({
  count: z.number().int().min(0),
  entries: z.array(catalogEntrySchema),
  truncated: z.boolean(),
  catalog_count: z.number().int().min(0),
});

export const catalogDescribeInputSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .describe("Exact capability name returned by rea_discover."),
});

export const catalogDescribeOutputSchema = catalogDescriptionSchema;

export const catalogExecuteInputSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .describe("Exact registered capability name returned by rea_discover."),
  arguments: jsonObjectSchema.describe(
    "Arguments validated against the named capability's own input schema before execution.",
  ),
});

export const catalogExecuteOutputSchema = catalogExecutionResultSchema;

const catalogOutputSchemas = {
  rea_discover: catalogDiscoverOutputSchema,
  rea_describe: catalogDescribeOutputSchema,
  rea_execute: catalogExecuteOutputSchema,
};

const catalog = <
  Name extends keyof typeof catalogOutputSchemas & string,
  Schema extends z.ZodObject,
>(
  name: Name,
  description: string,
  inputSchema: Schema,
) =>
  ({
    name,
    ...toolContractMetadata(name),
    description,
    kind: "application",
    inputSchema,
    outputSchema: requireOutputSchema(catalogOutputSchemas, name),
    examples: examplesFor(name, inputSchema),
  }) satisfies ToolContract<Name, Schema>;

/**
 * Progressive-disclosure surface. Only these three capabilities are advertised
 * under the compact tool profile; the remaining catalog stays registered and
 * callable through {@link rea_execute}.
 */
export const CATALOG_TOOL_CONTRACTS = [
  catalog(
    "rea_discover",
    "Search the REA capability catalog by name, title, description, or adapter family and return compact routing entries with a short summary, never input or output schemas. Request the complete contract, including the full description, with rea_describe. Every capability stays registered and callable regardless of the advertised profile, so discovery neither grants nor removes execution authority.",
    catalogDiscoverInputSchema,
  ),
  catalog(
    "rea_describe",
    "Return the complete advertised contract for one named capability: description, input schema, output schema, examples, and target-content provenance. Use it before rea_execute when the arguments need the full schema; the returned input schema is the same contract the capability validates against.",
    catalogDescribeInputSchema,
  ),
  catalog(
    "rea_execute",
    "Invoke one registered capability by name with caller-supplied arguments. Arguments are validated against that capability's own input schema before dispatch, an unknown or unregistered name is refused, and the real capability handler runs with its own admission, authority, and Sentinel decisions unchanged. The result follows the executed capability's contract.",
    catalogExecuteInputSchema,
  ),
] as const satisfies readonly ToolContract[];
