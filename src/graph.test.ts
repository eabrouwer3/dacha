import { assert, assertEquals, assertThrows } from "@std/assert";
import fc from "fast-check";
import { buildGraph, findImplicitDeps } from "./graph.ts";
import type { Resource } from "./types.ts";

// --- Independent resources (no deps) ---

Deno.test("buildGraph - independent resources are all returned, order preserved", () => {
  const resources: Resource[] = [
    { id: "a", type: "package" },
    { id: "b", type: "dotfile" },
    { id: "c", type: "command" },
  ];

  const sorted = buildGraph(resources);

  assertEquals(sorted.length, 3);
  const ids = sorted.map((r) => r.id);
  assertEquals(ids, ["a", "b", "c"]);
});

// --- Explicit dependsOn ---

Deno.test("buildGraph - explicit dependsOn: dependency appears before dependent", () => {
  const resources: Resource[] = [
    { id: "app", type: "command", dependsOn: ["db"] },
    { id: "db", type: "package" },
  ];

  const sorted = buildGraph(resources);
  const ids = sorted.map((r) => r.id);
  const dbIdx = ids.indexOf("db");
  const appIdx = ids.indexOf("app");

  assertEquals(dbIdx < appIdx, true, "db should come before app");
});

Deno.test("buildGraph - explicit dependsOn chain: a → b → c", () => {
  const resources: Resource[] = [
    { id: "a", type: "command", dependsOn: ["b"] },
    { id: "b", type: "command", dependsOn: ["c"] },
    { id: "c", type: "package" },
  ];

  const sorted = buildGraph(resources);
  const ids = sorted.map((r) => r.id);

  assertEquals(ids.indexOf("c") < ids.indexOf("b"), true);
  assertEquals(ids.indexOf("b") < ids.indexOf("a"), true);
});

// --- findImplicitDeps ---

Deno.test("findImplicitDeps - detects {{output.X.Y}} references", () => {
  const resource: Resource = {
    id: "tmpl",
    type: "dotfile",
    source: "files/config",
    destination: "{{output.cmd-path.value}}/config",
  } as Resource;

  const deps = findImplicitDeps(resource);
  assertEquals(deps, ["cmd-path"]);
});

Deno.test("findImplicitDeps - detects multiple distinct references", () => {
  const resource = {
    id: "tmpl",
    type: "command",
    run: "echo {{output.foo.x}} {{output.bar.y}}",
  } as Resource;

  const deps = findImplicitDeps(resource);
  assertEquals(deps.sort(), ["bar", "foo"]);
});

Deno.test("findImplicitDeps - deduplicates repeated references to same resource", () => {
  const resource = {
    id: "tmpl",
    type: "command",
    run: "{{output.same.a}} and {{output.same.b}}",
  } as Resource;

  const deps = findImplicitDeps(resource);
  assertEquals(deps, ["same"]);
});

Deno.test("findImplicitDeps - returns empty for resource with no references", () => {
  const resource: Resource = { id: "plain", type: "package" };
  assertEquals(findImplicitDeps(resource), []);
});

// --- Implicit deps in buildGraph ---

Deno.test("buildGraph - implicit {{output.X.Y}} dep: referencing resource sorted after dependency", () => {
  const resources: Resource[] = [
    {
      id: "tmpl",
      type: "dotfile",
      source: "f",
      destination: "{{output.other.val}}/.config",
    } as Resource,
    { id: "other", type: "command" },
  ];

  const sorted = buildGraph(resources);
  const ids = sorted.map((r) => r.id);

  assertEquals(ids.indexOf("other") < ids.indexOf("tmpl"), true, "other should come before tmpl");
});

// --- Mixed explicit + implicit deps ---

Deno.test("buildGraph - mixed explicit and implicit deps are both respected", () => {
  const resources: Resource[] = [
    {
      id: "deploy",
      type: "command",
      run: "deploy {{output.build.artifact}}",
      dependsOn: ["setup"],
    } as Resource,
    { id: "build", type: "command" },
    { id: "setup", type: "package" },
  ];

  const sorted = buildGraph(resources);
  const ids = sorted.map((r) => r.id);
  const deployIdx = ids.indexOf("deploy");

  assertEquals(ids.indexOf("build") < deployIdx, true, "build before deploy (implicit)");
  assertEquals(ids.indexOf("setup") < deployIdx, true, "setup before deploy (explicit)");
});

