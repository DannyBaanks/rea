import type {
  CallToolResult,
  RegisteredTool,
  ServerContext,
} from "@modelcontextprotocol/server";

import {
  REA_DESCRIBE,
  REA_DISCOVER,
  REA_EXECUTE,
  catalogEntrySummary,
  compactCatalogIdentity,
} from "../catalogDispatch.js";
import { TOOL_CONTRACTS } from "../contracts/toolContracts.js";
import type { ToolContract } from "../contracts/toolContractTypes.js";
import {
  advertisedInputJsonSchema,
  toolOutputSchemaWithMetadata,
} from "../contracts/toolSchemaMetadata.js";
import {
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import type { z } from "zod";
import { jsonObjectSchema } from "../domain/jsonValue.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import {
  carriesTargetContentMarker,
  encodeToolResult,
  TARGET_CONTENT_RESULT_META,
} from "./toolResultEncoding.js";

type JsonObject = z.output<typeof jsonObjectSchema>;

const contractByName = new Map<string, ToolContract>(
  TOOL_CONTRACTS.map((contract) => [contract.name, contract]),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const advertisedOutputSchema = (contract: ToolContract): JsonObject =>
  jsonObjectSchema.parse(
    toolOutputSchemaWithMetadata(contract)["~standard"].jsonSchema.output({
      target: "draft-2020-12",
    }),
  );

/**
 * Compact dispatch catalog over this server's canonical registrations.
 *
 * Installed after every family registered: the in-scope set is exactly the
 * registrations that are enabled at that moment, so `REA_MCP_TOOL_FAMILIES`
 * exclusions stay excluded, and discovery or dispatch can never re-enable a
 * tool the caller scoped out. Those registrations are then disabled, so
 * `tools/list` advertises only the three catalog tools; `rea_execute` reaches
 * them through their recorded handlers, after the same input validation the
 * SDK would perform on a direct call.
 */
export class CompactDispatchCatalog {
  private readonly tools: ReadonlyMap<
    string,
    { readonly registered: RegisteredTool; readonly contract: ToolContract }
  >;

  constructor(private readonly server: EvidenceMcpServer) {
    this.tools = new Map(
      [...server.registeredTools()]
        .filter(([, registered]) => registered.enabled)
        .flatMap(([name, registered]) => {
          const contract = contractByName.get(name);
          return contract === undefined
            ? []
            : [[name, { registered, contract }] as const];
        }),
    );
    for (const { registered } of this.tools.values()) registered.disable();
  }

  /** Register the three catalog tools and adopt the compact identity. */
  install(): void {
    const server = this.server;
    server.adoptCatalogIdentity(compactCatalogIdentity(server.catalogIdentity));
    server.registerCatalogSurfaceTool(
      REA_DISCOVER.name,
      REA_DISCOVER,
      (input: {
        query?: string | undefined;
        kind?: string | undefined;
        limit: number;
      }) => this.discover(input),
    );
    server.registerCatalogSurfaceTool(
      REA_DESCRIBE.name,
      REA_DESCRIBE,
      (input: { name: string }) => this.describe(input.name),
    );
    server.registerCatalogSurfaceTool(
      REA_EXECUTE.name,
      REA_EXECUTE,
      (
        input: { name: string; arguments: JsonObject },
        context: ServerContext,
      ) => this.execute(input.name, input.arguments, context),
    );
  }

  private refuse(
    operation: string,
    path: readonly string[],
    reason: string,
  ): CallToolResult {
    return this.server.delivery.toErrorToolResult(
      new AnalysisInputError(
        operation,
        { userMessage: reason, conformsToInputContract: true },
        [{ path: [...path], reason: "invalid_value", message: reason }],
      ),
      false,
    );
  }

  /** Encode one reply within the response budget, or refuse with its size. */
  private reply(
    operation: string,
    payload: JsonObject,
    meta?: Record<string, unknown>,
  ): CallToolResult {
    const delivery = this.server.delivery;
    const encoded = encodeToolResult(payload, delivery.resultBudgetBytes);
    if (!encoded.ok)
      return delivery.toErrorToolResult(
        new AnalysisResourceConstraintError(
          operation,
          "transport",
          "The catalog reply exceeds the response budget.",
          {
            result_budget_bytes: delivery.resultBudgetBytes,
            response_bytes_at_least: encoded.bytesAtLeast,
            constraint: encoded.constraint,
          },
          {
            remediationAction:
              "Narrow the query or lower limit; for rea_execute, request a smaller result from the capability itself.",
          },
        ),
        false,
      );
    return {
      content: [{ type: "text" as const, text: encoded.text }],
      structuredContent: payload,
      ...(meta === undefined ? {} : { _meta: meta }),
    };
  }

  private discover(input: {
    query?: string | undefined;
    kind?: string | undefined;
    limit: number;
  }): CallToolResult {
    const needle = input.query?.toLowerCase();
    const entries = [...this.tools.values()]
      .map(({ contract }) => contract)
      .filter(
        (contract) =>
          (needle === undefined ||
            contract.name.toLowerCase().includes(needle) ||
            contract.title.toLowerCase().includes(needle) ||
            contract.description.toLowerCase().includes(needle)) &&
          (input.kind === undefined || contract.kind === input.kind),
      )
      .map((contract) => ({
        name: contract.name,
        title: contract.title,
        kind: contract.kind,
        summary: catalogEntrySummary(contract.description),
        returns_target_content: contract.returnsTargetContent,
      }));
    return this.reply(REA_DISCOVER.name, {
      count: Math.min(entries.length, input.limit),
      entries: entries.slice(0, input.limit),
      truncated: entries.length > input.limit,
      catalog_count: this.tools.size,
    });
  }

  private describe(name: string): CallToolResult {
    const tool = this.tools.get(name);
    if (tool === undefined)
      return this.refuse(
        REA_DESCRIBE.name,
        ["name"],
        `Unknown, unregistered or out-of-scope capability: ${name}`,
      );
    const { contract } = tool;
    return this.reply(REA_DESCRIBE.name, {
      name: contract.name,
      title: contract.title,
      kind: contract.kind,
      description: contract.description,
      input_schema: jsonObjectSchema.parse(advertisedInputJsonSchema(contract)),
      output_schema: advertisedOutputSchema(contract),
      returns_target_content: contract.returnsTargetContent,
      examples: contract.examples.map((example) => ({
        title: example.title,
        input: jsonObjectSchema.parse(example.input),
      })),
    });
  }

  private async execute(
    name: string,
    args: JsonObject,
    context: ServerContext,
  ): Promise<CallToolResult> {
    const tool = this.tools.get(name);
    if (tool === undefined)
      return this.refuse(
        REA_EXECUTE.name,
        ["name"],
        `Unknown, unregistered or out-of-scope capability: ${name}`,
      );
    // Refuse before any capability work starts: the canonical contract is the
    // complete argument grammar, stricter than the registration envelope.
    if (!tool.contract.inputSchema.safeParse(args).success)
      return this.refuse(
        REA_EXECUTE.name,
        ["arguments"],
        `Arguments for ${name} failed that capability's own input schema validation. Read the schema with rea_describe.`,
      );
    // Then exactly what the SDK does for a direct call: the registration's
    // own validation, and the handler with the validated value.
    const schema = tool.registered.inputSchema;
    let value: unknown = args;
    if (schema !== undefined) {
      const validated = await schema["~standard"].validate(args);
      if (validated.issues !== undefined)
        return this.refuse(
          REA_EXECUTE.name,
          ["arguments"],
          `Arguments for ${name} were refused by its registration.`,
        );
      value = validated.value;
    }
    context.mcpReq.signal.throwIfAborted();
    const handler = tool.registered.handler as (
      input: unknown,
      ctx: ServerContext,
    ) => Promise<CallToolResult> | CallToolResult;
    const result = await handler(value, context);
    const text = result.content
      .flatMap((item) => (item.type === "text" ? [item.text] : []))
      .join("\n");
    return this.reply(
      REA_EXECUTE.name,
      {
        name,
        is_error: result.isError === true,
        structured: isRecord(result.structuredContent)
          ? jsonObjectSchema.parse(result.structuredContent)
          : null,
        text: text.length === 0 ? null : text,
      },
      // The dispatched result may quote the analysis target: keep its
      // untrusted-content provenance on the wrapping reply.
      carriesTargetContentMarker(result) || tool.contract.returnsTargetContent
        ? { ...TARGET_CONTENT_RESULT_META }
        : undefined,
    );
  }
}

/** Replace the full advertisement with the compact dispatch catalog. */
export const installCompactDispatchCatalog = (
  server: EvidenceMcpServer,
): void => new CompactDispatchCatalog(server).install();
