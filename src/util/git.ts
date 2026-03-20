// Git CLI helpers — thin wrappers around `git` commands via shell.ts.

import { exec, type ExecResult } from "./shell.ts";
import { debug } from "./log.ts";

/** Clone a git repository to a local destination. */
export async function gitClone(
  url: string,
  dest: string,
): Promise<ExecResult> {
  debug(`git clone ${url} → ${dest}`);
  return await exec(["git", "clone", url, dest]);
}

/** Pull latest changes in a repo. */
export async function gitPull(repoDir: string): Promise<ExecResult> {
  debug(`git pull in ${repoDir}`);
  return await exec(["git", "pull"], { cwd: repoDir });
}

/** Stage files for commit. */
export async function gitAdd(
  repoDir: string,
  files: string | string[],
): Promise<ExecResult> {
  const fileList = Array.isArray(files) ? files : [files];
  debug(`git add ${fileList.join(" ")} in ${repoDir}`);
  return await exec(["git", "add", ...fileList], { cwd: repoDir });
}

/** Commit staged changes with a message. */
export async function gitCommit(
  repoDir: string,
  message: string,
): Promise<ExecResult> {
  debug(`git commit in ${repoDir}`);
  return await exec(["git", "commit", "-m", message], { cwd: repoDir });
}

/** Push commits to the remote. */
export async function gitPush(repoDir: string): Promise<ExecResult> {
  debug(`git push in ${repoDir}`);
  return await exec(["git", "push"], { cwd: repoDir });
}

/** Fetch from a remote (defaults to "origin"). */
export async function gitFetch(
  repoDir: string,
  remote = "origin",
): Promise<ExecResult> {
  debug(`git fetch ${remote} in ${repoDir}`);
  return await exec(["git", "fetch", remote], { cwd: repoDir });
}

/** Return the list of file names changed between two refs. */
export async function gitDiffNames(
  repoDir: string,
  from: string,
  to: string,
): Promise<string[]> {
  debug(`git diff --name-only ${from}..${to} in ${repoDir}`);
  const result = await exec(
    ["git", "diff", "--name-only", `${from}..${to}`],
    { cwd: repoDir },
  );
  if (result.code !== 0) return [];
  return result.stdout.trim().split("\n").filter((l) => l.length > 0);
}

/** Get the working tree status. */
export async function gitStatus(repoDir: string): Promise<ExecResult> {
  debug(`git status in ${repoDir}`);
  return await exec(["git", "status", "--porcelain"], { cwd: repoDir });
}
