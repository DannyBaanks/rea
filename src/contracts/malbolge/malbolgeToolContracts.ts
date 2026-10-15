import { z } from "zod";

import {
  decompileMalbolgeInputSchema,
  inspectMalbolgeInputSchema,
  malbolgeDecompilationSchema,
  malbolgeInspectionSchema,
  malbolgeTraceSchema,
  traceMalbolgeInputSchema,
} from "../../domain/malbolge/malbolgeAnalysis.js";
import type { ToolContract } from "../toolContractTypes.js";
import { toolContractMetadata } from "../toolEffects.js";
import { requireOutputSchema } from "../toolOutputSchemaPrimitives.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";
import { examplesFor } from "../toolContractHelpers.js";

const malbolgeOutputSchemas = {
  inspect_malbolge: evidenceResultOf(malbolgeInspectionSchema),
  trace_malbolge: evidenceResultOf(malbolgeTraceSchema),
  decompile_malbolge: evidenceResultOf(malbolgeDecompilationSchema),
};

const malbolge = <
  Name extends keyof typeof malbolgeOutputSchemas & string,
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
    kind: "malbolge-provider",
    inputSchema,
    outputSchema: requireOutputSchema(malbolgeOutputSchemas, name),
    examples: examplesFor(name, inputSchema),
  }) satisfies ToolContract<Name, Schema>;

/** Classic Malbolge analysis family; semantics ported from the canonical interpreter. */
export const MALBOLGE_TOOL_CONTRACTS = [
  malbolge(
    "inspect_malbolge",
    "Decode one local Malbolge source file position by position without executing it: every loaded cell's character, its (cell + position) % 94 opcode and mnemonic, whitespace skipped, and per-opcode counts. Memory past the program follows the canonical crazy chain, so the listing is pre-encryption routing fact only; use trace_malbolge for control flow and output.",
    inspectMalbolgeInputSchema,
  ),
  malbolge(
    "trace_malbolge",
    "Run one local Malbolge program inside a bounded in-process Classic engine and return the execution trace: step events with position, opcode, data pointer and accumulator, the captured output text as latin-1 bytes, halt status, and step budget exhaustion as an explicit condition. The engine never touches the host beyond reading the selected file; self-encryption and lazy memory match the canonical interpreter.",
    traceMalbolgeInputSchema,
  ),
  malbolge(
    "decompile_malbolge",
    "Project one local Malbolge program into structure: translator-family bootstrap detection (a leading jump into a canonical nop block), reconstructed output text from a bounded run, executed versus data-candidate spans over the program image, and the run's halt facts. This is a trace-based structural projection, not a universal Malbolge decompiler; arbitrary Classic Malbolge lifting remains an open problem and stays explicit in the limitations.",
    decompileMalbolgeInputSchema,
  ),
] as const satisfies readonly ToolContract[];
