import { assertEquals } from "@std/assert";
import { collectFromTree, matchesPlatform, synth } from "./synth.ts";
import { Machine } from "./app.ts";
import { Package } from "./resources/package.ts";
import { Command } from "./resources/command.ts";
import { File } from "./resources/file.ts";
import type { DachaConfig, Profile } from "./types.ts";

// --- matchesPlatform ---

Deno.test("matchesPlatform - empty filter matches any platform", () => {
  const platform = { os: "darwin" as const, arch: "arm64" as const, packageManager: "brew" as const };
  assertEquals(matchesPlatform({}, platform), true);
});

Deno.test("matchesPlatform - matching os returns true", () => {
  const platform = { os: "darwin" as const, arch: "arm64" as const, packageManager: "brew" as const };
  assertEquals(matchesPlatform({ os: "darwin" }, platform), true);
});

Deno.test("matchesPlatform - non-matching os returns false", () => {
  const platform = { os: "darwin" as const, arch: "arm64" as const, packageManager: "brew" as const };
  assertEquals(matchesPlatform({ os: "linux" }, platform), false);
});

Deno.test("matchesPlatform - matching arch returns true", () => {
  const platform = { os: "linux" as const, arch: "x64" as const, packageManager: "apt" as const };
  assertEquals(matchesPlatform({ arch: "x64" }, platform), true);
});

Deno.test("matchesPlatform - non-matching arch returns false", () => {
  const platform = { os: "linux" as const, arch: "x64" as const, packageManager: "apt" as const };
  assertEquals(matchesPlatform({ arch: "arm64" }, platform), false);
});

Deno.test("matchesPlatform - matching distro returns true", () => {
  const platform = { os: "linux" as const, arch: "x64" as const, distro: "ubuntu", packageManager: "apt" as const };
  assertEquals(matchesPlatform({ distro: "ubuntu" }, platform), true);
});

Deno.test("matchesPlatform - non-matching distro returns false", () => {
  const platform = { os: "linux" as const, arch: "x64" as const, distro: "ubuntu", packageManager: "apt" as const };
  assertEquals(matchesPlatform({ distro: "fedora" }, platform), false);
});

Deno.test("matchesPlatform - combined os+arch must both match", () => {
  const platform = { os: "darwin" as const, arch: "arm64" as const, packageManager: "brew" as const };
  assertEquals(matchesPlatform({ os: "darwin", arch: "arm64" }, platform), true);
  assertEquals(matchesPlatform({ os: "darwin", arch: "x64" }, platform), false);
});

// --- synth: minimal config produces valid ResolvedState ---

Deno.test("synth - minimal config produces valid ResolvedState structure", async () => {
  const config: DachaConfig = {
    repoPath: "/tmp/test-repo",
    target: {
      name: "test",
      packages: [{ id: "pkg-git", type: "package", name: "git" }],
    },
  };

  const result = await synth(config);
  const state = result.state;

  // Has platform
  assertEquals(typeof state.platform.os, "string");
  assertEquals(typeof state.platform.arch, "string");
  assertEquals(typeof state.platform.packageManager, "string");

  // Has resources
  assertEquals(Array.isArray(state.resources), true);
  assertEquals(state.resources.length, 1);
  assertEquals(state.resources[0].id, "pkg-git");
  assertEquals(state.resources[0].type, "package");
  assertEquals(Array.isArray(state.resources[0].dependsOn), true);
  assertEquals(typeof state.resources[0].contributedBy, "string");

  // Has metadata
  assertEquals(typeof state.metadata.generatedAt, "string");
  assertEquals(state.metadata.repoPath, "/tmp/test-repo");
  assertEquals(Array.isArray(state.metadata.profileChain), true);
});

// --- synth: profile chain metadata reflects inheritance ---

Deno.test("synth - profile chain metadata reflects inheritance chain", async () => {
  const base: Profile = { name: "base", packages: [{ id: "pkg-git", type: "package", name: "git" }] };
  const desktop: Profile = { name: "desktop", extends: [base] };
  const myMachine: Profile = { name: "my-machine", extends: [desktop] };

  const config: DachaConfig = {
    repoPath: "/tmp/test-repo",
    target: myMachine,
  };

  const result = await synth(config);
  const state = result.state;

  assertEquals(state.metadata.profileChain, ["base", "desktop", "my-machine"]);
});

