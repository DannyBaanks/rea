/**
 * Classic Malbolge engine ported from the canonical ISyCo interpreter
 * (`workspace/assembly/malbolge/malbolge_interpreter.py`), which documents
 * validation against the reference "Hello, world." program (HALT at 48
 * steps). The port is deliberately literal: same memory fill (lazy crazy
 * chain from the last two program cells), same instruction decode
 * `(cell + position) % 94`, same post-instruction encryption, and the same
 * step accounting, so traces stay bit-comparable with the Python oracle.
 */

export const MALBOLGE_MEMORY_SIZE = 3 ** 10; // 59049 ten-trit words

const ORIGINAL_ALPHABET =
  "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
const TRANSLATED_ALPHABET =
  "5z]&gqtyfr$(we4{WP)H-Zn,[%\\3dL+Q;>U!pJS72FhOA1CB6v^=I_0/8|jsb9m<.TVac`uY*MK'X~xDl}REokN:#?G\"i@";

if (ORIGINAL_ALPHABET.length !== 94 || TRANSLATED_ALPHABET.length !== 94) {
  throw new Error("Malbolge translation alphabets must both be 94 characters");
}

/** Self-encryption applied to the word just after an instruction executes. */
const ENCRYPTION: readonly number[] = ORIGINAL_ALPHABET.split("").map(
  (character, index) => TRANSLATED_ALPHABET.charCodeAt(index),
);

/** Crazy operation truth table indexed as CRAZY[y_trit][x_trit]. */
const CRAZY: readonly (readonly number[])[] = [
  [1, 0, 0],
  [1, 0, 2],
  [2, 2, 1],
];

export const crazyOperation = (x: number, y: number): number => {
  let result = 0;
  let power = 1;
  let left = x;
  let right = y;
  for (let trit = 0; trit < 10; trit += 1) {
    result += (CRAZY[right % 3]?.[left % 3] ?? 0) * power;
    left = Math.floor(left / 3);
    right = Math.floor(right / 3);
    power *= 3;
  }
  return result;
};

/** Bounded cell read; typed-array indexing stays explicit under strict flags. */
const readCell = (memory: Int32Array, index: number): number =>
  memory[index] ?? 0;

/** Rotate one ten-trit word right by a single trit. */
export const rotateRight = (value: number): number =>
  Math.floor(value / 3) + (value % 3) * 3 ** 9;

/** The decoded instruction number at one position. */
export const instructionAt = (cell: number, position: number): number =>
  (cell + position) % 94;

/** Mnemonic for a decoded instruction number; unknown numbers are nops. */
export const instructionName = (opcode: number): MalbolgeOpcode =>
  opcode === 4
    ? "jmp"
    : opcode === 5
      ? "out"
      : opcode === 23
        ? "in"
        : opcode === 39
          ? "rotate"
          : opcode === 40
            ? "movd"
            : opcode === 62
              ? "crazy"
              : opcode === 68
                ? "nop"
                : opcode === 81
                  ? "halt"
                  : "nop";

export type MalbolgeOpcode =
  | "jmp"
  | "out"
  | "in"
  | "rotate"
  | "movd"
  | "crazy"
  | "nop"
  | "halt";

export type MalbolgeRunStatus = "HALTED" | "MAX_STEPS" | "INVALID";

export interface MalbolgeStepEvent {
  readonly step: number;
  readonly position: number;
  readonly opcode: number;
  readonly opcode_name: MalbolgeOpcode;
  readonly a: number;
  readonly d: number;
}

export interface MalbolgeRunResult {
  readonly output_bytes: readonly number[];
  readonly steps: number;
  readonly status: MalbolgeRunStatus;
  readonly invalid_reason: string | null;
  readonly events: readonly MalbolgeStepEvent[];
  readonly events_truncated: boolean;
  readonly executed_positions: ReadonlySet<number>;
  readonly peak_position: number;
}

const isSpace = (character: string): boolean =>
  " \t\n\r\f\v".includes(character);

export interface MalbolgeRunOptions {
  readonly maxSteps: number;
  readonly inputText?: string;
  readonly eventCaptureLimit?: number;
}

/**
 * Load a program exactly like the canonical interpreter: whitespace is
 * skipped, each remaining character must be printable ASCII (33..126), and
 * the rest of memory is the crazy chain grown from the final two program
 * cells. Programs shorter than two cells cannot seed the chain and are
 * rejected as invalid.
 */
