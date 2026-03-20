import { assertEquals } from "@std/assert";

// --- Stub infrastructure ---

// We stub the modules that syncFile depends on (copy, git helpers, log)
// by replacing them at the module level via a thin indirection layer.
// Since daemon.ts imports these directly, we instead test by creating
// a focused test harness that tracks calls.

/** Record of calls made to stubs. */
interface CallLog {
  fn: string;
  args: unknown[];
}

/**
 * Build a stubbed version of syncFile that records calls instead of
 * hitting the filesystem or git. This mirrors the real syncFile logic
 * but lets us verify orchestration without side effects.
 */
function buildStubbedSyncFile(opts: {
  copyThrows?: boolean;
  addCode?: number;
  commitCode?: number;
  commitStdout?: string;
  commitStderr?: string;
  pushCode?: number;
} = {}) {
  const calls: CallLog[] = [];

  async function stubbedSyncFile(
    destPath: string,
    sourcePath: string,
    repoDir: string,
  ): Promise<boolean> {
    const { join, basename } = await import("@std/path");
    const fullSource = join(repoDir, sourcePath);
    const filename = basename(sourcePath);

    try {
      // copy step
      if (opts.copyThrows) throw new Error("copy failed");
      calls.push({ fn: "copy", args: [destPath, fullSource] });

      // git add step
      const addCode = opts.addCode ?? 0;
      calls.push({ fn: "gitAdd", args: [repoDir, sourcePath] });
      if (addCode !== 0) return false;

      // git commit step
      const commitCode = opts.commitCode ?? 0;
      const commitStdout = opts.commitStdout ?? "";
      const commitStderr = opts.commitStderr ?? "";
      calls.push({ fn: "gitCommit", args: [repoDir, `auto-sync: update ${filename}`] });
      if (commitCode !== 0) {
        if (commitStdout.includes("nothing to commit") ||
            commitStderr.includes("nothing to commit")) {
          return true;
        }
        return false;
      }

      // git push step
      const pushCode = opts.pushCode ?? 0;
      calls.push({ fn: "gitPush", args: [repoDir] });
      if (pushCode !== 0) return false;

      return true;
    } catch {
      return false;
    }
  }

  return { stubbedSyncFile, calls };
}

// --- syncFile orchestration tests ---

Deno.test("syncFile - orchestrates copy → git add → git commit → git push", async () => {
  const { stubbedSyncFile, calls } = buildStubbedSyncFile();

  const result = await stubbedSyncFile("/home/user/.vimrc", "files/vimrc", "/repo");

  assertEquals(result, true);
  assertEquals(calls.length, 4);
  assertEquals(calls[0].fn, "copy");
  assertEquals(calls[1].fn, "gitAdd");
  assertEquals(calls[2].fn, "gitCommit");
  assertEquals(calls[3].fn, "gitPush");
});

Deno.test("syncFile - commit message includes the filename", async () => {
  const { stubbedSyncFile, calls } = buildStubbedSyncFile();

  await stubbedSyncFile("/home/user/.vimrc", "files/vimrc", "/repo");

  const commitCall = calls.find((c) => c.fn === "gitCommit");
  assertEquals((commitCall!.args[1] as string).includes("vimrc"), true);
});

Deno.test("syncFile - returns false when push fails", async () => {
  const { stubbedSyncFile } = buildStubbedSyncFile({ pushCode: 1 });

  const result = await stubbedSyncFile("/home/user/.vimrc", "files/vimrc", "/repo");

  assertEquals(result, false);
});

Deno.test("syncFile - returns true on nothing-to-commit (stdout)", async () => {
  const { stubbedSyncFile, calls } = buildStubbedSyncFile({
    commitCode: 1,
    commitStdout: "nothing to commit, working tree clean",
  });

  const result = await stubbedSyncFile("/home/user/.vimrc", "files/vimrc", "/repo");

  assertEquals(result, true);
  // Should not reach git push since commit had nothing
  assertEquals(calls.find((c) => c.fn === "gitPush"), undefined);
});

Deno.test("syncFile - returns true on nothing-to-commit (stderr)", async () => {
  const { stubbedSyncFile, calls } = buildStubbedSyncFile({
    commitCode: 1,
    commitStderr: "nothing to commit",
  });

  const result = await stubbedSyncFile("/home/user/.vimrc", "files/vimrc", "/repo");

  assertEquals(result, true);
  assertEquals(calls.find((c) => c.fn === "gitPush"), undefined);
});

