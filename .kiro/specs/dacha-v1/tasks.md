# Implementation Plan: дача (dacha) v1

## Overview

Build a TypeScript CLI tool on Deno that manages dotfiles and system configuration through code-first TypeScript configs, profile inheritance, cross-platform package management, a sync daemon, secret management, and pull-based updates. Implementation proceeds bottom-up: core types → platform detection → profile resolution → dependency graph → synthesis → resource executors → applier → sync daemon → update checker → CLI routing → install script.

## Tasks

- [x] 1. Set up project structure and core types
  - [x] 1.1 Create `dacha/deno.json` with project config, import map entries, and task definitions
    - Include entries for `@std/cli`, `@std/path`, `@std/fs`, and Cliffy dependencies
    - Define tasks: `dev`, `test`, `compile`
    - _Requirements: 1.5, 14.1_
  - [x] 1.2 Create `dacha/src/types.ts` with all core type definitions
    - Define: `Platform`, `PackageManagerType`, `Resource`, `PackageResource`, `DotfileResource`, `CommandResource`, `SecretResource`, `PlatformFilter`, `Profile`, `DachaConfig`, `ParamDefinition`, `Params`, `Paths`, `ResolvedState`, `ResolvedResource`, `ResourceExecutor`, `ResourceResult`, `OutputStore`
    - Export all types for use across modules
    - _Requirements: 1.1, 1.2, 2.1, 3.1, 4.3, 6.2, 7.1, 8.1, 9.2, 13.1, 13.7_
  - [x] 1.3 Create `dacha/src/util/log.ts` with colored terminal output helper
    - Implement `info`, `success`, `warn`, `error`, `debug` log functions using ANSI colors
    - Support `--quiet` and `--verbose` modes via a global log level
    - _Requirements: 14.2_
  - [x] 1.4 Create `dacha/src/util/shell.ts` with shell command execution helper
    - Implement `exec(cmd, opts?)` that wraps `Deno.Command`, returns `{ code, stdout, stderr }`
    - Handle timeouts and error reporting
    - _Requirements: 7.1, 3.5_

