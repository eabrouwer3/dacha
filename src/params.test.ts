import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  loadParams,
  type ParamsLockFile,
  readLockFile,
  resetParams,
  writeLockFile,
} from "./params.ts";

// Helper: create a temp dir and return its path + a lock file path inside it
async function makeTmpLockDir(): Promise<{ dir: string; lockPath: string }> {
  const dir = await Deno.makeTempDir({ prefix: "dacha-params-test-" });
  return { dir, lockPath: join(dir, "params.lock.json") };
}

// --- readLockFile ---

Deno.test("readLockFile - returns null for non-existent file", async () => {
  const result = await readLockFile("/tmp/dacha-does-not-exist-lock.json");
  assertEquals(result, null);
});

Deno.test("readLockFile - returns null for invalid JSON", async () => {
  const { dir, lockPath } = await makeTmpLockDir();
  try {
    await Deno.writeTextFile(lockPath, "not valid json {{{");
    const result = await readLockFile(lockPath);
    assertEquals(result, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readLockFile - returns null when version is missing", async () => {
  const { dir, lockPath } = await makeTmpLockDir();
  try {
    await Deno.writeTextFile(lockPath, JSON.stringify({ params: {} }));
    const result = await readLockFile(lockPath);
    assertEquals(result, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// --- writeLockFile ---

Deno.test("writeLockFile - creates the file with correct content", async () => {
  const { dir, lockPath } = await makeTmpLockDir();
  try {
    const lockFile: ParamsLockFile = {
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
      params: { gitEmail: "test@example.com", darkMode: true },
    };
    await writeLockFile(lockPath, lockFile);

    const raw = await Deno.readTextFile(lockPath);
    const parsed = JSON.parse(raw);
    assertEquals(parsed.version, 1);
    assertEquals(parsed.createdAt, "2026-01-01T00:00:00Z");
    assertEquals(parsed.params.gitEmail, "test@example.com");
    assertEquals(parsed.params.darkMode, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// --- readLockFile round-trip ---

Deno.test("readLockFile - reads back what writeLockFile wrote", async () => {
  const { dir, lockPath } = await makeTmpLockDir();
  try {
    const lockFile: ParamsLockFile = {
      version: 1,
      createdAt: "2026-03-19T12:00:00Z",
      params: { hostname: "my-macbook", enableGaming: false },
    };
    await writeLockFile(lockPath, lockFile);
    const result = await readLockFile(lockPath);

    assertEquals(result?.version, 1);
    assertEquals(result?.createdAt, "2026-03-19T12:00:00Z");
    assertEquals(result?.params.hostname, "my-macbook");
    assertEquals(result?.params.enableGaming, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// --- resetParams ---

Deno.test("resetParams - with name deletes only that param", async () => {
  const { dir, lockPath } = await makeTmpLockDir();
  try {
    const lockFile: ParamsLockFile = {
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
      params: { gitEmail: "a@b.com", hostname: "box" },
    };
    await writeLockFile(lockPath, lockFile);

    await resetParams(lockPath, "gitEmail");

    const result = await readLockFile(lockPath);
    assertEquals(result?.params.hostname, "box");
    assertEquals("gitEmail" in (result?.params ?? {}), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("resetParams - without name removes the entire file", async () => {
  const { dir, lockPath } = await makeTmpLockDir();
  try {
    const lockFile: ParamsLockFile = {
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
      params: { gitEmail: "a@b.com" },
    };
    await writeLockFile(lockPath, lockFile);

    await resetParams(lockPath);

    const result = await readLockFile(lockPath);
    assertEquals(result, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// --- loadParams (no prompting needed) ---

Deno.test("loadParams - returns existing params from lock file without prompting", async () => {
  const { dir, lockPath } = await makeTmpLockDir();
  try {
    const lockFile: ParamsLockFile = {
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
      params: { gitEmail: "saved@example.com", darkMode: true },
    };
    await writeLockFile(lockPath, lockFile);

    const params = await loadParams(
      [
        { name: "gitEmail", message: "Git email?", type: "text" },
        { name: "darkMode", message: "Dark mode?", type: "confirm" },
      ],
      lockPath,
    );

    assertEquals(params.gitEmail, "saved@example.com");
    assertEquals(params.darkMode, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
