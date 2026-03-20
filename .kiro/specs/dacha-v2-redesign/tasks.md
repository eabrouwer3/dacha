# Tasks: dacha-v2-redesign

## Task 1: Core Resource Model

- [x] 1.1 Create `src/app.ts` with the `App` class (root scope, `_children`, `addChild()`, `collectResources()`)
  - Requirements: 4.1, 4.2, 4.3
- [x] 1.2 Create `src/resource.ts` with the abstract `Resource` base class (`id`, `dependsOn`, `outputs`, `_children`, `addChild()`, abstract `check()`/`apply()`, `toResolved()`, `resolvedType()`, `toProps()`)
  - Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
- [x] 1.3 Update `src/types.ts` — remove the `Resource` interface and `ResourceExecutor` interface; keep `Platform`, `ResolvedResource`, `ResourceResult`, `OutputStore`, and all other preserved types
  - Requirements: 1.1

## Task 2: L1 Resource Classes

- [x] 2.1 Rewrite `src/resources/package.ts` — `Package` class extending `Resource` with `PackageProps`, move `PackageExecutor` logic into `check()`/`apply()`, add `ensurePackageManager()` with brew auto-install and apt/dnf/yum error, add static `_brewVerified` flag
  - Requirements: 2.1, 2.5, 2.6, 2.7, 2.8
- [x] 2.2 Rewrite `src/resources/dotfile.ts` — `Dotfile` class extending `Resource` with `DotfileProps`, move `DotfileExecutor` logic into `check()`/`apply()`
  - Requirements: 2.2, 2.5
- [x] 2.3 Rewrite `src/resources/command.ts` — `Command` class extending `Resource` with `CommandProps`, move `CommandExecutor` logic into `check()`/`apply()`
  - Requirements: 2.3, 2.5
- [x] 2.4 Rewrite `src/resources/secret.ts` — `Secret` class extending `Resource` with `SecretProps`, move `SecretExecutor` logic into `check()`/`apply()`
  - Requirements: 2.4, 2.5

## Task 3: Synthesizer and Applier Updates

- [x] 3.1 Update `src/synth.ts` — replace profile-based resource flattening with `collectFromTree(app)` that walks the scope tree, collects leaf resources, and inherits parent dependencies
  - Requirements: 9.1, 9.2, 9.3, 9.4, 3.3, 3.4
- [x] 3.2 Update `src/apply.ts` — remove `getExecutor()` dispatch, call `resource.check()` and `resource.apply()` directly on class instances
  - Requirements: 2.5

## Task 4: Permission Management

- [x] 4.1 Create `src/permissions.ts` — `PermissionStore`/`PermissionEntry` types, `loadPermissions()`, `savePermissions()`, `ensurePermissions()`, `resetPermissions()`, `formatPermissions()`
  - Requirements: 8.2, 8.3, 8.4, 8.6, 8.7, 8.8

## Task 5: CLI Updates

- [x] 5.1 Update `src/cli.ts` — add `dacha permissions show` and `dacha permissions reset` subcommands
  - Requirements: 8.7, 8.8
- [x] 5.2 Update `src/cli.ts` — call `ensurePermissions()` on startup before running commands
  - Requirements: 8.2, 8.4
- [x] 5.3 Update `src/init.ts` — change default clone path from `~/.dotfiles` to `~/.dacha/`
  - Requirements: 7.1, 7.3

## Task 6: Library Entry Point and Package Config

- [x] 6.1 Update `src/mod.ts` — export `App`, `Resource`, `Package`, `Dotfile`, `Command`, `Secret`, all public types, and utility functions
  - Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
- [x] 6.2 Update `deno.json` — add `name`, `version`, `exports` fields for package publishing
  - Requirements: 5.1, 5.5

## Task 7: Build and Release Updates

- [x] 7.1 Update `deno.json` compile task — change `--allow-all` to granular permission flags (`--allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys`)
  - Requirements: 8.1
- [x] 7.2 Update `.github/workflows/release.yml` — add `publish` job to publish to GitHub Packages after the release job
  - Requirements: 5.3
- [x] 7.3 Update `install.sh` — change default path to `~/.dacha/`, pass `--path` to `dacha init` when `--repo` flag is used
  - Requirements: 7.4
- [x] 7.4 Update `src/sync/daemon.ts` and `src/sync/launchd.ts` and `src/sync/systemd.ts` — derive permission flags from Permission_Store when launching the daemon
  - Requirements: 8.5

## Task 8: Tests — Unit

- [x] 8.1 Create `src/resource.test.ts` — unit tests for Resource base class construction, scope auto-registration, `toResolved()` output structure, and edge cases (missing optional fields, empty dependsOn)
  - Requirements: 1.1, 1.2, 1.3, 1.6, 1.7
- [x] 8.2 Update `src/resources/resources.test.ts` — unit tests for each L1 class constructor, field round-trip, and `ensurePackageManager()` behavior (brew auto-install, apt/dnf/yum error)
  - Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.8
- [x] 8.3 Update `src/synth.test.ts` — unit tests for scope tree collection (single resource, two-level composite, three-level nesting, dependency inheritance)
  - Requirements: 9.1, 9.2, 3.3, 3.4
- [x] 8.4 Create `src/permissions.test.ts` — unit tests for load/save round-trip, corrupted file handling, reset deletes file, formatPermissions output
  - Requirements: 8.3, 8.7, 8.8

## Task 9: Tests — Property-Based

- [x] 9.1 Property 1 test in `src/resource.test.ts` — Resource constructor round-trip for all L1 types with random props
  - Requirements: 1.1, 1.2, 1.4, 1.5, 1.7, 2.1, 2.2, 2.3, 2.4
- [x] 9.2 Property 2 test in `src/resource.test.ts` — toResolved serialization preserves identity
  - Requirements: 1.6, 9.3
- [x] 9.3 Property 3 test in `src/synth.test.ts` — Scope tree collection completeness with random trees
  - Requirements: 3.2, 3.3, 4.3, 9.1, 9.2
- [x] 9.4 Property 4 test in `src/synth.test.ts` — Child resources inherit parent dependencies
  - Requirements: 3.4
- [x] 9.5 Property 5 test in `src/init.test.ts` — Init config path round-trip
  - Requirements: 7.2, 7.3
- [x] 9.6 Property 6 test in `src/permissions.test.ts` — Permission store round-trip and reset
  - Requirements: 8.3, 8.7
- [x] 9.7 Property 7 test in `src/permissions.test.ts` — Permission formatting completeness
  - Requirements: 8.8
- [x] 9.8 Property 8 test in `src/resource.test.ts` — Scope auto-registration
  - Requirements: 1.1, 1.2, 1.3, 4.2
- [x] 9.9 Property 9 test in `src/resources/package.test.ts` — Package manager auto-bootstrap guard
  - Requirements: 2.6, 2.7, 2.8