// --- Cycle detection ---

Deno.test("buildGraph - cycle detection throws with descriptive message", () => {
  const resources: Resource[] = [
    { id: "a", type: "command", dependsOn: ["b"] },
    { id: "b", type: "command", dependsOn: ["a"] },
  ];

  assertThrows(
    () => buildGraph(resources),
    Error,
    "Circular dependency detected",
  );
});

Deno.test("buildGraph - three-node cycle throws", () => {
  const resources: Resource[] = [
    { id: "a", type: "command", dependsOn: ["b"] },
    { id: "b", type: "command", dependsOn: ["c"] },
    { id: "c", type: "command", dependsOn: ["a"] },
  ];

  assertThrows(
    () => buildGraph(resources),
    Error,
    "Circular dependency detected",
  );
});

// --- Self-referencing dependsOn ---

Deno.test("buildGraph - self-referencing dependsOn is detected as cycle", () => {
  const resources: Resource[] = [
    { id: "solo", type: "command", dependsOn: ["solo"] },
    { id: "other", type: "package" },
  ];

  assertThrows(
    () => buildGraph(resources),
    Error,
    "Circular dependency detected",
  );
});

/**
 * Arbitrary that produces a DAG of resources with explicit dependsOn edges.
 *
 * Strategy: generate N resources with ids "r0"…"r(N-1)". For each resource ri,
 * dependsOn may only reference rj where j < i. This guarantees no cycles.
 */
function arbDag(): fc.Arbitrary<Resource[]> {
  return fc
    .integer({ min: 1, max: 20 })
    .chain((n) =>
      fc.tuple(
        ...Array.from({ length: n }, (_, i) =>
          fc
            .subarray(
              Array.from({ length: i }, (_, j) => `r${j}`),
              { minLength: 0 },
            )
            .map((deps): Resource => ({
              id: `r${i}`,
              type: "package" as const,
              name: `pkg-${i}`,
              dependsOn: deps,
            }) as Resource)
        ),
      )
    );
}

/**
 * Property 2: Topological ordering validity
 *
 * For any DAG of resources, every resource in the sorted output appears after
 * all of its dependencies.
 */
Deno.test("property: topological ordering validity", async () => {
  await fc.assert(
    fc.property(arbDag(), (resources) => {
      const sorted = buildGraph(resources);
      const position = new Map(sorted.map((r, i) => [r.id, i]));

      for (const r of sorted) {
        for (const dep of r.dependsOn ?? []) {
          assert(
            position.get(dep)! < position.get(r.id)!,
            `dependency "${dep}" should appear before "${r.id}" in sorted output`,
          );
        }
      }
    }),
  );
});

/**
 * Arbitrary that produces a resource set guaranteed to contain at least one cycle.
 *
 * Strategy: generate N resources (N >= 2) with a guaranteed forward chain
 * r1 → r0, r2 → r1, …, rN-1 → rN-2 (each resource depends on the previous).
 * Then inject a back-edge: r0 depends on rN-1, creating the cycle
 * r0 → rN-1 → … → r1 → r0.
 */
function arbCyclicResources(): fc.Arbitrary<Resource[]> {
  return fc.integer({ min: 2, max: 20 }).map((n) => {
    // Build a chain: each ri depends on r(i-1)
    const resources: Resource[] = Array.from({ length: n }, (_, i) => ({
      id: `r${i}`,
      type: "package" as const,
      name: `pkg-${i}`,
      dependsOn: i > 0 ? [`r${i - 1}`] : [],
    }) as Resource);

    // Inject back-edge: r0 depends on rN-1, closing the cycle
    resources[0].dependsOn = [`r${n - 1}`];
    return resources;
  });
}

/**
 * Property 3: Cycle detection completeness
 *
 * For any resource set containing a circular dependency, `buildGraph` throws
 * an error containing the cycle path.
 *
 * Validates: Requirements 8.4
 */
Deno.test("property: cycle detection completeness", async () => {
  await fc.assert(
    fc.property(arbCyclicResources(), (resources) => {
      let threw = false;
      try {
        buildGraph(resources);
      } catch (e) {
        threw = true;
        assert(e instanceof Error, "should throw an Error");
        assert(
          e.message.includes("Circular dependency"),
          `error message should mention circular dependency, got: "${e.message}"`,
        );
      }
      assert(threw, "buildGraph should throw for cyclic resource sets");
    }),
  );
});