// --- synth: resources in topological order ---

Deno.test("synth - resources are in topological order (dependency before dependent)", async () => {
  const config: DachaConfig = {
    repoPath: "/tmp/test-repo",
    target: {
      name: "test",
      packages: [{ id: "pkg-db", type: "package", name: "postgres" }],
      commands: [{ id: "cmd-app", type: "command", run: "start app", dependsOn: ["pkg-db"] }],
    },
  };

  const result = await synth(config);
  const state = result.state;
  const ids = state.resources.map((r) => r.id);

  assertEquals(ids.indexOf("pkg-db") < ids.indexOf("cmd-app"), true, "pkg-db should come before cmd-app");
});

// --- synth: params included in metadata ---

Deno.test("synth - params are empty object when no params defined", async () => {
  const config: DachaConfig = {
    repoPath: "/tmp/test-repo",
    target: { name: "test" },
  };

  const result = await synth(config);
  const state = result.state;

  assertEquals(state.metadata.params, {});
});

// --- synth: no side effects ---

Deno.test("synth - does not write files or produce side effects", async () => {
  const marker = `/tmp/dacha-synth-side-effect-${Date.now()}`;
  const config: DachaConfig = {
    repoPath: "/tmp/test-repo",
    target: {
      name: "test",
      packages: [{ id: "pkg-a", type: "package", name: "curl" }],
    },
  };

  await synth(config);

  // The marker file should not exist — synth shouldn't touch the filesystem
  let exists = false;
  try {
    await Deno.stat(marker);
    exists = true;
  } catch {
    exists = false;
  }
  assertEquals(exists, false);
});

// ============================================================
// collectFromTree — scope tree collection
// ============================================================

Deno.test("collectFromTree - single resource returns one leaf", () => {
  const app = new Machine();
  new Package(app, "git", { name: "git" });
  const leaves = collectFromTree(app);
  assertEquals(leaves.length, 1);
  assertEquals(leaves[0].id, "git");
});

Deno.test("collectFromTree - two-level composite collects only leaves", () => {
  const app = new Machine();
  const parent = new Command(app, "parent", { run: "echo" });
  new Package(parent, "child-a", { name: "a" });
  new Package(parent, "child-b", { name: "b" });

  const leaves = collectFromTree(app);
  const ids = leaves.map((r) => r.id);
  assertEquals(ids.length, 2);
  assertEquals(ids.includes("child-a"), true);
  assertEquals(ids.includes("child-b"), true);
  // parent is not a leaf
  assertEquals(ids.includes("parent"), false);
});

Deno.test("collectFromTree - three-level nesting collects deepest leaves", () => {
  const app = new Machine();
  const l1 = new Command(app, "l1", { run: "echo" });
  const l2 = new Command(l1, "l2", { run: "echo" });
  new Package(l2, "leaf", { name: "leaf" });

  const leaves = collectFromTree(app);
  assertEquals(leaves.length, 1);
  assertEquals(leaves[0].id, "leaf");
});

Deno.test("collectFromTree - mixed flat and nested resources", () => {
  const app = new Machine();
  new Package(app, "flat-pkg", { name: "flat" });
  const composite = new Command(app, "composite", { run: "echo" });
  new File(composite, "nested-df", { source: "s", destination: "d" });

  const leaves = collectFromTree(app);
  const ids = leaves.map((r) => r.id);
  assertEquals(ids.length, 2);
  assertEquals(ids.includes("flat-pkg"), true);
  assertEquals(ids.includes("nested-df"), true);
});

Deno.test("collectFromTree - child inherits parent dependencies", () => {
  const app = new Machine();
  const base = new Package(app, "base", { name: "base" });
  const parent = new Command(app, "parent", { run: "echo", dependsOn: [base] });
  new Package(parent, "child", { name: "child" });

  const leaves = collectFromTree(app);
  assertEquals(leaves.length, 2); // base + child
  const child = leaves.find((r) => r.id === "child")!;
  assertEquals(child.dependsOn.includes("base"), true);
});

