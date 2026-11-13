import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

import {
  annotateEnglishUnicodeCaseCollisions,
  ArtifactPathRegistry,
  normalizeArtifactPath,
} from "../ArtifactPaths.js";
import {
  ArtifactReaderFailure,
  type ArtifactEntry,
  type ArtifactReader,
  type ArtifactReaderTraversal,
  type ArtifactTraversalOmission,
} from "../ArtifactReader.js";
import { AsarArtifactReader } from "../AsarArtifactReader.js";
import type { ArtifactNode } from "../../domain/artifactGraph.js";
import { compareUnicodeCodePoints } from "../../domain/unicodeCodePointOrder.js";
import {
  classifyArtifactContent,
  classifyArtifactBytes,
  createArtifactNode,
  createOccurrence,
  noteUnreadContainerSuffix,
  indexOccurrencesByPath,
  resolveOccurrenceParents,
  type MutableOccurrence,
} from "./ArtifactGraphConstruction.js";
import {
  STRICT_INTEGRITY_POLICY,
  type ArtifactIntegrityPolicy,
  type ArtifactInventoryRungCheckpoint,
} from "./types.js";
import { hashReadable } from "../ArtifactHash.js";

export interface PendingIntegrityContradiction {
  readonly occurrence: MutableOccurrence;
  readonly declaredSha256: string;
  readonly observedSha256: string;
  readonly entryKind: "file" | "slice";
  readonly unpacked: boolean;
}

const UNAVAILABLE_UNPACKED_LIMITATION =
  "ASAR unpacked companion bytes were unavailable; no content hash or child artifact was produced.";

const emptyScan = (): {
  readonly nodes: Map<string, ArtifactNode>;
  readonly occurrences: MutableOccurrence[];
  readonly pendingContradictions: PendingIntegrityContradiction[];
} => ({ nodes: new Map(), occurrences: [], pendingContradictions: [] });

export interface ScanReaderLadderOptions {
  readonly maxEntries?: number | undefined;
  readonly rungInterval?: number | undefined;
  readonly onRung?:
    | ((checkpoint: ArtifactInventoryRungCheckpoint) => void | Promise<void>)
    | undefined;
}

const DEFAULT_RUNG_INTERVAL = 500;
const INITIAL_RUNG_CHAIN = "0".repeat(64);

const hashRungChain = (
  previousSha256: string,
  rung: number,
  entriesProcessed: number,
  nodes: number,
  occurrences: number,
  lastPath: string | undefined,
): string =>
  createHash("sha256")
    .update(
      `${previousSha256}:${String(rung)}:${String(entriesProcessed)}:${String(nodes)}:${String(occurrences)}:${lastPath ?? ""}`,
    )
    .digest("hex");

interface ScanContext {
  readonly reader: ArtifactReader;
  readonly signal: AbortSignal | undefined;
  readonly integrity: ArtifactIntegrityPolicy;
  readonly nodes: Map<string, ArtifactNode>;
  readonly occurrences: MutableOccurrence[];
  readonly pendingContradictions: PendingIntegrityContradiction[];
  readonly occurrenceCountByPath: Map<string, number>;
  readonly registry: ArtifactPathRegistry;
  readonly expandedContainerIds: Set<string>;
  readonly ownedReaders: ArtifactReader[];
  readonly omissions: ArtifactTraversalOmission[];
  readonly maxEntries: number | undefined;
  readonly rungInterval: number;
  readonly onRung:
    | ((checkpoint: ArtifactInventoryRungCheckpoint) => void | Promise<void>)
    | undefined;
  entriesProcessed: number;
  rungIndex: number;
  rungChainSha256: string;
  ladderLimitation: string | undefined;
}

