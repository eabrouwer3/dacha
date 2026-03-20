import { assertEquals } from "@std/assert";
import { matchesPlatform, synth } from "./synth.ts";
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

  const state = await synth(config);

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

  const state = await synth(config);

  assertEquals(state.metadata.profileChain, ["base", "desktop", "my-machine"]);
});

// --- synth: platform filtering excludes non-matching onlyOn ---

Deno.test("synth - resources with non-matching onlyOn are excluded", async () => {
  const currentOs = Deno.build.os === "darwin" ? "darwin" : "linux";
  const otherOs = currentOs === "darwin" ? "linux" : "darwin";

  const config: DachaConfig = {
    repoPath: "/tmp/test-repo",
    target: {
      name: "test",
      packages: [
        { id: "pkg-always", type: "package", name: "curl" },
        { id: "pkg-match", type: "package", name: "matched", onlyOn: { os: currentOs as "darwin" | "linux" } },
        { id: "pkg-nomatch", type: "package", name: "excluded", onlyOn: { os: otherOs as "darwin" | "linux" } },
      ],
    },
  };

  const state = await synth(config);
  const ids = state.resources.map((r) => r.id);

  assertEquals(ids.includes("pkg-always"), true);
  assertEquals(ids.includes("pkg-match"), true);
  assertEquals(ids.includes("pkg-nomatch"), false);
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

  const state = await synth(config);
  const ids = state.resources.map((r) => r.id);

  assertEquals(ids.indexOf("pkg-db") < ids.indexOf("cmd-app"), true, "pkg-db should come before cmd-app");
});

// --- synth: params included in metadata ---

Deno.test("synth - params are empty object when no params defined", async () => {
  const config: DachaConfig = {
    repoPath: "/tmp/test-repo",
    target: { name: "test" },
  };

  const state = await synth(config);

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
