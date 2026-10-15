import { z } from "zod";

import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";

/**
 * Fork: compact dispatch profile. `full` (the default) advertises every
 * in-scope tool; `compact` advertises only rea_discover, rea_describe and
 * rea_execute, and dispatches to every in-scope capability without needing a
 * client that refreshes tools/list (contrast REA_MCP_TOOL_CATALOG_PROFILE=hot-cold).
 */
export const CATALOG_TOOL_NAMES = [
  "rea_discover",
  "rea_describe",
  "rea_execute",
] as const;

export const mcpToolProfileSchema = z.enum(["compact", "full"]);

export type McpToolProfile = z.infer<typeof mcpToolProfileSchema>;

const profileConstraint =
  'REA_MCP_TOOL_PROFILE must be "full" (default) or "compact". The compact profile advertises only rea_discover, rea_describe and rea_execute; every other in-scope capability stays reachable through rea_execute without a client catalog refresh.';

/** Parse the advertised tool profile selection. */
export const parseMcpToolProfile = (
  value: string | undefined,
): Result<McpToolProfile | undefined, ConfigurationError> => {
  if (value === undefined) return ok(undefined);
  const parsed = mcpToolProfileSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(
        new ConfigurationError(profileConstraint, {
          settings: [
            { setting: "REA_MCP_TOOL_PROFILE", constraint: profileConstraint },
          ],
        }),
      );
};

/** The two progressive surfaces own the advertisement differently: never both. */
export const COMPACT_WITH_HOT_COLD_CONSTRAINT =
  "REA_MCP_TOOL_PROFILE=compact cannot be combined with REA_MCP_TOOL_CATALOG_PROFILE=hot-cold. Choose compact dispatch (no client refresh needed) or hot/cold discovery (client refresh required).";
