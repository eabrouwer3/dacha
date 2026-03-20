import { assertEquals, assertStrictEquals } from "@std/assert";
import { App } from "./app.ts";
import { Resource } from "./resource.ts";
import { Package } from "./resources/package.ts";
import { Dotfile } from "./resources/dotfile.ts";
import { Command } from "./resources/command.ts";
import { Secret } from "./resources/secret.ts";

// ============================================================
// Construction with scope auto-registration
// ============================================================

Deno.test("Resource registers as child of App scope", () => {
  const app = new App();
  const pkg = new Package(app, "git", { name: "git" });
  assertEquals(app._children.length, 1);
  assertStrictEquals(app._children[0], pkg);
});

Deno.test("Resource registers as child of another Resource scope", () => {
  const app = new App();
  const parent = new Command(app, "parent", { run: "echo hi" });
  const child = new Package(parent, "child-pkg", { name: "child" });
  assertEquals(parent._children.length, 1);
  assertStrictEquals(parent._children[0], child);
  // parent itself is the only direct child of app
  assertEquals(app._children.length, 1);
});

Deno.test("id and dependsOn are set correctly from props", () => {
  const app = new App();
  const pkg = new Package(app, "curl", { name: "curl", dependsOn: ["git"] });
  assertEquals(pkg.id, "curl");
  assertEquals(pkg.dependsOn, ["git"]);
});

// ============================================================
// toResolved() output structure
// ============================================================

Deno.test("Package toResolved returns correct structure", () => {
  const app = new App();
  const pkg = new Package(app, "git", { name: "git", brew: "git-brew", dependsOn: ["base"] });
  const resolved = pkg.toResolved();

  assertEquals(resolved.id, "git");
  assertEquals(resolved.type, "package");
  assertEquals(resolved.dependsOn, ["base"]);
  assertEquals(resolved.contributedBy, "unknown");
  assertEquals(resolved.action.name, "git");
  assertEquals(resolved.action.brew, "git-brew");
});

Deno.test("Dotfile toResolved returns correct structure", () => {
  const app = new App();
  const df = new Dotfile(app, "gitconfig", {
    source: "./gitconfig",
    destination: "~/.gitconfig",
    template: true,
  });
  const resolved = df.toResolved();

  assertEquals(resolved.id, "gitconfig");
  assertEquals(resolved.type, "dotfile");
  assertEquals(resolved.dependsOn, []);
  assertEquals(resolved.action.source, "./gitconfig");
  assertEquals(resolved.action.destination, "~/.gitconfig");
  assertEquals(resolved.action.template, true);
});

Deno.test("Command toResolved returns correct structure", () => {
  const app = new App();
  const cmd = new Command(app, "setup", { run: "echo setup", check: "true", critical: true });
  const resolved = cmd.toResolved();

  assertEquals(resolved.id, "setup");
  assertEquals(resolved.type, "command");
  assertEquals(resolved.action.run, "echo setup");
  assertEquals(resolved.action.check, "true");
  assertEquals(resolved.action.critical, true);
});

Deno.test("Secret toResolved returns correct structure", () => {
  const app = new App();
  const sec = new Secret(app, "key", {
    source: "secrets/key.age",
    destination: "~/.ssh/key",
    permissions: "0600",
  });
  const resolved = sec.toResolved();

  assertEquals(resolved.id, "key");
  assertEquals(resolved.type, "secret");
  assertEquals(resolved.action.source, "secrets/key.age");
  assertEquals(resolved.action.destination, "~/.ssh/key");
  assertEquals(resolved.action.permissions, "0600");
});

Deno.test("toResolved uses contributedBy when set", () => {
  const app = new App();
  const pkg = new Package(app, "git", { name: "git" });
  pkg.contributedBy = "base-profile";
  const resolved = pkg.toResolved();
  assertEquals(resolved.contributedBy, "base-profile");
});

Deno.test("toResolved type comes from static resourceType", () => {
  assertEquals(Package.resourceType, "package");
  assertEquals(Dotfile.resourceType, "dotfile");
  assertEquals(Command.resourceType, "command");
  assertEquals(Secret.resourceType, "secret");
});

// ============================================================
// Edge cases
// ============================================================

Deno.test("dependsOn defaults to empty array when not provided", () => {
  const app = new App();
  const pkg = new Package(app, "git", { name: "git" });
  assertEquals(pkg.dependsOn, []);
  assertEquals(pkg.toResolved().dependsOn, []);
});

Deno.test("empty dependsOn array is preserved", () => {
  const app = new App();
  const pkg = new Package(app, "git", { name: "git", dependsOn: [] });
  assertEquals(pkg.dependsOn, []);
});

