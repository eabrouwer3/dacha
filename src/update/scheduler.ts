// Generate and manage launchd/systemd timers for periodic update checks.

import { join } from "@std/path";
import { exec } from "../util/shell.ts";
import { debug, error, info, warn } from "../util/log.ts";

/** Default check interval in seconds (24 hours). */
const DEFAULT_INTERVAL_SECS = 86400;

// --- macOS launchd ---

const LAUNCHD_LABEL = "dev.dacha.update";
const PLIST_FILENAME = `${LAUNCHD_LABEL}.plist`;

function plistPath(): string {
  const home = Deno.env.get("HOME") ?? "~";
  return join(home, "Library", "LaunchAgents", PLIST_FILENAME);
}

function launchdLogPath(): string {
  const home = Deno.env.get("HOME") ?? "~";
  return join(home, "Library", "Logs", "dacha-update.log");
}

/**
 * Generate the launchd plist XML for periodic update checks.
 * @param dachaPath - Absolute path to the `dacha` binary.
 * @param intervalSecs - Check interval in seconds (default 86400 = 24h).
 */
export function generateUpdatePlist(
  dachaPath: string,
  intervalSecs = DEFAULT_INTERVAL_SECS,
): string {
  const log = launchdLogPath();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${dachaPath}</string>
    <string>update</string>
  </array>
  <key>StartInterval</key>
  <integer>${intervalSecs}</integer>
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
 * @param intervalSecs - Check interval in seconds (default 86400 = 24h).
 */
export async function installUpdateLaunchd(
  dachaPath: string,
  intervalSecs = DEFAULT_INTERVAL_SECS,
): Promise<void> {
  const dest = plistPath();

  const dir = join(Deno.env.get("HOME") ?? "~", "Library", "LaunchAgents");
  await Deno.mkdir(dir, { recursive: true });

  const logsDir = join(Deno.env.get("HOME") ?? "~", "Library", "Logs");
  await Deno.mkdir(logsDir, { recursive: true });

  const plist = generateUpdatePlist(dachaPath, intervalSecs);
  await Deno.writeTextFile(dest, plist);
  info(`wrote plist to ${dest}`);

  // Unload first in case it's already loaded (ignore errors)
  debug("unloading existing plist (if any)");
  await exec(["launchctl", "unload", dest]);

  const result = await exec(["launchctl", "load", dest]);
  if (result.code !== 0) {
    error(`launchctl load failed: ${result.stderr}`);
    throw new Error(`failed to load launchd plist: ${result.stderr}`);
  }

  info(`loaded launchd agent ${LAUNCHD_LABEL}`);
}

/** Unload and remove the launchd plist. */
export async function uninstallUpdateLaunchd(): Promise<void> {
  const dest = plistPath();

  const unload = await exec(["launchctl", "unload", dest]);
  if (unload.code !== 0) {
    warn(`launchctl unload failed (may not be loaded): ${unload.stderr}`);
  } else {
    info(`unloaded launchd agent ${LAUNCHD_LABEL}`);
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

// --- Linux systemd ---

const TIMER_FILENAME = "dacha-update.timer";
const SERVICE_FILENAME = "dacha-update.service";

function systemdDir(): string {
  const home = Deno.env.get("HOME") ?? "~";
  return join(home, ".config", "systemd", "user");
}

function timerPath(): string {
  return join(systemdDir(), TIMER_FILENAME);
}

function servicePath(): string {
  return join(systemdDir(), SERVICE_FILENAME);
}

/**
 * Generate the systemd service unit that runs `dacha update`.
 * @param dachaPath - Absolute path to the `dacha` binary.
 */
export function generateUpdateService(dachaPath: string): string {
  return `[Unit]
Description=dacha update check

[Service]
Type=oneshot
ExecStart=${dachaPath} update
`;
}

/**
 * Generate the systemd timer unit for periodic update checks.
 * @param intervalSecs - Check interval in seconds (default 86400 = 24h).
 */
export function generateUpdateTimer(
  intervalSecs = DEFAULT_INTERVAL_SECS,
): string {
  return `[Unit]
Description=dacha periodic update check

[Timer]
OnBootSec=${intervalSecs}
OnUnitActiveSec=${intervalSecs}
Persistent=true

[Install]
WantedBy=timers.target
`;
}

/**
 * Write the systemd service + timer units, reload, enable and start the timer.
 * @param dachaPath - Absolute path to the `dacha` binary.
 * @param intervalSecs - Check interval in seconds (default 86400 = 24h).
 */
export async function installUpdateSystemd(
  dachaPath: string,
  intervalSecs = DEFAULT_INTERVAL_SECS,
): Promise<void> {
  const dir = systemdDir();
  await Deno.mkdir(dir, { recursive: true });

  // Write service unit
  const svc = generateUpdateService(dachaPath);
  await Deno.writeTextFile(servicePath(), svc);
  info(`wrote service unit to ${servicePath()}`);

  // Write timer unit
  const timer = generateUpdateTimer(intervalSecs);
  await Deno.writeTextFile(timerPath(), timer);
  info(`wrote timer unit to ${timerPath()}`);

  // Reload systemd to pick up new/changed units
  debug("reloading systemd user daemon");
  const reload = await exec(["systemctl", "--user", "daemon-reload"]);
  if (reload.code !== 0) {
    warn(`daemon-reload failed: ${reload.stderr}`);
  }

  const enable = await exec(["systemctl", "--user", "enable", TIMER_FILENAME]);
  if (enable.code !== 0) {
    error(`systemctl enable failed: ${enable.stderr}`);
    throw new Error(`failed to enable systemd timer: ${enable.stderr}`);
  }

  const start = await exec(["systemctl", "--user", "start", TIMER_FILENAME]);
  if (start.code !== 0) {
    error(`systemctl start failed: ${start.stderr}`);
    throw new Error(`failed to start systemd timer: ${start.stderr}`);
  }

  info(`enabled and started systemd timer ${TIMER_FILENAME}`);
}

/** Stop, disable, and remove the systemd timer + service units. */
export async function uninstallUpdateSystemd(): Promise<void> {
  const stop = await exec(["systemctl", "--user", "stop", TIMER_FILENAME]);
  if (stop.code !== 0) {
    warn(`systemctl stop failed (may not be running): ${stop.stderr}`);
  } else {
    info(`stopped systemd timer ${TIMER_FILENAME}`);
  }

  const disable = await exec([
    "systemctl",
    "--user",
    "disable",
    TIMER_FILENAME,
  ]);
  if (disable.code !== 0) {
    warn(`systemctl disable failed (may not be enabled): ${disable.stderr}`);
  } else {
    info(`disabled systemd timer ${TIMER_FILENAME}`);
  }

  // Remove both timer and service files
  for (const path of [timerPath(), servicePath()]) {
    try {
      await Deno.remove(path);
      info(`removed ${path}`);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        error(`failed to remove unit file: ${err}`);
        throw err;
      }
      debug(`unit file not found at ${path} — nothing to remove`);
    }
  }

  // Reload so systemd forgets the removed units
  await exec(["systemctl", "--user", "daemon-reload"]);
}
