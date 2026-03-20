# Requirements: дача (dacha) v1

## Introduction

дача is a code-first, cross-platform dotfiles and system configuration manager. Instead of templating languages or custom DSLs, users write their system configuration in TypeScript. Configurations compose through inheritance — shared base configs, platform-specific layers (macOS/Linux), and machine-specific overrides. A background daemon watches managed dotfiles for changes and syncs them back to a git repo automatically. The tool handles secrets, manages packages across different package managers, pulls updates from the remote repo, and can both copy config files and run arbitrary setup commands.

## Glossary

- **Profile**: A TypeScript module that declares a partial system configuration (packages, dotfiles, commands, settings). Profiles compose via inheritance/extension.
- **Target**: A specific machine or system type that a configuration is built for. A target selects which profiles to apply.
- **Dotfile**: Any user configuration file managed by дача (e.g. `~/.claude/CLAUDE.md`, `~/.config/ghostty/config`).
- **Package**: A software package to be installed. дача resolves the correct package manager per platform.
- **PackageManager**: A platform-specific installer (brew, apt, yum, dnf, snap, flatpak, etc.).
- **Secret**: An encrypted value (file or string) that дача decrypts at apply-time and places in the correct location.
- **SyncDaemon**: A background process that watches managed dotfiles for changes and syncs them back to the git repo.
- **ApplyRun**: The process of evaluating a target's configuration and converging the system to the desired state (installing packages, copying files, running commands).

---

## Requirements

### Requirement 1: Code-First Configuration with TypeScript

**User Story:** As a developer, I want to define my system configuration in TypeScript so that I get type safety, IDE support, and the full power of a real programming language instead of a custom DSL.

#### Acceptance Criteria

1. THE user SHALL define system configurations as TypeScript modules that export profile objects.
2. THE configuration API SHALL provide typed interfaces for declaring: packages, dotfiles, commands to run, system settings, and secrets.
3. THE user SHALL be able to use standard TypeScript features (conditionals, loops, functions, imports) to generate configuration dynamically.
4. THE tool SHALL evaluate the TypeScript configuration and produce a resolved desired-state representation before applying changes.
5. THE tool SHALL be runnable via a single CLI command (e.g. `dacha apply`) without requiring a separate build step — TypeScript is evaluated directly (e.g. via Deno or tsx).

### Requirement 2: Profile Inheritance and Composition

**User Story:** As a developer managing multiple machines, I want to define shared configuration once and layer platform-specific or machine-specific overrides on top, so I don't repeat myself.

#### Acceptance Criteria

1. THE configuration system SHALL support defining base profiles that can be extended by other profiles.
2. A profile SHALL be able to extend one or more parent profiles, inheriting their packages, dotfiles, commands, and settings.
3. WHEN a child profile declares a package, dotfile, or setting that conflicts with a parent, THE child's declaration SHALL take precedence.
4. THE user SHALL be able to compose profiles for common patterns such as: `base` → `desktop` → `macos-desktop` → `my-macbook`.
5. THE system SHALL support conditional inclusion of profile elements based on detected platform (os, arch, distro) at evaluation time.

### Requirement 3: Cross-Platform Package Management

**User Story:** As a developer with both macOS and Linux machines, I want to declare packages once and have дача figure out the right package manager for each platform.

#### Acceptance Criteria

1. THE user SHALL be able to declare packages by a canonical name, and дача SHALL resolve the correct package manager and package name per platform.
2. THE system SHALL support at minimum: brew (macOS), apt (Debian/Ubuntu), yum/dnf (RHEL/Fedora), and brew casks (macOS GUI apps).
3. THE user SHALL be able to override the package name per platform when canonical names differ (e.g. `{ name: "ripgrep", apt: "ripgrep", brew: "ripgrep" }`).
4. THE user SHALL be able to declare platform-specific packages that only install on certain OS/distro combinations.
5. WHEN `dacha apply` is run, THE system SHALL install any declared packages that are not already present, using the appropriate package manager.
6. THE system SHALL report which packages were installed, which were already present, and which failed.