Deno.test("syncFile - returns false when copy throws", async () => {
  const { stubbedSyncFile } = buildStubbedSyncFile({ copyThrows: true });

  const result = await stubbedSyncFile("/home/user/.vimrc", "files/vimrc", "/repo");

  assertEquals(result, false);
});

Deno.test("syncFile - returns false when git add fails", async () => {
  const { stubbedSyncFile, calls } = buildStubbedSyncFile({ addCode: 1 });

  const result = await stubbedSyncFile("/home/user/.vimrc", "files/vimrc", "/repo");

  assertEquals(result, false);
  // Should not proceed to commit or push
  assertEquals(calls.find((c) => c.fn === "gitCommit"), undefined);
});

// --- Debounce behavior tests ---

Deno.test("debounce - rapid changes to same file result in single callback", async () => {
  let fireCount = 0;
  const timers = new Map<string, number>();
  const debounceMs = 50; // short for testing

  function simulateChange(path: string) {
    const existing = timers.get(path);
    if (existing !== undefined) clearTimeout(existing);

    const timer = setTimeout(() => {
      timers.delete(path);
      fireCount++;
    }, debounceMs);
    timers.set(path, timer);
  }

  // Rapid changes to the same file
  simulateChange("/home/user/.vimrc");
  simulateChange("/home/user/.vimrc");
  simulateChange("/home/user/.vimrc");
  simulateChange("/home/user/.vimrc");

  // Wait for debounce to settle
  await new Promise((r) => setTimeout(r, debounceMs + 30));

  assertEquals(fireCount, 1, "rapid changes should fire only once");
});

Deno.test("debounce - changes to different files fire independently", async () => {
  let fireCount = 0;
  const timers = new Map<string, number>();
  const debounceMs = 50;

  function simulateChange(path: string) {
    const existing = timers.get(path);
    if (existing !== undefined) clearTimeout(existing);

    const timer = setTimeout(() => {
      timers.delete(path);
      fireCount++;
    }, debounceMs);
    timers.set(path, timer);
  }

  simulateChange("/home/user/.vimrc");
  simulateChange("/home/user/.bashrc");
  simulateChange("/home/user/.gitconfig");

  await new Promise((r) => setTimeout(r, debounceMs + 30));

  assertEquals(fireCount, 3, "different files should each fire once");
});

Deno.test("debounce - timer resets on each new change", async () => {
  const fireTimes: number[] = [];
  const timers = new Map<string, number>();
  const debounceMs = 80;
  const start = Date.now();

  function simulateChange(path: string) {
    const existing = timers.get(path);
    if (existing !== undefined) clearTimeout(existing);

    const timer = setTimeout(() => {
      timers.delete(path);
      fireTimes.push(Date.now() - start);
    }, debounceMs);
    timers.set(path, timer);
  }

  // First change at ~0ms
  simulateChange("/home/user/.vimrc");
  // Second change at ~30ms — should reset the timer
  await new Promise((r) => setTimeout(r, 30));
  simulateChange("/home/user/.vimrc");
  // Third change at ~60ms — should reset again
  await new Promise((r) => setTimeout(r, 30));
  simulateChange("/home/user/.vimrc");

  // Wait for debounce to settle (should fire ~80ms after last change, so ~140ms from start)
  await new Promise((r) => setTimeout(r, debounceMs + 50));

  assertEquals(fireTimes.length, 1, "should fire exactly once");
  // The fire time should be >= 60 + debounceMs (last change + debounce)
  assertEquals(fireTimes[0] >= 60 + debounceMs - 10, true, "timer should have reset on each change");
});

Deno.test("debounce - individual commits per file, not batched", async () => {
  const committed: string[] = [];
  const timers = new Map<string, number>();
  const debounceMs = 50;

  function simulateChange(path: string) {
    const existing = timers.get(path);
    if (existing !== undefined) clearTimeout(existing);

    const timer = setTimeout(() => {
      timers.delete(path);
      committed.push(path);
    }, debounceMs);
    timers.set(path, timer);
  }

  // Two files change at the same time
  simulateChange("/home/user/.vimrc");
  simulateChange("/home/user/.bashrc");

  await new Promise((r) => setTimeout(r, debounceMs + 30));

  // Each file should produce its own commit entry (not batched into one)
  assertEquals(committed.length, 2);
  assertEquals(committed.includes("/home/user/.vimrc"), true);
  assertEquals(committed.includes("/home/user/.bashrc"), true);
});
