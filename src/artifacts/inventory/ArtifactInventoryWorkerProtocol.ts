import { z } from "zod";

import { artifactReaderLimitsSchema } from "../../domain/artifactReaderLimits.js";

export const ARTIFACT_INVENTORY_WORKER_DEFAULTS = {
  heapMb: 1024,
  timeoutMs: 120_000,
  protocolBytes: 256 * 1024,
  maxResultBytes: 256 * 1024 * 1024,
} as const;

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const admissionSourceSchema = z.enum(["default", "setting", "runtime"]);

export const artifactInventoryWorkerRequestSchema = z.object({
  id: z.string().min(1),
  input_path: z.string().min(1),
  integrity_mode: z.enum(["fail", "record-and-continue"]),
  environment: z.record(z.string(), z.string()),
  result_file: z.string().min(1),
  max_entries: z.number().int().positive().optional(),
  rung_interval: z.number().int().positive().optional(),
  /** Caller-owned inventory options the parent resolved; all plain data. */
  inventory: z
    .strictObject({
      expected_root_sha256: sha256HexSchema.optional(),
      selected_path: z.string().min(1).optional(),
      asar_header_admission: z
        .strictObject({
          maximumBytes: z.number().int().positive(),
          source: admissionSourceSchema,
          listing: z
            .strictObject({
              maximumBytes: z.number().int().positive(),
              source: admissionSourceSchema,
            })
            .exactOptional(),
        })
        .optional(),
      esp_flash_selection: z
        .strictObject({
          flashOffset: z.number().int().nonnegative().exactOptional(),
          partitionTableOffset: z.number().int().nonnegative().exactOptional(),
        })
        .optional(),
      reader_limits: artifactReaderLimitsSchema.optional(),
    })
    .optional(),
});

export type ArtifactInventoryWorkerRequest = z.infer<
  typeof artifactInventoryWorkerRequestSchema
>;

export const artifactInventoryWorkerReadySchema = z.object({
  kind: z.literal("ready"),
  heap_limit_bytes: z.number().int().nonnegative().nullable(),
});

export const artifactInventoryWorkerRungSchema = z.object({
  kind: z.literal("rung"),
  id: z.string().min(1),
  rung: z.number().int().nonnegative(),
  label: z.string().min(1),
  sha256: sha256HexSchema,
  nodes: z.number().int().nonnegative().optional(),
  occurrences: z.number().int().nonnegative().optional(),
  entries_processed: z.number().int().nonnegative().optional(),
  last_path: z.string().optional(),
});

export type ArtifactInventoryWorkerRung = z.infer<
  typeof artifactInventoryWorkerRungSchema
>;

export const artifactInventoryWorkerCompletedSchema = z.object({
  kind: z.literal("completed"),
  id: z.string().min(1),
  result_file: z.string().min(1),
  sha256: sha256HexSchema,
  byte_length: z.number().int().nonnegative(),
});

export const artifactInventoryWorkerErrorSchema = z.object({
  kind: z.literal("error"),
  id: z.string().min(1),
  category: z.enum(["reader", "input", "unsupported", "resource", "io"]),
  reason: z.string().optional(),
  details: z.string().optional(),
  message: z.string().min(1),
});

export const artifactInventoryWorkerMessageSchema = z.discriminatedUnion(
  "kind",
  [
    artifactInventoryWorkerReadySchema,
    artifactInventoryWorkerRungSchema,
    artifactInventoryWorkerCompletedSchema,
    artifactInventoryWorkerErrorSchema,
  ],
);

export type ArtifactInventoryWorkerMessage = z.infer<
  typeof artifactInventoryWorkerMessageSchema
>;