- [x] 2. Platform detection
  - [x] 2.1 Create `dacha/src/platform.ts` with platform detection logic
    - Detect `os` (`darwin` | `linux`) via `Deno.build.os`
    - Detect `arch` (`arm64` | `x64`) via `Deno.build.arch`
    - Detect Linux distro by reading `/etc/os-release`
    - Determine `packageManager` based on os + distro (brew for darwin, apt/dnf/yum for linux variants)
    - Resolve `Paths` object (`home`, `configDir`, `dataDir`, `cacheDir`, `tmpDir`, `repoDir`) using env vars and XDG defaults
    - _Requirements: 2.5, 3.1, 3.2, 13.7, 14.4_
  - [x] 2.2 Write unit tests for platform detection
    - Test distro parsing from `/etc/os-release` content
    - Test package manager selection per os/distro
    - Test `Paths` resolution with and without XDG env vars
    - _Requirements: 2.5, 3.1, 13.7_

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Profile resolution
  - [x] 4.1 Create `dacha/src/profile.ts` with profile merging and inheritance
    - Implement `resolveProfile(profile: Profile): Profile` using depth-first left-to-right traversal of `extends`
    - Concatenate resource arrays from parent to child; child replaces parent on matching `id`
    - Tag each resource with `contributedBy` = profile name
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 4.2 Write property test for profile resolution
    - **Property 1: Child override precedence** — for any profile chain, if child and parent declare a resource with the same `id`, the resolved profile contains only the child's version
    - **Validates: Requirements 2.3**
  - [x] 4.3 Write unit tests for profile resolution
    - Test single-level inheritance, multi-level chain (`base → desktop → macos → my-macbook`), diamond inheritance, empty profiles
    - Test `contributedBy` tagging
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 5. Dependency graph and topological sort
  - [x] 5.1 Create `dacha/src/graph.ts` with dependency graph builder
    - Build adjacency list from explicit `dependsOn` references
    - Scan string fields for `{{output.X.Y}}` patterns to add implicit edges
    - Implement cycle detection via DFS with coloring; throw with cycle path on detection
    - Implement topological sort (Kahn's algorithm)
    - Return resources in execution order
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6_
  - [x] 5.2 Write property test for dependency graph
    - **Property 2: Topological ordering validity** — for any DAG of resources, every resource in the sorted output appears after all of its dependencies
    - **Validates: Requirements 8.3, 8.6**
  - [x] 5.3 Write property test for cycle detection
    - **Property 3: Cycle detection completeness** — for any resource set containing a circular dependency, `buildGraph` throws an error containing the cycle path
    - **Validates: Requirements 8.4**
  - [x] 5.4 Write unit tests for dependency graph
    - Test explicit `dependsOn`, implicit `{{output.X.Y}}` detection, mixed dependencies, independent resources ordering, cycle error messages
    - _Requirements: 8.3, 8.4, 8.5, 8.6_

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Parameter prompting and lock file
  - [x] 7.1 Create `dacha/src/params.ts` with parameter prompting and lock file management
    - Implement `loadParams(defs: ParamDefinition[]): Promise<Params>` — reads `~/.config/dacha/params.lock.json`, prompts for missing values using Cliffy prompts (text, confirm, select), writes updated lock file atomically
    - Implement `resetParams(name?: string)` — deletes specific or all params from lock file
    - Lock file format: `{ version: 1, createdAt: string, params: Record<string, string | boolean> }`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.8_
  - [x] 7.2 Write unit tests for params lock file read/write
    - Test loading existing lock file, writing new lock file, resetting individual and all params
    - Test that existing params are not re-prompted
    - _Requirements: 13.3, 13.4, 13.5_

- [x] 8. Configuration synthesis
  - [x] 8.1 Create `dacha/src/synth.ts` with the synthesizer
    - Implement `synth(configPath: string, opts?): Promise<ResolvedState>` that:
      1. Detects platform
      2. Loads params (prompting if needed)
      3. Dynamically imports `dacha.config.ts` from the user's repo, passing `{ platform, params, paths }`
      4. Resolves the profile chain via `resolveProfile`
      5. Evaluates platform conditionals (`onlyOn` filters)
      6. Collects all resources
      7. Builds dependency graph and topological sorts
      8. Returns `ResolvedState` JSON with metadata (generatedAt, repoPath, profileChain, params)
    - _Requirements: 1.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 13.6, 13.8_
  - [x] 8.2 Write unit tests for synth
    - Test with a minimal in-memory config: verify output structure, profile chain metadata, platform filtering, param inclusion
    - Test that no side effects occur (no file writes, no installs)
    - _Requirements: 9.2, 9.3, 9.4, 9.7_

- [x] 9. Resource executors
  - [x] 9.1 Create `dacha/src/resources/package.ts` — PackageExecutor
    - `check`: run platform-specific check command (`brew list`, `dpkg -l`, `rpm -q`)
    - `apply`: run install command, capture installed version as output
    - Resolve correct package name per platform using `brew`, `apt`, `yum` overrides on `PackageResource`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 9.2 Create `dacha/src/resources/dotfile.ts` — DotfileExecutor
    - `check`: compare source and destination file hashes
    - `apply`: copy file to destination, create parent dirs; if `template: true`, interpolate `{{output.X.Y}}` from OutputStore; prompt user on conflict (overwrite/skip/diff) unless `--yes`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 8.2_
  - [x] 9.3 Create `dacha/src/resources/command.ts` — CommandExecutor
    - `check`: run the `check` command, skip if exits 0
    - `apply`: run the `run` command; if `captureOutput` set, capture stdout to OutputStore; if `critical` and fails, throw to halt
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1_
  - [x] 9.4 Create `dacha/src/resources/secret.ts` — SecretExecutor
    - `check`: compare destination hash with decrypted source hash (or check existence + mtime)
    - `apply`: run `age -d -i <identity> <source>`, write to destination with permissions (default `0600`)
    - _Requirements: 6.1, 6.2, 6.3, 6.6_
  - [x] 9.5 Write unit tests for resource executors
    - Test PackageExecutor: check returns true when installed, apply runs correct command per platform
    - Test DotfileExecutor: copy, template interpolation, conflict detection
    - Test CommandExecutor: check skip, captureOutput, critical failure
    - Test SecretExecutor: permissions, age CLI invocation
    - _Requirements: 3.5, 3.6, 4.4, 4.5, 7.3, 7.4, 6.3_

- [x] 10. Applier
  - [x] 10.1 Create `dacha/src/apply.ts` with the applier
    - Implement `apply(state: ResolvedState, opts: { dryRun?: boolean, yes?: boolean }): Promise<ApplyReport>`
    - Iterate resources in topological order: check → apply → collect outputs → report status
    - On failure: if resource is critical, halt; otherwise continue and skip dependents (track skipped + reason)
    - Dry-run mode: run checks only, report what would change
    - Print colored summary: installed/applied, skipped, failed counts
    - _Requirements: 1.4, 3.5, 3.6, 4.4, 7.4, 8.6, 8.7, 9.5, 14.2, 14.3_
  - [x] 10.2 Write unit tests for applier
    - Test dry-run produces no side effects
    - Test dependent-skip on failure
    - Test summary report accuracy
    - _Requirements: 8.7, 14.3_

- [x] 11. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Git utilities
  - [x] 12.1 Create `dacha/src/util/git.ts` with git operation helpers
    - Implement: `gitClone`, `gitPull`, `gitAdd`, `gitCommit`, `gitPush`, `gitFetch`, `gitDiffNames`, `gitStatus`
    - All shell out to `git` CLI via `shell.ts`
    - _Requirements: 5.5, 10.5, 12.1, 12.2_
  - [x] 12.2 Create `dacha/src/util/network.ts` with connectivity check
    - Implement `isOnline(): Promise<boolean>` via DNS resolve or HTTP HEAD
    - _Requirements: 5.8_

- [x] 13. Sync daemon
  - [x] 13.1 Create `dacha/src/sync/daemon.ts` with the sync daemon process
    - Load config to get managed dotfile paths
    - Watch destinations via `Deno.watchFs`
    - Debounce changes (2s default per file)
    - On debounce fire: copy destination → repo source, `git add`, `git commit` (individual commits per file), `git push`
    - On push failure: buffer locally, retry periodically (every 60s) when online
    - Log activity to platform log location
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_
  - [x] 13.2 Create `dacha/src/sync/launchd.ts` — generate macOS launchd plist
    - Generate `~/Library/LaunchAgents/dev.dacha.sync.plist`
    - Support load/unload via `launchctl`
    - _Requirements: 5.1, 5.10_
  - [x] 13.3 Create `dacha/src/sync/systemd.ts` — generate Linux systemd user unit
    - Generate `~/.config/systemd/user/dacha-sync.service`
    - Support enable/start/stop via `systemctl --user`
    - _Requirements: 5.1, 5.10_
  - [x] 13.4 Write unit tests for sync daemon debounce and commit logic
    - Test debounce timer resets on rapid changes
    - Test individual commits per file (not batched)
    - _Requirements: 5.4, 5.6_

- [x] 14. Update checker
  - [x] 14.1 Create `dacha/src/update/checker.ts` with git fetch + diff check
    - `git fetch origin`, compare local HEAD with `origin/main`
    - If behind: get changed file list, write `~/.local/share/dacha/update-pending.json`
    - _Requirements: 10.1, 10.4_
  - [x] 14.2 Create `dacha/src/update/notifier.ts` with platform notification dispatch
    - macOS: shell out to `terminal-notifier`
    - Linux: shell out to `notify-send`
    - Include changed file list in notification body
    - _Requirements: 10.3, 10.4_
  - [x] 14.3 Create `dacha/src/update/scheduler.ts` — generate launchd/systemd timer
    - macOS: `~/Library/LaunchAgents/dev.dacha.update.plist` with `StartInterval`
    - Linux: `~/.config/systemd/user/dacha-update.timer`
    - Configurable interval (default 24h)
    - _Requirements: 10.1, 10.2, 10.7_

- [x] 15. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Secret management CLI helpers
  - [x] 16.1 Create `dacha/src/resources/secret.ts` additions for encrypt and edit commands
    - `encrypt(file, recipients)`: run `age -e -R <recipients> <file> > <file>.age`
    - `edit(ageFile, identity)`: decrypt to temp file → open `$EDITOR` → re-encrypt → clean up temp; ensure plaintext never hits disk unencrypted longer than the edit session
    - _Requirements: 6.4, 6.5, 6.6_

- [x] 17. Init command
  - [x] 17.1 Create `dacha/src/init.ts` with the init/bootstrap flow
    - `dacha init <github-url> [--path ~/.dotfiles]`: clone or pull repo
    - Write `~/.config/dacha/config.json` with `{ repoPath }`
    - Run `dacha apply` after clone
    - If sync enabled in config: run `dacha sync start`
    - If update enabled: install update checker schedule
    - Support `--reconfigure` flag to reset params
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 13.5_

- [x] 18. CLI entry point and subcommand routing
  - [x] 18.1 Create `dacha/src/cli.ts` with all subcommand routing
    - Parse subcommands using Cliffy Command: `init`, `synth`, `apply`, `sync start`, `sync stop`, `update`, `secret encrypt`, `secret edit`, `status`, `params reset`
    - Wire each subcommand to its implementation module
    - Support global flags: `--dry-run`, `--yes`, `--quiet`, `--verbose`
    - `synth`: call synth, print JSON to stdout (pipeable)
    - `apply`: call synth → apply, print colored report
    - `status`: show daemon running state, last sync time, pending pushes, pending updates
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 9.1, 9.6_
  - [x] 18.2 Create `dacha/src/mod.ts` as the library entry point
    - Re-export public types and key functions (`synth`, `apply`, `resolveProfile`, `buildGraph`, `detectPlatform`)
    - _Requirements: 1.1, 1.2_

- [x] 19. Install script
  - [x] 19.1 Create `dacha/install.sh` — POSIX shell installer
    - Detect OS (`uname -s`) and arch (`uname -m`), map to binary name
    - Download from GitHub releases URL
    - Verify checksum (download `sha256sums.txt`, compare)
    - Install to `~/.local/bin/dacha`, `chmod +x`
    - Print PATH advice if `~/.local/bin` not in PATH
    - Support `--repo <url>` argument to run `dacha init <url>` after install
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 12.4_

- [x] 20. Deno compile configuration
  - [x] 20.1 Add compile tasks to `dacha/deno.json` for cross-platform binaries
    - Add deno task entries for: `compile:darwin-arm64`, `compile:darwin-x64`, `compile:linux-arm64`, `compile:linux-x64`
    - Each runs `deno compile --target <target> --output dacha-<platform>-<arch> src/cli.ts`
    - _Requirements: 11.6, 11.7_

- [x] 21. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- All source code goes in `dacha/src/`, tests use Deno's built-in test runner (`Deno.test`)
- Property tests validate universal correctness properties; unit tests validate specific examples and edge cases
- The runtime is Deno — TypeScript runs directly, no build step needed
