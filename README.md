# дача (dacha)

Code-first dotfiles and system configuration manager. Define your packages, dotfiles, shell commands, and secrets as TypeScript classes — dacha synthesizes a dependency graph, detects your platform, and converges your system to the desired state.

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

1. You write a `dacha.config.ts` in your dotfiles repo using the class-based API
2. `dacha synth` evaluates the config — collecting resources from the scope tree, resolving dependencies, and topologically sorting the graph
3. `dacha apply` walks the sorted resources, calls each one's `check()` to see if it's already satisfied, and `apply()` on anything that needs converging

## Configuration

Your dotfiles repo contains a `dacha.config.ts` that exports a `Machine` instance. The recommended pattern is to subclass `Machine` and define all your resources in the constructor — similar to how you'd extend a `Stack` in CDK:

```ts
import { Machine, Package, File, Command, Secret } from "@eabrouwer3/dacha";

class MyMachine extends Machine {
  constructor() {
    super();

    new Package(this, "git", { name: "git" });
    new Package(this, "ripgrep", { name: "ripgrep", brew: "ripgrep", apt: "ripgrep" });
    new Package(this, "fish", { name: "fish" });

    new File(this, "gitconfig", {
      source: "./config/gitconfig",
      destination: "~/.gitconfig",
      template: true,
    });

    new Command(this, "install-rust", {
      run: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
      check: "command -v rustc",
    });

    new Secret(this, "ssh-key", {
      source: "./secrets/id_ed25519.age",
      destination: "~/.ssh/id_ed25519",
      permissions: "0600",
    });
  }
}

export default new MyMachine();
```

You can also use `Machine` directly without subclassing:

```ts
const machine = new Machine();
new Package(machine, "git", { name: "git" });
export default machine;
```

### Scope tree

Resources register themselves with a parent scope when constructed. The first argument to any resource constructor is its scope — either the `Machine` root or another `Resource`. This lets you compose logical groups:

```ts
class MyMachine extends Machine {
  constructor() {
    super();

    // A parent resource that groups related children
    const devTools = new Command(this, "dev-tools", {
      run: "echo 'dev tools ready'",
      check: "true",
    });

    // Children register under devTools instead of the machine directly
    new Package(devTools, "neovim", { name: "neovim" });
    new Package(devTools, "tmux", { name: "tmux" });
  }
}
```

When dacha collects resources, it walks the tree and gathers all leaf nodes for execution.

### Parameters

Parameters let you prompt for values on first run and reuse them on subsequent runs. Define them as a static `params` array on your `Machine` subclass, then export a factory function that receives the resolved values:

```ts
import { Machine, Package, type Params, type ParamDefinition } from "@eabrouwer3/dacha";

class WorkMachine extends Machine {
  static params: ParamDefinition[] = [
    { name: "hostname", message: "What should this machine be called?", type: "text", default: "work-laptop" },
    { name: "install_games", message: "Install games?", type: "confirm", default: false },
  ];

  constructor(params: Params) {
    super();

    new Package(this, "git", { name: "git" });

    if (params.install_games) {
      new Package(this, "steam", { name: "steam" });
    }

    new Command(this, "set-hostname", {
      run: `sudo scutil --set ComputerName "${params.hostname}"`,
      check: `test "$(scutil --get ComputerName)" = "${params.hostname}"`,
    });
  }
}

export default ({ params }: { params: Params }) => new WorkMachine(params);
```

On first run, dacha prompts for each parameter and saves the answers to `~/.config/dacha/params.lock.json`. Subsequent runs reuse the saved values. Use `dacha params reset` to re-prompt.
## Resources

### Package

Install system packages via the detected package manager (brew, apt, dnf, yum). On macOS, Homebrew is auto-installed if missing.

```ts
new Package(this, "ripgrep", {
  name: "ripgrep",
  brew: "ripgrep",       // override for brew
  apt: "ripgrep",        // override for apt
  yum: "ripgrep",        // override for yum
});

// macOS GUI apps via brew cask
new BrewCaskPackage(this, "firefox", { name: "firefox" });
```

