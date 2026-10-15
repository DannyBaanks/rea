import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { readFile } from "node:fs/promises";

import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
} from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../../domain/result.js";
import { PRODUCT_IDENTITY } from "../../identity.js";
import {
  decompileMalbolge,
  decodeMalbolgeProgram,
  type MalbolgeOpcode,
  runMalbolge,
} from "../../domain/malbolge/malbolgeClassic.js";
import {
  decompileMalbolgeInputSchema,
  inspectMalbolgeInputSchema,
  type MalbolgeDecompilationReport,
  type MalbolgeInspection,
  type MalbolgeTrace,
  traceMalbolgeInputSchema,
} from "../../domain/malbolge/malbolgeAnalysis.js";

const PROVIDER = {
  id: "rea-malbolge-classic",
  name: "REA Malbolge Classic engine",
  version: PRODUCT_IDENTITY.packageVersion,
} as const;

/** Read one bounded UTF-8 source file and its stable digest. */
const readSource = async (
  operation: string,
  path: string,
): Promise<
  Result<
    {
      readonly source: string;
      readonly sha256: string;
      readonly bytes: number;
    },
    AnalysisError
  >
> => {
  let raw: Buffer;
  try {
    raw = await readFile(path);
  } catch (cause) {
    return err(
      new AnalysisInputError(
        operation,
        {
          userMessage: `The selected Malbolge source could not be read: ${path}`,
          cause,
        },
        [
          {
            path: ["path"],
            reason: "invalid_format",
            message: `The selected file could not be read: ${path}`,
          },
        ],
      ),
    );
  }
  return ok({
    source: raw.toString("utf8"),
    sha256: createHash("sha256").update(raw).digest("hex"),
    bytes: raw.byteLength,
  });
};

