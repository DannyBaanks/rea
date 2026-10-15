import { z } from "zod";

import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";

/**
 * Catalog tool names exposed by the compact MCP tool profile, which is the
 * default. Only these three capabilities are advertised in that mode; the
 * complete catalog stays registered and callable behind {@link rea_execute}.
 */
export const CATALOG_TOOL_NAMES = [
  "rea_discover",
  "rea_describe",
  "rea_execute",
] as const;

export type CatalogToolName = (typeof CATALOG_TOOL_NAMES)[number];

export const mcpToolProfileSchema = z.enum(["compact", "full"]);

export type McpToolProfile = z.infer<typeof mcpToolProfileSchema>;

const profileConstraint =
  'REA_MCP_TOOL_PROFILE must be "full" (default) or "compact". The compact profile advertises only rea_discover, rea_describe and rea_execute; every other capability stays registered and callable through rea_execute, which keeps provider tool-count caps satisfiable without removing capabilities.';

/** Tool names advertised by the compact MCP tool profile. */
export const advertisedToolNamesForProfile = (
  profile: McpToolProfile | undefined,
): ReadonlySet<string> | undefined =>
  profile === "compact" ? new Set<string>(CATALOG_TOOL_NAMES) : undefined;

/** Parse the advertised tool catalog profile selection. */
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
            {
              setting: "REA_MCP_TOOL_PROFILE",
              constraint: profileConstraint,
            },
          ],
        }),
      );
};
