import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { getHeapStatistics } from "node:v8";
import {
  AnalysisInputError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../../domain/analysisErrorCore.js";
import type { ArtifactInventoryResult } from "../../domain/artifactGraph.js";
import { javaScriptRuntime } from "../../domain/runtimeVersion.js";
import { ArtifactReaderFailure } from "../ArtifactReader.js";
import { ArtifactResourceScope } from "../ArtifactResourceScope.js";
import type { ArtifactInventoryOptions } from "./types.js";
import {
  ARTIFACT_INVENTORY_WORKER_DEFAULTS as DEFAULTS,
  artifactInventoryWorkerMessageSchema,
  artifactInventoryWorkerRequestSchema,
  type ArtifactInventoryWorkerMessage,
  type ArtifactInventoryWorkerRequest,
} from "./ArtifactInventoryWorkerProtocol.js";

/** Rebuild the parent's plain-data inventory options inside the worker. */
const inventoryOptionsFromRequest = (
  request: ArtifactInventoryWorkerRequest,
): Partial<ArtifactInventoryOptions> => {
  const forwarded = request.inventory;
  if (forwarded === undefined) return {};
  return {
    ...(forwarded.expected_root_sha256 === undefined
      ? {}
      : { expectedRootSha256: forwarded.expected_root_sha256 }),
    ...(forwarded.selected_path === undefined
      ? {}
      : { selectedPath: forwarded.selected_path }),
    ...(forwarded.asar_header_admission === undefined
      ? {}
      : { asarHeaderAdmission: forwarded.asar_header_admission }),
    ...(forwarded.esp_flash_selection === undefined
      ? {}
      : { espFlashSelection: forwarded.esp_flash_selection }),
    ...(forwarded.reader_limits === undefined
      ? {}
      : { readerLimits: forwarded.reader_limits }),
  };
};

/** Trusted composition callback that runs canonical artifact inventory inside the worker. */
export interface ArtifactInventoryWorkerRunner {
  (
    inputPath: string,
    options: ArtifactInventoryOptions,
  ): Promise<ArtifactInventoryResult>;
}

const send = async (input: ArtifactInventoryWorkerMessage): Promise<void> => {
  const value = artifactInventoryWorkerMessageSchema.parse(input);
  const frame = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(frame) > DEFAULTS.protocolBytes)
    throw new RangeError(
      "Artifact inventory worker control frame exceeds its byte budget",
    );
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(frame, (error) =>
      error === null || error === undefined ? resolve() : reject(error),
    );
  });
};

const classifyWorkerError = (
  id: string,
  cause: unknown,
): ArtifactInventoryWorkerMessage => {
  if (cause instanceof ArtifactReaderFailure)
    return {
      kind: "error",
      id,
      category: "reader",
      reason: cause.reason,
      ...(cause.details === undefined
        ? {}
        : { details: JSON.stringify(cause.details) }),
      message: cause.message,
    };
  if (cause instanceof AnalysisInputError)
    return {
      kind: "error",
      id,
      category: "input",
      message: cause.message,
    };
  if (cause instanceof AnalysisUnsupportedTargetError)
    return {
      kind: "error",
      id,
      category: "unsupported",
      reason: cause.reason,
      message: cause.message,
    };
  if (cause instanceof AnalysisResourceConstraintError)
    return {
      kind: "error",
      id,
      category: "resource",
      reason: cause.resource,
      message: cause.message,
    };
  return {
    kind: "error",
    id,
    category: "io",
    message: cause instanceof Error ? cause.message : String(cause),
  };
};

const handleRequest = async (
  root: string,
  request: ArtifactInventoryWorkerRequest,
  runInventory: ArtifactInventoryWorkerRunner,
): Promise<void> => {
  const safeResultFile = basename(request.result_file);
  if (safeResultFile !== request.result_file || safeResultFile === "") {
    await send({
      kind: "error",
      id: request.id,
      category: "input",
      message: "Artifact inventory worker result_file must be a plain filename",
    });
    return;
  }

  const scope = new ArtifactResourceScope();
  try {
    let lastRungNumber = -1;
    let totalEntriesProcessed = 0;
    const result = await runInventory(request.input_path, {
      resourceScope: scope,
      environment: request.environment,
      integrity: request.integrity_mode,
      ...inventoryOptionsFromRequest(request),
      ...(request.max_entries === undefined
        ? {}
        : { maxEntries: request.max_entries }),
      rungInterval: request.rung_interval ?? 500,
      onRung: async (checkpoint) => {
        lastRungNumber = checkpoint.rung;
        totalEntriesProcessed = checkpoint.entriesProcessed;
        await send({
          kind: "rung",
          id: request.id,
          rung: checkpoint.rung,
          label: checkpoint.label,
          sha256: checkpoint.sha256,
          nodes: checkpoint.nodes,
          occurrences: checkpoint.occurrences,
          entries_processed: checkpoint.entriesProcessed,
          ...(checkpoint.lastPath === undefined
            ? {}
            : { last_path: checkpoint.lastPath }),
        });
      },
    });

    const payload = JSON.stringify(result);
    const payloadBuffer = Buffer.from(payload, "utf8");
    if (payloadBuffer.byteLength > DEFAULTS.maxResultBytes) {
      await send({
        kind: "error",
        id: request.id,
        category: "resource",
        reason: "memory",
        message: `Serialized artifact inventory (${String(payloadBuffer.byteLength)} bytes) exceeds transfer budget (${String(DEFAULTS.maxResultBytes)} bytes)`,
      });
      return;
    }

    const sha256 = createHash("sha256").update(payloadBuffer).digest("hex");
    await send({
      kind: "rung",
      id: request.id,
      rung: lastRungNumber + 1,
      label: "inventory-complete",
      sha256,
      nodes: result.nodes.length,
      occurrences: result.occurrences.length,
      entries_processed: Math.max(
        totalEntriesProcessed,
        result.occurrences.length,
      ),
    });

    await writeFile(join(root, safeResultFile), payloadBuffer, {
      flag: "wx",
      mode: 0o600,
    });

    await send({
      kind: "completed",
      id: request.id,
      result_file: safeResultFile,
      sha256,
      byte_length: payloadBuffer.byteLength,
    });
  } catch (cause: unknown) {
    await send(classifyWorkerError(request.id, cause));
  } finally {
    await scope.close().catch(() => undefined);
  }
};

/** Serve sequential artifact inventory requests from a parent-owned private runtime root. */
export const serveArtifactInventoryWorker = async (
  runInventory: ArtifactInventoryWorkerRunner,
): Promise<void> => {
  const root = process.cwd();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const requests = input[Symbol.asyncIterator]();
  await send({
    kind: "ready",
    heap_limit_bytes:
      javaScriptRuntime(process.versions).id === "node"
        ? getHeapStatistics().heap_size_limit
        : null,
  });

  try {
    for (;;) {
      const next = await requests.next();
      if (next.done) break;
      const line = next.value;
      if (Buffer.byteLength(line) > DEFAULTS.protocolBytes)
        throw new RangeError(
          "Artifact inventory worker request exceeds its byte budget",
        );
      const raw: unknown = JSON.parse(line);
      const request = artifactInventoryWorkerRequestSchema.parse(raw);
      await handleRequest(root, request, runInventory);
    }
  } finally {
    input.close();
  }
};
