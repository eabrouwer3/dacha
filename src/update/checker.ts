// Update checker — fetches from remote and checks if local is behind origin/main.
// Writes update-pending.json to the data dir when updates are available.

import { dirname } from "@std/path";
import { exec } from "../util/shell.ts";
import { gitFetch, gitDiffNames } from "../util/git.ts";
import { info, warn, debug } from "../util/log.ts";

/** Shape of the update-pending.json file. */
export interface UpdatePending {
  checkedAt: string;
  behind: boolean;
  changedFiles: string[];
  localRef: string;
  remoteRef: string;
}

/** Default path for the pending-update state file. */
function defaultPendingPath(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "/tmp";
  return `${home}/.local/share/dacha/update-pending.json`;
}

/** Resolve a git ref to its SHA in the given repo. */
async function resolveRef(repoDir: string, ref: string): Promise<string | null> {
  const result = await exec(["git", "rev-parse", ref], { cwd: repoDir });
  if (result.code !== 0) return null;
  return result.stdout.trim();
}

/**
 * Check for remote updates by fetching origin and comparing HEAD to origin/main.
 * Writes the result to `~/.local/share/dacha/update-pending.json`.
 *
 * Returns the UpdatePending result.
 */
export async function checkForUpdates(
  repoDir: string,
  opts?: { pendingPath?: string; remote?: string; branch?: string },
): Promise<UpdatePending> {
  const remote = opts?.remote ?? "origin";
  const branch = opts?.branch ?? "main";
  const pendingPath = opts?.pendingPath ?? defaultPendingPath();

  // Fetch latest from remote
  info("fetching remote updates...");
  const fetchResult = await gitFetch(repoDir, remote);
  if (fetchResult.code !== 0) {
    warn(`git fetch failed: ${fetchResult.stderr}`);
  }

  // Resolve local HEAD and remote branch
  const localRef = await resolveRef(repoDir, "HEAD");
  const remoteRef = await resolveRef(repoDir, `${remote}/${branch}`);

  if (!localRef || !remoteRef) {
    warn("could not resolve local or remote ref");
    const result: UpdatePending = {
      checkedAt: new Date().toISOString(),
      behind: false,
      changedFiles: [],
      localRef: localRef ?? "",
      remoteRef: remoteRef ?? "",
    };
    await writePending(pendingPath, result);
    return result;
  }

  const behind = localRef !== remoteRef;
  let changedFiles: string[] = [];

  if (behind) {
    changedFiles = await gitDiffNames(repoDir, localRef, remoteRef);
    info(`${changedFiles.length} file(s) changed on remote`);
    debug(`changed: ${changedFiles.join(", ")}`);
  } else {
    debug("up to date with remote");
  }

  const result: UpdatePending = {
    checkedAt: new Date().toISOString(),
    behind,
    changedFiles,
    localRef,
    remoteRef,
  };

  await writePending(pendingPath, result);
  return result;
}

/** Write the update-pending JSON, ensuring parent dirs exist. */
async function writePending(path: string, data: UpdatePending): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2) + "\n", {
    create: true,
  });
  debug(`wrote ${path}`);
}
