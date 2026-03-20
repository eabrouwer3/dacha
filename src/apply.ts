// Applier — iterates resources in topological order, checks current state,
// applies changes, collects outputs, and reports results.
//
// Supports two calling conventions:
//   1. v2: apply(resources, platform, opts?) — Resource class instances
//   2. Legacy: apply(state, opts?) — ResolvedState (backward compat, throws)

import type {
  OutputStore,
  Platform,
  ResolvedState,
} from "./types.ts";
import type { Resource } from "./resource.ts";
import { Command } from "./resources/command.ts";
import { debug, error, info, success, warn } from "./util/log.ts";

/** Result of an apply run. */
export interface ApplyReport {
  applied: string[];
  skipped: string[];
  failed: { id: string; error: string }[];
}

/** Options for the apply function. */
export interface ApplyOpts {
  dryRun?: boolean;
  yes?: boolean;
}

/** v2 overload — Resource class instances + Platform. */
export async function apply(
  resources: Resource[],
  platform: Platform,
  opts?: ApplyOpts,
): Promise<ApplyReport>;

/** Legacy overload — ResolvedState (backward compat). */
export async function apply(
  state: ResolvedState,
  opts?: ApplyOpts,
): Promise<ApplyReport>;

/** Implementation — dispatches based on first argument type. */
export function apply(
  resourcesOrState: Resource[] | ResolvedState,
  platformOrOpts?: Platform | ApplyOpts,
  maybeOpts?: ApplyOpts,
): Promise<ApplyReport> {
  if (Array.isArray(resourcesOrState)) {
    const resources = resourcesOrState;
    const platform = platformOrOpts as Platform;
    const opts = maybeOpts ?? {};
    return applyResources(resources, platform, opts);
  }

  // Legacy path — ResolvedState no longer supported without Resource instances.
  throw new Error(
    "Legacy ResolvedState apply path is no longer supported. " +
    "Pass Resource[] instances and a Platform instead.",
  );
}

/**
 * Apply Resource class instances to the system.
 *
 * Iterates resources in order (caller provides topological sort),
 * checks each resource's current state via resource.check(),
 * applies if needed via resource.apply(), and collects outputs
 * for downstream dependencies.
 */
async function applyResources(
  resources: Resource[],
  platform: Platform,
  opts: ApplyOpts,
): Promise<ApplyReport> {
  const outputs: OutputStore = new Map();
  const failedIds = new Set<string>();
  const report: ApplyReport = { applied: [], skipped: [], failed: [] };

  for (const resource of resources) {
    const id = resource.id;

    // Skip if any dependency failed — propagate so transitive dependents also skip
    const failedDep = resource.dependsOn.find((dep) => failedIds.has(dep));
    if (failedDep) {
      const reason = `dependency "${failedDep}" failed`;
      warn(`skipping ${id}: ${reason}`);
      report.skipped.push(id);
      failedIds.add(id);
      continue;
    }

    // Check if already in desired state
    try {
      const done = await resource.check(platform);
      if (done) {
        debug(`${id}: already up to date`);
        report.skipped.push(id);
        continue;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error(`${id}: check failed: ${msg}`);
      report.failed.push({ id, error: msg });
      failedIds.add(id);
      continue;
    }

    // Dry-run: report what would change and move on
    if (opts.dryRun) {
      info(`would apply: ${id}`);
      report.applied.push(id);
      continue;
    }

    // Apply the resource
    try {
      const result = await resource.apply(platform, outputs);

      if (result.status === "failed") {
        const msg = result.error ?? "unknown error";
        error(`${id}: ${msg}`);
        report.failed.push({ id, error: msg });
        failedIds.add(id);

        // Critical commands halt the entire apply
        if (resource instanceof Command && resource.critical) {
          error(`critical resource "${id}" failed — halting apply`);
          break;
        }
        continue;
      }

      // Collect outputs
      if (result.outputs) {
        outputs.set(id, { ...outputs.get(id), ...result.outputs });
      }

      success(`${id}`);
      report.applied.push(id);
    } catch (err) {
      // Critical commands throw to halt
      const msg = err instanceof Error ? err.message : String(err);
      error(`${id}: ${msg}`);
      report.failed.push({ id, error: msg });
      failedIds.add(id);
      break;
    }
  }

  printSummary(report, opts.dryRun);
  return report;
}

/** Print a colored summary of the apply run. */
function printSummary(report: ApplyReport, dryRun?: boolean): void {
  const label = dryRun ? "Dry-run summary" : "Summary";
  const appliedLabel = dryRun ? "would apply" : "applied";

  console.log("");
  info(
    `${label}: ${report.applied.length} ${appliedLabel}, ` +
    `${report.skipped.length} skipped, ${report.failed.length} failed`,
  );

  if (report.failed.length > 0) {
    for (const f of report.failed) {
      error(`  ${f.id}: ${f.error}`);
    }
  }
}
