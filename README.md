# дача (dacha)

Code-first dotfiles and system configuration manager. Define your packages, dotfiles, shell commands, and secrets in TypeScript — dacha synthesizes a dependency graph, detects your platform, and converges your system to the desired state.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/eabrouwer3/dacha/main/install.sh | sh
```

To install and bootstrap a dotfiles repo in one step:

```sh
curl -fsSL https://raw.githubusercontent.com/eabrouwer3/dacha/main/install.sh | sh -s -- --repo https://github.com/you/dotfiles
```

The installer downloads a prebuilt binary for your platform (macOS/Linux, arm64/x64), verifies its SHA-256 checksum, and places it in `~/.local/bin`.

## Quick start

```sh
# Clone your dotfiles repo and apply everything
dacha init https://github.com/you/dotfiles

# Preview what would change
dacha apply --dry-run

# Apply your config
dacha apply
```

## How it works

1. You write a `dacha.config.ts` in your dotfiles repo
2. `dacha synth` evaluates the config — detecting your platform, resolving profile inheritance, filtering resources by OS/arch, and topologically sorting the dependency graph
3. `dacha apply` walks the sorted resources, checks each one's current state, and applies only what's needed

## Configuration

Your dotfiles repo contains a `dacha.config.ts` that exports a function (or object) returning a `DachaConfig`:

```ts
import type { DachaConfig, Platform, Params, Paths } from "dacha/mod.ts";

export default ({ platform, params, paths }: {
  platform: Platform;
  params: Params;
  paths: Paths;
}): DachaConfig => ({
  repoPath: paths.repoDir,
  target: workstation,
  params: [
    { name: "gitEmail", message: "Git email?", type: "text" },
    { name: "useNeovim", message: "Install neovim?", type: "confirm", default: true },
  ],
  sync: { enabled: true },
  update: { enabled: true, intervalHours: 24 },
});
```

### Resources

There are four resource types:

**package** — Install system packages via the detected package manager (brew, apt, dnf, yum). Supports per-platform overrides:

```ts
{
  id: "ripgrep",
  type: "package",
  name: "ripgrep",
  brew: "ripgrep",
  apt: "ripgrep",
}
```

**dotfile** — Copy (or template) files to their destination. Templates support `{{output.resourceId.key}}` interpolation from upstream resource outputs:

```ts
{
  id: "gitconfig",
  type: "dotfile",
  source: "./config/gitconfig",
  destination: "~/.gitconfig",
  template: true,
}
```

**command** — Run shell commands with optional idempotency checks. Commands can capture output for downstream use and be marked `critical` to halt the entire apply on failure:

```ts
{
  id: "install-rust",
  type: "command",
  run: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
  check: "command -v rustc",
}
```

**secret** — Decrypt [age](https://github.com/FiloSottile/age)-encrypted files and place them with specific permissions:

```ts
{
  id: "ssh-key",
  type: "secret",
  source: "./secrets/id_ed25519.age",
  destination: "~/.ssh/id_ed25519",
  permissions: "0600",
}
```

### Profiles

Profiles group resources and support inheritance. Child profiles override parent resources by `id`:

```ts
const base: Profile = {
  name: "base",
  packages: [
    { id: "git", type: "package", name: "git" },
    { id: "curl", type: "package", name: "curl" },
  ],
};

const workstation: Profile = {
  name: "workstation",
  extends: [base],
  packages: [
    { id: "firefox", type: "package", name: "firefox", brewCask: "firefox" },
  ],
};
```

### Platform filtering

Any package or command resource can include an `onlyOn` filter to restrict it to specific platforms:

```ts
{
  id: "coreutils",
  type: "package",
  name: "coreutils",
  onlyOn: { os: "darwin" },
}
```

### Parameters

Define interactive prompts that are asked once and saved to a lock file (`~/.config/dacha/params.lock.json`). Supported types: `text`, `confirm`, `select`.

```ts
params: [
  { name: "theme", message: "Color theme?", type: "select", choices: ["dark", "light"] },
]
```

Reset saved params with `dacha params reset` or `dacha init --reconfigure`.

### Dependencies

Resources can declare explicit dependencies via `dependsOn`. Implicit dependencies are also detected from `{{output.resourceId.key}}` template references. dacha builds a DAG, detects cycles, and applies resources in topological order.

## CLI

```
dacha init <url>          Clone a dotfiles repo and bootstrap the system
  --path <path>           Local clone path (default ~/.dotfiles)
  --reconfigure           Reset saved parameters and re-prompt
  -y, --yes               Auto-confirm prompts

dacha synth               Evaluate config and output resolved state as JSON
  --config <path>         Path to dacha.config.ts

dacha apply               Evaluate config and converge the system
  --config <path>         Path to dacha.config.ts
  --dry-run               Show what would change without applying
  -y, --yes               Auto-confirm prompts

dacha sync start          Install and start the background sync daemon
dacha sync stop           Stop and uninstall the sync daemon

dacha update              Pull remote changes and apply

dacha secret encrypt <f>  Encrypt a file using age
  --recipients <file>     Path to age recipients file

dacha secret edit <f>     Decrypt, edit in $EDITOR, and re-encrypt
  --identity <file>       Path to age identity file

dacha status              Show daemon state, last sync, and pending updates

dacha params reset [name] Reset saved parameters (all or by name)

Global flags:
  -q, --quiet             Suppress non-error output
  -v, --verbose           Enable debug output
  --version               Show version
```

## Background sync

The sync daemon watches your managed dotfiles for changes, debounces edits, and automatically commits + pushes them back to your repo. On macOS it uses launchd, on Linux it uses systemd.

```sh
dacha sync start   # install and start
dacha sync stop    # stop and uninstall
```

## Automatic updates

When enabled, dacha periodically fetches from your remote and notifies you (via `terminal-notifier` on macOS or `notify-send` on Linux) when changes are available. `dacha update` pulls and applies in one step.

## Secrets

dacha uses [age](https://github.com/FiloSottile/age) for secret management. Encrypted `.age` files live in your repo and are decrypted at apply time using your identity file (default `~/.config/age/identity.txt`, override with `DACHA_AGE_IDENTITY`).

```sh
dacha secret encrypt myfile --recipients recipients.txt
dacha secret edit myfile.age
```

## Supported platforms

| OS    | Arch  | Package Manager |
|-------|-------|-----------------|
| macOS | arm64 | brew            |
| macOS | x64   | brew            |
| Linux | arm64 | apt, dnf, yum   |
| Linux | x64   | apt, dnf, yum   |

Linux distro detection reads `/etc/os-release` to select the right package manager (apt for Debian/Ubuntu, dnf for Fedora, yum for CentOS/RHEL).

## Development

Requires [Deno](https://deno.land/) v2+.

```sh
# Run in dev mode
deno task dev

# Run tests
deno task test

# Compile a local binary
deno task compile
```

## License

MIT
