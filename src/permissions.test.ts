import { assertEquals } from "@std/assert";
import {
  buildPermissionFlags,
  formatPermissions,
  loadPermissions,
  resetPermissions,
  savePermissions,
} from "./permissions.ts";
import type { PermissionStore } from "./permissions.ts";
import { join } from "@std/path";

// --- Helpers ---

async function tmpStorePath(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "dacha-perm-test-" });
  return join(dir, "permissions.json");
}

// ============================================================
// load/save round-trip
// ============================================================

Deno.test("loadPermissions - returns empty store when file missing", async () => {
  const store = await loadPermissions("/tmp/dacha-perm-nonexistent-" + Date.now() + "/permissions.json");
  assertEquals(store.granted, []);
});

Deno.test("save then load round-trips correctly", async () => {
  const path = await tmpStorePath();
  const store: PermissionStore = {
    granted: [
      { name: "read", grantedAt: "2025-01-01T00:00:00Z" },
      { name: "write", grantedAt: "2025-01-01T00:00:00Z" },
    ],
  };
  await savePermissions(store, path);
  const loaded = await loadPermissions(path);
  assertEquals(loaded.granted.length, 2);
  assertEquals(loaded.granted[0].name, "read");
  assertEquals(loaded.granted[1].name, "write");
});

// ============================================================
// corrupted file handling
// ============================================================

Deno.test("loadPermissions - corrupted file returns empty store", async () => {
  const path = await tmpStorePath();
  await Deno.writeTextFile(path, "not valid json {{{");
  const store = await loadPermissions(path);
  assertEquals(store.granted, []);
});

// ============================================================
// resetPermissions
// ============================================================

Deno.test("resetPermissions - deletes the store file", async () => {
  const path = await tmpStorePath();
  await savePermissions({ granted: [{ name: "read", grantedAt: "2025-01-01T00:00:00Z" }] }, path);
  await resetPermissions(path);
  const store = await loadPermissions(path);
  assertEquals(store.granted, []);
});

Deno.test("resetPermissions - no error when file already absent", async () => {
  await resetPermissions("/tmp/dacha-perm-nonexistent-" + Date.now() + "/permissions.json");
});

// ============================================================
// formatPermissions
// ============================================================

Deno.test("formatPermissions - shows granted permissions", () => {
  const store: PermissionStore = {
    granted: [
      { name: "read", grantedAt: "2025-01-01T00:00:00Z" },
      { name: "env", grantedAt: "2025-01-01T00:00:00Z" },
    ],
  };
  const output = formatPermissions(store);
  assertEquals(output.includes("read: granted"), true);
  assertEquals(output.includes("env: granted"), true);
  assertEquals(output.includes("write: not granted"), true);
  assertEquals(output.includes("net: not granted"), true);
});

Deno.test("formatPermissions - empty store shows all not granted", () => {
  const output = formatPermissions({ granted: [] });
  assertEquals(output.includes("read: not granted"), true);
  assertEquals(output.includes("write: not granted"), true);
  assertEquals(output.includes("env: not granted"), true);
  assertEquals(output.includes("net: not granted"), true);
  assertEquals(output.includes("run: not granted"), true);
  assertEquals(output.includes("sys: not granted"), true);
});

// ============================================================
// buildPermissionFlags
// ============================================================

Deno.test("buildPermissionFlags - maps granted permissions to flags", () => {
  const store: PermissionStore = {
    granted: [
      { name: "read", grantedAt: "2025-01-01T00:00:00Z" },
      { name: "net", grantedAt: "2025-01-01T00:00:00Z" },
    ],
  };
  const flags = buildPermissionFlags(store);
  assertEquals(flags, ["--allow-read", "--allow-net"]);
});

Deno.test("buildPermissionFlags - empty store returns empty flags", () => {
  assertEquals(buildPermissionFlags({ granted: [] }), []);
});

// ============================================================
// Property-Based Tests
// ============================================================

import fc from "fast-check";

const ALL_PERMISSIONS = ["read", "write", "env", "net", "run", "sys"] as const;

// Feature: dacha-v2-redesign, Property 6: Permission store round-trip and reset
Deno.test("PBT: Permission store round-trip and reset", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "dacha-perm-pbt-" });

  try {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray([...ALL_PERMISSIONS]),
        async (permNames) => {
          const path = join(tmpDir, "permissions.json");

          const store: PermissionStore = {
            granted: permNames.map((name) => ({ name, grantedAt: new Date().toISOString() })),
          };

          await savePermissions(store, path);
          const loaded = await loadPermissions(path);
          const loadedNames = loaded.granted.map((e) => e.name).sort();
          assertEquals(loadedNames, [...permNames].sort());

          // Reset and verify empty
          await resetPermissions(path);
          const afterReset = await loadPermissions(path);
          assertEquals(afterReset.granted, []);
        },
      ),
      { numRuns: 100 },
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// Feature: dacha-v2-redesign, Property 7: Permission formatting completeness
Deno.test("PBT: Permission formatting completeness", () => {
  fc.assert(
    fc.property(
      fc.subarray([...ALL_PERMISSIONS]),
      (permNames) => {
        const store: PermissionStore = {
          granted: permNames.map((name) => ({ name, grantedAt: new Date().toISOString() })),
        };
        const output = formatPermissions(store);

        // Every granted permission name appears as "granted" in the output
        for (const name of permNames) {
          assertEquals(output.includes(`${name}: granted`), true, `missing granted entry for ${name}`);
        }

        // Every non-granted permission appears as "not granted"
        const notGranted = ALL_PERMISSIONS.filter((p) => !permNames.includes(p));
        for (const name of notGranted) {
          assertEquals(output.includes(`${name}: not granted`), true, `missing not-granted entry for ${name}`);
        }
      },
    ),
    { numRuns: 100 },
  );
});
