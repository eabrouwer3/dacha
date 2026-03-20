// MacDefault resource — manage macOS `defaults` preferences.
// Infers the defaults type flag (-bool, -int, -float, -string) from the
// TypeScript type of the provided value, then uses `defaults read` to check
// current state and `defaults write` to apply.

import { Resource } from "../resource.ts";
import type { Machine } from "../app.ts";
import type { OutputStore, Platform, ResourceResult } from "../types.ts";
import { exec } from "../util/shell.ts";
import { debug, info } from "../util/log.ts";

export type DefaultsValue = string | number | boolean;

export interface MacDefaultProps {
  domain: string;
  key: string;
  value: DefaultsValue;
  dependsOn?: Resource[];
}

/** Map a JS value to the `defaults` CLI type flag. */
function defaultsTypeFlag(value: DefaultsValue): string {
  if (typeof value === "boolean") return "-bool";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "-int" : "-float";
  }
  return "-string";
}

/** Normalize a `defaults read` output to compare against the desired value. */
function normalize(raw: string, value: DefaultsValue): DefaultsValue {
  const trimmed = raw.trim();
  if (typeof value === "boolean") {
    // defaults read prints "1" / "0" for booleans
    return trimmed === "1" || trimmed === "true";
  }
  if (typeof value === "number") {
    return Number(trimmed);
  }
  return trimmed;
}

export class MacDefault extends Resource {
  static readonly resourceType = "mac-default";

  readonly domain: string;
  readonly key: string;
  readonly value: DefaultsValue;

  constructor(scope: Resource | Machine, id: string, props: MacDefaultProps) {
    super(scope, id, props);
    this.domain = props.domain;
    this.key = props.key;
    this.value = props.value;
  }

  async check(_platform: Platform): Promise<boolean> {
    const cmd = `defaults read ${this.domain} ${this.key}`;
    debug(`mac-default check: ${cmd}`);
    const result = await exec(cmd);

    if (result.code !== 0) {
      debug(`mac-default ${this.id}: key not set`);
      return false;
    }

    const current = normalize(result.stdout, this.value);
    const match = current === this.value;
    debug(`mac-default ${this.id}: current=${current} desired=${this.value} match=${match}`);
    return match;
  }

  async apply(_platform: Platform, _outputs: OutputStore): Promise<ResourceResult> {
    const typeFlag = defaultsTypeFlag(this.value);
    const writeValue = typeof this.value === "boolean"
      ? (this.value ? "TRUE" : "FALSE")
      : String(this.value);

    const cmd = `defaults write ${this.domain} ${this.key} ${typeFlag} ${writeValue}`;
    info(`setting ${this.domain} ${this.key} = ${this.value}`);
    const result = await exec(cmd);

    if (result.code !== 0) {
      return {
        status: "failed",
        error: result.stderr.trim() || `exit code ${result.code}`,
      };
    }

    return { status: "applied" };
  }

  protected toProps(): Record<string, unknown> & { id: string } {
    return {
      id: this.id,
      domain: this.domain,
      key: this.key,
      value: this.value,
      dependsOn: this.dependsOn,
    };
  }
}
