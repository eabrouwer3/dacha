// Directory resource — ensure a directory exists.

import { Resource } from "../resource.ts";
import type { Machine } from "../app.ts";
import type { OutputStore, Platform, ResourceResult } from "../types.ts";
import { debug, info } from "../util/log.ts";

export interface DirectoryProps {
  destination: string;
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

export class Directory extends Resource {
  static readonly resourceType = "directory";

  readonly destination: string;

  constructor(scope: Resource | Machine, id: string, props: DirectoryProps) {
    super(scope, id, props);
    this.destination = props.destination;
  }

  async check(_platform: Platform): Promise<boolean> {
    const dest = resolveHome(this.destination);
    try {
      const stat = await Deno.stat(dest);
      const exists = stat.isDirectory;
      debug(`directory check: ${this.id} exists=${exists}`);
      return exists;
    } catch {
      debug(`directory check: ${this.id} missing`);
      return false;
    }
  }

  async apply(_platform: Platform, _outputs: OutputStore): Promise<ResourceResult> {
    const dest = resolveHome(this.destination);
    info(`creating directory ${this.destination}`);
    await Deno.mkdir(dest, { recursive: true });
    return { status: "applied" };
  }

  protected toProps(): Record<string, unknown> & { id: string } {
    return {
      id: this.id,
      destination: this.destination,
      dependsOn: this.dependsOn,
    };
  }
}
