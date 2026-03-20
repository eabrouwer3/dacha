// Platform detection: os, arch, distro, package manager, and standard paths.

import type { PackageManagerType, Paths, Platform } from "./types.ts";

/** Parse the ID= line from /etc/os-release content. */
export function parseDistro(content: string): string | undefined {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("ID=")) {
      return trimmed.slice(3).replace(/"/g, "").toLowerCase();
    }
  }
  return undefined;
}

/** Select the package manager based on os and optional distro. */
export function selectPackageManager(
  os: string,
  distro?: string,
): PackageManagerType {
  if (os === "darwin") return "brew";

  switch (distro) {
    case "fedora":
      return "dnf";
    case "centos":
    case "rhel":
      return "yum";
    case "ubuntu":
    case "debian":
      return "apt";
    default:
      return "apt";
  }
}

/** Detect the current platform: os, arch, distro, and package manager. */
export function detectPlatform(): Platform {
  const os = Deno.build.os === "darwin" ? "darwin" : "linux";
  const arch = Deno.build.arch === "aarch64" ? "arm64" : "x64";

  let distro: string | undefined;
  if (os === "linux") {
    try {
      const content = Deno.readTextFileSync("/etc/os-release");
      distro = parseDistro(content);
    } catch {
      // File may not exist on some systems
    }
  }

  const packageManager = selectPackageManager(os, distro);

  return { os, arch, distro, packageManager };
}

/** Resolve standard paths using env vars with XDG defaults. */
export function resolvePaths(repoDir?: string): Paths {
  const home = Deno.env.get("HOME") ?? "/tmp";
  const configDir = Deno.env.get("XDG_CONFIG_HOME") ?? `${home}/.config`;
  const dataDir = Deno.env.get("XDG_DATA_HOME") ?? `${home}/.local/share`;
  const cacheDir = Deno.env.get("XDG_CACHE_HOME") ?? `${home}/.cache`;
  const tmpDir = Deno.env.get("TMPDIR") ?? "/tmp";

  return {
    home,
    configDir,
    dataDir,
    cacheDir,
    tmpDir,
    repoDir: repoDir ?? `${home}/.dotfiles`,
  };
}
