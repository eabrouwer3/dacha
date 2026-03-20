// Platform notification dispatch — sends desktop notifications for pending updates.
// macOS: terminal-notifier, Linux: notify-send.

import { exec } from "../util/shell.ts";
import { info, warn, debug } from "../util/log.ts";
import type { UpdatePending } from "./checker.ts";

/** Max files to list in the notification body before truncating. */
const MAX_FILES_SHOWN = 5;

/** Format the notification body from a list of changed files. */
export function formatBody(changedFiles: string[]): string {
  const count = changedFiles.length;
  if (count === 0) return "No files changed.";

  const shown = changedFiles.slice(0, MAX_FILES_SHOWN);
  const lines = shown.join(", ");
  const remaining = count - shown.length;

  return remaining > 0
    ? `${lines} (+${remaining} more)`
    : lines;
}

/**
 * Send a desktop notification about pending updates.
 * Gracefully handles missing notification tools (warns instead of throwing).
 */
export async function notify(update: UpdatePending): Promise<void> {
  const count = update.changedFiles.length;
  const subtitle = `${count} file${count === 1 ? "" : "s"} changed`;
  const body = formatBody(update.changedFiles);
  const os = Deno.build.os;

  debug(`notify: platform=${os}, files=${count}`);

  if (os === "darwin") {
    await notifyDarwin(subtitle, body);
  } else if (os === "linux") {
    await notifyLinux(subtitle, body);
  } else {
    warn(`notifications not supported on ${os}`);
  }
}

async function notifyDarwin(subtitle: string, body: string): Promise<void> {
  const result = await exec([
    "terminal-notifier",
    "-title", "dacha",
    "-subtitle", subtitle,
    "-message", body,
  ]);

  if (result.code !== 0) {
    warn(`terminal-notifier failed (is it installed?): ${result.stderr}`);
    return;
  }

  info("update notification sent");
}

async function notifyLinux(subtitle: string, body: string): Promise<void> {
  const result = await exec([
    "notify-send",
    "dacha",
    `${subtitle}\n${body}`,
  ]);

  if (result.code !== 0) {
    warn(`notify-send failed (is it installed?): ${result.stderr}`);
    return;
  }

  info("update notification sent");
}
