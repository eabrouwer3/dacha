// Generate and manage Linux systemd user unit for the sync daemon.

import { join } from "@std/path";
import { exec } from "../util/shell.ts";
import { debug, error, info, warn } from "../util/log.ts";

const UNIT_FILENAME = "dacha-sync.service";

/** Returns the path to the systemd user unit file. */
function unitPath(): string {
  const home = Deno.env.get("HOME") ?? "~";
  return join(home, ".config", "systemd", "user", UNIT_FILENAME);
}

/**
 * Generate the systemd user unit file content for the sync daemon.
 * @param dachaPath - Absolute path to the `dacha` binary.
 */
export function generateSyncUnit(dachaPath: string): string {
  return `[Unit]
Description=dacha sync daemon

[Service]
ExecStart=${dachaPath} sync run
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

/**
 * Write the systemd user unit, reload the daemon, enable and start the service.
 * @param dachaPath - Absolute path to the `dacha` binary.
 */
export async function installSyncSystemd(dachaPath: string): Promise<void> {
  const dest = unitPath();

  // Ensure the systemd user directory exists
  const dir = join(Deno.env.get("HOME") ?? "~", ".config", "systemd", "user");
  await Deno.mkdir(dir, { recursive: true });

  const unit = generateSyncUnit(dachaPath);
  await Deno.writeTextFile(dest, unit);
  info(`wrote unit file to ${dest}`);

  // Reload systemd to pick up the new/changed unit
  debug("reloading systemd user daemon");
  const reload = await exec(["systemctl", "--user", "daemon-reload"]);
  if (reload.code !== 0) {
    warn(`daemon-reload failed: ${reload.stderr}`);
  }

  const enable = await exec(["systemctl", "--user", "enable", UNIT_FILENAME]);
  if (enable.code !== 0) {
    error(`systemctl enable failed: ${enable.stderr}`);
    throw new Error(`failed to enable systemd unit: ${enable.stderr}`);
  }

  const start = await exec(["systemctl", "--user", "start", UNIT_FILENAME]);
  if (start.code !== 0) {
    error(`systemctl start failed: ${start.stderr}`);
    throw new Error(`failed to start systemd unit: ${start.stderr}`);
  }

  info(`enabled and started systemd unit ${UNIT_FILENAME}`);
}

/**
 * Stop, disable, and remove the systemd user unit.
 */
export async function uninstallSyncSystemd(): Promise<void> {
  const dest = unitPath();

  const stop = await exec(["systemctl", "--user", "stop", UNIT_FILENAME]);
  if (stop.code !== 0) {
    warn(`systemctl stop failed (may not be running): ${stop.stderr}`);
  } else {
    info(`stopped systemd unit ${UNIT_FILENAME}`);
  }

  const disable = await exec([
    "systemctl",
    "--user",
    "disable",
    UNIT_FILENAME,
  ]);
  if (disable.code !== 0) {
    warn(`systemctl disable failed (may not be enabled): ${disable.stderr}`);
  } else {
    info(`disabled systemd unit ${UNIT_FILENAME}`);
  }

  try {
    await Deno.remove(dest);
    info(`removed ${dest}`);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      error(`failed to remove unit file: ${err}`);
      throw err;
    }
    debug(`unit file not found at ${dest} — nothing to remove`);
  }

  // Reload so systemd forgets the removed unit
  await exec(["systemctl", "--user", "daemon-reload"]);
}
