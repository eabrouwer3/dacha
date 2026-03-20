import { assertEquals } from "@std/assert";
import { parseDistro, resolvePaths, selectPackageManager } from "./platform.ts";

// --- parseDistro ---

Deno.test("parseDistro - extracts ubuntu from os-release", () => {
  const content = `NAME="Ubuntu"\nVERSION="22.04"\nID=ubuntu\nPRETTY_NAME="Ubuntu 22.04"`;
  assertEquals(parseDistro(content), "ubuntu");
});

Deno.test("parseDistro - extracts fedora from os-release", () => {
  const content = `NAME="Fedora Linux"\nID=fedora\nVERSION_ID=39`;
  assertEquals(parseDistro(content), "fedora");
});

Deno.test("parseDistro - strips quotes from ID value", () => {
  const content = `NAME="Debian"\nID="debian"\nVERSION_ID="12"`;
  assertEquals(parseDistro(content), "debian");
});

Deno.test("parseDistro - lowercases the ID value", () => {
  const content = `ID=CentOS`;
  assertEquals(parseDistro(content), "centos");
});

Deno.test("parseDistro - returns undefined when no ID line", () => {
  const content = `NAME="Some OS"\nVERSION="1.0"`;
  assertEquals(parseDistro(content), undefined);
});

Deno.test("parseDistro - returns undefined for empty string", () => {
  assertEquals(parseDistro(""), undefined);
});

Deno.test("parseDistro - ignores ID_LIKE line", () => {
  const content = `ID_LIKE=debian\nNAME="Pop!_OS"`;
  assertEquals(parseDistro(content), undefined);
});

// --- selectPackageManager ---

Deno.test("selectPackageManager - darwin returns brew", () => {
  assertEquals(selectPackageManager("darwin"), "brew");
});

Deno.test("selectPackageManager - darwin ignores distro", () => {
  assertEquals(selectPackageManager("darwin", "ubuntu"), "brew");
});

Deno.test("selectPackageManager - ubuntu returns apt", () => {
  assertEquals(selectPackageManager("linux", "ubuntu"), "apt");
});

Deno.test("selectPackageManager - debian returns apt", () => {
  assertEquals(selectPackageManager("linux", "debian"), "apt");
});

Deno.test("selectPackageManager - fedora returns dnf", () => {
  assertEquals(selectPackageManager("linux", "fedora"), "dnf");
});

Deno.test("selectPackageManager - centos returns yum", () => {
  assertEquals(selectPackageManager("linux", "centos"), "yum");
});

Deno.test("selectPackageManager - rhel returns yum", () => {
  assertEquals(selectPackageManager("linux", "rhel"), "yum");
});

Deno.test("selectPackageManager - unknown linux distro defaults to apt", () => {
  assertEquals(selectPackageManager("linux", "arch"), "apt");
});

Deno.test("selectPackageManager - linux with no distro defaults to apt", () => {
  assertEquals(selectPackageManager("linux"), "apt");
});

// --- resolvePaths ---

Deno.test("resolvePaths - uses XDG env vars when set", () => {
  const origConfig = Deno.env.get("XDG_CONFIG_HOME");
  const origData = Deno.env.get("XDG_DATA_HOME");
  const origCache = Deno.env.get("XDG_CACHE_HOME");
  try {
    Deno.env.set("XDG_CONFIG_HOME", "/custom/config");
    Deno.env.set("XDG_DATA_HOME", "/custom/data");
    Deno.env.set("XDG_CACHE_HOME", "/custom/cache");
    const paths = resolvePaths("/my/repo");
    assertEquals(paths.configDir, "/custom/config");
    assertEquals(paths.dataDir, "/custom/data");
    assertEquals(paths.cacheDir, "/custom/cache");
    assertEquals(paths.repoDir, "/my/repo");
  } finally {
    if (origConfig) Deno.env.set("XDG_CONFIG_HOME", origConfig);
    else Deno.env.delete("XDG_CONFIG_HOME");
    if (origData) Deno.env.set("XDG_DATA_HOME", origData);
    else Deno.env.delete("XDG_DATA_HOME");
    if (origCache) Deno.env.set("XDG_CACHE_HOME", origCache);
    else Deno.env.delete("XDG_CACHE_HOME");
  }
});

Deno.test("resolvePaths - falls back to XDG defaults when env vars unset", () => {
  const origConfig = Deno.env.get("XDG_CONFIG_HOME");
  const origData = Deno.env.get("XDG_DATA_HOME");
  const origCache = Deno.env.get("XDG_CACHE_HOME");
  try {
    Deno.env.delete("XDG_CONFIG_HOME");
    Deno.env.delete("XDG_DATA_HOME");
    Deno.env.delete("XDG_CACHE_HOME");
    const home = Deno.env.get("HOME") ?? "/tmp";
    const paths = resolvePaths();
    assertEquals(paths.configDir, `${home}/.config`);
    assertEquals(paths.dataDir, `${home}/.local/share`);
    assertEquals(paths.cacheDir, `${home}/.cache`);
  } finally {
    if (origConfig) Deno.env.set("XDG_CONFIG_HOME", origConfig);
    if (origData) Deno.env.set("XDG_DATA_HOME", origData);
    if (origCache) Deno.env.set("XDG_CACHE_HOME", origCache);
  }
});

Deno.test("resolvePaths - defaults repoDir to ~/.dotfiles", () => {
  const home = Deno.env.get("HOME") ?? "/tmp";
  const paths = resolvePaths();
  assertEquals(paths.repoDir, `${home}/.dotfiles`);
});

Deno.test("resolvePaths - home matches HOME env var", () => {
  const home = Deno.env.get("HOME") ?? "/tmp";
  const paths = resolvePaths();
  assertEquals(paths.home, home);
});