Deno.test("multiple children registered to same App parent", () => {
  const app = new App();
  const a = new Package(app, "a", { name: "a" });
  const b = new Dotfile(app, "b", { source: "s", destination: "d" });
  const c = new Command(app, "c", { run: "echo" });
  assertEquals(app._children.length, 3);
  assertStrictEquals(app._children[0], a);
  assertStrictEquals(app._children[1], b);
  assertStrictEquals(app._children[2], c);
});

Deno.test("multiple children registered to same Resource parent", () => {
  const app = new App();
  const parent = new Command(app, "parent", { run: "echo" });
  const c1 = new Package(parent, "c1", { name: "c1" });
  const c2 = new Package(parent, "c2", { name: "c2" });
  assertEquals(parent._children.length, 2);
  assertStrictEquals(parent._children[0], c1);
  assertStrictEquals(parent._children[1], c2);
});

Deno.test("optional Dotfile fields default correctly", () => {
  const app = new App();
  const df = new Dotfile(app, "df", { source: "s", destination: "d" });
  assertEquals(df.template, undefined);
  assertEquals(df.dependsOn, []);
});

Deno.test("optional Command fields default correctly", () => {
  const app = new App();
  const cmd = new Command(app, "cmd", { run: "echo" });
  assertEquals(cmd.checkCmd, undefined);
  assertEquals(cmd.critical, undefined);
  assertEquals(cmd.captureOutput, undefined);
  assertEquals(cmd.dependsOn, []);
});

Deno.test("optional Secret fields default correctly", () => {
  const app = new App();
  const sec = new Secret(app, "sec", { source: "s", destination: "d" });
  assertEquals(sec.permissions, undefined);
  assertEquals(sec.dependsOn, []);
});

Deno.test("optional Package fields default correctly", () => {
  const app = new App();
  const pkg = new Package(app, "pkg", { name: "pkg" });
  assertEquals(pkg.brew, undefined);
  assertEquals(pkg.brewCask, undefined);
  assertEquals(pkg.apt, undefined);
  assertEquals(pkg.yum, undefined);
  assertEquals(pkg.dependsOn, []);
});

// ============================================================
// Property-Based Tests
// ============================================================

import fc from "fast-check";

// --- Arbitraries ---

const arbId = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);
const arbDepList = fc.array(arbId, { maxLength: 5 });
const arbOptStr = fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined });

// Feature: dacha-v2-redesign, Property 1: Resource constructor round-trip
Deno.test("PBT: Resource constructor round-trip for all L1 types", () => {
  // Package round-trip
  fc.assert(
    fc.property(
      arbId,
      fc.string({ minLength: 1, maxLength: 20 }),
      arbOptStr,
      arbOptStr,
      arbOptStr,
      arbOptStr,
      arbDepList,
      (id, name, brew, brewCask, apt, yum, deps) => {
        const app = new App();
        const pkg = new Package(app, id, { name, brew, brewCask, apt, yum, dependsOn: deps });
        assertEquals(pkg.id, id);
        assertEquals(pkg.name, name);
        assertEquals(pkg.brew, brew);
        assertEquals(pkg.brewCask, brewCask);
        assertEquals(pkg.apt, apt);
        assertEquals(pkg.yum, yum);
        assertEquals(pkg.dependsOn, deps);
        assertStrictEquals(app._children[app._children.length - 1], pkg);
        assertEquals(typeof pkg.check, "function");
        assertEquals(typeof pkg.apply, "function");
      },
    ),
    { numRuns: 100 },
  );

  // Dotfile round-trip
  fc.assert(
    fc.property(
      arbId,
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.option(fc.boolean(), { nil: undefined }),
      arbDepList,
      (id, source, destination, template, deps) => {
        const app = new App();
        const df = new Dotfile(app, id, { source, destination, template, dependsOn: deps });
        assertEquals(df.id, id);
        assertEquals(df.source, source);
        assertEquals(df.destination, destination);
        assertEquals(df.template, template);
        assertEquals(df.dependsOn, deps);
        assertStrictEquals(app._children[app._children.length - 1], df);
      },
    ),
    { numRuns: 100 },
  );

  // Command round-trip
  fc.assert(
    fc.property(
      arbId,
      fc.string({ minLength: 1, maxLength: 30 }),
      arbOptStr,
      fc.option(fc.boolean(), { nil: undefined }),
      arbOptStr,
      arbDepList,
      (id, run, check, critical, captureOutput, deps) => {
        const app = new App();
        const cmd = new Command(app, id, { run, check, critical, captureOutput, dependsOn: deps });
        assertEquals(cmd.id, id);
        assertEquals(cmd.run, run);
        assertEquals(cmd.checkCmd, check);
        assertEquals(cmd.critical, critical);
        assertEquals(cmd.captureOutput, captureOutput);
        assertEquals(cmd.dependsOn, deps);
        assertStrictEquals(app._children[app._children.length - 1], cmd);
      },
    ),
    { numRuns: 100 },
  );

  // Secret round-trip
  fc.assert(
    fc.property(
      arbId,
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.string({ minLength: 1, maxLength: 30 }),
      arbOptStr,
      arbDepList,
      (id, source, destination, permissions, deps) => {
        const app = new App();
        const sec = new Secret(app, id, { source, destination, permissions, dependsOn: deps });
        assertEquals(sec.id, id);
        assertEquals(sec.source, source);
        assertEquals(sec.destination, destination);
        assertEquals(sec.permissions, permissions);
        assertEquals(sec.dependsOn, deps);
        assertStrictEquals(app._children[app._children.length - 1], sec);
      },
    ),
    { numRuns: 100 },
  );
});

