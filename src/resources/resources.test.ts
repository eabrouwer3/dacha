import { assertEquals, assertRejects } from "@std/assert";
import { App } from "../app.ts";
import { Package, resolvePackageName } from "./package.ts";
import { Dotfile, interpolateTemplate } from "./dotfile.ts";
import { Command } from "./command.ts";
import { Secret } from "./secret.ts";
import type { OutputStore, Platform } from "../types.ts";

// --- Helpers ---

function platform(pm: Platform["packageManager"], os: Platform["os"] = "darwin"): Platform {
  return { os, arch: "arm64", packageManager: pm };
}

function pkg(overrides: { name: string; brew?: string; brewCask?: string; apt?: string; yum?: string } = { name: "testpkg" }) {
  return overrides;
}

// ============================================================
// resolvePackageName
// ============================================================

Deno.test("resolvePackageName - brew falls back to canonical name", () => {
  assertEquals(resolvePackageName(pkg(), platform("brew")), "testpkg");
});

Deno.test("resolvePackageName - brew override used when set", () => {
  assertEquals(resolvePackageName(pkg({ name: "testpkg", brew: "testpkg-brew" }), platform("brew")), "testpkg-brew");
});

Deno.test("resolvePackageName - brewCask takes priority over brew", () => {
  assertEquals(resolvePackageName(pkg({ name: "testpkg", brew: "testpkg-brew", brewCask: "testpkg-cask" }), platform("brew")), "testpkg-cask");
});

Deno.test("resolvePackageName - brewCask alone works", () => {
  assertEquals(resolvePackageName(pkg({ name: "testpkg", brewCask: "my-cask" }), platform("brew")), "my-cask");
});

Deno.test("resolvePackageName - apt override used when set", () => {
  assertEquals(resolvePackageName(pkg({ name: "testpkg", apt: "testpkg-apt" }), platform("apt", "linux")), "testpkg-apt");
});

Deno.test("resolvePackageName - apt falls back to canonical name", () => {
  assertEquals(resolvePackageName(pkg(), platform("apt", "linux")), "testpkg");
});

Deno.test("resolvePackageName - yum override used when set", () => {
  assertEquals(resolvePackageName(pkg({ name: "testpkg", yum: "testpkg-yum" }), platform("yum", "linux")), "testpkg-yum");
});

Deno.test("resolvePackageName - yum falls back to canonical name", () => {
  assertEquals(resolvePackageName(pkg(), platform("yum", "linux")), "testpkg");
});

Deno.test("resolvePackageName - dnf uses yum override", () => {
  assertEquals(resolvePackageName(pkg({ name: "testpkg", yum: "testpkg-yum" }), platform("dnf", "linux")), "testpkg-yum");
});

Deno.test("resolvePackageName - dnf falls back to canonical name", () => {
  assertEquals(resolvePackageName(pkg(), platform("dnf", "linux")), "testpkg");
});

// ============================================================
// interpolateTemplate
// ============================================================

Deno.test("interpolateTemplate - single reference replaced", () => {
  const outputs: OutputStore = new Map([["cmd-ver", { version: "3.2.1" }]]);
  assertEquals(interpolateTemplate("v={{output.cmd-ver.version}}", outputs), "v=3.2.1");
});

Deno.test("interpolateTemplate - multiple references replaced", () => {
  const outputs: OutputStore = new Map();
  outputs.set("cmd-a", { host: "localhost" });
  outputs.set("cmd-b", { port: "5432" });
  assertEquals(interpolateTemplate("{{output.cmd-a.host}}:{{output.cmd-b.port}}", outputs), "localhost:5432");
});

Deno.test("interpolateTemplate - missing resource leaves reference intact", () => {
  assertEquals(interpolateTemplate("{{output.missing.key}}", new Map()), "{{output.missing.key}}");
});

Deno.test("interpolateTemplate - missing key leaves reference intact", () => {
  const outputs: OutputStore = new Map([["cmd-a", { host: "localhost" }]]);
  assertEquals(interpolateTemplate("{{output.cmd-a.nokey}}", outputs), "{{output.cmd-a.nokey}}");
});

Deno.test("interpolateTemplate - no references returns content unchanged", () => {
  assertEquals(interpolateTemplate("plain text here", new Map([["cmd-a", { x: "y" }]])), "plain text here");
});

Deno.test("interpolateTemplate - empty content returns empty", () => {
  assertEquals(interpolateTemplate("", new Map()), "");
});

// ============================================================
// Package class — constructor field round-trip
// ============================================================

Deno.test("Package constructor sets all fields", () => {
  const app = new App();
  const pkg = new Package(app, "git", { name: "git", brew: "git-brew", brewCask: "git-cask", apt: "git-apt", yum: "git-yum", dependsOn: ["base"] });
  assertEquals(pkg.id, "git");
  assertEquals(pkg.name, "git");
  assertEquals(pkg.brew, "git-brew");
  assertEquals(pkg.brewCask, "git-cask");
  assertEquals(pkg.apt, "git-apt");
  assertEquals(pkg.yum, "git-yum");
  assertEquals(pkg.dependsOn, ["base"]);
});

Deno.test("Package constructor defaults optional fields", () => {
  const app = new App();
  const pkg = new Package(app, "curl", { name: "curl" });
  assertEquals(pkg.brew, undefined);
  assertEquals(pkg.brewCask, undefined);
  assertEquals(pkg.apt, undefined);
  assertEquals(pkg.yum, undefined);
  assertEquals(pkg.dependsOn, []);
});

