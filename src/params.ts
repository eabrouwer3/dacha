// Parameter prompting and lock file management.
// Reads saved params from a lock file, prompts for missing values
// interactively, and writes the updated lock file atomically.

import { Confirm, Input, Select } from "@cliffy/prompt";
import { dirname } from "@std/path";
import type { ParamDefinition, Params } from "./types.ts";
import { debug, info } from "./util/log.ts";

/** Lock file schema persisted at ~/.config/dacha/params.lock.json */
export interface ParamsLockFile {
  version: 1;
  createdAt: string;
  params: Record<string, string | boolean>;
}

/** Read and parse the lock file. Returns null if it doesn't exist or is invalid. */
export async function readLockFile(
  path: string,
): Promise<ParamsLockFile | null> {
  try {
    const text = await Deno.readTextFile(path);
    const data = JSON.parse(text);
    if (data?.version === 1 && typeof data.params === "object") {
      return data as ParamsLockFile;
    }
    return null;
  } catch {
    return null;
  }
}

/** Write the lock file atomically (write to tmp then rename). */
export async function writeLockFile(
  path: string,
  lockFile: ParamsLockFile,
): Promise<void> {
  const dir = dirname(path);
  await Deno.mkdir(dir, { recursive: true });

  const tmp = `${path}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify(lockFile, null, 2) + "\n");
  await Deno.rename(tmp, path);
}

/** Prompt for a single parameter value using Cliffy prompts. */
async function promptParam(def: ParamDefinition): Promise<string | boolean> {
  switch (def.type) {
    case "confirm":
      return await Confirm.prompt({
        message: def.message,
        default: typeof def.default === "boolean" ? def.default : undefined,
      });

    case "select":
      return await Select.prompt({
        message: def.message,
        options: def.choices ?? [],
        default: typeof def.default === "string" ? def.default : undefined,
      });

    case "text":
    default:
      return await Input.prompt({
        message: def.message,
        default: typeof def.default === "string" ? def.default : undefined,
      });
  }
}

/**
 * Load parameters: read lock file, prompt for any missing values,
 * write updated lock file, and return the full params record.
 */
export async function loadParams(
  defs: ParamDefinition[],
  lockFilePath: string,
): Promise<Params> {
  const existing = await readLockFile(lockFilePath);
  const params: Record<string, string | boolean> = existing?.params
    ? { ...existing.params }
    : {};

  let prompted = false;
  for (const def of defs) {
    if (def.name in params) {
      debug(`param "${def.name}" loaded from lock file`);
      continue;
    }
    info(`prompting for parameter: ${def.name}`);
    params[def.name] = await promptParam(def);
    prompted = true;
  }

  if (prompted) {
    const lockFile: ParamsLockFile = {
      version: 1,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      params,
    };
    await writeLockFile(lockFilePath, lockFile);
    debug(`lock file written to ${lockFilePath}`);
  }

  return params;
}

/**
 * Reset parameters in the lock file.
 * If name is provided, delete only that param. Otherwise delete all.
 */
export async function resetParams(
  lockFilePath: string,
  name?: string,
): Promise<void> {
  if (!name) {
    // Delete the entire lock file
    try {
      await Deno.remove(lockFilePath);
      info("all parameters reset");
    } catch {
      // File didn't exist — nothing to do
    }
    return;
  }

  const existing = await readLockFile(lockFilePath);
  if (!existing) return;

  if (!(name in existing.params)) {
    info(`parameter "${name}" not found in lock file`);
    return;
  }

  delete existing.params[name];
  await writeLockFile(lockFilePath, existing);
  info(`parameter "${name}" reset`);
}
