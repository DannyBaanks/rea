import { z } from "zod";

import { digestSchema } from "../digests.js";
import { localPathStringSchema } from "../localPath.js";
import type { MalbolgeOpcode } from "./malbolgeClassic.js";

/** One exact local Malbolge source file, independent of any session target. */
export const inspectMalbolgeInputSchema = z.strictObject({
  path: localPathStringSchema.describe(
    "Absolute filesystem path to a UTF-8 Malbolge source file; whitespace lines are skipped like the canonical loader",
  ),
  instruction_limit: z
    .number()
    .int()
    .min(1)
    .max(4096)
    .default(512)
    .describe(
      "Maximum decoded program instructions returned in one response; stats always cover the whole file",
    ),
});

const malbolgeArtifactSchema = z.strictObject({
  path: localPathStringSchema,
  sha256: digestSchema,
  bytes: z.number().int().nonnegative(),
});

export const malbolgeOpcodeSchema = z.enum([
  "jmp",
  "out",
  "in",
  "rotate",
  "movd",
  "crazy",
  "nop",
  "halt",
] satisfies readonly MalbolgeOpcode[]);

export const malbolgeDecodedInstructionSchema = z.strictObject({
  position: z.number().int().nonnegative(),
  character: z.string(),
  character_code: z.number().int().min(33).max(126),
  opcode: z.number().int().min(0).max(93),
  opcode_name: malbolgeOpcodeSchema,
});

const malbolgeInstructionStatsSchema = z.strictObject({
  jmp: z.number().int().nonnegative(),
  out: z.number().int().nonnegative(),
  in: z.number().int().nonnegative(),
  rotate: z.number().int().nonnegative(),
  movd: z.number().int().nonnegative(),
  crazy: z.number().int().nonnegative(),
  nop: z.number().int().nonnegative(),
  halt: z.number().int().nonnegative(),
});

/** Static positional decode of one Malbolge source; nothing is executed. */
export const malbolgeInspectionSchema = z.strictObject({
  artifact: malbolgeArtifactSchema,
  program_length: z.number().int().nonnegative(),
  whitespace_skipped: z.number().int().nonnegative(),
  instructions: z.array(malbolgeDecodedInstructionSchema),
  instructions_truncated: z.boolean(),
  stats: malbolgeInstructionStatsSchema,
  limitations: z.array(z.string()),
});

export const traceMalbolgeInputSchema = z.strictObject({
  path: localPathStringSchema.describe(
    "Absolute filesystem path to a UTF-8 Malbolge source file",
  ),
  max_steps: z
    .number()
    .int()
    .min(1)
    .max(2_000_000)
    .default(100_000)
    .describe("Bounded step budget; the run stops and reports when exhausted"),
  input_text: z
    .string()
    .max(4096)
    .optional()
    .describe("Optional input consumed by `in` instructions in order"),
  event_capture_limit: z
    .number()
    .int()
    .min(0)
    .max(4096)
    .default(256)
    .describe(
      "Maximum step events retained inline; the run itself always uses the full step budget",
    ),
});

const malbolgeStepEventSchema = z.strictObject({
  step: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  opcode: z.number().int().min(0).max(93),
  opcode_name: malbolgeOpcodeSchema,
  a: z.number().int(),
  d: z.number().int().nonnegative(),
  writes: z
    .array(
      z.strictObject({
        position: z.number().int().nonnegative(),
        value_before: z.number().int(),
        value_after: z.number().int(),
      }),
    )
    .describe(
      "Memory writes observed during this step: explicit rotate/crazy stores plus the post-instruction self-encryption",
    ),
});

const malbolgeRunSchema = z.strictObject({
  steps: z.number().int().nonnegative(),
  status: z.enum(["HALTED", "MAX_STEPS", "INVALID"]),
  invalid_reason: z.string().nullable(),
  events_truncated: z.boolean(),
  peak_position: z.number().int().nonnegative(),
  writebacks: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "Total memory writes during the run: rotate/crazy stores plus post-instruction encryptions",
    ),
  representation_changes: z
    .number()
    .int()
    .nonnegative()
    .describe("Writes that actually altered the stored value"),
  state_digest_before: digestSchema.describe(
    "SHA-256 over the comma-joined 59049-word machine at load time",
  ),
  state_digest_after: digestSchema.describe(
    "SHA-256 over the comma-joined 59049-word machine at the stop",
  ),
});

/** Bounded in-process execution trace with the captured output text. */
export const malbolgeTraceSchema = z.strictObject({
  artifact: malbolgeArtifactSchema,
  execution_id: z
    .string()
    .uuid()
    .describe(
      "Identity of this traced execution: stable across every recorded transformation of the run",
    ),
  run: malbolgeRunSchema,
  output_text: z.string(),
  output_bytes: z.array(z.number().int().min(0).max(255)),
  events: z.array(malbolgeStepEventSchema),
  limitations: z.array(z.string()),
});

export const decompileMalbolgeInputSchema = z.strictObject({
  path: localPathStringSchema.describe(
    "Absolute filesystem path to a UTF-8 Malbolge source file",
  ),
  max_steps: z
    .number()
    .int()
    .min(1)
    .max(2_000_000)
    .default(200_000)
    .describe("Bounded step budget for the structural run"),
});

/** Structural projection: bootstrap family hint, output text and data spans. */
export const malbolgeDecompilationSchema = z.strictObject({
  artifact: malbolgeArtifactSchema,
  family: z.enum(["translator_bootstrap", "unknown"]),
  bootstrap: z
    .strictObject({ jump_target: z.number().int().positive() })
    .nullable(),
  output_text: z.string(),
  executed_positions: z.number().int().nonnegative(),
  program_length: z.number().int().nonnegative(),
  spans: z.array(
    z.strictObject({
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
      kind: z.enum(["executed", "data_candidate"]),
    }),
  ),
  run: malbolgeRunSchema,
  limitations: z.array(z.string()),
});

export type MalbolgeInspection = z.infer<typeof malbolgeInspectionSchema>;
export type MalbolgeTrace = z.infer<typeof malbolgeTraceSchema>;
export type MalbolgeDecompilationReport = z.infer<
  typeof malbolgeDecompilationSchema
>;
