import { assertEquals } from "@std/assert";
import { resolvePackageName } from "./package.ts";
import { interpolateTemplate } from "./dotfile.ts";
import { CommandExecutor } from "./command.ts";
import { SecretExecutor } from "./secret.ts";
import type { CommandResource, OutputStore, PackageResource, Platform, SecretResource } from "../types.ts";

// --- Helper: build a minimal PackageResource ---

function pkg(overrides: Partial<PackageResource> = {}): PackageResource {
  return { id: "pkg-test", type: "package", name: "testpkg", ...overrides };
}

function platform(pm: Platform["packageManager"], os: Platform["os"] = "darwin"): Platform {
  return { os, arch: "arm64", packageManager: pm };
}

// ============================================================
// resolvePackageName
// ============================================================

Deno.test("resolvePackageName - brew falls back to canonical name", () => {
  assertEquals(resolvePackageName(pkg(), platform("brew")), "testpkg");
});

Deno.test("resolvePackageName - brew override used when set", () => {
  assertEquals(resolvePackageName(pkg({ brew: "testpkg-brew" }), platform("brew")), "testpkg-brew");
});

Deno.test("resolvePackageName - brewCask takes priority over brew", () => {
  const r = pkg({ brew: "testpkg-brew", brewCask: "testpkg-cask" });
  assertEquals(resolvePackageName(r, platform("brew")), "testpkg-cask");
});

Deno.test("resolvePackageName - brewCask alone works", () => {
  assertEquals(resolvePackageName(pkg({ brewCask: "my-cask" }), platform("brew")), "my-cask");
});

Deno.test("resolvePackageName - apt override used when set", () => {
  assertEquals(resolvePackageName(pkg({ apt: "testpkg-apt" }), platform("apt", "linux")), "testpkg-apt");
});

Deno.test("resolvePackageName - apt falls back to canonical name", () => {
  assertEquals(resolvePackageName(pkg(), platform("apt", "linux")), "testpkg");
});

Deno.test("resolvePackageName - yum override used when set", () => {
  assertEquals(resolvePackageName(pkg({ yum: "testpkg-yum" }), platform("yum", "linux")), "testpkg-yum");
});

Deno.test("resolvePackageName - yum falls back to canonical name", () => {
  assertEquals(resolvePackageName(pkg(), platform("yum", "linux")), "testpkg");
});

Deno.test("resolvePackageName - dnf uses yum override", () => {
  assertEquals(resolvePackageName(pkg({ yum: "testpkg-yum" }), platform("dnf", "linux")), "testpkg-yum");
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
  const tpl = "{{output.cmd-a.host}}:{{output.cmd-b.port}}";
  assertEquals(interpolateTemplate(tpl, outputs), "localhost:5432");
});

Deno.test("interpolateTemplate - missing resource leaves reference intact", () => {
  const outputs: OutputStore = new Map();
  assertEquals(interpolateTemplate("{{output.missing.key}}", outputs), "{{output.missing.key}}");
});

Deno.test("interpolateTemplate - missing key leaves reference intact", () => {
  const outputs: OutputStore = new Map([["cmd-a", { host: "localhost" }]]);
  assertEquals(interpolateTemplate("{{output.cmd-a.nokey}}", outputs), "{{output.cmd-a.nokey}}");
});

Deno.test("interpolateTemplate - no references returns content unchanged", () => {
  const outputs: OutputStore = new Map([["cmd-a", { x: "y" }]]);
  assertEquals(interpolateTemplate("plain text here", outputs), "plain text here");
});

Deno.test("interpolateTemplate - empty content returns empty", () => {
  assertEquals(interpolateTemplate("", new Map()), "");
});


// ============================================================
// CommandExecutor.check — uses real simple commands
// ============================================================

function cmdResource(overrides: Partial<CommandResource> = {}): CommandResource {
  return { id: "cmd-test", type: "command", run: "echo ok", ...overrides };
}

const anyPlatform = platform("brew");

Deno.test("CommandExecutor.check - returns false when no check command", async () => {
  const result = await CommandExecutor.check(cmdResource(), anyPlatform);
  assertEquals(result, false);
});

Deno.test("CommandExecutor.check - returns true when check exits 0", async () => {
  const result = await CommandExecutor.check(cmdResource({ check: "true" }), anyPlatform);
  assertEquals(result, true);
});

Deno.test("CommandExecutor.check - returns false when check exits non-zero", async () => {
  const result = await CommandExecutor.check(cmdResource({ check: "false" }), anyPlatform);
  assertEquals(result, false);
});

// ============================================================
// CommandExecutor.apply — captureOutput, critical failure
// ============================================================

Deno.test("CommandExecutor.apply - successful command returns applied", async () => {
  const outputs: OutputStore = new Map();
  const result = await CommandExecutor.apply(cmdResource({ run: "echo hello" }), anyPlatform, outputs);
  assertEquals(result.status, "applied");
});

Deno.test("CommandExecutor.apply - captureOutput stores stdout", async () => {
  const outputs: OutputStore = new Map();
  const r = cmdResource({ run: "echo captured-value", captureOutput: "myKey" });
  const result = await CommandExecutor.apply(r, anyPlatform, outputs);
  assertEquals(result.status, "applied");
  assertEquals(result.outputs?.myKey, "captured-value");
  assertEquals(outputs.get("cmd-test")?.myKey, "captured-value");
});

Deno.test("CommandExecutor.apply - failed non-critical returns failed", async () => {
  const outputs: OutputStore = new Map();
  const r = cmdResource({ run: "false" });
  const result = await CommandExecutor.apply(r, anyPlatform, outputs);
  assertEquals(result.status, "failed");
});

Deno.test("CommandExecutor.apply - failed critical throws error", async () => {
  const outputs: OutputStore = new Map();
  const r = cmdResource({ run: "false", critical: true });
  let threw = false;
  try {
    await CommandExecutor.apply(r, anyPlatform, outputs);
  } catch (e) {
    threw = true;
    assertEquals((e as Error).message.includes("critical"), true);
  }
  assertEquals(threw, true);
});

// ============================================================
// SecretExecutor.check — destination existence
// ============================================================

Deno.test("SecretExecutor.check - returns false when destination missing", async () => {
  const r: SecretResource = {
    id: "sec-test",
    type: "secret",
    source: "secrets/test.age",
    destination: "/tmp/dacha-secret-does-not-exist-" + Date.now(),
  };
  const result = await SecretExecutor.check(r, anyPlatform);
  assertEquals(result, false);
});

Deno.test("SecretExecutor.check - returns true when destination exists", async () => {
  const tmpFile = await Deno.makeTempFile({ prefix: "dacha-sec-test-" });
  try {
    const r: SecretResource = {
      id: "sec-test",
      type: "secret",
      source: "secrets/test.age",
      destination: tmpFile,
    };
    const result = await SecretExecutor.check(r, anyPlatform);
    assertEquals(result, true);
  } finally {
    await Deno.remove(tmpFile);
  }
});
