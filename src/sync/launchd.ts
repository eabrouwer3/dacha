// Generate and manage macOS launchd plist for the sync daemon.

import { join } from "@std/path";
import { exec } from "../util/shell.ts";
import { info, warn, error, debug } from "../util/log.ts";

const LABEL = "dev.dacha.sync";
const PLIST_FILENAME = `${LABEL}.plist`;

/** Returns the path to the LaunchAgents plist file. */
function plistPath(): string {
  const home = Deno.env.get("HOME") ?? "~";
  return join(home, "Library", "LaunchAgents", PLIST_FILENAME);
}

/** Returns the path to the daemon log file. */
function logPath(): string {
  const home = Deno.env.get("HOME") ?? "~";
  return join(home, "Library", "Logs", "dacha-sync.log");
}

/**
 * Generate the launchd plist XML content for the sync daemon.
 * @param dachaPath - Absolute path to the `dacha` binary.
 */
export function generateSyncPlist(dachaPath: string): string {
  const log = logPath();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${dachaPath}</string>
    <string>sync</string>
    <string>run</string>
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${log}</string>
  <key>StandardErrorPath</key>
  <string>${log}</string>
</dict>
</plist>
`;
}

/**
 * Write the launchd plist and load it via launchctl.
 * @param dachaPath - Absolute path to the `dacha` binary.
 */
export async function installSyncLaunchd(dachaPath: string): Promise<void> {
  const dest = plistPath();

  // Ensure the LaunchAgents directory exists
  const dir = join(Deno.env.get("HOME") ?? "~", "Library", "LaunchAgents");
  await Deno.mkdir(dir, { recursive: true });

  // Ensure the Logs directory exists
  const logsDir = join(Deno.env.get("HOME") ?? "~", "Library", "Logs");
  await Deno.mkdir(logsDir, { recursive: true });

  const plist = generateSyncPlist(dachaPath);
  await Deno.writeTextFile(dest, plist);
  info(`wrote plist to ${dest}`);

  // Unload first in case it's already loaded (ignore errors)
  debug(`unloading existing plist (if any)`);
  await exec(["launchctl", "unload", dest]);

  const result = await exec(["launchctl", "load", dest]);
  if (result.code !== 0) {
    error(`launchctl load failed: ${result.stderr}`);
    throw new Error(`failed to load launchd plist: ${result.stderr}`);
  }

  info(`loaded launchd agent ${LABEL}`);
}

/**
 * Unload and remove the launchd plist.
 */
export async function uninstallSyncLaunchd(): Promise<void> {
  const dest = plistPath();

  const unload = await exec(["launchctl", "unload", dest]);
  if (unload.code !== 0) {
    warn(`launchctl unload failed (may not be loaded): ${unload.stderr}`);
  } else {
    info(`unloaded launchd agent ${LABEL}`);
  }

  try {
    await Deno.remove(dest);
    info(`removed ${dest}`);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      error(`failed to remove plist: ${err}`);
      throw err;
    }
    debug(`plist not found at ${dest} — nothing to remove`);
  }
}