/** Shared exact input validation and artifact-bound Evidence for CLI and MCP. */
export class MalbolgeService {
  /** Static positional decode; no target code is executed. */
  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const OPERATION = "inspect_malbolge";
    if (options?.signal?.aborted)
      return err(new AnalysisCancelledError(OPERATION));
    const input = inspectMalbolgeInputSchema.safeParse(rawInput);
    if (!input.success)
      return err(
        analysisInputErrorFromIssues(OPERATION, input.error.issues, rawInput, {
          cause: input.error,
        }),
      );
    if (!isAbsolute(input.data.path))
      return err(
        new AnalysisInputError(OPERATION, undefined, [
          {
            path: ["path"],
            reason: "invalid_format",
            message: "Expected an absolute filesystem path on this host.",
          },
        ]),
      );
    if (options?.signal?.aborted)
      return err(new AnalysisCancelledError(OPERATION));
    const read = await readSource(OPERATION, input.data.path);
    if (!read.ok) return read;
    const decoded = decodeMalbolgeProgram(read.value.source);
    if (!("instructions" in decoded))
      return err(
        new AnalysisInputError(
          OPERATION,
          { userMessage: decoded.invalidReason },
          [
            {
              path: ["path"],
              reason: "invalid_value",
              message: decoded.invalidReason,
            },
          ],
        ),
      );
    const stats: Record<MalbolgeOpcode, number> = {
      jmp: 0,
      out: 0,
      in: 0,
      rotate: 0,
      movd: 0,
      crazy: 0,
      nop: 0,
      halt: 0,
    };
    for (const instruction of decoded.instructions)
      stats[instruction.opcode_name] += 1;
    const limited = decoded.instructions.slice(0, input.data.instruction_limit);
    const value: MalbolgeInspection = {
      artifact: {
        path: input.data.path,
        sha256: read.value.sha256,
        bytes: read.value.bytes,
      },
      program_length: decoded.instructions.length,
      whitespace_skipped: decoded.whitespace_skipped,
      instructions: limited,
      instructions_truncated:
        decoded.instructions.length > input.data.instruction_limit,
      stats: {
        jmp: stats.jmp,
        out: stats.out,
        in: stats.in,
        rotate: stats.rotate,
        movd: stats.movd,
        crazy: stats.crazy,
        nop: stats.nop,
        halt: stats.halt,
      },
      limitations: [
        "The decode is positional: opcode values reflect (cell + position) % 94 before any runtime self-encryption.",
        "Opcode mnemonics are routing facts only; control flow and data require a bounded execution trace.",
      ],
    };
    return ok(
      createEvidence(
        {
          path: input.data.path,
          sha256: read.value.sha256,
          format: "file",
        },
        PROVIDER,
        {
          operation: OPERATION,
          parameters: input.data,
          result: value,
          confidence: "observed",
          limitations: value.limitations,
          locations: [{ kind: "artifact-path", path: input.data.path }],
        },
      ),
    );
  }

  /** Bounded in-process execution trace of one Malbolge program. */
  async trace(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const OPERATION = "trace_malbolge";
    if (options?.signal?.aborted)
      return err(new AnalysisCancelledError(OPERATION));
    const input = traceMalbolgeInputSchema.safeParse(rawInput);
    if (!input.success)
      return err(
        analysisInputErrorFromIssues(OPERATION, input.error.issues, rawInput, {
          cause: input.error,
        }),
      );
    if (!isAbsolute(input.data.path))
      return err(
        new AnalysisInputError(OPERATION, undefined, [
          {
            path: ["path"],
            reason: "invalid_format",
            message: "Expected an absolute filesystem path on this host.",
          },
        ]),
      );
    if (options?.signal?.aborted)
      return err(new AnalysisCancelledError(OPERATION));
    const read = await readSource(OPERATION, input.data.path);
    if (!read.ok) return read;
    const run = runMalbolge(read.value.source, {
      maxSteps: input.data.max_steps,
      ...(input.data.input_text === undefined
        ? {}
        : { inputText: input.data.input_text }),
      eventCaptureLimit: input.data.event_capture_limit,
    });
    if (run.status === "INVALID")
      return err(
        new AnalysisInputError(
          OPERATION,
          { userMessage: run.invalid_reason ?? "Invalid Malbolge program" },
          [
            {
              path: ["path"],
              reason: "invalid_value",
              message: run.invalid_reason ?? "Invalid Malbolge program",
            },
          ],
        ),
      );
    const value: MalbolgeTrace = {
      artifact: {
        path: input.data.path,
        sha256: read.value.sha256,
        bytes: read.value.bytes,
      },
      run: {
        steps: run.steps,
        status: run.status,
        invalid_reason: run.invalid_reason,
        events_truncated: run.events_truncated,
        peak_position: run.peak_position,
      },
      output_text: Buffer.from(run.output_bytes).toString("latin1"),
      output_bytes: [...run.output_bytes],
      events: run.events.map((event) => ({ ...event })),
      limitations: [
        "The trace replays Classic Malbolge semantics in a bounded in-process engine; memory past the program is the canonical crazy chain, never the host.",
        "Output text is decoded as latin-1 bytes, exactly as the canonical interpreter reports it.",
      ],
    };
    return ok(
      createEvidence(
        {
          path: input.data.path,
          sha256: read.value.sha256,
          format: "file",
        },
        PROVIDER,
        {
          operation: OPERATION,
          parameters: {
            path: input.data.path,
            max_steps: input.data.max_steps,
            ...(input.data.input_text === undefined
              ? {}
              : { input_text: input.data.input_text }),
            event_capture_limit: input.data.event_capture_limit,
          },
          result: value,
          confidence: "observed",
          limitations: value.limitations,
          locations: [{ kind: "artifact-path", path: input.data.path }],
        },
      ),
    );
  }

  /** Bootstrap-family hint, reconstructed output text and data spans. */
  async decompile(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const OPERATION = "decompile_malbolge";
    if (options?.signal?.aborted)
      return err(new AnalysisCancelledError(OPERATION));
    const input = decompileMalbolgeInputSchema.safeParse(rawInput);
    if (!input.success)
      return err(
        analysisInputErrorFromIssues(OPERATION, input.error.issues, rawInput, {
          cause: input.error,
        }),
      );
    if (!isAbsolute(input.data.path))
      return err(
        new AnalysisInputError(OPERATION, undefined, [
          {
            path: ["path"],
            reason: "invalid_format",
            message: "Expected an absolute filesystem path on this host.",
          },
        ]),
      );
    if (options?.signal?.aborted)
      return err(new AnalysisCancelledError(OPERATION));
    const read = await readSource(OPERATION, input.data.path);
    if (!read.ok) return read;
    const decompiled = decompileMalbolge(read.value.source, {
      maxSteps: input.data.max_steps,
    });
    if (!("family" in decompiled))
      return err(
        new AnalysisInputError(
          OPERATION,
          { userMessage: decompiled.invalidReason },
          [
            {
              path: ["path"],
              reason: "invalid_value",
              message: decompiled.invalidReason,
            },
          ],
        ),
      );
    const value = {
      artifact: {
        path: input.data.path,
        sha256: read.value.sha256,
        bytes: read.value.bytes,
      },
      family: decompiled.family,
      bootstrap: decompiled.bootstrap,
      output_text: decompiled.output_text,
      executed_positions: decompiled.executed_positions,
      program_length: decompiled.program_length,
      spans: decompiled.spans.map((span) => ({
        start: span.start,
        end: span.end,
        kind: span.kind,
      })),
      run: {
        steps: decompiled.run.steps,
        status: decompiled.run.status,
        invalid_reason: decompiled.run.invalid_reason,
        events_truncated: decompiled.run.events_truncated,
        peak_position: decompiled.run.peak_position,
      },
      limitations: [
        "This is a trace-based structural projection, not a universal Malbolge decompiler; arbitrary Classic Malbolge decompilation remains an open problem.",
        "The translator-family bootstrap detection is a routing heuristic (leading jump into a canonical nop block), never a provenance proof.",
        "Span classification assumes the bounded run reached every intended instruction; a run that exhausted its step budget leaves later positions unclassified.",
      ],
    } satisfies MalbolgeDecompilationReport;
    return ok(
      createEvidence(
        {
          path: input.data.path,
          sha256: read.value.sha256,
          format: "file",
        },
        PROVIDER,
        {
          operation: OPERATION,
          parameters: input.data,
          result: value,
          confidence: "observed",
          limitations: value.limitations,
          locations: [{ kind: "artifact-path", path: input.data.path }],
        },
      ),
    );
  }
}
