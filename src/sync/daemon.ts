// Sync daemon — watches managed dotfiles, debounces changes, and syncs
// them back to the git repo via individual commits + push.

import { join, basename } from "@std/path";
import { copy } from "@std/fs";
import { gitAdd, gitCommit, gitPush } from "../util/git.ts";
import { isOnline } from "../util/network.ts";
import { info, warn, error, debug } from "../util/log.ts";

/** Configuration for the sync daemon. */
export interface DaemonConfig {
  /** Absolute path to the dotfiles git repo. */
  repoDir: string;
  /** Map of destination path → source path (relative to repoDir). */
  watchPaths: Map<string, string>;
  /** Debounce delay in milliseconds (default 2000). */
  debounceMs?: number;
}

/** Default debounce delay. */
const DEFAULT_DEBOUNCE_MS = 2000;

/** Retry interval for pending pushes (ms). */
const RETRY_INTERVAL_MS = 60_000;

/**
 * Copy a changed destination file back to the repo, then git add + commit + push.
 * Returns true if the push succeeded, false otherwise.
 */
export async function syncFile(
  destPath: string,
  sourcePath: string,
  repoDir: string,
): Promise<boolean> {
  const fullSource = join(repoDir, sourcePath);
  const filename = basename(sourcePath);

  try {
    // Copy destination → repo source
    await copy(destPath, fullSource, { overwrite: true });
    debug(`copied ${destPath} → ${fullSource}`);

    // Stage the file
    const addResult = await gitAdd(repoDir, sourcePath);
    if (addResult.code !== 0) {
      error(`git add failed for ${sourcePath}: ${addResult.stderr}`);
      return false;
    }

    // Commit with individual message
    const commitResult = await gitCommit(
      repoDir,
      `auto-sync: update ${filename}`,
    );
    if (commitResult.code !== 0) {
      // Nothing to commit is not a real error (file unchanged after copy)
      if (commitResult.stdout.includes("nothing to commit") ||
          commitResult.stderr.includes("nothing to commit")) {
        debug(`nothing to commit for ${sourcePath}`);
        return true;
      }
      error(`git commit failed for ${sourcePath}: ${commitResult.stderr}`);
      return false;
    }

    info(`committed: auto-sync: update ${filename}`);

    // Push
    const pushResult = await gitPush(repoDir);
    if (pushResult.code !== 0) {
      warn(`git push failed: ${pushResult.stderr}`);
      return false;
    }

    info(`pushed sync for ${filename}`);
    return true;
  } catch (err) {
    error(`syncFile error for ${destPath}: ${err}`);
    return false;
  }
}

/**
 * Start the sync daemon. This is a long-lived process that:
 * 1. Watches all destination paths for changes via Deno.watchFs
 * 2. Debounces per-file changes (default 2s)
 * 3. On debounce fire: copies dest→source, git add, commit, push
 * 4. On push failure: buffers locally, retries every 60s when online
 * 5. Logs all activity
 */
export async function startDaemon(config: DaemonConfig): Promise<void> {
  const { repoDir, watchPaths } = config;
  const debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  if (watchPaths.size === 0) {
    warn("no watch paths configured — daemon has nothing to watch");
    return;
  }

  // Per-file debounce timers
  const timers = new Map<string, number>();

  // Pending pushes that failed (dest → source pairs needing retry)
  const pendingPushes = new Set<string>();

  info(`sync daemon starting — watching ${watchPaths.size} file(s)`);
  debug(`debounce: ${debounceMs}ms, retry interval: ${RETRY_INTERVAL_MS}ms`);

  // Start the periodic retry loop for failed pushes
  const retryTimer = setInterval(async () => {
    if (pendingPushes.size === 0) return;

    const online = await isOnline();
    if (!online) {
      debug("offline — skipping pending push retry");
      return;
    }

    info(`retrying ${pendingPushes.size} pending push(es)...`);

    for (const destPath of [...pendingPushes]) {
      const sourcePath = watchPaths.get(destPath);
      if (!sourcePath) {
        pendingPushes.delete(destPath);
        continue;
      }

      const pushResult = await gitPush(repoDir);
      if (pushResult.code === 0) {
        info(`pending push succeeded for ${basename(sourcePath)}`);
        pendingPushes.delete(destPath);
      } else {
        debug(`pending push still failing for ${sourcePath}`);
      }
    }
  }, RETRY_INTERVAL_MS);

  // Ensure the retry timer doesn't keep the process alive if we're shutting down
  Deno.unrefTimer(retryTimer);

  const destPaths = [...watchPaths.keys()];
  const watcher = Deno.watchFs(destPaths);

  info(`watching: ${destPaths.join(", ")}`);

  for await (const event of watcher) {
    // We care about modify and create events
    if (event.kind !== "modify" && event.kind !== "create") continue;

    for (const path of event.paths) {
      const sourcePath = watchPaths.get(path);
      if (!sourcePath) continue;

      // Reset debounce timer for this file
      const existing = timers.get(path);
      if (existing !== undefined) {
        clearTimeout(existing);
      }

      const timer = setTimeout(async () => {
        timers.delete(path);
        debug(`debounce fired for ${path}`);

        const ok = await syncFile(path, sourcePath, repoDir);
        if (!ok) {
          warn(`sync failed for ${basename(sourcePath)} — queued for retry`);
          pendingPushes.add(path);
        } else {
          // If it was pending before, clear it
          pendingPushes.delete(path);
        }
      }, debounceMs);

      timers.set(path, timer);
    }
  }
}
