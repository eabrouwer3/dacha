// Command resource — run shell commands with check/skip support.

import { Resource } from "../resource.ts";
import type { App } from "../app.ts";
import type { OutputStore, Platform, ResourceResult } from "../types.ts";
import { exec } from "../util/shell.ts";
import { debug, info } from "../util/log.ts";

export interface CommandProps {
  run: string;
  check?: string;
  critical?: boolean;
  captureOutput?: string;
  dependsOn?: string[];
}

export class Command extends Resource {
  static readonly resourceType = "command";

  readonly run: string;
  readonly checkCmd?: string;
  readonly critical?: boolean;
  readonly captureOutput?: string;

  constructor(scope: Resource | App, id: string, props: CommandProps) {
    super(scope, id, props);
    this.run = props.run;
    this.checkCmd = props.check;
    this.critical = props.critical;
    this.captureOutput = props.captureOutput;
  }

  async check(_platform: Platform): Promise<boolean> {
    if (!this.checkCmd) {
      debug(`command ${this.id}: no check command, will run`);
      return false;
    }

    debug(`command check: ${this.checkCmd}`);
    const result = await exec(this.checkCmd);
    return result.code === 0;
  }

  async apply(_platform: Platform, outputs: OutputStore): Promise<ResourceResult> {
    info(`running command: ${this.id}`);
    debug(`command run: ${this.run}`);
    const result = await exec(this.run);

    if (result.code !== 0) {
      const error = result.stderr.trim() || `exit code ${result.code}`;

      if (this.critical) {
        throw new Error(`critical command "${this.id}" failed: ${error}`);
      }

      return { status: "failed", error };
    }

    const resourceOutputs: Record<string, string> = {};

    if (this.captureOutput) {
      const captured = result.stdout.trim();
      resourceOutputs[this.captureOutput] = captured;
      outputs.set(this.id, { ...outputs.get(this.id), [this.captureOutput]: captured });
      debug(`captured output "${this.captureOutput}": ${captured}`);
    }

    return {
      status: "applied",
      outputs: Object.keys(resourceOutputs).length > 0 ? resourceOutputs : undefined,
    };
  }

  protected toProps(): Record<string, unknown> & { id: string } {
    return {
      id: this.id,
      run: this.run,
      check: this.checkCmd,
      critical: this.critical,
      captureOutput: this.captureOutput,
      dependsOn: this.dependsOn,
    };
  }
}