### Requirement 4: Dotfile Management (Copy-Based, Mutable)

**User Story:** As a developer, I want дача to deploy my config files as real mutable copies so I can edit them in place, and have changes tracked automatically.

#### Acceptance Criteria

1. THE system SHALL deploy managed dotfiles by copying them from the repo to their destination paths, not by symlinking.
2. THE deployed files SHALL be writable by the user.
3. THE user SHALL declare dotfiles in the configuration with a source path (relative to the repo) and a destination path (absolute or home-relative).
4. WHEN `dacha apply` is run, THE system SHALL copy each declared dotfile to its destination, creating parent directories as needed.
5. IF a destination file already exists and differs from the source, THE system SHALL prompt the user to overwrite, skip, or diff before replacing.

### Requirement 5: Dotfile Sync Daemon

**User Story:** As a developer, I want a background daemon that watches my managed dotfiles and automatically syncs changes back to the git repo, so my repo always reflects my current config.

#### Acceptance Criteria

1. THE SyncDaemon SHALL run as a background process (launchd agent on macOS, systemd user unit on Linux).
2. THE SyncDaemon SHALL watch all managed dotfile destination paths for content changes.
3. WHEN a managed dotfile changes, THE SyncDaemon SHALL copy it back to its source path in the repo.
4. THE SyncDaemon SHALL debounce changes, waiting at least 2 seconds after the last modification before syncing.
5. AFTER copying a changed file back, THE SyncDaemon SHALL git add, commit (with a message like `auto-sync: update <filename>`), and push.
6. THE SyncDaemon SHALL create individual commits per file, not batch unrelated changes.
7. THE SyncDaemon SHALL never amend commits or force push.
8. IF git push fails due to network issues, THE SyncDaemon SHALL buffer the commit locally and retry when network connectivity is restored.
9. THE SyncDaemon SHALL log activity to a platform-appropriate log location.
10. THE SyncDaemon SHALL be startable/stoppable via `dacha sync start` and `dacha sync stop`.

### Requirement 6: Secret Management

**User Story:** As a developer, I want to store secrets (API tokens, credentials) encrypted in my dotfiles repo and have дача decrypt and deploy them at apply-time.

#### Acceptance Criteria

1. THE system SHALL support encrypting secrets at rest in the git repo using age encryption.
2. THE user SHALL be able to declare secrets in the configuration with a source (encrypted file in repo) and a destination path.
3. WHEN `dacha apply` is run, THE system SHALL decrypt each secret and place it at its destination path with restricted permissions (e.g. 0600).
4. THE system SHALL provide a CLI command to encrypt a new secret (e.g. `dacha secret encrypt <file>`).
5. THE system SHALL provide a CLI command to edit an encrypted secret in place (e.g. `dacha secret edit <file>`).
6. Secrets SHALL NOT be committed to git in plaintext at any point.

### Requirement 7: Command Execution

**User Story:** As a developer, I want to run arbitrary setup commands as part of my configuration (e.g. setting macOS defaults, enabling services), not just copy files and install packages.

#### Acceptance Criteria

1. THE user SHALL be able to declare commands in the configuration that run during `dacha apply`.
2. Commands SHALL support an ordering mechanism so they run at the right phase (e.g. before packages, after dotfiles).
3. Commands SHALL support a `check` condition — a command that determines if the action is already done, so it can be skipped on subsequent runs (idempotency).
4. WHEN a command fails, THE system SHALL report the error and continue with remaining commands (unless marked as critical).
5. Commands SHALL have access to platform context (os, arch, distro) so they can be conditional.

### Requirement 8: Resource Outputs and Dependency Resolution

