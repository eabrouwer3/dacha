// Permission management — prompt for Deno permissions on first run,
// persist approvals to disk, and provide show/reset commands.

import { dirname, join } from "@std/path";
import { debug, info, warn } from "./util/log.ts";

export interface PermissionStore {
  granted: PermissionEntry[];
}

export interface PermissionEntry {
  name: string; // "read" | "write" | "env" | "net" | "run" | "sys"
  grantedAt: string; // ISO timestamp
}

const REQUIRED_PERMISSIONS = [
  "read",
  "write",
  "env",
  "net",
  "run",
  "sys",
] as const;

/** Resolve the default permission store path. */
function defaultStorePath(): string {
  const home = Deno.env.get("HOME") ?? "~";
  return join(home, ".config", "dacha", "permissions.json");
}

/** Load the permission store from disk. Returns empty store if not found or corrupted. */
export async function loadPermissions(
  storePath?: string,
): Promise<PermissionStore> {
  const path = storePath ?? defaultStorePath();
  try {
    const text = await Deno.readTextFile(path);
    return JSON.parse(text) as PermissionStore;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      debug(`permission store not found at ${path}`);
      return { granted: [] };
    }
    warn(`corrupted permission store at ${path} — starting fresh`);
    return { granted: [] };
  }
}

/** Save the permission store to disk, creating parent directories if needed. */
export async function savePermissions(
  store: PermissionStore,
  storePath?: string,
): Promise<void> {
  const path = storePath ?? defaultStorePath();
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(store, null, 2) + "\n");
  debug(`saved permission store to ${path}`);
}

/**
 * Load the store, prompt for any missing permissions via Deno.permissions.request(),
 * record grants, save, and return the final store.
 *
 * If a permission is denied, logs a warning about reduced capability.
 * If Deno.permissions.request() is unavailable (compiled binary), catches the
 * error and logs which permissions are missing.
 */
export async function ensurePermissions(
  storePath?: string,
): Promise<PermissionStore> {
  const store = await loadPermissions(storePath);
  const grantedNames = new Set(store.granted.map((e) => e.name));
  const missing = REQUIRED_PERMISSIONS.filter((p) => !grantedNames.has(p));

  if (missing.length === 0) {
    debug("all permissions already granted");
    return store;
  }

  info(`requesting permissions: ${missing.join(", ")}`);

  for (const name of missing) {
    try {
      const result = await Deno.permissions.request({
        name: name as Deno.PermissionName,
      });
      if (result.state === "granted") {
        store.granted.push({ name, grantedAt: new Date().toISOString() });
        debug(`permission granted: ${name}`);
      } else {
        warn(
          `permission denied: ${name} — some functionality may be unavailable`,
        );
      }
    } catch {
      warn(
        `unable to request permissions interactively — missing: ${missing.join(", ")}`,
      );
      break;
    }
  }

  await savePermissions(store, storePath);
  return store;
}

/** Delete the permission store file to force re-prompting on next run. */
export async function resetPermissions(storePath?: string): Promise<void> {
  const path = storePath ?? defaultStorePath();
  try {
    await Deno.remove(path);
    info("permission store reset — will re-prompt on next run");
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
    debug("permission store already absent");
  }
}

/** Map of permission names to their corresponding Deno CLI flags. */
const PERMISSION_FLAG_MAP: Record<string, string> = {
  read: "--allow-read",
  write: "--allow-write",
  env: "--allow-env",
  net: "--allow-net",
  run: "--allow-run",
  sys: "--allow-sys",
};

/** Build Deno permission flags from the granted entries in a PermissionStore. */
export function buildPermissionFlags(store: PermissionStore): string[] {
  return store.granted
    .map((e) => PERMISSION_FLAG_MAP[e.name])
    .filter((f): f is string => f !== undefined);
}

/** Format the permission store for display (dacha permissions show). */
export function formatPermissions(store: PermissionStore): string {
  const grantedMap = new Map(
    store.granted.map((e) => [e.name, e.grantedAt]),
  );

  const lines: string[] = ["Deno Permissions:"];
  for (const name of REQUIRED_PERMISSIONS) {
    const ts = grantedMap.get(name);
    if (ts) {
      lines.push(`  ${name}: granted (${ts})`);
    } else {
      lines.push(`  ${name}: not granted`);
    }
  }
  return lines.join("\n");
}
