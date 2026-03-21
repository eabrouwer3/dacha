// CLI entry point — subcommand routing via Cliffy Command.

import { Command } from "@cliffy/command";
import { setLogLevel } from "./util/log.ts";

const VERSION = "0.4.0";

// --- Root command ---

const root = new Command()
  .name("dacha")
  .version(VERSION)
  .description("Code-first dotfiles and system configuration manager.")
  .globalOption("-q, --quiet", "Suppress non-error output.")
  .globalOption("-v, --verbose", "Enable debug output.")
  .globalAction(({ quiet, verbose }) => {
    if (quiet) setLogLevel("quiet");
    else if (verbose) setLogLevel("verbose");
  });

// --- init ---

root
  .command("init")
  .description("Clone a dotfiles repo and bootstrap the system.")
  .arguments("<url:string>")
  .option("--path <path:string>", "Local clone path (default ~/.dacha).")
  .option("--reconfigure", "Reset saved parameters and re-prompt.")
  .option("-y, --yes", "Auto-confirm prompts.")
  .action(async ({ path, reconfigure, yes }, url) => {
    const { init } = await import("./init.ts");
    await init(url, { path, reconfigure, yes });
  });

// --- synth ---

root
  .command("synth")
  .description("Evaluate config and output resolved state as JSON.")
  .option("--config <path:string>", "Path to dacha.config.ts.")
  .action(async ({ config }) => {
    const configPath = config ?? await resolveConfigPath();
    const { synth } = await import("./synth.ts");
    const result = await synth(configPath);
    console.log(JSON.stringify(result.state, null, 2));
  });

// --- apply ---

root
  .command("apply")
  .description("Evaluate config and converge the system to desired state.")
  .option("--config <path:string>", "Path to dacha.config.ts.")
  .option("--dry-run", "Show what would change without applying.")
  .option("-y, --yes", "Auto-confirm prompts.")
  .action(async ({ config, dryRun, yes }) => {
    const configPath = config ?? await resolveConfigPath();
    const { synth } = await import("./synth.ts");
    const { apply } = await import("./apply.ts");
    const result = await synth(configPath);
    await apply(result.resources, result.platform, { dryRun, yes });
  });

// --- sync ---

const syncCmd = new Command()
  .description("Manage the background sync daemon.");

syncCmd
  .command("start")
  .description("Install and start the sync daemon.")
  .action(async () => {
    const os = Deno.build.os;
    const dachaPath = resolveDachaPath();
    if (os === "darwin") {
      const { installSyncLaunchd } = await import("./sync/launchd.ts");
      await installSyncLaunchd(dachaPath);
    } else {
      const { installSyncSystemd } = await import("./sync/systemd.ts");
      await installSyncSystemd(dachaPath);
    }
  });

syncCmd
  .command("stop")
  .description("Stop and uninstall the sync daemon.")
  .action(async () => {
    const os = Deno.build.os;
    if (os === "darwin") {
      const { uninstallSyncLaunchd } = await import("./sync/launchd.ts");
      await uninstallSyncLaunchd();
    } else {
      const { uninstallSyncSystemd } = await import("./sync/systemd.ts");
      await uninstallSyncSystemd();
    }
  });

root.command("sync", syncCmd);

// --- update ---

root
  .command("update")
  .description("Pull remote changes and apply.")
  .action(async () => {
    const repoDir = await resolveRepoDir();
    const { checkForUpdates } = await import("./update/checker.ts");
    const { notify } = await import("./update/notifier.ts");
    const { info } = await import("./util/log.ts");

    const result = await checkForUpdates(repoDir);
    if (result.behind) {
      await notify(result);
      // Pull and apply
      const { gitPull } = await import("./util/git.ts");
      await gitPull(repoDir);
      const configPath = await resolveConfigPath();
      const { synth } = await import("./synth.ts");
      const { apply } = await import("./apply.ts");
      const synthResult = await synth(configPath);
      await apply(synthResult.resources, synthResult.platform);
    } else {
      info("already up to date");
    }
  });

// --- secret ---

const secretCmd = new Command()
  .description("Manage age-encrypted secrets.");