export const loadMalbolgeMemory = (
  source: string,
):
  | { readonly memory: Int32Array; readonly programLength: number }
  | {
      readonly invalidReason: string;
    } => {
  const characters = [...source].filter((character) => !isSpace(character));
  for (let index = 0; index < characters.length; index += 1) {
    const code = characters[index]?.charCodeAt(0) ?? 0;
    if (code < 33 || code > 126)
      return {
        invalidReason: `non-printable source character at index ${index}: ${code}`,
      };
  }
  if (characters.length < 2)
    return { invalidReason: "program needs at least two loaded cells" };
  if (characters.length > MALBOLGE_MEMORY_SIZE)
    return { invalidReason: "program exceeds the 59049-word address space" };
  const memory = new Int32Array(MALBOLGE_MEMORY_SIZE);
  for (let index = 0; index < characters.length; index += 1)
    memory[index] = characters[index]?.charCodeAt(0) ?? 0;
  for (let index = characters.length; index < MALBOLGE_MEMORY_SIZE; index += 1)
    memory[index] = crazyOperation(
      readCell(memory, index - 1),
      readCell(memory, index - 2),
    );
  return { memory, programLength: characters.length };
};

/**
 * Execute one bounded run of Classic Malbolge. `executed_positions` is only
 * tracked within the program image; lazy memory beyond it is execution
 * scratch and is never reported as program data.
 */
export const runMalbolge = (
  source: string,
  options: MalbolgeRunOptions,
): MalbolgeRunResult => {
  const loaded = loadMalbolgeMemory(source);
  if (!("memory" in loaded))
    return {
      output_bytes: [],
      steps: 0,
      status: "INVALID",
      invalid_reason: loaded.invalidReason,
      events: [],
      events_truncated: false,
      executed_positions: new Set(),
      peak_position: 0,
    };
  const memory = loaded.memory;
  const captureLimit = options.eventCaptureLimit ?? 0;
  const input = [...(options.inputText ?? "")];
  let inputIndex = 0;
  let a = 0;
  let c = 0;
  let d = 0;
  let steps = 0;
  let peakPosition = 0;
  let status: MalbolgeRunStatus = "MAX_STEPS";
  let invalidReason: string | null = null;
  const outputBytes: number[] = [];
  const events: MalbolgeStepEvent[] = [];
  const executed = new Set<number>();
  while (steps < options.maxSteps) {
    steps += 1;
    const cell = readCell(memory, c);
    const opcode = instructionAt(cell, c);
    executed.add(c);
    if (c > peakPosition) peakPosition = c;
    if (events.length < captureLimit)
      events.push({
        step: steps,
        position: c,
        opcode,
        opcode_name: instructionName(opcode),
        a,
        d,
      });
    let jumped = false;
    let jumpTarget = 0;
    if (opcode === 4) {
      jumpTarget = readCell(memory, d);
      jumped = true;
    } else if (opcode === 5) {
      outputBytes.push(a % 256);
    } else if (opcode === 23) {
      const next = inputIndex < input.length ? input[inputIndex] : undefined;
      a = next === undefined ? -1 : next.charCodeAt(0);
      if (next !== undefined) inputIndex += 1;
    } else if (opcode === 39) {
      const rotated = rotateRight(readCell(memory, d));
      memory[d] = rotated;
      a = rotated;
    } else if (opcode === 40) {
      d = readCell(memory, d);
    } else if (opcode === 62) {
      const crazied = crazyOperation(a, readCell(memory, d));
      memory[d] = crazied;
      a = crazied;
    } else if (opcode === 68) {
      // Canonical nop used by generated bootstrap blocks.
    } else if (opcode === 81) {
      status = "HALTED";
      break;
    }
    if (jumped) c = jumpTarget;
    const currentCell = readCell(memory, c);
    if (currentCell >= 33 && currentCell <= 126) {
      const translated = ENCRYPTION[currentCell - 33];
      if (translated !== undefined) memory[c] = translated;
    }
    c = (c + 1) % MALBOLGE_MEMORY_SIZE;
    d = (d + 1) % MALBOLGE_MEMORY_SIZE;
  }
  if (status === "MAX_STEPS")
    invalidReason = `step budget of ${options.maxSteps} reached before halt`;
  return {
    output_bytes: outputBytes,
    steps,
    status,
    invalid_reason: invalidReason,
    events,
    events_truncated: steps > events.length,
    executed_positions: executed,
    peak_position: peakPosition,
  };
};

