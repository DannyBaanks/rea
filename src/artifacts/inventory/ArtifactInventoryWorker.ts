import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANALYSIS_RESOURCE_KINDS,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
  AnalysisUnsupportedTargetError,
} from "../../domain/analysisErrorCore.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { ArtifactOperationError } from "../../domain/artifactOperationError.js";
import type { ArtifactReaderLimits } from "../../domain/artifactReaderLimits.js";
import type { EspFlashSelection } from "../../domain/firmware/espFlashLocation.js";
import type { AsarHeaderAdmission } from "../../config/asarHeaderAdmission.js";
import {
  artifactInventoryResultSchema,
  type ArtifactInventoryResult,
} from "../../domain/artifactGraph.js";
import { ProviderCleanupError } from "../../domain/providerCleanupError.js";
import { err, ok, type Result } from "../../domain/result.js";
import { javaScriptWorkerMemoryLimitBytes } from "../../process/JavaScriptWorkerMemoryLimit.js";
import { PrivateRuntimeRoot } from "../../process/PrivateRuntimeRoot.js";
import { cleanupOwnedProcessGroup } from "../../process/ProcessOwnership.js";
import { prepareProcessOwnershipInspection } from "../../process/ProcessOwnershipObservation.js";
import {
  ProviderProcessSupervisor,
  spawnOwnedProviderProcess,
} from "../../process/ProviderProcess.js";
import { ProviderStartupDeadline } from "../../process/ProviderDeadline.js";
import {
  ARTIFACT_INVENTORY_WORKER_DEFAULTS as DEFAULTS,
  artifactInventoryWorkerMessageSchema,
  type ArtifactInventoryWorkerMessage,
  type ArtifactInventoryWorkerRung,
} from "./ArtifactInventoryWorkerProtocol.js";

const OPERATION = "inspect_artifact" as const;

/** Fork opt-in: `REA_ARTIFACT_INVENTORY_WORKER=1` isolates inventory in a worker. */
export const ARTIFACT_INVENTORY_WORKER_SETTING =
  "REA_ARTIFACT_INVENTORY_WORKER";

export const artifactInventoryWorkerSelected = (
  environment: Readonly<NodeJS.ProcessEnv>,
): boolean => environment[ARTIFACT_INVENTORY_WORKER_SETTING] === "1";

/** Plain-data inventory options forwarded to the worker's own scan. */
export interface ArtifactInventoryWorkerForwardedOptions {
  readonly expectedRootSha256?: string | undefined;
  readonly selectedPath?: string | undefined;
  readonly asarHeaderAdmission?: AsarHeaderAdmission | undefined;
  readonly espFlashSelection?: EspFlashSelection | undefined;
  readonly readerLimits?: ArtifactReaderLimits | undefined;
}

const forwardedInventoryOptions = (
  inventory: ArtifactInventoryWorkerForwardedOptions | undefined,
): Record<string, unknown> | undefined => {
  if (inventory === undefined) return undefined;
  const espFlash =
    inventory.espFlashSelection === undefined
      ? undefined
      : {
          ...(inventory.espFlashSelection.flashOffset === undefined
            ? {}
            : { flashOffset: inventory.espFlashSelection.flashOffset }),
          ...(inventory.espFlashSelection.partitionTableOffset === undefined
            ? {}
            : {
                partitionTableOffset:
                  inventory.espFlashSelection.partitionTableOffset,
              }),
        };
  return {
    ...(inventory.expectedRootSha256 === undefined
      ? {}
      : { expected_root_sha256: inventory.expectedRootSha256 }),
    ...(inventory.selectedPath === undefined
      ? {}
      : { selected_path: inventory.selectedPath }),
    ...(inventory.asarHeaderAdmission === undefined
      ? {}
      : { asar_header_admission: inventory.asarHeaderAdmission }),
    ...(espFlash === undefined ? {} : { esp_flash_selection: espFlash }),
    ...(inventory.readerLimits === undefined
      ? {}
      : { reader_limits: inventory.readerLimits }),
  };
};

