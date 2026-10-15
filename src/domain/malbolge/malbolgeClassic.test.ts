import { describe, expect, it } from "vitest";

import {
  crazyOperation,
  decodeMalbolgeProgram,
  decompileMalbolge,
  instructionAt,
  instructionName,
  rotateRight,
  runMalbolge,
} from "./malbolgeClassic.js";
import { HELLO_WORLD_SOURCE } from "../../../tests/fixtures/malbolgeHelloWorld.js";

describe("Malbolge classic engine", () => {
  it("reproduces the golden Hello, world. run (48 steps, HALTED)", () => {
    const run = runMalbolge(HELLO_WORLD_SOURCE, {
      maxSteps: 1000,
      eventCaptureLimit: 64,
    });
    expect(run.status).toBe("HALTED");
    expect(run.steps).toBe(48);
    expect(Buffer.from(run.output_bytes).toString("latin1")).toBe(
      "Hello, world.",
    );
    expect(run.events).toHaveLength(48);
    expect(run.events_truncated).toBe(false);
    // '(' is 40 and (40 + 0) % 94 decodes to movd at the first step.
    expect(run.events[0]).toMatchObject({
      step: 1,
      position: 0,
      opcode: 40,
      opcode_name: "movd",
    });
  });

  it("stops and reports when the step budget is exhausted", () => {
    const run = runMalbolge(HELLO_WORLD_SOURCE, { maxSteps: 10 });
    expect(run.status).toBe("MAX_STEPS");
    expect(run.steps).toBe(10);
    expect(run.invalid_reason).toContain("step budget");
  });

  it("rejects non-printable, empty and too-short programs", () => {
    expect(runMalbolge("ok\u0001", { maxSteps: 10 }).status).toBe("INVALID");
    expect(runMalbolge("", { maxSteps: 10 }).status).toBe("INVALID");
    expect(runMalbolge("D", { maxSteps: 10 }).status).toBe("INVALID");
  });

  it("decodes every program position without executing anything", () => {
    const decoded = decodeMalbolgeProgram(HELLO_WORLD_SOURCE);
    expect("instructions" in decoded).toBe(true);
    if (!("instructions" in decoded)) return;
    expect(decoded.instructions).toHaveLength(88);
    expect(decoded.whitespace_skipped).toBe(0);
    expect(decoded.instructions[0]).toMatchObject({
      position: 0,
      character: "(",
      character_code: 40,
      opcode: 40,
      opcode_name: "movd",
    });
  });

  it("computes the crazy and rotate primitives exactly", () => {
    // Verified against the canonical Python interpreter: crz(1,0)=29523,
    // crz(0,0)=29524, crz(2,1)=29525 (per-trit truth table, high trits default).
    expect(crazyOperation(1, 0)).toBe(29523);
    expect(crazyOperation(0, 0)).toBe(29524);
    expect(crazyOperation(2, 1)).toBe(29525);
    expect(instructionName(instructionAt(40, 0))).toBe("movd");
    expect(rotateRight(1)).toBe(3 ** 9);
  });

  it("projects structure with an honest unknown family for the golden program", () => {
    const decompiled = decompileMalbolge(HELLO_WORLD_SOURCE, {
      maxSteps: 1000,
    });
    expect("family" in decompiled).toBe(true);
    if (!("family" in decompiled)) return;
    expect(decompiled.family).toBe("unknown");
    expect(decompiled.bootstrap).toBeNull();
    expect(decompiled.output_text).toBe("Hello, world.");
    expect(decompiled.program_length).toBe(88);
    expect(decompiled.executed_positions).toBeGreaterThan(0);
    expect(decompiled.spans.at(-1)?.end).toBe(87);
    expect(decompiled.run.status).toBe("HALTED");
  });

  it("detects a generated translator bootstrap shape", () => {
    // Position 0: 'b' decodes to jmp ((98 + 0) % 94 == 4). Positions 1..99
    // decode to canonical nops; each char is chosen so (c + p) % 94 == 68.
    const cells = ["b"];
    for (let position = 1; position <= 100; position += 1) {
      let code = (((68 - position) % 94) + 94) % 94;
      if (code < 33) code += 94;
      cells.push(String.fromCharCode(code));
    }
    const decompiled = decompileMalbolge(cells.join(""), { maxSteps: 200 });
    expect("family" in decompiled).toBe(true);
    if (!("family" in decompiled)) return;
    expect(decompiled.family).toBe("translator_bootstrap");
    expect(decompiled.bootstrap).toEqual({ jump_target: 100 });
  });
});
