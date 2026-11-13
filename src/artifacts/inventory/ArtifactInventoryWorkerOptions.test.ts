import { describe, expect, it } from "vitest";

import { parseConfig } from "../../config/parseConfig.js";
import {
  ARTIFACT_INVENTORY_WORKER_SETTING,
  artifactInventoryWorkerSelected,
} from "./ArtifactInventoryWorker.js";
import { artifactInventoryWorkerRequestSchema } from "./ArtifactInventoryWorkerProtocol.js";
import { resolveArtifactReaderLimits } from "../../domain/artifactReaderLimits.js";

const baseRequest = {
  id: "request-1",
  input_path: "/tmp/target.zip",
  integrity_mode: "fail" as const,
  environment: {},
  result_file: "request-1.result.json",
};

describe("artifact inventory worker selection (fork opt-in)", () => {
  it("keeps the in-process upstream path unless the setting is exactly 1", () => {
    expect(artifactInventoryWorkerSelected({})).toBe(false);
    expect(
      artifactInventoryWorkerSelected({
        [ARTIFACT_INVENTORY_WORKER_SETTING]: "0",
      }),
    ).toBe(false);
    expect(
      artifactInventoryWorkerSelected({
        [ARTIFACT_INVENTORY_WORKER_SETTING]: "1",
      }),
    ).toBe(true);
  });

  it("validates the setting at startup", () => {
    expect(parseConfig({ [ARTIFACT_INVENTORY_WORKER_SETTING]: "1" }).ok).toBe(
      true,
    );
    expect(parseConfig({ [ARTIFACT_INVENTORY_WORKER_SETTING]: "yes" }).ok).toBe(
      false,
    );
  });
});

describe("artifact inventory worker request", () => {
  it("carries every plain-data inventory option the parent resolved", () => {
    const inventory = {
      expected_root_sha256: "a".repeat(64),
      selected_path: "/tmp/selected.asar",
      asar_header_admission: {
        maximumBytes: 1024,
        source: "setting" as const,
        listing: { maximumBytes: 2048, source: "default" as const },
      },
      esp_flash_selection: { flashOffset: 0, partitionTableOffset: 32768 },
      reader_limits: resolveArtifactReaderLimits(),
    };
    const parsed = artifactInventoryWorkerRequestSchema.parse({
      ...baseRequest,
      inventory,
    });
    expect(parsed.inventory).toEqual(inventory);
  });

  it("refuses unknown or malformed forwarded options", () => {
    expect(
      artifactInventoryWorkerRequestSchema.safeParse({
        ...baseRequest,
        inventory: { expected_root_sha256: "not-a-digest" },
      }).success,
    ).toBe(false);
    expect(
      artifactInventoryWorkerRequestSchema.safeParse({
        ...baseRequest,
        inventory: { resource_scope: {} },
      }).success,
    ).toBe(false);
  });
});
