// BrewCaskPackage resource — install macOS GUI apps via `brew install --cask`.

import { Resource } from "../resource.ts";
import type { Machine } from "../app.ts";
import type { OutputStore, Platform, ResourceResult } from "../types.ts";
import { exec } from "../util/shell.ts";
import { ensureBrew } from "./package.ts";
import { debug, info } from "../util/log.ts";

export interface BrewCaskPackageProps {
  name: string;
  dependsOn?: Resource[];
}

export class BrewCaskPackage extends Resource {
  static readonly resourceType = "brew-cask-package";

  readonly name: string;

  constructor(scope: Resource | Machine, id: string, props: BrewCaskPackageProps) {
    super(scope, id, props);
    this.name = props.name;
  }

  async check(_platform: Platform): Promise<boolean> {
    const cmd = `brew list --cask ${this.name}`;
    debug(`brew cask check: ${cmd}`);
    const result = await exec(cmd);
    return result.code === 0;
  }

  async apply(_platform: Platform, _outputs: OutputStore): Promise<ResourceResult> {
    await ensureBrew();

    const cmd = `brew install --cask ${this.name}`;
    info(`installing cask ${this.name}`);
    const result = await exec(cmd);

    if (result.code !== 0) {
      return {
        status: "failed",
        error: result.stderr.trim() || `exit code ${result.code}`,
      };
    }

    const verResult = await exec(`brew list --cask --versions ${this.name}`);
    const version = verResult.stdout.trim();

    return {
      status: "applied",
      outputs: { version },
    };
  }

  protected toProps(): Record<string, unknown> & { id: string } {
    return {
      id: this.id,
      name: this.name,
      dependsOn: this.dependsOn,
    };
  }
}
