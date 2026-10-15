import type {
  CallToolResult,
  ServerContext,
} from "@modelcontextprotocol/server";

import { toolContract } from "../contracts/toolContracts.js";
import { TOOL_CONTRACTS } from "../contracts/toolContracts.js";
import { catalogEntrySummary } from "../contracts/catalogToolContracts.js";
import type { ToolContract } from "../contracts/toolContractTypes.js";
import {
  advertisedInputJsonSchema,
  toolOutputSchemaWithMetadata,
} from "../contracts/toolSchemaMetadata.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { err, ok } from "../domain/result.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const contractOf = (name: string): ToolContract | undefined =>
  TOOL_CONTRACTS.find((candidate) => candidate.name === name);

/** Refuse a catalog operation before any capability work starts. */
const deny = (
  server: EvidenceMcpServer,
  contract: ToolContract,
  refusal: {
    readonly operation: string;
    readonly reason: string;
    readonly path: readonly string[];
  },
): CallToolResult =>
  server.delivery.toCallToolResult(
    err(
      new AnalysisInputError(
        refusal.operation,
        { userMessage: refusal.reason },
        [
          {
            path: refusal.path,
            reason: "invalid_value",
            message: refusal.reason,
          },
        ],
      ),
    ),
    contract,
  );

/** JSON Schema projection of one contract's advertised output contract. */
const advertisedOutputSchema = (
  contract: ToolContract,
): ReturnType<typeof jsonValueSchema.parse> =>
  jsonValueSchema.parse(
    toolOutputSchemaWithMetadata(contract)["~standard"].jsonSchema.output({
      target: "draft-2020-12",
    }),
  );

const matchesQuery = (
  contract: ToolContract,
  query: string | undefined,
): boolean => {
  if (query === undefined) return true;
  const needle = query.toLowerCase();
  return (
    contract.name.toLowerCase().includes(needle) ||
    contract.title.toLowerCase().includes(needle) ||
    contract.description.toLowerCase().includes(needle)
  );
};

const structuredOf = (
  result: CallToolResult,
): ReturnType<typeof jsonValueSchema.parse> | null =>
  isRecord(result.structuredContent)
    ? jsonValueSchema.parse(result.structuredContent)
    : null;

const textOf = (result: CallToolResult): string | null => {
  const texts = result.content
    .filter((item) => item.type === "text")
    .map((item) => (item.type === "text" ? item.text : ""));
  return texts.length === 0 ? null : texts.join("\n");
};

/** Describe one registered capability with its complete advertised contract. */
const describeOperation = async (
  server: EvidenceMcpServer,
  contract: ToolContract,
  name: string,
): Promise<CallToolResult> => {
  const target = contractOf(name);
  if (target === undefined)
    return deny(server, contract, {
      operation: "rea_describe",
      reason: `Unknown capability: ${name}`,
      path: ["name"],
    });
  if (server.registeredOperation(name) === undefined)
    return deny(server, contract, {
      operation: "rea_describe",
      reason: `Capability ${name} is not registered on this server, so it can be neither described nor executed here.`,
      path: ["name"],
    });
  return server.delivery.toCallToolResult(
    ok({
      name: target.name,
      title: target.title,
      kind: target.kind,
      description: target.description,
      input_schema: jsonValueSchema.parse(advertisedInputJsonSchema(target)),
      output_schema: advertisedOutputSchema(target),
      returns_target_content: target.returnsTargetContent,
      examples: target.examples.map((example) => ({
        title: example.title,
        input: jsonValueSchema.parse(example.input),
      })),
    }),
    contract,
  );
};

/**
 * Register the progressive-disclosure catalog surface. rea_discover and
 * rea_describe read the canonical contracts of registered capabilities;
 * rea_execute dispatches to the recorded handler, so admission, authority and
 * target-content provenance decisions stay inside the capability itself.
 */
export const registerCatalogTools = (server: EvidenceMcpServer): void => {
  const discoverContract = toolContract("rea_discover");
  server.registerTool(
    discoverContract.name,
    toolRegistrationOptions(discoverContract),
    async (input) => {
      const registered = server.registeredOperationNames();
      const entries = registered
        .map((name) => contractOf(name))
        .filter((contract): contract is ToolContract => contract !== undefined)
        .filter(
          (contract) =>
            matchesQuery(contract, input.query) &&
            (input.kind === undefined || contract.kind === input.kind),
        )
        .map((contract) => ({
          name: contract.name,
          title: contract.title,
          kind: contract.kind,
          summary: catalogEntrySummary(contract.description),
          returns_target_content: contract.returnsTargetContent,
        }));
      return server.delivery.toCallToolResult(
        ok({
          count: Math.min(entries.length, input.limit),
          entries: entries.slice(0, input.limit),
          truncated: entries.length > input.limit,
          catalog_count: registered.length,
        }),
        discoverContract,
      );
    },
  );

  const describeContract = toolContract("rea_describe");
  server.registerTool(
    describeContract.name,
    toolRegistrationOptions(describeContract),
    async (input) => describeOperation(server, describeContract, input.name),
  );

  const executeContract = toolContract("rea_execute");
  server.registerTool(
    executeContract.name,
    toolRegistrationOptions(executeContract),
    async (input, context: ServerContext) => {
      const operation = server.registeredOperation(input.name);
      if (operation === undefined)
        return deny(server, executeContract, {
          operation: "rea_execute",
          reason: `Unknown or unregistered capability: ${input.name}`,
          path: ["name"],
        });
      const contract = contractOf(input.name);
      if (contract === undefined)
        return deny(server, executeContract, {
          operation: "rea_execute",
          reason: `Capability ${input.name} has no canonical contract, so its arguments cannot be validated.`,
          path: ["name"],
        });
      const parsed = contract.inputSchema.safeParse(input.arguments);
      if (!parsed.success)
        return deny(server, executeContract, {
          operation: "rea_execute",
          reason: `Arguments for ${input.name} failed that capability's own input schema validation.`,
          path: ["arguments"],
        });
      const result = await operation.callback(parsed.data, context);
      return server.delivery.toCallToolResult(
        ok({
          name: input.name,
          is_error: result.isError === true,
          structured: structuredOf(result),
          text: textOf(result),
        }),
        executeContract,
      );
    },
  );
};
