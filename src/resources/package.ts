// Package resource executor — install via detected package manager.

import type {
  OutputStore,
  PackageResource,
  Platform,
  ResourceExecutor,
  ResourceResult,
} from "../types.ts";
import { exec } from "../util/shell.ts";
import { debug, info } from "../util/log.ts";

/**
 * Resolve the correct package name for the current platform.
 * Checks platform-specific overrides (brew, brewCask, apt, yum) and
 * falls back to the canonical `name`.
 */
export function resolvePackageName(
  resource: PackageResource,
  platform: Platform,
): string {
  switch (platform.packageManager) {
    case "brew":
      return resource.brewCask ?? resource.brew ?? resource.name;
    case "apt":
      return resource.apt ?? resource.name;
    case "yum":
    case "dnf":
      return resource.yum ?? resource.name;
  }
}

/** Build the check command to test if a package is already installed. */
function checkCommand(pkg: string, resource: PackageResource, platform: Platform): string {
  switch (platform.packageManager) {
    case "brew":
      // If it's a cask, use `brew list --cask`
      if (resource.brewCask) {
        return `brew list --cask ${pkg}`;
      }
      return `brew list ${pkg}`;
    case "apt":
      return `dpkg -l ${pkg}`;
    case "yum":
    case "dnf":
      return `rpm -q ${pkg}`;
  }
}

/** Build the install command for the platform's package manager. */
function installCommand(pkg: string, resource: PackageResource, platform: Platform): string {
  switch (platform.packageManager) {
    case "brew":
      if (resource.brewCask) {
        return `brew install --cask ${pkg}`;
      }
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
function versionCommand(pkg: string, resource: PackageResource, platform: Platform): string {
  switch (platform.packageManager) {
    case "brew":
      if (resource.brewCask) {
        return `brew list --cask --versions ${pkg}`;
      }
      return `brew list --versions ${pkg}`;
    case "apt":
      return `dpkg-query -W -f='\${Version}' ${pkg}`;
    case "yum":
    case "dnf":
      return `rpm -q --queryformat '%{VERSION}' ${pkg}`;
  }
}

export const PackageExecutor: ResourceExecutor<PackageResource> = {
  async check(resource, platform): Promise<boolean> {
    const pkg = resolvePackageName(resource, platform);
    const cmd = checkCommand(pkg, resource, platform);
    debug(`package check: ${cmd}`);
    const result = await exec(cmd);
    return result.code === 0;
  },

  async apply(resource, platform, _outputs: OutputStore): Promise<ResourceResult> {
    const pkg = resolvePackageName(resource, platform);
    const cmd = installCommand(pkg, resource, platform);
    info(`installing ${pkg} via ${platform.packageManager}`);
    const result = await exec(cmd);

    if (result.code !== 0) {
      return {
        status: "failed",
        error: result.stderr.trim() || `exit code ${result.code}`,
      };
    }

    // Capture installed version as output
    const verResult = await exec(versionCommand(pkg, resource, platform));
    const version = verResult.stdout.trim();

    return {
      status: "applied",
      outputs: { version },
    };
  },
};
