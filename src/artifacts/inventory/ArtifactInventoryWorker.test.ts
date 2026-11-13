import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AnalysisCancelledError,
  AnalysisResourceConstraintError,
} from "../../domain/analysisErrorCore.js";
import { ArtifactOperationError } from "../../domain/artifactOperationError.js";
import type { ArtifactInventoryWorkerRung } from "./ArtifactInventoryWorkerProtocol.js";
import {
  runArtifactInventoryInWorker,
  runArtifactInventoryLadder,
} from "./ArtifactInventoryWorker.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "rea-artifact-worker-test-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined)
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("ArtifactInventoryWorker", () => {
  it("runs canonical artifact inventory in an isolated child process", async () => {
    const dir = await makeTempDir();
    const targetFile = join(dir, "sample.bin");
    await writeFile(targetFile, Buffer.from("hello rea worker\n", "utf8"));

    const result = await runArtifactInventoryInWorker({
      inputPath: targetFile,
      environment: process.env,
      integrityMode: "record-and-continue",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.length).toBeGreaterThanOrEqual(1);
    expect(result.value.occurrences.length).toBeGreaterThanOrEqual(1);
    expect(result.value.manifest).toBeDefined();
  });

  it("preserves last completed rung as partialObservation when worker crashes", async () => {
    const dir = await makeTempDir();
    const targetFile = join(dir, "sample.bin");
    const mockWorker = join(dir, "crash-worker.mjs");
    await writeFile(targetFile, Buffer.from("abc", "utf8"));
    await writeFile(
      mockWorker,
      `
import { createInterface } from "node:readline";
process.stdout.write(JSON.stringify({ kind: "ready", heap_limit_bytes: 134217728 }) + "\\n");
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const req = JSON.parse(line);
  process.stdout.write(JSON.stringify({
    kind: "rung",
    id: req.id,
    rung: 2,
    label: "chunk-2",
    sha256: "a".repeat(64),
    nodes: 10,
    occurrences: 12
  }) + "\\n");
  process.exit(139);
});
`,
      "utf8",
    );

    const result = await runArtifactInventoryInWorker({
      inputPath: targetFile,
      environment: process.env,
      integrityMode: "record-and-continue",
      entrypoint: mockWorker,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ArtifactOperationError);
    expect(result.error.diagnostics).toEqual({
      last_rung: 2,
      last_label: "chunk-2",
      last_sha256: "a".repeat(64),
      last_nodes: 10,
      last_occurrences: 12,
    });
  });

  it("classifies worker OOM as AnalysisResourceConstraintError without crashing parent", async () => {
    const dir = await makeTempDir();
    const targetFile = join(dir, "sample.bin");
    const mockWorker = join(dir, "oom-worker.mjs");
    await writeFile(targetFile, Buffer.from("abc", "utf8"));
    await writeFile(
      mockWorker,
      `
import { createInterface } from "node:readline";
process.stdout.write(JSON.stringify({ kind: "ready", heap_limit_bytes: 134217728 }) + "\\n");
const rl = createInterface({ input: process.stdin });
rl.on("line", () => {
  process.stderr.write("FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory\\n");
  process.exit(134);
});
`,
      "utf8",
    );

    const result = await runArtifactInventoryInWorker({
      inputPath: targetFile,
      environment: process.env,
      integrityMode: "record-and-continue",
      entrypoint: mockWorker,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
    if (result.error instanceof AnalysisResourceConstraintError) {
      expect(result.error.resource).toBe("memory");
    }
  });

  it("returns AnalysisCancelledError when aborted before start", async () => {
    const dir = await makeTempDir();
    const targetFile = join(dir, "sample.bin");
    await writeFile(targetFile, Buffer.from("abc", "utf8"));
    const controller = new AbortController();
    controller.abort();

    const result = await runArtifactInventoryInWorker({
      inputPath: targetFile,
      environment: process.env,
      integrityMode: "record-and-continue",
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  });
});

const makeFiveFileCorpus = async (): Promise<{
  readonly dir: string;
  readonly corpus: string;
}> => {
  const dir = await makeTempDir();
  const corpus = join(dir, "corpus");
  await mkdir(corpus);
  for (let i = 1; i <= 5; i += 1) {
    await writeFile(join(corpus, `f${String(i)}.txt`), `file-${String(i)}`);
  }
  return { dir, corpus };
};

describe("ArtifactInventoryLadder", () => {
  it("streams progressive SHA-256-chained rungs and stops cleanly at maxEntries", async () => {
    const { corpus } = await makeFiveFileCorpus();

    const rungs: ArtifactInventoryWorkerRung[] = [];
    const full = await runArtifactInventoryInWorker({
      inputPath: corpus,
      environment: process.env,
      integrityMode: "record-and-continue",
      rungInterval: 2,
      onRung: (rung) => rungs.push(rung),
    });

    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.value.coverage.status).toBe("complete");
    expect(rungs.map((r) => r.rung)).toEqual([0, 1, 2, 3]);
    expect(rungs.map((r) => r.label)).toEqual([
      "root-directory",
      "entries-2",
      "entries-4",
      "inventory-complete",
    ]);
    expect(new Set(rungs.map((r) => r.sha256)).size).toBe(4);

    const exactCap = await runArtifactInventoryInWorker({
      inputPath: corpus,
      environment: process.env,
      integrityMode: "record-and-continue",
      maxEntries: 5,
    });
    expect(exactCap.ok).toBe(true);
    if (exactCap.ok) expect(exactCap.value.coverage.status).toBe("complete");

    const truncated = await runArtifactInventoryInWorker({
      inputPath: corpus,
      environment: process.env,
      integrityMode: "record-and-continue",
      maxEntries: 2,
    });
    expect(truncated.ok).toBe(true);
    if (!truncated.ok) return;
    expect(truncated.value.coverage.status).toBe("unknown");
    expect(
      truncated.value.limitations.some((line) =>
        line.includes("stopped at ladder cap (2 entries"),
      ),
    ).toBe(true);
    expect(truncated.value.occurrences.length).toBeLessThan(
      full.value.occurrences.length,
    );
  });

  it("recovers via bounded ladder worker after mid-scan OOM past rung 1", async () => {
    const { dir, corpus } = await makeFiveFileCorpus();

    const boundedBaseline = await runArtifactInventoryInWorker({
      inputPath: corpus,
      environment: process.env,
      integrityMode: "record-and-continue",
      maxEntries: 2,
    });
    expect(boundedBaseline.ok).toBe(true);
    if (!boundedBaseline.ok) return;

    const baselinePath = join(dir, "baseline.json");
    const baselineBytes = Buffer.from(
      JSON.stringify(boundedBaseline.value),
      "utf8",
    );
    await writeFile(baselinePath, baselineBytes);
    const baselineSha = createHash("sha256")
      .update(baselineBytes)
      .digest("hex");

    const ladderMockWorker = join(dir, "ladder-oom-worker.mjs");
    await writeFile(
      ladderMockWorker,
      `
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
process.stdout.write(JSON.stringify({ kind: "ready", heap_limit_bytes: 134217728 }) + "\\n");
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const req = JSON.parse(line);
  if (req.max_entries === undefined) {
    process.stdout.write(JSON.stringify({
      kind: "rung",
      id: req.id,
      rung: 1,
      label: "entries-2",
      sha256: "b".repeat(64),
      nodes: 2,
      occurrences: 2,
      entries_processed: 2
    }) + "\\n");
    process.stderr.write("FATAL ERROR: JavaScript heap out of memory\\n");
    process.exit(134);
  }
  const bytes = readFileSync(${JSON.stringify(baselinePath)});
  writeFileSync(join(process.cwd(), req.result_file), bytes, { mode: 0o600 });
  process.stdout.write(JSON.stringify({
    kind: "completed",
    id: req.id,
    result_file: req.result_file,
    sha256: ${JSON.stringify(baselineSha)},
    byte_length: bytes.byteLength
  }) + "\\n");
  process.exit(0);
});
`,
      "utf8",
    );

    const observedRungs: ArtifactInventoryWorkerRung[] = [];
    const recovered = await runArtifactInventoryLadder({
      inputPath: corpus,
      environment: process.env,
      integrityMode: "record-and-continue",
      entrypoint: ladderMockWorker,
      onRung: (r) => observedRungs.push(r),
    });

    expect(observedRungs.some((r) => r.entries_processed === 2)).toBe(true);
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.value.coverage.status).toBe("unknown");
    expect(
      recovered.value.limitations.some((line) =>
        line.includes("stopped at ladder cap (2 entries"),
      ),
    ).toBe(true);
  });
});