### File

Copy files or directories to their destination. Templates support `{{output.resourceId.key}}` interpolation from upstream resource outputs. Can also create empty directories.

```ts
// Copy a single file with template interpolation
new File(this, "gitconfig", {
  source: "./config/gitconfig",
  destination: "~/.gitconfig",
  template: true,          // enable interpolation
});

// Copy an entire directory
new File(this, "nvim-config", {
  source: "./config/nvim",
  destination: "~/.config/nvim",
});

// Create an empty directory
new File(this, "cache-dir", {
  destination: "~/.cache/myapp",
  directory: true,
});
```

### Command

Run shell commands with optional idempotency checks. If `check` exits 0, the command is skipped. Commands can capture output for downstream use and be marked `critical` to halt the entire apply on failure.

```ts
new Command(this, "install-rust", {
  run: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
  check: "command -v rustc",
  critical: true,
  captureOutput: "rustc_path",
});
```

### Secret

Decrypt [age](https://github.com/FiloSottile/age)-encrypted files and place them with specific permissions.

```ts
new Secret(this, "ssh-key", {
  source: "./secrets/id_ed25519.age",
  destination: "~/.ssh/id_ed25519",
  permissions: "0600",
});
```

### MacDefault

Set macOS `defaults` preferences. The type flag (`-bool`, `-int`, `-string`) is inferred from the value.

```ts
new MacDefault(this, "dock-autohide", {
  domain: "com.apple.dock",
  key: "autohide",
  value: true,
});
```

### Dependencies

Resources can declare explicit dependencies via `dependsOn`. Implicit dependencies are also detected from `{{output.resourceId.key}}` template references. dacha builds a DAG, detects cycles, and applies resources in topological order.

```ts
const rust = new Command(this, "install-rust", {
  run: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
  check: "command -v rustc",
});

new Command(this, "setup-rust", {
  run: "rustup default stable",
  check: "rustup show | grep stable",
  dependsOn: [rust],
});
```

## Library usage

dacha is published on JSR as `@eabrouwer3/dacha`. You can import and use it programmatically:

```ts
import { Machine, Package, synth, apply } from "@eabrouwer3/dacha";

const machine = new Machine();
new Package(machine, "git", { name: "git" });

const state = await synth(machine);
await apply(state);
```

## CLI

```
dacha init <url>              Clone a dotfiles repo and bootstrap the system
  --path <path>               Local clone path (default ~/.dacha)
  --reconfigure               Reset saved parameters and re-prompt
  -y, --yes                   Auto-confirm prompts

dacha synth                   Evaluate config and output resolved state as JSON
  --config <path>             Path to dacha.config.ts

dacha apply                   Evaluate config and converge the system
  --config <path>             Path to dacha.config.ts
  --dry-run                   Show what would change without applying
  -y, --yes                   Auto-confirm prompts

dacha sync start              Install and start the background sync daemon
dacha sync stop               Stop and uninstall the sync daemon

dacha update                  Pull remote changes and apply

dacha secret encrypt <f>      Encrypt a file using age
  --recipients <file>         Path to age recipients file

dacha secret edit <f>         Decrypt, edit in $EDITOR, and re-encrypt
  --identity <file>           Path to age identity file

dacha status                  Show daemon state, last sync, and pending updates

dacha params reset [name]     Reset saved parameters (all or by name)

dacha permissions show        Display currently granted Deno permissions
dacha permissions reset       Reset permissions — will re-prompt on next run

Global flags:
  -q, --quiet                 Suppress non-error output
  -v, --verbose               Enable debug output
  --version                   Show version
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

## Permissions

dacha uses granular Deno permissions instead of `--allow-all`. On first run it prompts for each required permission (read, write, env, net, run, sys) and persists approvals to `~/.config/dacha/permissions.json`.

```sh
dacha permissions show    # see what's granted
dacha permissions reset   # clear and re-prompt next run
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
deno task dev       # run in dev mode
deno task test      # run tests
deno task compile   # compile a local binary
```

## License

MIT
