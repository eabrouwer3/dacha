import { assertEquals } from "@std/assert";
import { Machine } from "../app.ts";
import { Package } from "./package.ts";
import { MacDefault } from "./mac-default.ts";
import type { Platform } from "../types.ts";

function platform(): Platform {
  return { os: "darwin", arch: "arm64", packageManager: "brew" };
}

// ============================================================
// MacDefault — constructor field round-trip
// ============================================================

Deno.test("MacDefault constructor sets all fields", () => {
  const app = new Machine();
  const dep = new Package(app, "dep", { name: "dep" });
  const md = new MacDefault(app, "dock-autohide", {
    domain: "com.apple.dock",
    key: "autohide",
    value: true,
    dependsOn: [dep],
  });
  assertEquals(md.id, "dock-autohide");
  assertEquals(md.domain, "com.apple.dock");
  assertEquals(md.key, "autohide");
  assertEquals(md.value, true);
  assertEquals(md.dependsOn, ["dep"]);
});

Deno.test("MacDefault constructor defaults optional fields", () => {
  const app = new Machine();
  const md = new MacDefault(app, "md", { domain: "com.apple.dock", key: "k", value: "v" });
  assertEquals(md.dependsOn, []);
});

// ============================================================
// MacDefault — toProps round-trip
// ============================================================

Deno.test("MacDefault toProps includes all fields", () => {
  const app = new Machine();
  const md = new MacDefault(app, "tilesize", { domain: "com.apple.dock", key: "tilesize", value: 48 });
  const resolved = md.toResolved();
  assertEquals(resolved.id, "tilesize");
  assertEquals(resolved.type, "mac-default");
  assertEquals(resolved.action.domain, "com.apple.dock");
  assertEquals(resolved.action.key, "tilesize");
  assertEquals(resolved.action.value, 48);
});

// ============================================================
// MacDefault — check/apply via real `defaults` command
// ============================================================

const testDomain = "com.dacha.test-" + Date.now();

Deno.test("MacDefault.check - returns false for unset key", async () => {
  const app = new Machine();
  const md = new MacDefault(app, "md", { domain: testDomain, key: "nonexistent", value: true });
  assertEquals(await md.check(platform()), false);
});

Deno.test("MacDefault.apply + check - boolean true", async () => {
  const key = "testBool" + Date.now();
  const app = new Machine();
  const md = new MacDefault(app, "md", { domain: testDomain, key, value: true });
  const result = await md.apply(platform(), new Map());
  assertEquals(result.status, "applied");
  assertEquals(await md.check(platform()), true);
});

Deno.test("MacDefault.apply + check - boolean false", async () => {
  const key = "testBoolFalse" + Date.now();
  const app = new Machine();
  const md = new MacDefault(app, "md", { domain: testDomain, key, value: false });
  await md.apply(platform(), new Map());
  assertEquals(await md.check(platform()), true);
});

Deno.test("MacDefault.apply + check - integer", async () => {
  const key = "testInt" + Date.now();
  const app = new Machine();
  const md = new MacDefault(app, "md", { domain: testDomain, key, value: 47 });
  await md.apply(platform(), new Map());
  assertEquals(await md.check(platform()), true);
});

Deno.test("MacDefault.apply + check - string", async () => {
  const key = "testStr" + Date.now();
  const app = new Machine();
  const md = new MacDefault(app, "md", { domain: testDomain, key, value: "clmv" });
  await md.apply(platform(), new Map());
  assertEquals(await md.check(platform()), true);
});

Deno.test("MacDefault.check - returns false when value differs", async () => {
  const key = "testMismatch" + Date.now();
  const app = new Machine();
  // Write one value
  const md1 = new MacDefault(app, "md1", { domain: testDomain, key, value: 10 });
  await md1.apply(platform(), new Map());
  // Check against a different value
  const md2 = new MacDefault(app, "md2", { domain: testDomain, key, value: 20 });
  assertEquals(await md2.check(platform()), false);
});

Deno.test("MacDefault.apply + check - float", async () => {
  const key = "testFloat" + Date.now();
  const app = new Machine();
  const md = new MacDefault(app, "md", { domain: testDomain, key, value: 1.5 });
  await md.apply(platform(), new Map());
  assertEquals(await md.check(platform()), true);
});
