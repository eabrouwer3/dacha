// Synthesizer — evaluates a dacha config into a fully resolved state JSON.
// Supports two paths:
//   1. NEW (v2): Config returns a Machine → walk scope tree via collectFromTree
//   2. LEGACY: Config returns a DachaConfig with profiles → profile resolution

import type {
  DachaConfig,
  Params,
  Platform,
  PlatformFilter,
  ResolvedResource,
  ResolvedState,
  ResourceDef,
} from "./types.ts";
import { Machine } from "./app.ts";
import type { Resource } from "./resource.ts";
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

/**
 * Walk the scope tree from the App root and collect all leaf resources.
 * Leaf resources are those with no children.
 * Child resources inherit parent dependencies.
 */
export function collectFromTree(app: Machine): Resource[] {
  const leaves: Resource[] = [];

  function walk(children: Resource[], parentDeps: string[]): void {
    for (const child of children) {
      // Inherit parent dependencies
      for (const dep of parentDeps) {
        if (!child.dependsOn.includes(dep)) {
          child.dependsOn.push(dep);
        }
      }

      if (child._children.length === 0) {
        leaves.push(child);
      } else {
        walk(child._children, child.dependsOn);
      }
    }
  }

  walk(app._children, []);
  return leaves;
}

/**
 * Synthesize a resolved state from a dacha config or Machine instance.
 *
 * Accepts:
 *   - A Machine instance directly (v2 scope tree path)
 *   - A file path to dynamically import (may return Machine or DachaConfig)
 *   - A DachaConfig object directly (legacy profile path)
 */
export async function synth(
  configOrPath: string | DachaConfig | Machine,
  opts?: SynthOpts,
): Promise<ResolvedState> {
  const platform = detectPlatform();
  const paths = resolvePaths();
  info(`detected platform: ${platform.os}/${platform.arch}`);

  // --- Machine instance: v2 scope tree path ---
  if (configOrPath instanceof Machine) {
    return synthFromMachine(configOrPath, platform, {});
  }

  // --- String path: dynamic import, may return App or DachaConfig ---
  if (typeof configOrPath === "string") {
    debug(`loading config from ${configOrPath}`);
    const mod = await import(configOrPath);
    const configFn = mod.default;

    // First pass: get param definitions (call with empty params)
    const initial = typeof configFn === "function"
      ? configFn({ platform, params: {}, paths })
      : configFn;

    // Check if the config returned a Machine (v2 style)
    if (initial instanceof Machine) {
      // Check for static params on the Machine subclass
      const paramDefs = (initial.constructor as typeof Machine).params;
      if (paramDefs && paramDefs.length > 0) {
        const lockFilePath = opts?.lockFilePath ??
          join(paths.configDir, "dacha", "params.lock.json");
        const params = await loadParams(paramDefs, lockFilePath);

        // Re-invoke the config function with resolved params
        if (typeof configFn === "function") {
          const final = configFn({ platform, params, paths });
          if (final instanceof Machine) {
            return synthFromMachine(final, platform, params);
          }
        }
      }
      return synthFromMachine(initial, platform, {});
    }

    // Legacy DachaConfig path — load params and re-evaluate
    const config = initial as DachaConfig;
    const lockFilePath = opts?.lockFilePath ??
      join(paths.configDir, "dacha", "params.lock.json");
    const params: Params = config.params
      ? await loadParams(config.params, lockFilePath)
      : {};

    // Second pass: re-evaluate config with resolved params
    const finalConfig: DachaConfig = typeof configFn === "function"
      ? configFn({ platform, params, paths })
      : config;

    // If second pass returns a Machine, use scope tree path
    if (finalConfig instanceof Machine) {
      return synthFromMachine(finalConfig as unknown as Machine, platform, params);
    }

    return synthFromDachaConfig(finalConfig, platform, params);
  }

  // --- DachaConfig object: legacy profile path ---
  return synthFromDachaConfig(configOrPath, platform, {});
}

/** Synthesize from a Machine instance by walking the scope tree. */
function synthFromMachine(machine: Machine, platform: Platform, params: Params): ResolvedState {
  const leaves = collectFromTree(machine);
  debug(`scope tree: ${leaves.length} leaf resources collected`);

  // Convert to ResolvedResource for the graph builder
  const resolved = leaves.map((r) => r.toResolved());

  // Build dependency graph and topological sort
  // buildGraph expects objects with id/dependsOn — ResolvedResource has these
  const sorted = buildGraph(resolved as unknown as ResourceDef[]);

  // Map sorted back to ResolvedResource format
  const resources: ResolvedResource[] = sorted.map((r) => {
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
  });

  return {
    platform,
    resources,
    metadata: {
      generatedAt: new Date().toISOString(),
      repoPath: "",
      profileChain: [],
      params,
    },
  };
}

/** Synthesize from a legacy DachaConfig with profile resolution. */
function synthFromDachaConfig(
  config: DachaConfig,
  platform: Platform,
  params: Params,
): ResolvedState {
  // Resolve the profile chain
  const resolved = resolveProfile(config.target);
  const profileChain = collectProfileChain(config.target);
  debug(`profile chain: ${profileChain.join(" → ")}`);

  // Collect all resources from the resolved profile
  const allResources: ResourceDef[] = [
    ...(resolved.packages ?? []),
    ...(resolved.files ?? []),
    ...(resolved.commands ?? []),
    ...(resolved.secrets ?? []),
  ];

  debug(`resources: ${allResources.length} total`);

  // Build dependency graph and topological sort
  const sorted = buildGraph(allResources);

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

/** Map a resource def to its ResolvedResource representation (legacy path). */
function toResolvedResource(r: ResourceDef): ResolvedResource {
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