**User Story:** As a developer, I want commands, packages, and other configuration steps to produce output values that can be referenced by later steps, and I want дача to automatically figure out the execution order based on these dependencies.

#### Acceptance Criteria

1. Commands, package installs, dotfile deployments, and secret decryptions SHALL be able to produce named output values (e.g. a command that returns a path, a version string, or a config value).
2. Other configuration steps SHALL be able to reference these output values as inputs (e.g. a dotfile template that uses the output of a command).
3. THE system SHALL automatically build a dependency graph from output/input references and determine the correct execution order (topological sort).
4. IF a circular dependency is detected, THE system SHALL report a clear error at evaluation time, before any actions are taken.
5. THE user SHALL be able to declare explicit dependencies between steps when automatic resolution is insufficient (e.g. `dependsOn: [otherStep]`).
6. THE system SHALL execute independent steps in the order they appear, and dependent steps only after their dependencies have completed.
7. IF a step fails and other steps depend on it, THE system SHALL skip the dependent steps and report which steps were skipped and why.

### Requirement 9: Configuration Synthesis

**User Story:** As a developer, I want a `dacha synth` command that evaluates my TypeScript config and outputs the fully resolved desired state as a declarative manifest, so I can inspect, debug, and review what дача would do without making any changes.

#### Acceptance Criteria

1. THE CLI SHALL provide a `dacha synth` command that evaluates the configuration for the current (or specified) target and outputs the resolved desired state.
2. THE output SHALL be a structured format (JSON) containing the full flattened list of packages, dotfiles, commands, secrets, and their resolved dependency order.
3. THE output SHALL reflect all profile inheritance, platform detection, and conditional logic already resolved — no unresolved references or conditionals.
4. THE synth output SHALL NOT perform any side effects (no installs, no file copies, no commands run).
5. `dacha apply` SHALL internally run synth first, then diff the desired state against the current system to determine what actions to take.
6. THE user SHALL be able to pipe or save the synth output for diffing between runs (e.g. `dacha synth > state.json`).
7. THE synth output SHALL include metadata about which profile(s) contributed each element, for traceability.

### Requirement 10: Pull-Based Updates from Remote Repo

**User Story:** As a developer, I want дача to periodically check for updates in the remote git repo and prompt me to apply them, so my machines stay in sync.

#### Acceptance Criteria

1. THE system SHALL support a scheduled update check (configurable interval, default 24 hours).
2. THE update check SHALL run automatically via launchd (macOS) or systemd timer (Linux).
3. WHEN updates are found in the remote repo, THE system SHALL notify the user (e.g. terminal-notifier on macOS, notify-send on Linux).
4. THE notification SHALL indicate what changed (list of modified files).
5. THE user SHALL be able to apply updates via `dacha update` which pulls the latest repo and runs `dacha apply`.
6. THE user SHALL be able to skip or defer an update.
7. WHEN the machine has been off or disconnected for longer than the configured interval, THE system SHALL check for updates on next boot/login.

### Requirement 11: Zero-Dependency Installation

**User Story:** As a developer setting up a new machine, I want to install дача with a single `curl | sh` command that requires no pre-installed dependencies (no Deno, no Node, no package manager), so I can bootstrap from a bare system.

#### Acceptance Criteria

1. THE project SHALL provide an install script hosted at a stable URL (e.g. `https://dacha.dev/install.sh` or a raw GitHub URL).
2. THE install script SHALL detect the current platform (os, arch) and download the correct pre-compiled binary or Deno-bundled executable.
3. THE install script SHALL NOT require any runtime dependencies beyond `curl` (or `wget`) and a POSIX shell — no Deno, Node, Python, or package manager needed.
4. THE install script SHALL place the `dacha` binary in a standard location (e.g. `~/.local/bin/dacha`) and advise the user to add it to PATH if not already present.
5. THE install script SHALL verify the download integrity (e.g. checksum).
6. THE project SHALL use `deno compile` to produce self-contained, platform-specific binaries (darwin-arm64, darwin-x64, linux-arm64, linux-x64) that bundle the Deno runtime.
7. THE binaries SHALL be published as GitHub release assets on each version tag.

