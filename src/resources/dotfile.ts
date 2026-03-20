// Dotfile resource executor — copy files to destination, with template support.

import type {
  DotfileResource,
  OutputStore,
  Platform,
  ResourceExecutor,
  ResourceResult,
} from "../types.ts";
import { debug, info } from "../util/log.ts";
import { dirname } from "@std/path";

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

export const DotfileExecutor: ResourceExecutor<DotfileResource> = {
  async check(resource, _platform: Platform): Promise<boolean> {
    const dest = resolveHome(resource.destination);
    const srcHash = await fileHash(resource.source);
    const destHash = await fileHash(dest);

    if (srcHash === null) {
      debug(`dotfile check: source missing ${resource.source}`);
      return false;
    }

    const match = srcHash === destHash;
    debug(`dotfile check: ${resource.id} src=${srcHash.slice(0, 8)} dest=${destHash?.slice(0, 8) ?? "missing"} match=${match}`);
    return match;
  },

  async apply(resource, _platform: Platform, outputs: OutputStore): Promise<ResourceResult> {
    const dest = resolveHome(resource.destination);

    let content: Uint8Array;
    try {
      content = await Deno.readFile(resource.source);
    } catch (err) {
      return {
        status: "failed",
        error: `cannot read source ${resource.source}: ${err}`,
      };
    }

    // Template interpolation if enabled
    if (resource.template) {
      const text = new TextDecoder().decode(content);
      const interpolated = interpolateTemplate(text, outputs);
      content = new TextEncoder().encode(interpolated);
    }

    // Create parent directories
    const parentDir = dirname(dest);
    await Deno.mkdir(parentDir, { recursive: true });

    // Write file to destination
    info(`copying ${resource.source} → ${resource.destination}`);
    await Deno.writeFile(dest, content);

    return { status: "applied" };
  },
};
