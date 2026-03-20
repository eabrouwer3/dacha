// Init command — clone or pull a dotfiles repo, write global config,
// run synth + apply, and optionally set up sync daemon and update scheduler.

import { dirname, join } from "@std/path";
import { gitClone, gitPull } from "./util/git.ts";
import { synth } from "./synth.ts";
import { apply } from "./apply.ts";
import { resetParams } from "./params.ts";
import { installSyncLaunchd } from "./sync/launchd.ts";
import { installSyncSystemd } from "./sync/systemd.ts";
import {
  installUpdateLaunchd,
  installUpdateSystemd,
} from "./update/scheduler.ts";
import { exec } from "./util/shell.ts";
import { error, info, success, warn } from "./util/log.ts";

/** Options accepted by the init command. */
export interface InitOpts {
  path?: string;
  reconfigure?: boolean;
  yes?: boolean;
}

/** Resolve the default dotfiles path (~/.dacha). */
function defaultRepoPath(): string {
  const home = Deno.env.get("HOME") ?? "~";
  return join(home, ".dacha");
}

/** Return the global config path (~/.config/dacha/config.json). */
function globalConfigPath(): string {
  const home = Deno.env.get("HOME") ?? "~";
  return join(home, ".config", "dacha", "config.json");
}

/** Check if a directory exists. */
async function dirExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

/** Write the global config file with the repo path. */
async function writeGlobalConfig(repoPath: string): Promise<void> {
  const configPath = globalConfigPath();
  const dir = dirname(configPath);
  await Deno.mkdir(dir, { recursive: true });

  const config = JSON.stringify({ repoPath }, null, 2) + "\n";
  await Deno.writeTextFile(configPath, config);
  info(`wrote config to ${configPath}`);
}

/** Install the sync daemon for the current platform. */
async function installSync(dachaPath: string): Promise<void> {
  const os = Deno.build.os;
  if (os === "darwin") {
    await installSyncLaunchd(dachaPath);
  } else if (os === "linux") {
    await installSyncSystemd(dachaPath);
  } else {
    warn(`sync daemon not supported on ${os}`);
  }
}

/** Install the update scheduler for the current platform. */
async function installUpdate(dachaPath: string): Promise<void> {
  const os = Deno.build.os;
  if (os === "darwin") {
    await installUpdateLaunchd(dachaPath);
  } else if (os === "linux") {
    await installUpdateSystemd(dachaPath);
  } else {
    warn(`update scheduler not supported on ${os}`);
  }
}

/**
 * Run the init/bootstrap flow:
 * 1. Clone or pull the dotfiles repo
 * 2. Write global config
 * 3. Optionally reset params (--reconfigure)
 * 4. Synth + apply
 * 5. Set up sync daemon and update scheduler if enabled
 */
export async function init(url: string, opts: InitOpts = {}): Promise<void> {
  const repoPath = opts.path ?? defaultRepoPath();

  // Ensure Xcode CLT is installed on macOS (required for git)
  if (Deno.build.os === "darwin") {
    const check = await exec("xcode-select -p");
    if (check.code !== 0) {
      info("installing Xcode Command Line Tools (required for git)...");
      await exec("xcode-select --install 2>/dev/null || true");
      // xcode-select --install is async (opens a UI dialog), so wait for it
      info("waiting for Xcode CLT installation to complete...");
      while ((await exec("xcode-select -p")).code !== 0) {
        await new Promise((r) => setTimeout(r, 5000));
      }
      success("Xcode Command Line Tools installed");
    }
  }

  // Clone or pull
  if (await dirExists(repoPath)) {
    info(`repo already exists at ${repoPath} — pulling latest`);
    const result = await gitPull(repoPath);
    if (result.code !== 0) {
      error(`git pull failed: ${result.stderr}`);
      throw new Error(`git pull failed: ${result.stderr}`);
    }
  } else {
    info(`cloning ${url} → ${repoPath}`);
    const result = await gitClone(url, repoPath);
    if (result.code !== 0) {
      error(`git clone failed: ${result.stderr}`);
      throw new Error(`git clone failed: ${result.stderr}`);
    }
  }

  // Write global config
  await writeGlobalConfig(repoPath);

  // Reset params if --reconfigure
  if (opts.reconfigure) {
    const home = Deno.env.get("HOME") ?? "~";
    const lockFilePath = join(home, ".config", "dacha", "params.lock.json");
    await resetParams(lockFilePath);
  }

  // Synth — resolve the config into desired state
  const configPath = join(repoPath, "dacha.config.ts");
  const state = await synth(configPath);

  // Apply — converge the system
  const report = await apply(state, { yes: opts.yes });

  if (report.failed.length > 0) {
    warn(`apply completed with ${report.failed.length} failure(s)`);
  }

  // Read the DachaConfig to check sync/update settings.
  // Re-import the config to access sync/update flags.
  const mod = await import(configPath);
  const configFn = mod.default;
  const { detectPlatform, resolvePaths } = await import("./platform.ts");
  const platform = detectPlatform();
  const paths = resolvePaths();
  const config = typeof configFn === "function"
    ? configFn({ platform, params: state.metadata.params, paths })
    : configFn;

  const dachaPath = Deno.execPath();

  // Install sync daemon if enabled
  if (config.sync?.enabled) {
    info("setting up sync daemon...");
    try {
      await installSync(dachaPath);
    } catch (err) {
      warn(`failed to install sync daemon: ${err}`);
    }
  }

  // Install update scheduler if enabled
  if (config.update?.enabled) {
    info("setting up update scheduler...");
    try {
      await installUpdate(dachaPath);
    } catch (err) {
      warn(`failed to install update scheduler: ${err}`);
    }
  }

  success("init complete");
}
