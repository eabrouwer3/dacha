// Dotfile resource — copy files to destination, with template support.

import { Resource } from "../resource.ts";
import type { App } from "../app.ts";
import type { OutputStore, Platform, ResourceResult } from "../types.ts";
import { debug, info } from "../util/log.ts";
import { dirname } from "@std/path";

export interface DotfileProps {
  source: string;
  destination: string;
  template?: boolean;
  dependsOn?: string[];
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

export class Dotfile extends Resource {
  static readonly resourceType = "dotfile";

  readonly source: string;
  readonly destination: string;
  readonly template?: boolean;

  constructor(scope: Resource | App, id: string, props: DotfileProps) {
    super(scope, id, props);
    this.source = props.source;
    this.destination = props.destination;
    this.template = props.template;
  }

  async check(_platform: Platform): Promise<boolean> {
    const dest = resolveHome(this.destination);
    const srcHash = await fileHash(this.source);
    const destHash = await fileHash(dest);

    if (srcHash === null) {
      debug(`dotfile check: source missing ${this.source}`);
      return false;
    }

    const match = srcHash === destHash;
    debug(`dotfile check: ${this.id} src=${srcHash.slice(0, 8)} dest=${destHash?.slice(0, 8) ?? "missing"} match=${match}`);
    return match;
  }

  async apply(_platform: Platform, outputs: OutputStore): Promise<ResourceResult> {
    const dest = resolveHome(this.destination);

    let content: Uint8Array;
    try {
      content = await Deno.readFile(this.source);
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

    // Write file to destination
    info(`copying ${this.source} → ${this.destination}`);
    await Deno.writeFile(dest, content);

    return { status: "applied" };
  }

  protected toProps() {
    return {
      id: this.id,
      source: this.source,
      destination: this.destination,
      template: this.template,
      dependsOn: this.dependsOn,
    };
  }
}