export const scanReader = async (
  reader: ArtifactReader | undefined,
  ownedReaders: ArtifactReader[],
  signal?: AbortSignal,
  integrity: ArtifactIntegrityPolicy = STRICT_INTEGRITY_POLICY,
  ladder: ScanReaderLadderOptions = {},
): Promise<{
  readonly nodes: Map<string, ArtifactNode>;
  readonly occurrences: MutableOccurrence[];
  readonly pendingContradictions: PendingIntegrityContradiction[];
  readonly caseCollisionLimitation: string | undefined;
  readonly unknownParentOccurrences: ReadonlySet<MutableOccurrence>;
  readonly traversal: ArtifactReaderTraversal;
}> => {
  const { nodes, occurrences, pendingContradictions } = emptyScan();
  if (reader === undefined)
    return {
      nodes,
      occurrences,
      pendingContradictions,
      caseCollisionLimitation: undefined,
      unknownParentOccurrences: new Set(),
      traversal: { status: "complete", limitations: [] },
    };
  const context: ScanContext = {
    reader,
    signal,
    integrity,
    nodes,
    occurrences,
    pendingContradictions,
    occurrenceCountByPath: new Map<string, number>(),
    registry: new ArtifactPathRegistry(),
    expandedContainerIds: new Set<string>(),
    ownedReaders,
    omissions: [],
    maxEntries: ladder.maxEntries,
    rungInterval: Math.max(1, ladder.rungInterval ?? DEFAULT_RUNG_INTERVAL),
    onRung: ladder.onRung,
    entriesProcessed: 0,
    rungIndex: 0,
    rungChainSha256: INITIAL_RUNG_CHAIN,
    ladderLimitation: undefined,
  };
  await visitArtifactEntries(context, reader, "");
  // Archive directories may appear after their children. Resolve containment
  // against the complete index before directory identities are materialized.
  const byPath = indexOccurrencesByPath(occurrences);
  const parentResolution = resolveOccurrenceParents(
    occurrences,
    byPath,
    context.expandedContainerIds,
  );
  const structuralLimitations = [
    ...parentResolution.limitations,
    ...(context.ladderLimitation === undefined
      ? []
      : [context.ladderLimitation]),
  ];
  return {
    nodes,
    occurrences,
    pendingContradictions,
    caseCollisionLimitation: annotateEnglishUnicodeCaseCollisions(occurrences),
    unknownParentOccurrences: parentResolution.unknownParentOccurrences,
    traversal: {
      status:
        context.omissions.length === 0 && structuralLimitations.length === 0
          ? "complete"
          : "unknown",
      limitations: [
        ...new Set([
          ...context.omissions.map(
            ({ path, kind }) =>
              `Artifact traversal omitted ${kind} at ${JSON.stringify(path)}.`,
          ),
          ...structuralLimitations,
        ]),
      ].sort(compareUnicodeCodePoints),
    },
  };
};

const inventoryEntries = (
  context: ScanContext,
  reader: ArtifactReader,
  prefix: string,
): AsyncIterator<ArtifactEntry> =>
  reader
    .entries(context.signal, {
      onOmission: (omission) =>
        context.omissions.push({
          ...omission,
          path: normalizeArtifactPath(
            prefix.length === 0 ? omission.path : `${prefix}/${omission.path}`,
          ),
        }),
    })
    [Symbol.asyncIterator]();

const visitArtifactEntries = async (
  context: ScanContext,
  currentReader: ArtifactReader,
  prefix: string,
): Promise<void> => {
  const stack: Array<{
    readonly reader: ArtifactReader;
    readonly prefix: string;
    readonly iterator: AsyncIterator<ArtifactEntry>;
  }> = [
    {
      reader: currentReader,
      prefix,
      iterator: inventoryEntries(context, currentReader, prefix),
    },
  ];
  let failure: { readonly cause: unknown } | undefined;
  try {
    while (stack.length > 0) {
      const frame = stack.at(-1);
      if (frame === undefined) break;
      const next = await frame.iterator.next();
      if (next.done) {
        stack.pop();
        continue;
      }
      if (
        context.maxEntries !== undefined &&
        context.entriesProcessed >= context.maxEntries
      ) {
        context.ladderLimitation = `Artifact traversal stopped at ladder cap (${String(context.maxEntries)} entries; remaining entries starting at ${JSON.stringify(frame.prefix.length === 0 ? next.value.path : `${frame.prefix}/${next.value.path}`)} were omitted).`;
        break;
      }
      const entry = next.value;
      const logicalPath = normalizeArtifactPath(
        frame.prefix.length === 0
          ? entry.path
          : `${frame.prefix}/${entry.path}`,
      );
      const expandableAsar = isExpandableAsar(entry, logicalPath);
      context.registry.add(
        logicalPath,
        expandableAsar ? "directory" : entry.kind,
      );
      const duplicateOrdinal =
        context.occurrenceCountByPath.get(logicalPath) ?? 0;
      context.occurrenceCountByPath.set(logicalPath, duplicateOrdinal + 1);
      const occurrence = createOccurrence(
        entry,
        logicalPath,
        null,
        duplicateOrdinal,
      );
      let digested:
        | {
            readonly node: ArtifactNode;
            readonly mismatched: boolean;
            readonly classification: ReturnType<typeof classifyArtifactContent>;
          }
        | undefined;
      try {
        digested = await digestArtifactEntry(
          context,
          frame.reader,
          entry,
          logicalPath,
          occurrence,
        );
      } catch (cause: unknown) {
        if (!isUnavailableUnpackedEntry(cause, entry)) throw cause;
        occurrence.hash_status = "unavailable";
        occurrence.limitations.push(UNAVAILABLE_UNPACKED_LIMITATION);
      }
      if (digested === undefined) noteUnreadContainerSuffix(occurrence);
      else {
        context.nodes.set(digested.node.artifact_id, digested.node);
        occurrence.artifact_id = digested.node.artifact_id;
        occurrence.artifact_kind = digested.classification.kind;
        occurrence.artifact_format = digested.classification.format;
        occurrence.hash_status = digested.mismatched
          ? "mismatched"
          : "verified";
        if (digested.mismatched)
          occurrence.limitations.push(
            "Declared integrity metadata contradicts observed bytes.",
          );
      }
      context.occurrences.push(occurrence);
      context.entriesProcessed += 1;
      if (
        context.onRung !== undefined &&
        context.entriesProcessed % context.rungInterval === 0
      ) {
        context.rungIndex += 1;
        context.rungChainSha256 = hashRungChain(
          context.rungChainSha256,
          context.rungIndex,
          context.entriesProcessed,
          context.nodes.size,
          context.occurrences.length,
          logicalPath,
        );
        await context.onRung({
          rung: context.rungIndex,
          label: `entries-${String(context.entriesProcessed)}`,
          sha256: context.rungChainSha256,
          nodes: context.nodes.size,
          occurrences: context.occurrences.length,
          entriesProcessed: context.entriesProcessed,
          lastPath: logicalPath,
        });
      }
      if (
        expandableAsar &&
        digested !== undefined &&
        digested.classification.format === "asar" &&
        !digested.mismatched
      ) {
        const nested = new AsarArtifactReader(entry.adapterKey);
        context.ownedReaders.push(nested);
        await nested.prepareContainer(digested.node.sha256, context.signal);
        // Only traversed containers can own members, not opaque ASAR-named files.
        context.expandedContainerIds.add(occurrence.occurrence_id);
        stack.push({
          reader: nested,
          prefix: logicalPath,
          iterator: inventoryEntries(context, nested, logicalPath),
        });
      }
    }
  } catch (cause: unknown) {
    failure = { cause };
  } finally {
    // Readers remain owned by the inventory until its complete observation is built.
    for (const { iterator, prefix, reader } of stack.reverse()) {
      try {
        await iterator.return?.();
      } catch (cause: unknown) {
        failure = {
          cause: ArtifactReaderFailure.withCleanup(
            failure === undefined ? cause : failure.cause,
            ArtifactReaderFailure.cleanupObservation(
              cause,
              `artifact traversal for ${prefix || reader.format}`,
            ),
          ),
        };
      }
    }
  }
  if (failure !== undefined) throw failure.cause;
};

