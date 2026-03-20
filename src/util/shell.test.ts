import { assertEquals, assertStringIncludes } from "@std/assert";
import { exec } from "./shell.ts";

Deno.test("exec - runs a string command via sh", async () => {
  const result = await exec("echo hello");
  assertEquals(result.code, 0);
  assertEquals(result.stdout.trim(), "hello");
  assertEquals(result.stderr, "");
});

Deno.test("exec - runs an array command directly", async () => {
  const result = await exec(["echo", "world"]);
  assertEquals(result.code, 0);
  assertEquals(result.stdout.trim(), "world");
});

Deno.test("exec - returns non-zero exit code on failure", async () => {
  const result = await exec("exit 42");
  assertEquals(result.code, 42);
});

Deno.test("exec - captures stderr", async () => {
  const result = await exec("echo oops >&2");
  assertEquals(result.stdout, "");
  assertEquals(result.stderr.trim(), "oops");
});

Deno.test("exec - respects cwd option", async () => {
  const result = await exec("pwd", { cwd: "/tmp" });
  assertEquals(result.code, 0);
  // macOS resolves /tmp → /private/tmp
  assertStringIncludes(result.stdout.trim(), "tmp");
});

Deno.test("exec - kills process on timeout", async () => {
  const result = await exec("sleep 30", { timeout: 100 });
  assertStringIncludes(result.stderr, "timed out");
});
