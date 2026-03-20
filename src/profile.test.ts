import { assertEquals } from "@std/assert";
import fc from "fast-check";
import { resolveProfile } from "./profile.ts";
import type { Profile, ResourceDef } from "./types.ts";

// --- No extends ---

Deno.test("resolveProfile - profile with no extends returns own resources tagged with contributedBy", () => {
  const profile: Profile = {
    name: "standalone",
    packages: [{ id: "pkg-git", type: "package", name: "git" }],
    dotfiles: [{ id: "df-vim", type: "dotfile", source: "vim/vimrc", destination: "~/.vimrc" }],
  };

  const resolved = resolveProfile(profile);

  assertEquals(resolved.packages?.length, 1);
  assertEquals(resolved.packages![0].name, "git");
  assertEquals(resolved.packages![0].contributedBy, "standalone");
  assertEquals(resolved.dotfiles?.length, 1);
  assertEquals(resolved.dotfiles![0].contributedBy, "standalone");
});

// --- Single-level inheritance ---

Deno.test("resolveProfile - single-level inheritance: child inherits parent packages", () => {
  const parent: Profile = {
    name: "base",
    packages: [{ id: "pkg-git", type: "package", name: "git" }],
  };
  const child: Profile = {
    name: "desktop",
    extends: [parent],
    packages: [{ id: "pkg-node", type: "package", name: "node" }],
  };

  const resolved = resolveProfile(child);

  assertEquals(resolved.packages?.length, 2);
  const ids = resolved.packages!.map((p) => p.id);
  assertEquals(ids.includes("pkg-git"), true);
  assertEquals(ids.includes("pkg-node"), true);
});

// --- Child overrides parent resource with same id ---

Deno.test("resolveProfile - child overrides parent resource with same id", () => {
  const parent: Profile = {
    name: "base",
    packages: [{ id: "pkg-editor", type: "package", name: "vim" }],
  };
  const child: Profile = {
    name: "desktop",
    extends: [parent],
    packages: [{ id: "pkg-editor", type: "package", name: "neovim" }],
  };

  const resolved = resolveProfile(child);

  assertEquals(resolved.packages?.length, 1);
  assertEquals(resolved.packages![0].name, "neovim");
});

// --- Multi-level chain: base → desktop → macos → my-macbook ---

Deno.test("resolveProfile - multi-level chain base → desktop → macos → my-macbook", () => {
  const base: Profile = {
    name: "base",
    packages: [{ id: "pkg-git", type: "package", name: "git" }],
    commands: [{ id: "cmd-setup", type: "command", run: "echo base" }],
  };
  const desktop: Profile = {
    name: "desktop",
    extends: [base],
    packages: [{ id: "pkg-node", type: "package", name: "node" }],
  };
  const macos: Profile = {
    name: "macos",
    extends: [desktop],
    packages: [{ id: "pkg-brew", type: "package", name: "brew-pkg" }],
  };
  const myMacbook: Profile = {
    name: "my-macbook",
    extends: [macos],
    commands: [{ id: "cmd-setup", type: "command", run: "echo macbook" }],
  };

  const resolved = resolveProfile(myMacbook);

  // All three packages inherited
  assertEquals(resolved.packages?.length, 3);
  const pkgIds = resolved.packages!.map((p) => p.id);
  assertEquals(pkgIds.includes("pkg-git"), true);
  assertEquals(pkgIds.includes("pkg-node"), true);
  assertEquals(pkgIds.includes("pkg-brew"), true);

  // cmd-setup overridden by my-macbook
  assertEquals(resolved.commands?.length, 1);
  assertEquals(resolved.commands![0].run, "echo macbook");
});

// --- Diamond inheritance ---

