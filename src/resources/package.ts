// Package resource — install via detected package manager.

import { Resource } from "../resource.ts";
import type { Machine } from "../app.ts";
import type { OutputStore, Platform, ResourceResult } from "../types.ts";
import { exec } from "../util/shell.ts";
import { debug, info } from "../util/log.ts";

export interface PackageProps {
  name: string;
  brew?: string;
  apt?: string;
  yum?: string;
  dependsOn?: Resource[];
}

/** Shape used by the standalone helper functions. */
interface PackageLike {
  name: string;
  brew?: string;
  apt?: string;
  yum?: string;
}

/**
 * Resolve the correct package name for the current platform.
 * Checks platform-specific overrides (brew, apt, yum) and
 * falls back to the canonical `name`.
 */
export function resolvePackageName(
  resource: PackageLike,
  platform: Platform,
): string {
  switch (platform.packageManager) {
    case "brew":
      return (resource.brew ?? resource.name) as string;
    case "apt":
      return (resource.apt ?? resource.name) as string;
    case "yum":
    case "dnf":
      return (resource.yum ?? resource.name) as string;
  }
}

/** Build the check command to test if a package is already installed. */
export function checkCommand(pkg: string, platform: Platform): string {
  switch (platform.packageManager) {
    case "brew":
      return `brew list ${pkg}`;
    case "apt":
      return `dpkg -l ${pkg}`;
    case "yum":
    case "dnf":
      return `rpm -q ${pkg}`;
  }
}

/** Build the install command for the platform's package manager. */
export function installCommand(pkg: string, platform: Platform): string {
  switch (platform.packageManager) {
    case "brew":
      return `brew install ${pkg}`;
    case "apt":
      return `sudo apt-get install -y ${pkg}`;
    case "yum":
      return `sudo yum install -y ${pkg}`;
    case "dnf":
      return `sudo dnf install -y ${pkg}`;
  }
}

/** Build the command to query the installed version of a package. */
export function versionCommand(pkg: string, platform: Platform): string {
  switch (platform.packageManager) {
    case "brew":
      return `brew list --versions ${pkg}`;
    case "apt":
      return `dpkg-query -W -f='\${Version}' ${pkg}`;
    case "yum":
    case "dnf":
      return `rpm -q --queryformat '%{VERSION}' ${pkg}`;
  }
}

/** Module-level flag — once brew is confirmed/installed, skip future checks. */
let _brewVerified = false;

/** Reset the brew-verified flag (for testing). */
export function resetBrewVerified(): void {
  _brewVerified = false;
}

/** Check (and return) whether brew has been verified this session. */
export function isBrewVerified(): boolean {
  return _brewVerified;
}

/**
 * Ensure Homebrew is available, auto-installing if missing.
 * Shared by Package (on macOS) and BrewCaskPackage.
 */
export async function ensureBrew(): Promise<void> {
  if (_brewVerified) return;
  const result = await exec("command -v brew");
  if (result.code !== 0) {
    info("Homebrew not found — installing via official script…");
    const install = await exec(
      '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
      { stdin: "inherit" },
    );
    if (install.code !== 0) {
      throw new Error(
        `Failed to auto-install Homebrew: ${install.stderr.trim() || `exit code ${install.code}`}`,
      );
    }
    // Add Homebrew to PATH for this session (Apple Silicon installs to /opt/homebrew)
    const brewPaths = ["/opt/homebrew/bin", "/usr/local/bin"];
    for (const p of brewPaths) {
      try {
        await Deno.stat(`${p}/brew`);
        Deno.env.set("PATH", `${p}:${Deno.env.get("PATH") ?? ""}`);
        break;
      } catch { /* not here */ }
    }
  }
  _brewVerified = true;
}

export class Package extends Resource {
  static readonly resourceType = "package";

  readonly name: string;
  readonly brew?: string;
  readonly apt?: string;
  readonly yum?: string;

  /** @deprecated Use isBrewVerified()/resetBrewVerified() instead. */
  static get _brewVerified(): boolean {
    return _brewVerified;
  }
  static set _brewVerified(v: boolean) {
    _brewVerified = v;
  }

  constructor(scope: Resource | Machine, id: string, props: PackageProps) {
    super(scope, id, props);
    this.name = props.name;
    this.brew = props.brew;
    this.apt = props.apt;
    this.yum = props.yum;
  }

  async check(platform: Platform): Promise<boolean> {
    const pkg = resolvePackageName(this, platform);
    const cmd = checkCommand(pkg, platform);
    debug(`package check: ${cmd}`);
    const result = await exec(cmd);
    return result.code === 0;
  }

  async apply(platform: Platform, _outputs: OutputStore): Promise<ResourceResult> {
    await this.ensurePackageManager(platform);

    const pkg = resolvePackageName(this, platform);
    const cmd = installCommand(pkg, platform);
    info(`installing ${pkg} via ${platform.packageManager}`);
    const result = await exec(cmd);

    if (result.code !== 0) {
      return {
        status: "failed",
        error: result.stderr.trim() || `exit code ${result.code}`,
      };
    }

    const verResult = await exec(versionCommand(pkg, platform));
    const version = verResult.stdout.trim();

    return {
      status: "applied",
      outputs: { version },
    };
  }

  /**
   * Ensure the package manager binary exists before running install commands.
   * - brew: auto-install via the official Homebrew install script if missing.
   * - apt/dnf/yum: throw a clear error if the binary is not found.
   */
  private async ensurePackageManager(platform: Platform): Promise<void> {
    const pm = platform.packageManager;

    if (pm === "brew") {
      await ensureBrew();
      return;
    }

    // apt, dnf, yum — cannot auto-install; verify binary exists
    const result = await exec(`command -v ${pm}`);
    if (result.code !== 0) {
      throw new Error(
        `System package manager "${pm}" is not installed and cannot be auto-installed. ` +
        `Please install ${pm} manually before running dacha.`,
      );
    }
  }

  protected toProps(): Record<string, unknown> & { id: string } {
    return {
      id: this.id,
      name: this.name,
      brew: this.brew,
      apt: this.apt,
      yum: this.yum,
      dependsOn: this.dependsOn,
    };
  }
}