export interface ArtifactInventoryWorkerOptions {
  readonly inputPath: string;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly integrityMode: "fail" | "record-and-continue";
  readonly inventory?: ArtifactInventoryWorkerForwardedOptions;
  readonly signal?: AbortSignal;
  readonly heapMb?: number;
  readonly timeoutMs?: number;
  readonly maxEntries?: number;
  readonly rungInterval?: number;
  readonly onRung?: (rung: ArtifactInventoryWorkerRung) => void;
  readonly entrypoint?: string;
  readonly launcher?: typeof spawnOwnedProviderProcess;
}

const filterEnvironment = (
  environment: Readonly<NodeJS.ProcessEnv>,
): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment))
    if (value !== undefined) result[key] = value;
  return result;
};

const isResourceOomFailure = (
  snapshot: ReturnType<ProviderProcessSupervisor["snapshot"]>,
): boolean => {
  if (snapshot.memoryLimitReached === true) return true;
  if (snapshot.signal === "SIGABRT" || snapshot.signal === "SIGKILL")
    return true;
  const stderr = snapshot.stderr.text.toLowerCase();
  return (
    stderr.includes("heap out of memory") ||
    stderr.includes("allocation failed") ||
    stderr.includes("out of memory")
  );
};

const rungDiagnostics = (
  lastRung: ArtifactInventoryWorkerRung | undefined,
): Readonly<Record<string, string | number>> | undefined =>
  lastRung === undefined
    ? undefined
    : {
        last_rung: lastRung.rung,
        last_label: lastRung.label,
        last_sha256: lastRung.sha256,
        ...(lastRung.nodes === undefined ? {} : { last_nodes: lastRung.nodes }),
        ...(lastRung.occurrences === undefined
          ? {}
          : { last_occurrences: lastRung.occurrences }),
        ...(lastRung.entries_processed === undefined
          ? {}
          : { last_entries_processed: lastRung.entries_processed }),
        ...(lastRung.last_path === undefined
          ? {}
          : { last_path: lastRung.last_path }),
      };

const reconstructWorkerError = (
  frame: Extract<ArtifactInventoryWorkerMessage, { kind: "error" }>,
  lastRung: ArtifactInventoryWorkerRung | undefined,
): AnalysisError => {
  const diagnostics = rungDiagnostics(lastRung);

  if (frame.category === "input")
    return new AnalysisInputError(OPERATION, {
      userMessage: frame.message,
      ...(diagnostics === undefined ? {} : { diagnostics }),
    });
  if (frame.category === "unsupported")
    return new AnalysisUnsupportedTargetError(
      OPERATION,
      frame.details ?? "target",
      frame.reason ?? frame.message,
      diagnostics === undefined ? undefined : { diagnostics },
    );
  if (frame.category === "resource") {
    const resource = (ANALYSIS_RESOURCE_KINDS as readonly string[]).includes(
      frame.reason ?? "",
    )
      ? (frame.reason as (typeof ANALYSIS_RESOURCE_KINDS)[number])
      : "memory";
    return new AnalysisResourceConstraintError(
      OPERATION,
      resource,
      frame.message,
      diagnostics ?? null,
    );
  }
  if (frame.category === "reader") {
    const reason =
      frame.reason === "format" ||
      frame.reason === "integrity" ||
      frame.reason === "limit" ||
      frame.reason === "path" ||
      frame.reason === "unavailable" ||
      frame.reason === "cancelled"
        ? frame.reason
        : "io";
    return new ArtifactOperationError(
      OPERATION,
      reason,
      undefined,
      frame.message,
      diagnostics === undefined ? undefined : { diagnostics },
    );
  }
  return new ArtifactOperationError(
    OPERATION,
    "io",
    undefined,
    frame.message,
    diagnostics === undefined ? undefined : { diagnostics },
  );
};

