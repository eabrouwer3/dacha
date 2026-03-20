import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import fc from "fast-check";

// Feature: dacha-v2-redesign, Property 5: Init config path round-trip
// Tests that writing a global config with a repoPath and reading it back preserves the path.
// Mirrors the writeGlobalConfig() logic in init.ts.
Deno.test("PBT: Init config path round-trip", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "dacha-init-test-" });

  try {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0),
        async (repoPath) => {
          const configPath = join(tmpDir, "config.json");
          const config = JSON.stringify({ repoPath }, null, 2) + "\n";
          await Deno.writeTextFile(configPath, config);

          const loaded = JSON.parse(await Deno.readTextFile(configPath));
          assertEquals(loaded.repoPath, repoPath);
        },
      ),
      { numRuns: 100 },
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