// ============================================================
// Dotfile class — constructor field round-trip
// ============================================================

Deno.test("Dotfile constructor sets all fields", () => {
  const app = new App();
  const df = new Dotfile(app, "gitconfig", { source: "./gitconfig", destination: "~/.gitconfig", template: true, dependsOn: ["git"] });
  assertEquals(df.id, "gitconfig");
  assertEquals(df.source, "./gitconfig");
  assertEquals(df.destination, "~/.gitconfig");
  assertEquals(df.template, true);
  assertEquals(df.dependsOn, ["git"]);
});

Deno.test("Dotfile constructor defaults optional fields", () => {
  const app = new App();
  const df = new Dotfile(app, "df", { source: "s", destination: "d" });
  assertEquals(df.template, undefined);
  assertEquals(df.dependsOn, []);
});

// ============================================================
// Command class — constructor field round-trip
// ============================================================

Deno.test("Command constructor sets all fields", () => {
  const app = new App();
  const cmd = new Command(app, "setup", { run: "echo setup", check: "true", critical: true, captureOutput: "ver", dependsOn: ["git"] });
  assertEquals(cmd.id, "setup");
  assertEquals(cmd.run, "echo setup");
  assertEquals(cmd.checkCmd, "true");
  assertEquals(cmd.critical, true);
  assertEquals(cmd.captureOutput, "ver");
  assertEquals(cmd.dependsOn, ["git"]);
});

Deno.test("Command constructor defaults optional fields", () => {
  const app = new App();
  const cmd = new Command(app, "cmd", { run: "echo" });
  assertEquals(cmd.checkCmd, undefined);
  assertEquals(cmd.critical, undefined);
  assertEquals(cmd.captureOutput, undefined);
  assertEquals(cmd.dependsOn, []);
});

// ============================================================
// Command class — check/apply via real commands
// ============================================================

Deno.test("Command.check - returns false when no check command", async () => {
  const app = new App();
  const cmd = new Command(app, "cmd", { run: "echo ok" });
  assertEquals(await cmd.check(platform("brew")), false);
});

Deno.test("Command.check - returns true when check exits 0", async () => {
  const app = new App();
  const cmd = new Command(app, "cmd", { run: "echo ok", check: "true" });
  assertEquals(await cmd.check(platform("brew")), true);
});

Deno.test("Command.check - returns false when check exits non-zero", async () => {
  const app = new App();
  const cmd = new Command(app, "cmd", { run: "echo ok", check: "false" });
  assertEquals(await cmd.check(platform("brew")), false);
});

Deno.test("Command.apply - successful command returns applied", async () => {
  const app = new App();
  const cmd = new Command(app, "cmd", { run: "echo hello" });
  const outputs: OutputStore = new Map();
  const result = await cmd.apply(platform("brew"), outputs);
  assertEquals(result.status, "applied");
});

Deno.test("Command.apply - captureOutput stores stdout", async () => {
  const app = new App();
  const cmd = new Command(app, "cmd", { run: "echo captured-value", captureOutput: "myKey" });
  const outputs: OutputStore = new Map();
  const result = await cmd.apply(platform("brew"), outputs);
  assertEquals(result.status, "applied");
  assertEquals(result.outputs?.myKey, "captured-value");
  assertEquals(outputs.get("cmd")?.myKey, "captured-value");
});

Deno.test("Command.apply - failed non-critical returns failed", async () => {
  const app = new App();
  const cmd = new Command(app, "cmd", { run: "false" });
  const outputs: OutputStore = new Map();
  const result = await cmd.apply(platform("brew"), outputs);
  assertEquals(result.status, "failed");
});

Deno.test("Command.apply - failed critical throws error", async () => {
  const app = new App();
  const cmd = new Command(app, "cmd", { run: "false", critical: true });
  const outputs: OutputStore = new Map();
  await assertRejects(
    () => cmd.apply(platform("brew"), outputs),
    Error,
    "critical",
  );
});

// ============================================================
// Secret class — constructor field round-trip
// ============================================================

Deno.test("Secret constructor sets all fields", () => {
  const app = new App();
  const sec = new Secret(app, "key", { source: "secrets/key.age", destination: "~/.ssh/key", permissions: "0600", dependsOn: ["git"] });
  assertEquals(sec.id, "key");
  assertEquals(sec.source, "secrets/key.age");
  assertEquals(sec.destination, "~/.ssh/key");
  assertEquals(sec.permissions, "0600");
  assertEquals(sec.dependsOn, ["git"]);
});

Deno.test("Secret constructor defaults optional fields", () => {
  const app = new App();
  const sec = new Secret(app, "sec", { source: "s", destination: "d" });
  assertEquals(sec.permissions, undefined);
  assertEquals(sec.dependsOn, []);
});

// ============================================================
// Secret class — check via real filesystem
// ============================================================

Deno.test("Secret.check - returns false when destination missing", async () => {
  const app = new App();
  const sec = new Secret(app, "sec", { source: "secrets/test.age", destination: "/tmp/dacha-secret-does-not-exist-" + Date.now() });
  assertEquals(await sec.check(platform("brew")), false);
});

Deno.test("Secret.check - returns true when destination exists", async () => {
  const tmpFile = await Deno.makeTempFile({ prefix: "dacha-sec-test-" });
  try {
    const app = new App();
    const sec = new Secret(app, "sec", { source: "secrets/test.age", destination: tmpFile });
    assertEquals(await sec.check(platform("brew")), true);
  } finally {
    await Deno.remove(tmpFile);
  }
});
