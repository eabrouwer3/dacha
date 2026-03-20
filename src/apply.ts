// Applier — iterates resources in topological order, checks current state,
// applies changes, collects outputs, and reports results.

import type {
  CommandResource,
  OutputStore,
  ResolvedResource,
  ResolvedState,
  Resource,
  ResourceExecutor,
} from "./types.ts";
import { PackageExecutor } from "./resources/package.ts";
import { DotfileExecutor } from "./resources/dotfile.ts";
import { CommandExecutor } from "./resources/command.ts";
import { SecretExecutor } from "./resources/secret.ts";
import { debug, error, info, success, warn } from "./util/log.ts";

/** Result of an apply run. */
export interface ApplyReport {
  applied: string[];
  skipped: string[];
  failed: { id: string; error: string }[];
}

/** Reconstruct a typed Resource from a ResolvedResource. */
function toTypedResource(r: ResolvedResource): Resource {
  return {
    id: r.id,
    type: r.type,
    dependsOn: r.dependsOn,
    contributedBy: r.contributedBy,
    ...r.action,
  } as Resource;
}

/** Get the executor for a resource type. */
// deno-lint-ignore no-explicit-any
function getExecutor(type: Resource["type"]): ResourceExecutor<any> {
  switch (type) {
    case "package":
      return PackageExecutor;
    case "dotfile":
      return DotfileExecutor;
    case "command":
      return CommandExecutor;
    case "secret":
      return SecretExecutor;
  }
}

/** Options for the apply function. */
export interface ApplyOpts {
  dryRun?: boolean;
  yes?: boolean;
}

/**
 * Apply a resolved state to the system.
 *
 * Iterates resources in topological order (as provided by synth),
 * checks each resource's current state, applies if needed, and
 * collects outputs for downstream dependencies.
 */
export async function apply(
  state: ResolvedState,
  opts: ApplyOpts = {},
): Promise<ApplyReport> {
  const outputs: OutputStore = new Map();
  const failedIds = new Set<string>();
  const report: ApplyReport = { applied: [], skipped: [], failed: [] };

  for (const resolved of state.resources) {
    const id = resolved.id;

    // Check if any dependency failed — skip with reason
    const failedDep = resolved.dependsOn.find((dep) => failedIds.has(dep));
    if (failedDep) {
      const reason = `dependency "${failedDep}" failed`;
      warn(`skipping ${id}: ${reason}`);
      report.skipped.push(id);
      failedIds.add(id); // propagate so transitive dependents also skip
      continue;
    }

    const resource = toTypedResource(resolved);
    const executor = getExecutor(resolved.type);

    // Check if already in desired state
    try {
      const done = await executor.check(resource, state.platform);
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
      info(`would apply: ${id} (${resolved.type})`);
      report.applied.push(id);
      continue;
    }

    // Apply the resource
    try {
      const result = await executor.apply(resource, state.platform, outputs);

      if (result.status === "failed") {
        const msg = result.error ?? "unknown error";
        error(`${id}: ${msg}`);
        report.failed.push({ id, error: msg });
        failedIds.add(id);

        // Critical commands halt the entire apply
        if (resolved.type === "command" && (resource as CommandResource).critical) {
          error(`critical resource "${id}" failed — halting apply`);
          break;
        }
        continue;
      }

      // Collect outputs
      if (result.outputs) {
        outputs.set(id, { ...outputs.get(id), ...result.outputs });
      }

      success(`${id} (${resolved.type})`);
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
  info(`${label}: ${report.applied.length} ${appliedLabel}, ${report.skipped.length} skipped, ${report.failed.length} failed`);

  if (report.failed.length > 0) {
    for (const f of report.failed) {
      error(`  ${f.id}: ${f.error}`);
    }
  }
}