Deno.test("collectFromTree - grandchild inherits ancestor dependencies", () => {
  const app = new Machine();
  const rootDep = new Package(app, "root-dep", { name: "root-dep" });
  const midDep = new Package(app, "mid-dep", { name: "mid-dep" });
  const l1 = new Command(app, "l1", { run: "echo", dependsOn: [rootDep] });
  const l2 = new Command(l1, "l2", { run: "echo", dependsOn: [midDep] });
  new Package(l2, "leaf", { name: "leaf" });

  const leaves = collectFromTree(app);
  const leaf = leaves.find((r) => r.id === "leaf")!;
  assertEquals(leaf.dependsOn.includes("root-dep"), true);
  assertEquals(leaf.dependsOn.includes("mid-dep"), true);
});

Deno.test("collectFromTree - empty app returns empty list", () => {
  const app = new Machine();
  assertEquals(collectFromTree(app).length, 0);
});

// ============================================================
// Property-Based Tests
// ============================================================

import fc from "fast-check";
import type { Resource } from "./resource.ts";

// Helper: count leaf nodes in a scope tree
function countLeaves(children: Resource[]): number {
  let count = 0;
  for (const child of children) {
    if (child._children.length === 0) {
      count++;
    } else {
      count += countLeaves(child._children);
    }
  }
  return count;
}

// Helper: build a random scope tree under an App
// Returns the total number of leaf nodes created
function buildRandomTree(app: Machine, depth: number, childCount: number): number {
  let leafCount = 0;
  let idCounter = 0;

  function addChildren(scope: Resource | Machine, remainingDepth: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const id = `r-${idCounter++}`;
      const resource = new Package(scope, id, { name: id });
      if (remainingDepth > 0 && count > 0) {
        // Make this a composite by adding children
        const subCount = Math.max(1, Math.floor(count / 2));
        addChildren(resource, remainingDepth - 1, subCount);
      } else {
        leafCount++;
      }
    }
  }

  addChildren(app, depth, childCount);
  return leafCount;
}

// Feature: dacha-v2-redesign, Property 3: Scope tree collection completeness
Deno.test("PBT: Scope tree collection completeness with random trees", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 3 }),
      fc.integer({ min: 1, max: 5 }),
      (depth, childCount) => {
        const app = new Machine();
        buildRandomTree(app, depth, childCount);

        const leaves = collectFromTree(app);
        const expectedCount = countLeaves(app._children);

        // Every leaf collected exactly once
        assertEquals(leaves.length, expectedCount);

        // All collected resources are actually leaves
        for (const leaf of leaves) {
          assertEquals(leaf._children.length, 0);
        }

        // No duplicate ids
        const ids = leaves.map((r) => r.id);
        assertEquals(new Set(ids).size, ids.length);
      },
    ),
    { numRuns: 100 },
  );
});

// Feature: dacha-v2-redesign, Property 4: Child resources inherit parent dependencies
Deno.test("PBT: Child resources inherit parent dependencies", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 1, max: 4 }),
      (depCount, childCount) => {
        const app = new Machine();
        let idCounter = 0;

        // Create dep resources
        const depResources: Package[] = [];
        for (let i = 0; i < depCount; i++) {
          depResources.push(new Package(app, `dep-${idCounter++}`, { name: `dep-${i}` }));
        }

        // Create a composite parent with dependencies
        const parent = new Command(app, `parent-${idCounter++}`, { run: "echo", dependsOn: depResources });

        // Add leaf children
        for (let i = 0; i < childCount; i++) {
          new Package(parent, `child-${idCounter++}`, { name: `child-${i}` });
        }

        const leaves = collectFromTree(app);

        // Every leaf child should have all parent deps
        for (const leaf of leaves) {
          if (leaf.id.startsWith("child-") || leaf.id.startsWith("dep-")) continue;
          for (const dep of depResources) {
            assertEquals(leaf.dependsOn.includes(dep.id), true, `leaf ${leaf.id} missing dep ${dep.id}`);
          }
        }

        // More specifically, check the children of the parent
        const childLeaves = leaves.filter((l) => l.id.startsWith("child-"));
        for (const leaf of childLeaves) {
          for (const dep of depResources) {
            assertEquals(leaf.dependsOn.includes(dep.id), true, `leaf ${leaf.id} missing dep ${dep.id}`);
          }
        }
      },
    ),
    { numRuns: 100 },
  );
});