/** Decode every program position without executing anything. */
export const decodeMalbolgeProgram = (
  source: string,
):
  | {
      readonly instructions: readonly {
        readonly position: number;
        readonly character: string;
        readonly character_code: number;
        readonly opcode: number;
        readonly opcode_name: MalbolgeOpcode;
      }[];
      readonly whitespace_skipped: number;
    }
  | { readonly invalidReason: string } => {
  let whitespaceSkipped = 0;
  const instructions: {
    position: number;
    character: string;
    character_code: number;
    opcode: number;
    opcode_name: MalbolgeOpcode;
  }[] = [];
  let position = 0;
  for (const character of source) {
    if (isSpace(character)) {
      whitespaceSkipped += 1;
      continue;
    }
    const code = character.charCodeAt(0);
    if (code < 33 || code > 126)
      return {
        invalidReason: `non-printable source character at index ${position}: ${code}`,
      };
    const opcode = instructionAt(code, position);
    instructions.push({
      position,
      character,
      character_code: code,
      opcode,
      opcode_name: instructionName(opcode),
    });
    position += 1;
  }
  if (instructions.length === 0)
    return { invalidReason: "program contains no instructions" };
  return { instructions, whitespace_skipped: whitespaceSkipped };
};

export interface MalbolgeStructureSpan {
  readonly start: number;
  readonly end: number;
  readonly kind: "executed" | "data_candidate";
}

export interface MalbolgeDecompilation {
  readonly family: "translator_bootstrap" | "unknown";
  readonly bootstrap: { readonly jump_target: number } | null;
  readonly output_text: string;
  readonly executed_positions: number;
  readonly program_length: number;
  readonly spans: readonly MalbolgeStructureSpan[];
  readonly run: MalbolgeRunResult;
}

const isNopOpcode = (opcode: number): boolean =>
  opcode === 68 || ![4, 5, 23, 39, 40, 62, 81].includes(opcode);

/**
 * Structure projection for one program. The translator-family heuristic
 * matches the generated bootstrap shape (a leading jump into a block of
 * canonical nops); it is a routing hint, never a proof of provenance.
 */
export const decompileMalbolge = (
  source: string,
  options: MalbolgeRunOptions,
): MalbolgeDecompilation | { readonly invalidReason: string } => {
  const decoded = decodeMalbolgeProgram(source);
  if (!("instructions" in decoded)) return decoded;
  const run = runMalbolge(source, options);
  if (run.status === "INVALID")
    return { invalidReason: run.invalid_reason ?? "invalid program" };
  const instructions = decoded.instructions;
  const bootstrapTarget = (() => {
    const first = instructions[0];
    if (!first || first.opcode_name !== "jmp") return null;
    const blockEnd = Math.min(100, instructions.length);
    for (let index = 1; index < blockEnd; index += 1) {
      const block = instructions[index];
      if (block === undefined || !isNopOpcode(block.opcode)) return null;
    }
    return instructions.length > blockEnd ? { jump_target: blockEnd } : null;
  })();
  const programLength = instructions.length;
  const spans: MalbolgeStructureSpan[] = [];
  for (let position = 0; position < programLength; position += 1) {
    const executed = run.executed_positions.has(position);
    const kind: MalbolgeStructureSpan["kind"] = executed
      ? "executed"
      : "data_candidate";
    const last = spans[spans.length - 1];
    if (last !== undefined && last.end === position - 1 && last.kind === kind) {
      spans[spans.length - 1] = { ...last, end: position };
    } else spans.push({ start: position, end: position, kind });
  }
  const outputText = Buffer.from(run.output_bytes).toString("latin1");
  return {
    family: bootstrapTarget === null ? "unknown" : "translator_bootstrap",
    bootstrap: bootstrapTarget,
    output_text: outputText,
    executed_positions: [...run.executed_positions].filter(
      (position) => position < programLength,
    ).length,
    program_length: programLength,
    spans,
    run,
  };
};
