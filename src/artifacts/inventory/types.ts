import type { ArtifactResourceScope } from "../ArtifactResourceScope.js";

/** Resolved integrity behavior admitted to the artifact scanner. */
export type ArtifactIntegrityPolicy =
  | { readonly mode: "fail" }
  | { readonly mode: "record-and-continue" };

export const STRICT_INTEGRITY_POLICY: ArtifactIntegrityPolicy = {
  mode: "fail",
};

/** Monotonic SHA-256-chained progress checkpoint emitted during inventory traversal. */
export interface ArtifactInventoryRungCheckpoint {
  readonly rung: number;
  readonly label: string;
  readonly sha256: string;
  readonly nodes: number;
  readonly occurrences: number;
  readonly entriesProcessed: number;
  readonly lastPath?: string | undefined;
}

/** Options shared by artifact inventory scans. */
export interface ArtifactInventoryOptions {
  readonly resourceScope: ArtifactResourceScope;
  readonly signal?: AbortSignal | undefined;
  readonly integrity?: ArtifactIntegrityPolicy | undefined;
  readonly environment?: Readonly<NodeJS.ProcessEnv> | undefined;
  readonly maxEntries?: number | undefined;
  readonly rungInterval?: number | undefined;
  readonly onRung?:
    | ((checkpoint: ArtifactInventoryRungCheckpoint) => void | Promise<void>)
    | undefined;
}
