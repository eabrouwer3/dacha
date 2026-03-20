import { assertEquals } from "@std/assert";
import { apply } from "./apply.ts";
import { Machine } from "./app.ts";
import { Command } from "./resources/command.ts";
import type { Platform } from "./types.ts";

// --- Helpers ---

const testPlatform: Platform = {
  os: "darwin",
  arch: "arm64",
  packageManager: "brew",
};

/** Create a Command resource attached to a fresh App scope. */
function cmd(
  app: Machine,
  id: string,
  overrides: { run?: string; check?: string; critical?: boolean; dependsOn?: Command[] } = {},
): Command {
  return new Command(app, id, {
    run: overrides.run ?? "echo ok",
    check: overrides.check,
    critical: overrides.critical,
    dependsOn: overrides.dependsOn,
  });
}

// --- Dry-run: no side effects ---

Deno.test("apply dry-run - does not execute commands (no side effects)", async () => {
  const marker = `/tmp/dacha-apply-dryrun-${Date.now()}`;
  const app = new Machine();
  const resources = [cmd(app, "cmd-touch", { run: `touch ${marker}` })];

  const report = await apply(resources, testPlatform, { dryRun: true });

  assertEquals(report.applied.includes("cmd-touch"), true);

  // The file should NOT exist — command was not actually run
  let exists = false;
  try {
    await Deno.stat(marker);
    exists = true;
  } catch {
    exists = false;
  }
  assertEquals(exists, false, "dry-run should not create the marker file");
});

// --- Dependent-skip on failure ---

Deno.test("apply - dependent resources are skipped when a dependency fails", async () => {
  const app = new Machine();
  const fail = cmd(app, "cmd-fail", { run: "false" });
  const resources = [
    fail,
    cmd(app, "cmd-child", { run: "echo child", dependsOn: [fail] }),
  ];

  const report = await apply(resources, testPlatform);

  assertEquals(report.failed.length, 1);
  assertEquals(report.failed[0].id, "cmd-fail");
  assertEquals(report.skipped.includes("cmd-child"), true);
});

Deno.test("apply - transitive dependents are also skipped", async () => {
  const app = new Machine();
  const fail = cmd(app, "cmd-fail", { run: "false" });
  const mid = cmd(app, "cmd-mid", { run: "echo mid", dependsOn: [fail] });
  const resources = [
    fail,
    mid,
    cmd(app, "cmd-leaf", { run: "echo leaf", dependsOn: [mid] }),
  ];

  const report = await apply(resources, testPlatform);

  assertEquals(report.failed[0].id, "cmd-fail");
  assertEquals(report.skipped.includes("cmd-mid"), true);
  assertEquals(report.skipped.includes("cmd-leaf"), true);
});

// --- Summary report accuracy ---

Deno.test("apply - summary counts are accurate", async () => {
  const app = new Machine();
  const fail = cmd(app, "cmd-fail", { run: "false" });
  const resources = [
    cmd(app, "cmd-ok", { run: "echo ok" }),
    cmd(app, "cmd-done", { run: "echo done", check: "true" }),
    fail,
    cmd(app, "cmd-dep", { run: "echo dep", dependsOn: [fail] }),
  ];

  const report = await apply(resources, testPlatform);

  assertEquals(report.applied.length, 1); // cmd-ok
  assertEquals(report.applied[0], "cmd-ok");
  assertEquals(report.skipped.length, 2); // cmd-done (already done) + cmd-dep (dep failed)
  assertEquals(report.failed.length, 1);  // cmd-fail
  assertEquals(report.failed[0].id, "cmd-fail");
});

// --- Already-done resources are skipped ---

Deno.test("apply - resource with check=true is skipped as already done", async () => {
  const app = new Machine();
  const resources = [
    cmd(app, "cmd-done", { run: "echo should-not-run", check: "true" }),
  ];

  const report = await apply(resources, testPlatform);

  assertEquals(report.skipped.includes("cmd-done"), true);
  assertEquals(report.applied.length, 0);
  assertEquals(report.failed.length, 0);
});