### Requirement 12: One-Command Bootstrap from GitHub URL

**User Story:** As a developer, I want to point дача at my dotfiles GitHub repo URL and have it clone the repo, evaluate the config, and fully set up my machine in one command.

#### Acceptance Criteria

1. THE CLI SHALL provide a `dacha init <github-url>` command that clones the repo to a configurable local path (default `~/.dotfiles`).
2. IF the repo is already cloned at the target path, `dacha init` SHALL pull the latest changes instead of re-cloning.
3. AFTER cloning, `dacha init` SHALL automatically run `dacha apply` to converge the system to the desired state.
4. THE install script (Requirement 11) SHALL support an optional argument or environment variable to run `dacha init <url>` immediately after installation, enabling a true single-command bootstrap: `curl -fsSL https://dacha.dev/install.sh | sh -s -- --repo https://github.com/user/dotfiles`.
5. `dacha init` SHALL configure the local repo path in `~/.config/dacha/config.json` so subsequent `dacha apply`, `dacha sync`, and `dacha update` commands know where to find the config.
6. `dacha init` SHALL set up the sync daemon and update checker automatically after a successful apply (if enabled in the config).

### Requirement 13: Interactive Parameters and Lock File

**User Story:** As a developer, I want my dotfiles config to declare required parameters (like username, hostname, git email) that get prompted interactively on first run, so the config is personalized without hardcoding values, and the answers are saved so I'm never asked twice.

#### Acceptance Criteria

1. THE configuration API SHALL support declaring named parameters with a type (string, boolean, choice), a human-readable prompt message, and an optional default value.
2. WHEN `dacha apply` or `dacha init` is run and a required parameter has no saved value, THE system SHALL interactively prompt the user using a rich terminal prompt (selections, text input, confirmations).
3. THE system SHALL save all parameter answers to a lock file at `~/.config/dacha/params.lock.json`.
4. THE lock file SHALL be treated as immutable after creation — subsequent runs SHALL read from it without re-prompting.
5. THE user SHALL be able to re-prompt for all or specific parameters via `dacha init --reconfigure` or `dacha params reset [name]`.
6. Parameters SHALL be available to the TypeScript configuration at evaluation time, so profiles can use them in conditionals, package names, dotfile content, commands, etc.
7. THE configuration context SHALL also provide built-in path variables (`home`, `configDir`, `dataDir`, `cacheDir`, `tmpDir`, `repoDir`) resolved per platform, so resources can reference standard directories without hardcoding paths.
8. THE lock file SHALL NOT be committed to the git repo (it is machine-specific). It SHALL be listed in a recommended `.gitignore`.
8. THE synth output SHALL include the resolved parameter values used during evaluation, for traceability.

### Requirement 14: CLI Interface

**User Story:** As a developer, I want a clean CLI to manage all дача operations.

#### Acceptance Criteria

1. THE CLI SHALL provide the following subcommands at minimum:
   - `dacha init <github-url>` — clone repo and bootstrap the system
   - `dacha synth` — evaluate config and output the resolved desired state as JSON
   - `dacha apply` — evaluate config and converge the system
   - `dacha sync start` / `dacha sync stop` — manage the sync daemon
   - `dacha update` — pull remote changes and apply
   - `dacha secret encrypt <file>` — encrypt a secret
   - `dacha secret edit <file>` — edit an encrypted secret
   - `dacha status` — show current state (daemon running, pending changes, last sync)
2. THE CLI SHALL provide clear, colored terminal output showing what actions are being taken.
3. THE CLI SHALL support a `--dry-run` flag on `apply` that shows what would change without making changes.
4. THE CLI SHALL detect the current platform automatically and apply the correct target configuration.
