// Command resource executor — run shell commands with check/skip support.

import type {
  CommandResource,
  OutputStore,
  Platform,
  ResourceExecutor,
  ResourceResult,
} from "../types.ts";
import { exec } from "../util/shell.ts";
import { debug, info } from "../util/log.ts";

export const CommandExecutor: ResourceExecutor<CommandResource> = {
  async check(resource, _platform: Platform): Promise<boolean> {
    if (!resource.check) {
      debug(`command ${resource.id}: no check command, will run`);
      return false;
    }

    debug(`command check: ${resource.check}`);
    const result = await exec(resource.check);
    return result.code === 0;
  },

  async apply(resource, _platform: Platform, outputs: OutputStore): Promise<ResourceResult> {
    info(`running command: ${resource.id}`);
    debug(`command run: ${resource.run}`);
    const result = await exec(resource.run);

    if (result.code !== 0) {
      const error = result.stderr.trim() || `exit code ${result.code}`;

      if (resource.critical) {
        throw new Error(`critical command "${resource.id}" failed: ${error}`);
      }

      return { status: "failed", error };
    }

    const resourceOutputs: Record<string, string> = {};

    if (resource.captureOutput) {
      const captured = result.stdout.trim();
      resourceOutputs[resource.captureOutput] = captured;
      outputs.set(resource.id, { ...outputs.get(resource.id), [resource.captureOutput]: captured });
      debug(`captured output "${resource.captureOutput}": ${captured}`);
    }

    return {
      status: "applied",
      outputs: Object.keys(resourceOutputs).length > 0 ? resourceOutputs : undefined,
    };
  },
};