// Feature: dacha-v2-redesign, Property 2: toResolved serialization preserves identity
Deno.test("PBT: toResolved serialization preserves identity", () => {
  // Package
  fc.assert(
    fc.property(arbId, fc.string({ minLength: 1, maxLength: 20 }), arbDepList, (id, name, deps) => {
      const app = new App();
      const pkg = new Package(app, id, { name, dependsOn: deps });
      const resolved = pkg.toResolved();
      assertEquals(resolved.id, id);
      assertEquals(resolved.type, "package");
      assertEquals(resolved.dependsOn, deps);
      assertEquals(resolved.action.name, name);
    }),
    { numRuns: 100 },
  );

  // Dotfile
  fc.assert(
    fc.property(arbId, fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), arbDepList, (id, src, dest, deps) => {
      const app = new App();
      const df = new Dotfile(app, id, { source: src, destination: dest, dependsOn: deps });
      const resolved = df.toResolved();
      assertEquals(resolved.id, id);
      assertEquals(resolved.type, "dotfile");
      assertEquals(resolved.dependsOn, deps);
      assertEquals(resolved.action.source, src);
      assertEquals(resolved.action.destination, dest);
    }),
    { numRuns: 100 },
  );

  // Command
  fc.assert(
    fc.property(arbId, fc.string({ minLength: 1 }), arbDepList, (id, run, deps) => {
      const app = new App();
      const cmd = new Command(app, id, { run, dependsOn: deps });
      const resolved = cmd.toResolved();
      assertEquals(resolved.id, id);
      assertEquals(resolved.type, "command");
      assertEquals(resolved.dependsOn, deps);
      assertEquals(resolved.action.run, run);
    }),
    { numRuns: 100 },
  );

  // Secret
  fc.assert(
    fc.property(arbId, fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), arbDepList, (id, src, dest, deps) => {
      const app = new App();
      const sec = new Secret(app, id, { source: src, destination: dest, dependsOn: deps });
      const resolved = sec.toResolved();
      assertEquals(resolved.id, id);
      assertEquals(resolved.type, "secret");
      assertEquals(resolved.dependsOn, deps);
      assertEquals(resolved.action.source, src);
      assertEquals(resolved.action.destination, dest);
    }),
    { numRuns: 100 },
  );
});

// Feature: dacha-v2-redesign, Property 8: Scope auto-registration
Deno.test("PBT: Scope auto-registration", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 5 }),
      fc.integer({ min: 0, max: 3 }),
      (topCount, childPerTop) => {
        const app = new App();
        const topResources: Package[] = [];

        // Create top-level resources under App
        for (let i = 0; i < topCount; i++) {
          topResources.push(new Package(app, `top-${i}`, { name: `top-${i}` }));
        }

        assertEquals(app._children.length, topCount);

        // Create children under each top-level resource
        const childMap = new Map<string, Package[]>();
        for (const top of topResources) {
          const children: Package[] = [];
          for (let j = 0; j < childPerTop; j++) {
            children.push(new Package(top, `${top.id}-child-${j}`, { name: `child-${j}` }));
          }
          childMap.set(top.id, children);
        }

        // Verify App still has only top-level children
        assertEquals(app._children.length, topCount);
        for (let i = 0; i < topCount; i++) {
          assertStrictEquals(app._children[i], topResources[i]);
        }

        // Verify each top resource has its own children
        for (const top of topResources) {
          const expected = childMap.get(top.id)!;
          assertEquals(top._children.length, childPerTop);
          for (let j = 0; j < childPerTop; j++) {
            assertStrictEquals(top._children[j], expected[j]);
          }
        }

        // No resource appears in multiple parents' children lists
        const allChildren = new Set<Resource>();
        for (const child of app._children) {
          assertEquals(allChildren.has(child), false);
          allChildren.add(child);
        }
        for (const top of topResources) {
          for (const child of top._children) {
            assertEquals(allChildren.has(child), false);
            allChildren.add(child);
          }
        }
      },
    ),
    { numRuns: 100 },
  );
});