const digestArtifactEntry = async (
  context: ScanContext,
  currentReader: ArtifactReader,
  entry: ArtifactEntry,
  logicalPath: string,
  occurrence: MutableOccurrence,
): Promise<
  | {
      readonly node: ArtifactNode;
      readonly mismatched: boolean;
      readonly classification: ReturnType<typeof classifyArtifactContent>;
    }
  | undefined
> => {
  if ((entry.kind !== "file" && entry.kind !== "slice") || entry.encrypted)
    return undefined;
  const digest = await hashReadable(
    await currentReader.open(entry, context.signal),
    context.signal,
  );
  const mismatched =
    entry.declaredSha256 !== null && entry.declaredSha256 !== digest.sha256;
  if (mismatched && entry.declaredSha256 !== null) {
    if (context.integrity.mode === "fail")
      throw new ArtifactReaderFailure(
        "integrity",
        `Artifact integrity metadata disagrees with content: ${logicalPath}`,
        undefined,
        {
          logicalPath,
          declaredSha256: entry.declaredSha256,
          calculatedSha256: digest.sha256,
          unpacked: entry.unpacked,
        },
      );
    context.pendingContradictions.push({
      occurrence,
      declaredSha256: entry.declaredSha256,
      observedSha256: digest.sha256,
      entryKind: entry.kind,
      unpacked: entry.unpacked,
    });
  }
  const classified =
    entry.kind === "slice"
      ? ({ kind: "universal-slice", format: "mach-o" } as const)
      : classifyArtifactContent(logicalPath, digest.prefix, digest.bytes);
  return {
    node: createArtifactNode({
      sha256: digest.sha256,
      size: digest.bytes,
      format: classifyArtifactBytes(digest.prefix, digest.bytes),
      contentState: "embedded",
    }),
    mismatched,
    classification: classified,
  };
};

const isExpandableAsar = (entry: ArtifactEntry, logicalPath: string): boolean =>
  entry.kind === "file" &&
  logicalPath.toLowerCase().endsWith(".asar") &&
  isAbsolute(entry.adapterKey);

const isUnavailableUnpackedEntry = (
  cause: unknown,
  entry: ArtifactEntry,
): boolean =>
  entry.unpacked &&
  cause instanceof ArtifactReaderFailure &&
  cause.reason === "unavailable";