secretCmd
  .command("encrypt")
  .description("Encrypt a file using age.")
  .arguments("<file:string>")
  .option("--recipients <file:string>", "Path to age recipients file.", { required: true })
  .action(async ({ recipients }, file) => {
    const { encrypt } = await import("./resources/secret.ts");
    await encrypt(file, recipients);
  });

secretCmd
  .command("edit")
  .description("Decrypt, edit, and re-encrypt an age file.")
  .arguments("<file:string>")
  .option("--identity <file:string>", "Path to age identity file.")
  .action(async ({ identity }, file) => {
    const { edit } = await import("./resources/secret.ts");
    await edit(file, identity);
  });

root.command("secret", secretCmd);

// --- status ---

root
  .command("status")
  .description("Show daemon state, last sync, and pending updates.")
  .action(async () => {
    const { info, warn } = await import("./util/log.ts");
    const home = Deno.env.get("HOME") ?? "~";

    // Check for pending updates
    const pendingPath = `${home}/.local/share/dacha/update-pending.json`;
    try {
      const text = await Deno.readTextFile(pendingPath);
      const pending = JSON.parse(text);
      if (pending.behind) {
        warn(`updates available (checked ${pending.checkedAt})`);
        info(`  ${pending.changedFiles.length} file(s) changed on remote`);
      } else {
        info(`up to date (checked ${pending.checkedAt})`);
      }
    } catch {
      info("no update check data found");
    }

    // Check sync daemon status
    const os = Deno.build.os;
    if (os === "darwin") {
      const { exec } = await import("./util/shell.ts");
      const result = await exec(["launchctl", "list", "dev.dacha.sync"]);
      info(result.code === 0 ? "sync daemon: running" : "sync daemon: stopped");
    } else {
      const { exec } = await import("./util/shell.ts");
      const result = await exec(["systemctl", "--user", "is-active", "dacha-sync.service"]);
      const active = result.stdout.trim() === "active";
      info(active ? "sync daemon: running" : "sync daemon: stopped");
    }
  });

// --- params ---

const paramsCmd = new Command()
  .description("Manage saved parameters.");

paramsCmd
  .command("reset")
  .description("Reset saved parameters (all or by name).")
  .arguments("[name:string]")
  .action(async (_opts, name) => {
    const home = Deno.env.get("HOME") ?? "~";
    const lockFilePath = `${home}/.config/dacha/params.lock.json`;
    const { resetParams } = await import("./params.ts");
    await resetParams(lockFilePath, name);
  });

root.command("params", paramsCmd);

// --- permissions ---

const permissionsCmd = new Command()
  .description("Manage Deno permission approvals.");

permissionsCmd
  .command("show")
  .description("Display currently granted permissions.")
  .action(async () => {
    const { loadPermissions, formatPermissions } = await import("./permissions.ts");
    const store = await loadPermissions();
    console.log(formatPermissions(store));
  });

permissionsCmd
  .command("reset")
  .description("Reset permissions — will re-prompt on next run.")
  .action(async () => {
    const { resetPermissions } = await import("./permissions.ts");
    await resetPermissions();
  });

root.command("permissions", permissionsCmd);

// --- Helpers ---

/** Resolve the path to the dacha launcher script. */
function resolveDachaPath(): string {
  const home = Deno.env.get("HOME") ?? "~";
  return `${home}/.local/bin/dacha`;
}

/** Read the global config to find the repo path. */
async function resolveRepoDir(): Promise<string> {
  const home = Deno.env.get("HOME") ?? "~";
  const configPath = `${home}/.config/dacha/config.json`;
  try {
    const text = await Deno.readTextFile(configPath);
    const config = JSON.parse(text);
    return config.repoPath;
  } catch {
    throw new Error(
      `No repo configured. Run 'dacha init <url>' first, or create ${configPath}`,
    );
  }
}

/** Resolve the dacha.config.ts path from the repo dir. */
async function resolveConfigPath(): Promise<string> {
  // Check current directory first
  try {
    await Deno.stat("dacha.config.ts");
    return Deno.cwd() + "/dacha.config.ts";
  } catch {
    // Fall through to global config
  }

  const repoDir = await resolveRepoDir();
  return `${repoDir}/dacha.config.ts`;
}

// --- Parse and run ---

await root.parse(Deno.args);
