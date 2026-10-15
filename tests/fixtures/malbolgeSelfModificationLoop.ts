/**
 * Two-byte self-modification loop: 'b' decodes to jmp at position 0
 * ((98 + 0) % 94 == 4) and lands in the lazy crazy chain. The run revisits
 * position 29503 seven times; between visits the post-instruction
 * encryption rewrites that cell, so the revisits decode as distinct opcodes
 * (21, 15, 50, 30, 23, 25, 6) — the fifth visit is an `in`. Gate: HALTED at
 * 392 steps with no output, 137 recorded memory writes.
 */
export const SELF_MODIFICATION_LOOP_SOURCE = 'b"';
