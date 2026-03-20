// GitRepo resource — clone a git repository into a local directory.

import { Resource } from "../resource.ts";
import type { Machine } from "../app.ts";
import type { OutputStore, Platform, ResourceResult } from "../types.ts";
import { exec } from "../util/shell.ts";
import { debug, info } from "../util/log.ts";

export interface GitRepoProps {
  /** GitHub repo in "owner/name" format, or a full URL. */
  repo: string;
  /** Local directory to clone into (supports ~). */
  destination: string;
  dependsOn?: Resource[];
}

/** Resolve `~` prefix to the user's home directory. */
function resolveHome(path: string): string {
  if (path.startsWith("~/")) {
    const home = Deno.env.get("HOME") ?? "/tmp";
    return home + path.slice(1);
  }
  return path;
}

/** Build a clone URL from a repo string. */
function repoUrl(repo: string): string {
  if (repo.includes("://") || repo.startsWith("git@")) return repo;
  return `https://github.com/${repo}.git`;
}

export class GitRepo extends Resource {
  static readonly resourceType = "git-repo";

  readonly repo: string;
  readonly destination: string;

  constructor(scope: Resource | Machine, id: string, props: GitRepoProps) {
    super(scope, id, props);
    this.repo = props.repo;
    this.destination = props.destination;
  }

  async check(_platform: Platform): Promise<boolean> {
    const dest = resolveHome(this.destination);
    try {
      const stat = await Deno.stat(`${dest}/.git`);
      const exists = stat.isDirectory;
      debug(`git-repo check: ${this.id} .git exists=${exists}`);
      return exists;
    } catch {
      debug(`git-repo check: ${this.id} not cloned`);
      return false;
    }
  }

  async apply(_platform: Platform, _outputs: OutputStore): Promise<ResourceResult> {
    const dest = resolveHome(this.destination);
    const url = repoUrl(this.repo);

    info(`cloning ${url} → ${this.destination}`);
    const result = await exec(`git clone ${url} ${dest}`);

    if (result.code !== 0) {
      return { status: "failed", error: result.stderr.trim() || `exit code ${result.code}` };
    }

    return { status: "applied" };
  }

  protected toProps(): Record<string, unknown> & { id: string } {
    return {
      id: this.id,
      repo: this.repo,
      destination: this.destination,
      dependsOn: this.dependsOn,
    };
  }
}
