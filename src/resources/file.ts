// File resource — copy files/directories to destination, with template support.

import { Resource } from "../resource.ts";
import type { Machine } from "../app.ts";
import type { OutputStore, Platform, ResourceResult } from "../types.ts";
import { debug, info } from "../util/log.ts";
import { dirname } from "@std/path";
import { copy } from "@std/fs";

export interface FileProps {
  source?: string;
  destination: string;
  template?: boolean;
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

/** Compute SHA-256 hex digest of a file's contents. Returns null if file doesn't exist. */
async function fileHash(path: string): Promise<string | null> {
  try {
    const data = await Deno.readFile(path);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/**
 * Interpolate `{{output.resourceId.key}}` references in template content
 * using values from the OutputStore.
 */
export function interpolateTemplate(
  content: string,
  outputs: OutputStore,
): string {
  return content.replace(/\{\{output\.([^.}]+)\.([^}]+)\}\}/g, (_match, resourceId, key) => {
    const resourceOutputs = outputs.get(resourceId);
    if (!resourceOutputs || !(key in resourceOutputs)) {
      return `{{output.${resourceId}.${key}}}`;
    }
    return resourceOutputs[key];
  });
}

export class File extends Resource {
  static readonly resourceType = "file";

  readonly source?: string;
  readonly destination: string;
  readonly template?: boolean;

  constructor(scope: Resource | Machine, id: string, props: FileProps) {
    super(scope, id, props);
    this.source = props.source;
    this.destination = props.destination;
    this.template = props.template;
  }

  async check(_platform: Platform): Promise<boolean> {
    const dest = resolveHome(this.destination);

    // No source: just check if destination exists
    if (!this.source) {
      try {
        await Deno.stat(dest);
        debug(`file check: ${this.id} destination exists`);
        return true;
      } catch {
        debug(`file check: ${this.id} destination missing`);
        return false;
      }
    }

    // Check if source is a directory
    let srcIsDir = false;
    try {
      const srcStat = await Deno.stat(this.source);
      srcIsDir = srcStat.isDirectory;
    } catch {
      debug(`file check: source missing ${this.source}`);
      return false;
    }

    // Source directory mode: check destination exists and is a directory
    if (srcIsDir) {
      try {
        const destStat = await Deno.stat(dest);
        const exists = destStat.isDirectory;
        debug(`file check: ${this.id} source dir, dest dir exists=${exists}`);
        return exists;
      } catch {
        debug(`file check: ${this.id} source dir, dest missing`);
        return false;
      }
    }

    // Source file mode: compare hashes
    const srcHash = await fileHash(this.source);
    const destHash = await fileHash(dest);

    if (srcHash === null) {
      debug(`file check: source missing ${this.source}`);
      return false;
    }

    const match = srcHash === destHash;
    debug(`file check: ${this.id} src=${srcHash.slice(0, 8)} dest=${destHash?.slice(0, 8) ?? "missing"} match=${match}`);
    return match;
  }

  async apply(_platform: Platform, outputs: OutputStore): Promise<ResourceResult> {
    const dest = resolveHome(this.destination);

    // No source: create parent directories (destination is treated as a file path)
    if (!this.source) {
      const parentDir = dirname(dest);
      await Deno.mkdir(parentDir, { recursive: true });
      // Create empty file if it doesn't exist
      info(`ensuring ${this.destination} exists`);
      try {
        await Deno.stat(dest);
      } catch {
        await Deno.writeFile(dest, new Uint8Array());
      }
      return { status: "applied" };
    }

    // Source mode: check if source is a directory
    let srcIsDir = false;
    try {
      const srcStat = await Deno.stat(this.source);
      srcIsDir = srcStat.isDirectory;
    } catch (err) {
      return {
        status: "failed",
        error: `cannot read source ${this.source}: ${err}`,
      };
    }

    // Source directory mode: recursively copy
    if (srcIsDir) {
      info(`copying directory ${this.source} → ${this.destination}`);
      await copy(this.source, dest, { overwrite: true });
      return { status: "applied" };
    }

    // Source file mode: copy file
    let content: Uint8Array;
    let mode: number | undefined;
    try {
      content = await Deno.readFile(this.source);
      const srcStat = await Deno.stat(this.source);
      mode = srcStat.mode ?? undefined;
    } catch (err) {
      return {
        status: "failed",
        error: `cannot read source ${this.source}: ${err}`,
      };
    }

    // Template interpolation if enabled
    if (this.template) {
      const text = new TextDecoder().decode(content);
      const interpolated = interpolateTemplate(text, outputs);
      content = new TextEncoder().encode(interpolated);
    }

    // Create parent directories
    const parentDir = dirname(dest);
    await Deno.mkdir(parentDir, { recursive: true });

    // Write file to destination, preserving source permissions
    info(`copying ${this.source} → ${this.destination}`);
    await Deno.writeFile(dest, content, { ...(mode != null && { mode }) });

    return { status: "applied" };
  }

  protected toProps(): Record<string, unknown> & { id: string } {
    return {
      id: this.id,
      source: this.source,
      destination: this.destination,
      template: this.template,
      dependsOn: this.dependsOn,
    };
  }
}
