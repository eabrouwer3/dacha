// Dependency graph builder + topological sort.
// Builds a DAG from explicit dependsOn and implicit {{output.X.Y}} references,
// detects cycles via DFS with coloring, and returns resources in execution order
// using Kahn's algorithm.

import type { ResourceDef } from "./types.ts";

/** A resource-like object used by the graph builder. */
type Resource = ResourceDef;

/** Regex to match {{output.resourceId.key}} patterns in strings. */
const OUTPUT_REF_RE = /\{\{output\.([^.}]+)\.[^}]+\}\}/g;

/**
 * Scan all string fields of a resource for {{output.X.Y}} patterns.
 * Returns an array of unique resource IDs referenced.
 */
export function findImplicitDeps(resource: Resource): string[] {
  const deps = new Set<string>();

  for (const value of Object.values(resource)) {
    if (typeof value === "string") {
      for (const match of value.matchAll(OUTPUT_REF_RE)) {
        deps.add(match[1]);
      }
    }
  }

  return [...deps];
}

/**
 * Build a dependency graph from resources and return them in topological order.
 *
 * Algorithm:
 *  1. Create adjacency list from all resources
 *  2. Scan string fields for {{output.X.Y}} patterns → implicit edges
 *  3. Add edges from explicit dependsOn arrays
 *  4. Run cycle detection (DFS with coloring)
 *  5. Topological sort (Kahn's algorithm)
 *  6. Return ordered resource list
 */
export function buildGraph(resources: Resource[]): Resource[] {
  const idSet = new Set(resources.map((r) => r.id));
  const resourceById = new Map(resources.map((r) => [r.id, r]));

  // adjacency: id → set of IDs it depends on
  const deps = new Map<string, Set<string>>();
  for (const r of resources) {
    deps.set(r.id, new Set());
  }

  // Add implicit deps from {{output.X.Y}} patterns
  for (const r of resources) {
    const implicit = findImplicitDeps(r);
    for (const dep of implicit) {
      if (idSet.has(dep) && dep !== r.id) {
        deps.get(r.id)!.add(dep);
      }
    }
  }

  // Add explicit dependsOn edges
  for (const r of resources) {
    if (r.dependsOn) {
      for (const dep of r.dependsOn) {
        if (idSet.has(dep)) {
          deps.get(r.id)!.add(dep);
        }
      }
    }
  }

  // Cycle detection via DFS with coloring
  // WHITE=0 (unvisited), GRAY=1 (in progress), BLACK=2 (done)
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  for (const id of idSet) {
    color.set(id, WHITE);
    parent.set(id, null);
  }

  function dfs(id: string): void {
    color.set(id, GRAY);

    for (const dep of deps.get(id)!) {
      if (color.get(dep) === GRAY) {
        // Found a cycle — reconstruct the path
        const cycle = [dep, id];
        let cur = id;
        while (parent.get(cur) !== null && parent.get(cur) !== dep) {
          cur = parent.get(cur)!;
          cycle.push(cur);
        }
        cycle.reverse();
        throw new Error(
          `Circular dependency detected: ${cycle.join(" → ")}`,
        );
      }

      if (color.get(dep) === WHITE) {
        parent.set(dep, id);
        dfs(dep);
      }
    }

    color.set(id, BLACK);
  }

  for (const id of idSet) {
    if (color.get(id) === WHITE) {
      dfs(id);
    }
  }

  // Topological sort via Kahn's algorithm
  // Build in-degree map and forward adjacency (dep → dependents)
  const inDegree = new Map<string, number>();
  for (const id of idSet) {
    inDegree.set(id, 0);
  }
  for (const [id, depSet] of deps) {
    inDegree.set(id, depSet.size);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    // Find all nodes that depend on current and decrement their in-degree
    for (const [id, depSet] of deps) {
      if (depSet.has(current)) {
        const newDeg = inDegree.get(id)! - 1;
        inDegree.set(id, newDeg);
        if (newDeg === 0) {
          queue.push(id);
        }
      }
    }
  }

  return sorted.map((id) => resourceById.get(id)!);
}
