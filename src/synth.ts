// Synthesizer — evaluates a dacha config into a fully resolved state JSON.
// Detects platform, loads params, resolves profiles, filters by platform
// conditionals, builds dependency graph, and returns ResolvedState.

import type {
  DachaConfig,
  Params,
  Platform,
  PlatformFilter,
  ResolvedResource,
  ResolvedState,
  Resource,
} from "./types.ts";
import { detectPlatform, resolvePaths } from "./platform.ts";
import { resolveProfile } from "./profile.ts";
import { buildGraph } from "./graph.ts";
import { loadParams } from "./params.ts";
import { join } from "@std/path";
import { debug, info } from "./util/log.ts";

/** Options for the synth function. */
export interface SynthOpts {
  lockFilePath?: string;
}

/** Check whether a platform filter matches the current platform. */
export function matchesPlatform(
  filter: PlatformFilter,
  platform: Platform,
): boolean {
  if (filter.os !== undefined && filter.os !== platform.os) return false;
  if (filter.arch !== undefined && filter.arch !== platform.arch) return false;
  if (filter.distro !== undefined && filter.distro !== platform.distro) {
    return false;
  }
  return true;
}

/** Collect the profile chain names by walking the extends tree depth-first. */
function collectProfileChain(
  profile: { name: string; extends?: { name: string; extends?: unknown[] }[] },
): string[] {
  const names: string[] = [];
  if (profile.extends) {
    for (const parent of profile.extends) {
      names.push(
        ...collectProfileChain(
          parent as {
            name: string;
            extends?: { name: string; extends?: unknown[] }[];
          },
        ),
      );
    }
  }
  names.push(profile.name);
  return names;
}

/** Filter resources that don't match the current platform via onlyOn. */
function filterByPlatform(
  resources: Resource[],
  platform: Platform,
): Resource[] {
  return resources.filter((r) => {
    const filter = (r as { onlyOn?: PlatformFilter }).onlyOn;
    if (!filter) return true;
    return matchesPlatform(filter, platform);
  });
}

/** Map a resource to its ResolvedResource representation. */
function toResolvedResource(r: Resource): ResolvedResource {
  const { id, type, dependsOn, contributedBy, ...rest } = r;
  const action = { ...rest };
  delete (action as Record<string, unknown>).outputs;

  return {
    id,
    type,
    action: action as Record<string, unknown>,
    dependsOn: dependsOn ?? [],
    contributedBy: contributedBy ?? "unknown",
  };
}

/**
 * Synthesize a resolved state from a dacha config.
 *
 * Accepts either a file path to dynamically import, or a DachaConfig object
 * directly (useful for testing without file I/O).
 */
export async function synth(
  configOrPath: string | DachaConfig,
  opts?: SynthOpts,
): Promise<ResolvedState> {
  const platform = detectPlatform();
  const paths = resolvePaths();
  info(`detected platform: ${platform.os}/${platform.arch}`);

  let config: DachaConfig;
  let params: Params = {};

  if (typeof configOrPath === "string") {
    debug(`loading config from ${configOrPath}`);
    const mod = await import(configOrPath);
    const configFn = mod.default;

    // First pass: get param definitions (call with empty params)
    const initial: DachaConfig = typeof configFn === "function"
      ? configFn({ platform, params: {}, paths })
      : configFn;

    // Load params from lock file, prompting for missing values
    const lockFilePath = opts?.lockFilePath ??
      join(paths.configDir, "dacha", "params.lock.json");
    params = initial.params
      ? await loadParams(initial.params, lockFilePath)
      : {};

    // Second pass: re-evaluate config with resolved params
    config = typeof configFn === "function"
      ? configFn({ platform, params, paths })
      : initial;
  } else {
    config = configOrPath;
  }

  // Resolve the profile chain
  const resolved = resolveProfile(config.target);
  const profileChain = collectProfileChain(config.target);
  debug(`profile chain: ${profileChain.join(" → ")}`);

  // Collect all resources from the resolved profile
  const allResources: Resource[] = [
    ...(resolved.packages ?? []),
    ...(resolved.dotfiles ?? []),
    ...(resolved.commands ?? []),
    ...(resolved.secrets ?? []),
  ];

  // Filter by platform conditionals (onlyOn)
  const filtered = filterByPlatform(allResources, platform);
  debug(
    `resources: ${allResources.length} total, ${filtered.length} after platform filter`,
  );

  // Build dependency graph and topological sort
  const sorted = buildGraph(filtered);

  // Map to ResolvedResource format
  const resources = sorted.map(toResolvedResource);

  return {
    platform,
    resources,
    metadata: {
      generatedAt: new Date().toISOString(),
      repoPath: config.repoPath,
      profileChain,
      params,
    },
  };
}