Deno.test("resolveProfile - diamond inheritance: two parents share a common grandparent", () => {
  const grandparent: Profile = {
    name: "base",
    packages: [
      { id: "pkg-git", type: "package", name: "git" },
      { id: "pkg-curl", type: "package", name: "curl" },
    ],
  };
  const parentA: Profile = {
    name: "desktop",
    extends: [grandparent],
    packages: [{ id: "pkg-gui", type: "package", name: "gui-toolkit" }],
  };
  const parentB: Profile = {
    name: "server",
    extends: [grandparent],
    packages: [{ id: "pkg-nginx", type: "package", name: "nginx" }],
  };
  const child: Profile = {
    name: "dev-machine",
    extends: [parentA, parentB],
  };

  const resolved = resolveProfile(child);

  // Grandparent resources should not be duplicated
  const ids = resolved.packages!.map((p) => p.id);
  const gitCount = ids.filter((id) => id === "pkg-git").length;
  assertEquals(gitCount, 1, "grandparent resource should not be duplicated");

  // All unique packages present
  assertEquals(ids.includes("pkg-git"), true);
  assertEquals(ids.includes("pkg-curl"), true);
  assertEquals(ids.includes("pkg-gui"), true);
  assertEquals(ids.includes("pkg-nginx"), true);
});

// --- Empty profile ---

Deno.test("resolveProfile - empty profile resolves cleanly", () => {
  const profile: Profile = { name: "empty" };
  const resolved = resolveProfile(profile);

  assertEquals(resolved.name, "empty");
  assertEquals(resolved.packages, undefined);
  assertEquals(resolved.dotfiles, undefined);
  assertEquals(resolved.commands, undefined);
  assertEquals(resolved.secrets, undefined);
});

// --- contributedBy tagging ---

Deno.test("resolveProfile - contributedBy is set to the final profile name for all resources", () => {
  const parent: Profile = {
    name: "base",
    packages: [{ id: "pkg-git", type: "package", name: "git" }],
    dotfiles: [{ id: "df-vim", type: "dotfile", source: "vim/vimrc", destination: "~/.vimrc" }],
  };
  const child: Profile = {
    name: "my-machine",
    extends: [parent],
    commands: [{ id: "cmd-setup", type: "command", run: "echo hi" }],
  };

  const resolved = resolveProfile(child);

  for (const pkg of resolved.packages ?? []) {
    assertEquals(pkg.contributedBy, "my-machine");
  }
  for (const df of resolved.dotfiles ?? []) {
    assertEquals(df.contributedBy, "my-machine");
  }
  for (const cmd of resolved.commands ?? []) {
    assertEquals(cmd.contributedBy, "my-machine");
  }
});

/**
 * Arbitrary that produces a PackageResource with a fixed id but a random name.
 */
function arbPackage(id: string): fc.Arbitrary<ResourceDef> {
  return fc.string({ minLength: 1, maxLength: 20 }).map((name) => ({
    id,
    type: "package" as const,
    name,
  }));
}

/**
 * Property 1: Child override precedence
 *
 * For any profile chain, if child and parent declare a resource with the same
 * id, the resolved profile contains only the child's version.
 */
Deno.test("property: child override precedence", async () => {
  const sharedId = "shared-pkg";

  const arb = fc.record({
    parentName: fc.string({ minLength: 1, maxLength: 10 }),
    childName: fc.string({ minLength: 1, maxLength: 10 }),
    parentPkg: arbPackage(sharedId),
    childPkg: arbPackage(sharedId),
  });

  await fc.assert(
    fc.property(arb, ({ parentName, childName, parentPkg, childPkg }) => {
      const parent: Profile = {
        name: parentName,
        packages: [parentPkg],
      };

      const child: Profile = {
        name: childName,
        extends: [parent],
        packages: [childPkg],
      };

      const resolved = resolveProfile(child);

      // There should be exactly one package with the shared id
      const matches = (resolved.packages ?? []).filter(
        (p) => p.id === sharedId,
      );
      assertEquals(matches.length, 1, "expected exactly one resource with the shared id");

      // The resolved package name must be the child's, not the parent's
      assertEquals(
        matches[0].name,
        childPkg.name,
        "child version should take precedence over parent",
      );
    }),
  );
});