/**
 * Run canonical artifact inventory in an isolated supervised child process.
 * A worker crash, OOM, abort, or protocol error returns a typed AnalysisError
 * without crashing the host/MCP process.
 */
export const runArtifactInventoryInWorker = async (
  options: ArtifactInventoryWorkerOptions,
): Promise<Result<ArtifactInventoryResult, AnalysisError>> => {
  const heapMb = options.heapMb ?? DEFAULTS.heapMb;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const launcher = options.launcher ?? spawnOwnedProviderProcess;
  const entrypoint =
    options.entrypoint ??
    fileURLToPath(import.meta.resolve("#artifact-inventory-worker"));

  let root: PrivateRuntimeRoot | undefined;
  let supervisor: ProviderProcessSupervisor | undefined;
  let deadline: ProviderStartupDeadline | undefined;
  let lastRung: ArtifactInventoryWorkerRung | undefined;
  let failure: AnalysisError | undefined;

  try {
    if (options.signal?.aborted === true)
      return err(new AnalysisCancelledError(OPERATION));

    await prepareProcessOwnershipInspection(options.signal);
    deadline = new ProviderStartupDeadline(timeoutMs, options.signal);
    root = await PrivateRuntimeRoot.create({
      prefix: "rea-artifact-inventory-",
    });

    const hostEnv: NodeJS.ProcessEnv = {
      ...process.env,
      UV_THREADPOOL_SIZE: "1",
    };
    delete hostEnv.NODE_OPTIONS;

    const memoryLimitBytes = javaScriptWorkerMemoryLimitBytes(heapMb);
    const spawned = await launcher({
      command: process.execPath,
      arguments: [
        `--max-old-space-size=${String(heapMb)}`,
        "--v8-pool-size=1",
        entrypoint,
      ],
      runId: `artifact-inventory-${randomUUID()}`,
      cwd: root.path,
      hostEnvironment: hostEnv,
      stdin: "pipe",
      ...(memoryLimitBytes === null ? {} : { memoryLimitBytes }),
      signal: deadline.signal,
    });

    supervisor = new ProviderProcessSupervisor(
      {
        ...spawned,
        ownsProcessLifetime: true,
        cleanup:
          spawned.cleanup ??
          (() => cleanupOwnedProcessGroup(spawned.ownership)),
      },
      { captureStdout: false, maxDiagnosticBytes: 256 * 1024 },
    );

    const frames: ArtifactInventoryWorkerMessage[] = [];
    let pending = "";
    let protocolFailure: string | undefined;
    let streamClosed = false;
    let wakeWaiter: (() => void) | undefined;
    const notify = (): void => {
      const wake = wakeWaiter;
      wakeWaiter = undefined;
      wake?.();
    };

    const onStdout = (chunk: Buffer | string): void => {
      pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (Buffer.byteLength(pending) > DEFAULTS.protocolBytes * 2) {
        protocolFailure =
          "Artifact inventory worker control stream exceeded frame budget";
        notify();
        return;
      }
      for (;;) {
        const newline = pending.indexOf("\n");
        if (newline < 0) break;
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.trim() === "") continue;
        try {
          const parsed = artifactInventoryWorkerMessageSchema.parse(
            JSON.parse(line),
          );
          frames.push(parsed);
        } catch (cause: unknown) {
          protocolFailure = `Artifact inventory worker emitted invalid frame: ${
            cause instanceof Error ? cause.message : String(cause)
          }`;
        }
      }
      notify();
    };

    const onStdoutClose = (): void => {
      streamClosed = true;
      notify();
    };

    const onAbort = (): void => {
      notify();
    };

    spawned.process.stdout?.on("data", onStdout);
    spawned.process.stdout?.once("close", onStdoutClose);
    spawned.process.once("exit", onStdoutClose);
    deadline.signal.addEventListener("abort", onAbort, { once: true });

    const nextFrame = async (
      phase: string,
    ): Promise<ArtifactInventoryWorkerMessage> => {
      for (;;) {
        if (deadline?.interruption === "cancelled")
          throw new AnalysisCancelledError(OPERATION);
        if (deadline?.interruption === "timeout")
          throw new AnalysisTimeoutError(OPERATION, timeoutMs);
        if (protocolFailure !== undefined)
          throw new AnalysisOutputError(OPERATION, protocolFailure);
        const frame = frames.shift();
        if (frame !== undefined) return frame;
        if (streamClosed || supervisor?.observedExit() !== undefined) {
          const snapshot = supervisor?.snapshot();
          if (snapshot !== undefined && isResourceOomFailure(snapshot)) {
            throw new AnalysisResourceConstraintError(
              OPERATION,
              "memory",
              `Artifact inventory worker exceeded memory limit during ${phase} (exit=${String(snapshot.exitCode ?? "null")}, signal=${String(snapshot.signal ?? "null")})`,
              {
                heap_mb: heapMb,
                ...(lastRung === undefined
                  ? {}
                  : {
                      last_rung: lastRung.rung,
                      last_label: lastRung.label,
                      last_sha256: lastRung.sha256,
                    }),
              },
            );
          }
          const diagnostics = rungDiagnostics(lastRung);
          throw new ArtifactOperationError(
            OPERATION,
            "io",
            undefined,
            `Artifact inventory worker exited unexpectedly during ${phase} (exit=${String(snapshot?.exitCode ?? "null")}, signal=${String(snapshot?.signal ?? "null")})`,
            diagnostics === undefined ? undefined : { diagnostics },
          );
        }
        await new Promise<void>((resolve) => {
          wakeWaiter = resolve;
        });
      }
    };

    try {
      const ready = await nextFrame("worker startup");
      if (ready.kind !== "ready")
        throw new AnalysisOutputError(
          OPERATION,
          "Artifact inventory worker emitted non-ready frame during startup",
        );

      const requestId = randomUUID();
      const inventoryOptions = forwardedInventoryOptions(options.inventory);
      const resultFile = `${requestId}.result.json`;
      const requestLine = `${JSON.stringify({
        id: requestId,
        input_path: options.inputPath,
        integrity_mode: options.integrityMode,
        environment: filterEnvironment(options.environment),
        result_file: resultFile,
        ...(options.maxEntries === undefined
          ? {}
          : { max_entries: options.maxEntries }),
        ...(options.rungInterval === undefined
          ? {}
          : { rung_interval: options.rungInterval }),
        ...(inventoryOptions === undefined
          ? {}
          : { inventory: inventoryOptions }),
      })}\n`;

      const stdin = spawned.process.stdin;
      if (stdin === null || stdin === undefined)
        throw new AnalysisOutputError(
          OPERATION,
          "Artifact inventory worker stdin is unavailable",
        );

      await new Promise<void>((resolve, reject) => {
        stdin.write(requestLine, (writeError) =>
          writeError === null || writeError === undefined
            ? resolve()
            : reject(writeError),
        );
      });
      stdin.end();

      for (;;) {
        const frame = await nextFrame("inventory");
        if (frame.kind === "rung") {
          if (frame.id === requestId) {
            lastRung = frame;
            options.onRung?.(frame);
          }
          continue;
        }
        if (frame.kind === "error") {
          return err(reconstructWorkerError(frame, lastRung));
        }
        if (frame.kind === "completed") {
          if (frame.id !== requestId)
            throw new AnalysisOutputError(
              OPERATION,
              "Artifact inventory worker completed a mismatched request id",
            );
          const payloadBytes = await readFile(
            join(root.path, frame.result_file),
          );
          const actualSha256 = createHash("sha256")
            .update(payloadBytes)
            .digest("hex");
          if (actualSha256 !== frame.sha256)
            throw new AnalysisOutputError(
              OPERATION,
              `Artifact inventory worker result SHA-256 mismatch (expected ${frame.sha256}, got ${actualSha256})`,
            );
          const parsed = artifactInventoryResultSchema.parse(
            JSON.parse(payloadBytes.toString("utf8")),
          );
          return ok(parsed);
        }
      }
    } finally {
      spawned.process.stdout?.off("data", onStdout);
      spawned.process.stdout?.off("close", onStdoutClose);
      spawned.process.off("exit", onStdoutClose);
      deadline.signal.removeEventListener("abort", onAbort);
    }
  } catch (cause: unknown) {
    if (
      cause instanceof AnalysisCancelledError ||
      cause instanceof AnalysisTimeoutError ||
      cause instanceof AnalysisOutputError ||
      cause instanceof AnalysisResourceConstraintError ||
      cause instanceof AnalysisInputError ||
      cause instanceof AnalysisUnsupportedTargetError ||
      cause instanceof ArtifactOperationError
    ) {
      failure = cause;
    } else {
      failure = new ArtifactOperationError(
        OPERATION,
        "io",
        undefined,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
    return err(failure);
  } finally {
    let cleanupError: ProviderCleanupError | undefined;
    if (supervisor !== undefined) {
      try {
        const stopped = await supervisor.stop();
        supervisor.dispose();
        if (stopped.status === "incomplete")
          cleanupError = new ProviderCleanupError(
            "artifact-graph",
            ["artifact-inventory-worker-process"],
            { reason: stopped.reason },
            { operation: OPERATION },
          );
      } catch (cause: unknown) {
        cleanupError = new ProviderCleanupError(
          "artifact-graph",
          ["artifact-inventory-worker-process"],
          {
            error: cause instanceof Error ? cause.message : String(cause),
          },
          { operation: OPERATION },
        );
      }
    }
    if (root !== undefined) {
      try {
        await root.close();
      } catch (cause: unknown) {
        cleanupError ??= new ProviderCleanupError(
          "artifact-graph",
          ["artifact-inventory-worker-runtime-root"],
          {
            error: cause instanceof Error ? cause.message : String(cause),
          },
          { operation: OPERATION },
        );
      }
    }
    if (cleanupError !== undefined && failure === undefined) {
      return err(cleanupError);
    }
  }
};

/**
 * Progressive rung-aware artifact inventory runner: streams chained rung
 * checkpoints during traversal and, if the worker hits a memory or timeout
 * limit after completing at least one rung, steps cleanly back to the last
 * proven entry budget in a fresh isolated worker so partial coverage survives.
 */
export const runArtifactInventoryLadder = async (
  options: ArtifactInventoryWorkerOptions,
): Promise<Result<ArtifactInventoryResult, AnalysisError>> => {
  let lastProvenRung: ArtifactInventoryWorkerRung | undefined;
  const firstAttempt = await runArtifactInventoryInWorker({
    ...options,
    onRung: (rung) => {
      if ((rung.entries_processed ?? 0) > 0) lastProvenRung = rung;
      options.onRung?.(rung);
    },
  });
  if (firstAttempt.ok) return firstAttempt;

  const isRecoverableResourceLimit =
    firstAttempt.error instanceof AnalysisResourceConstraintError ||
    firstAttempt.error instanceof AnalysisTimeoutError;
  const safeEntryBudget = lastProvenRung?.entries_processed;
  if (
    !isRecoverableResourceLimit ||
    safeEntryBudget === undefined ||
    safeEntryBudget <= 0 ||
    options.maxEntries !== undefined ||
    options.signal?.aborted === true
  ) {
    return firstAttempt;
  }

  const boundedAttempt = await runArtifactInventoryInWorker({
    ...options,
    maxEntries: safeEntryBudget,
  });
  return boundedAttempt.ok ? boundedAttempt : firstAttempt;
};
