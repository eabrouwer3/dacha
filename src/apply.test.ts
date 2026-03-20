import { assertEquals } from "@std/assert";
import { apply } from "./apply.ts";
import type { Platform, ResolvedResource, ResolvedState } from "./types.ts";

// --- Helpers ---

const testPlatform: Platform = {
  os: "darwin",
  arch: "arm64",
  packageManager: "brew",
};

function makeState(resources: ResolvedResource[]): ResolvedState {
  return {
    platform: testPlatform,
    resources,
    metadata: {
      generatedAt: new Date().toISOString(),
      repoPath: "/tmp/test-repo",
      profileChain: ["test"],
      params: {},
    },
  };
}

function cmdResource(
  id: string,
  overrides: Record<string, unknown> = {},
): ResolvedResource {
  return {
    id,
    type: "command",
    action: { run: "echo ok", ...overrides },
    dependsOn: [],
    contributedBy: "test",
  };
}

// --- Dry-run: no side effects ---

Deno.test("apply dry-run - does not execute commands (no side effects)", async () => {
  const marker = `/tmp/dacha-apply-dryrun-${Date.now()}`;
  const state = makeState([
    cmdResource("cmd-touch", { run: `touch ${marker}` }),
  ]);

  const report = await apply(state, { dryRun: true });

  // Resource reported as "would apply"
  assertEquals(report.applied.includes("cmd-touch"), true);

  // But the file should NOT exist — command was not actually run
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
  const state = makeState([
    cmdResource("cmd-fail", { run: "false" }),
    { ...cmdResource("cmd-child", { run: "echo child" }), dependsOn: ["cmd-fail"] },
  ]);

  const report = await apply(state);

  assertEquals(report.failed.length, 1);
  assertEquals(report.failed[0].id, "cmd-fail");
  assertEquals(report.skipped.includes("cmd-child"), true);
});

Deno.test("apply - transitive dependents are also skipped", async () => {
  const state = makeState([
    cmdResource("cmd-fail", { run: "false" }),
    { ...cmdResource("cmd-mid", { run: "echo mid" }), dependsOn: ["cmd-fail"] },
    { ...cmdResource("cmd-leaf", { run: "echo leaf" }), dependsOn: ["cmd-mid"] },
  ]);

  const report = await apply(state);

  assertEquals(report.failed[0].id, "cmd-fail");
  assertEquals(report.skipped.includes("cmd-mid"), true);
  assertEquals(report.skipped.includes("cmd-leaf"), true);
});

// --- Summary report accuracy ---

Deno.test("apply - summary counts are accurate", async () => {
  const state = makeState([
    cmdResource("cmd-ok", { run: "echo ok" }),
    cmdResource("cmd-done", { run: "echo done", check: "true" }),
    cmdResource("cmd-fail", { run: "false" }),
    { ...cmdResource("cmd-dep", { run: "echo dep" }), dependsOn: ["cmd-fail"] },
  ]);

  const report = await apply(state);

  assertEquals(report.applied.length, 1); // cmd-ok
  assertEquals(report.applied[0], "cmd-ok");
  assertEquals(report.skipped.length, 2); // cmd-done (already done) + cmd-dep (dep failed)
  assertEquals(report.failed.length, 1);  // cmd-fail
  assertEquals(report.failed[0].id, "cmd-fail");
});

// --- Already-done resources are skipped ---

Deno.test("apply - resource with check=true is skipped as already done", async () => {
  const state = makeState([
    cmdResource("cmd-done", { run: "echo should-not-run", check: "true" }),
  ]);

  const report = await apply(state);

  assertEquals(report.skipped.includes("cmd-done"), true);
  assertEquals(report.applied.length, 0);
  assertEquals(report.failed.length, 0);
});
