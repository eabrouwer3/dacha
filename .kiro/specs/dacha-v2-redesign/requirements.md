# Requirements Document

## Introduction

Dacha v2 is a redesign of the dacha dotfiles and system configuration manager. The redesign introduces a CDK-style class-based resource model with a construct-tree scope pattern, publishes dacha as a library to GitHub Packages so users can import it as a dependency, changes the default dotfiles clone location to `~/.dacha/`, and adds a Deno permission management system that prompts on first run and persists approvals for automated background runs. Dacha remains an executable CLI tool throughout.

## Glossary

- **Dacha_CLI**: The compiled Deno binary that provides the `dacha` command-line interface (init, synth, apply, etc.)
- **Dacha_Library**: The npm/Deno package published to GitHub Packages that exports the resource classes, types, and utility functions for use in user configuration files
- **Resource**: A class-based unit of system configuration (package, dotfile, command, or secret) that encapsulates its own check and apply logic. Every Resource takes a `scope` (parent) as its first constructor argument, an `id` string as its second, and an optional props object as its third.
- **App**: The root scope object that serves as the top-level parent for all resources in a user's configuration. The user creates an App, adds resources to it, and returns it from their dacha.config.ts.
- **Scope_Tree**: The in-memory tree of Resource instances formed by parent-child relationships established through constructor scope arguments. The App is the root of the Scope_Tree.
- **L1_Resource**: A base resource class shipped with the Dacha_Library that maps directly to a single system operation (e.g., Package, Dotfile, Command, Secret)
- **L2_Resource**: A higher-level resource class shipped with the Dacha_Library that composes multiple L1_Resources into a reusable pattern
- **L3_Resource**: A user-defined custom resource class that composes L1_Resources and L2_Resources for project-specific configuration patterns
- **Synthesizer**: The component that walks the Scope_Tree starting from the App root, collects all leaf Resource instances, resolves dependencies, and produces a ResolvedState
- **Applier**: The component that walks resources in topological order, checks current state, and applies changes to converge the system
- **Permission_Store**: A JSON file at `~/.config/dacha/permissions.json` that persists Deno permission approvals granted by the user
- **Config_Repo**: The user's dotfiles git repository cloned into `~/.dacha/`
- **Profile**: A named grouping of resources that supports inheritance via an extends chain
- **Platform**: The detected operating system, architecture, and package manager of the current machine
- **OutputStore**: A map of resource IDs to their output key-value pairs, used for cross-resource data passing

## Requirements

### Requirement 1: Resource Base Class

**User Story:** As a dacha user, I want resources to be class instances with a CDK-style scope pattern, so that I can compose them into trees, extend them, and benefit from type-safe constructors.

#### Acceptance Criteria

1. THE Dacha_Library SHALL export an abstract `Resource` base class whose constructor takes a `scope` (parent Resource or App) as the first argument, an `id` string as the second argument, and an optional props object as the third argument
2. WHEN a Resource is constructed with a scope, THE Resource SHALL automatically register itself as a child of the scope
3. THE Resource base class SHALL maintain an internal list of child resources registered via the scope pattern
4. THE Resource base class SHALL provide an abstract `check(platform: Platform): Promise<boolean>` method that determines whether the resource is already in the desired state
5. THE Resource base class SHALL provide an abstract `apply(platform: Platform, outputs: OutputStore): Promise<ResourceResult>` method that converges the resource to the desired state
6. THE Resource base class SHALL expose a `toResolved(): ResolvedResource` method that serializes the resource instance into the ResolvedResource format, deriving a type string from the class name or a static field for serialization purposes
7. THE Resource base class SHALL expose optional `dependsOn` and `outputs` fields

### Requirement 2: L1 Resource Classes

**User Story:** As a dacha user, I want built-in resource classes for packages, dotfiles, commands, and secrets, so that I can instantiate them with type-safe constructors using the scope pattern.

#### Acceptance Criteria

1. THE Dacha_Library SHALL export a `Package` class extending Resource whose constructor takes `(scope, id, props)` where props accepts package configuration (name, brew, brewCask, apt, yum)
2. THE Dacha_Library SHALL export a `Dotfile` class extending Resource whose constructor takes `(scope, id, props)` where props accepts dotfile configuration (source, destination, template)
3. THE Dacha_Library SHALL export a `Command` class extending Resource whose constructor takes `(scope, id, props)` where props accepts command configuration (run, check, critical, captureOutput)
4. THE Dacha_Library SHALL export a `Secret` class extending Resource whose constructor takes `(scope, id, props)` where props accepts secret configuration (source, destination, permissions)
5. WHEN an L1_Resource is instantiated, THE L1_Resource SHALL embed the check and apply logic currently in the corresponding ResourceExecutor (PackageExecutor, DotfileExecutor, CommandExecutor, SecretExecutor)
6. WHEN the Package class's `apply()` method runs and the detected package manager is `brew`, THE Package class SHALL check whether Homebrew is installed and automatically install Homebrew using the official install script before proceeding with the package installation
7. WHEN the Package class auto-installs Homebrew, THE Package class SHALL use the official Homebrew install script (`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`)
8. IF the Package class's `apply()` method runs and the detected package manager is `apt`, `dnf`, or `yum` and that package manager binary is not found, THEN THE Package class SHALL throw a descriptive error stating that the system package manager is not installed and cannot be auto-installed

### Requirement 3: Custom Resource Composition (L2/L3)

**User Story:** As a dacha user, I want to create custom resource classes that compose built-in resources using the scope pattern, so that I can encapsulate repeatable configuration patterns.

#### Acceptance Criteria

1. THE Dacha_Library SHALL allow users to define L3_Resource classes by extending the Resource base class and constructing child resources with `this` as the scope in the constructor
2. WHEN a child Resource is constructed with a parent Resource as its scope, THE child SHALL automatically register itself with the parent, forming a Scope_Tree
3. WHEN a composite Resource has child resources, THE Synthesizer SHALL walk the Scope_Tree to collect all leaf resources for the dependency graph
4. WHEN a composite Resource has a non-empty `dependsOn` list, THE Synthesizer SHALL automatically add dependency edges from child resources to the parent resource's own dependencies
5. WHEN a user defines an L3_Resource, THE L3_Resource SHALL be usable identically to L1_Resources by constructing it with a scope and id

### Requirement 4: App Root Scope

**User Story:** As a dacha user, I want a root scope object (App) that serves as the top-level parent for all resources, so that my dacha.config.ts has a clear entry point and the synthesizer has a root to walk.

#### Acceptance Criteria

1. THE Dacha_Library SHALL export an `App` class that serves as the root scope for the Scope_Tree
2. THE App class SHALL accept child resources registered via the scope pattern, identically to how Resource accepts children
3. WHEN the Synthesizer processes an App instance, THE Synthesizer SHALL walk the Scope_Tree starting from the App to collect all resources
4. THE user's dacha.config.ts SHALL create an App instance, construct resources with the App (or child resources) as scope, and return the App

### Requirement 5: Publish to GitHub Packages

**User Story:** As a dacha user, I want to import dacha as a package dependency in my dacha.config.ts, so that I get type checking, autocompletion, and versioned imports instead of inlining types.

#### Acceptance Criteria

1. THE Dacha_Library SHALL be published to the GitHub Packages npm registry under a scoped package name
2. THE Dacha_Library SHALL include all public types (Platform, Params, Paths, DachaConfig, Profile, Resource classes) as named exports
3. WHEN a new version tag is pushed, THE release workflow SHALL publish the Dacha_Library package to GitHub Packages in addition to compiling CLI binaries
4. THE Dacha_Library package SHALL be importable in a user's dacha.config.ts via a standard import specifier (e.g., `import { App, Package, Dotfile } from "@eabrouwer3/dacha"`)
5. THE Dacha_Library SHALL include a `deno.json` exports field mapping the package entry point to `src/mod.ts`
6. THE Dacha_Library package SHALL support both Deno-native imports and npm-style imports

### Requirement 6: CLI Executable Preservation

**User Story:** As a dacha user, I want dacha to remain a standalone CLI binary, so that I can run `dacha init`, `dacha synth`, `dacha apply`, and other commands without installing Deno.

#### Acceptance Criteria

1. THE Dacha_CLI SHALL continue to compile into standalone platform-specific binaries via `deno compile`
2. THE Dacha_CLI SHALL preserve all existing subcommands: init, synth, apply, sync (start/stop), update, secret (encrypt/edit), status, and params (reset)
3. THE Dacha_CLI SHALL accept the same global flags (--quiet, --verbose, --version) as the current version
4. WHEN the Dacha_CLI is compiled, THE release workflow SHALL produce binaries for darwin-arm64, darwin-x64, linux-arm64, and linux-x64 targets
5. THE install.sh script SHALL continue to download, verify checksums, and install the compiled binary to `~/.local/bin`

### Requirement 7: Clone Dotfiles to ~/.dacha/

**User Story:** As a dacha user, I want `dacha init` to clone my dotfiles repo into `~/.dacha/` instead of `~/.dotfiles`, so that the tool owns its own directory namespace.

#### Acceptance Criteria

1. WHEN `dacha init <url>` is run without a `--path` flag, THE Dacha_CLI SHALL clone the Config_Repo into `~/.dacha/`
2. WHEN `dacha init <url>` is run with a `--path <path>` flag, THE Dacha_CLI SHALL clone the Config_Repo into the specified path
3. WHEN `dacha init` clones into `~/.dacha/`, THE Dacha_CLI SHALL write the global config file at `~/.config/dacha/config.json` with the repoPath value of `~/.dacha/`
4. THE install.sh script SHALL pass `--path` to `dacha init` when the `--repo` flag is used, defaulting to `~/.dacha/`

### Requirement 8: Deno Permission Prompting on First Run

**User Story:** As a dacha user, I want dacha to prompt me for Deno permissions on the first run and remember my choices, so that background sync and automated updates run without re-prompting.

#### Acceptance Criteria

1. WHEN the Dacha_CLI is compiled, THE build process SHALL use granular Deno permission flags instead of `--allow-all`, specifying only the permission categories dacha requires (read, write, env, net, run, sys)
2. WHEN the Dacha_CLI runs for the first time and the Permission_Store does not exist, THE Dacha_CLI SHALL use `Deno.permissions.request()` to prompt the user for each required permission category
3. WHEN the user grants a permission, THE Dacha_CLI SHALL record the granted permission and its scope in the Permission_Store at `~/.config/dacha/permissions.json`
4. WHEN the Permission_Store already contains granted permissions, THE Dacha_CLI SHALL skip prompting for those permissions on subsequent runs
5. WHEN the sync daemon or update scheduler launches the Dacha_CLI, THE daemon launcher SHALL pass the appropriate Deno permission flags derived from the Permission_Store so that no interactive prompts occur
6. IF the user denies a required permission, THEN THE Dacha_CLI SHALL log a clear message explaining which functionality is unavailable due to the denied permission and continue operating with reduced capability
7. THE Dacha_CLI SHALL provide a `dacha permissions reset` subcommand that deletes the Permission_Store and forces re-prompting on the next run
8. THE Dacha_CLI SHALL provide a `dacha permissions show` subcommand that displays the currently granted permissions from the Permission_Store

### Requirement 9: Synthesizer for Class-Based Resources

**User Story:** As a dacha user, I want the synth step to walk the Scope_Tree from the App root and collect all resources, so that the CDK-style resource model flows through synthesis into a resolved state.

#### Acceptance Criteria

1. WHEN the Synthesizer receives an App instance, THE Synthesizer SHALL walk the Scope_Tree starting from the App root to collect all leaf Resource instances
2. WHEN the Synthesizer encounters a Resource with children, THE Synthesizer SHALL recursively descend into children to collect all leaf resources for the dependency graph
3. WHEN the Synthesizer collects a leaf Resource, THE Synthesizer SHALL call `toResolved()` on the instance to produce a ResolvedResource
4. THE Synthesizer SHALL preserve the existing topological sort, cycle detection, and profile inheritance behaviors

### Requirement 10: Library Entry Point and Exports

**User Story:** As a dacha user, I want a clean import surface from the dacha library, so that my dacha.config.ts is concise and well-typed.

#### Acceptance Criteria

1. THE Dacha_Library SHALL export all L1_Resource classes (Package, Dotfile, Command, Secret) from the main entry point
2. THE Dacha_Library SHALL export the Resource base class from the main entry point so users can extend it for L3_Resources
3. THE Dacha_Library SHALL export the App class from the main entry point
4. THE Dacha_Library SHALL export all public type interfaces (Platform, Params, Paths, DachaConfig, Profile, PlatformFilter, ResourceResult, OutputStore) from the main entry point
5. THE Dacha_Library SHALL export utility functions (detectPlatform, synth, apply, resolveProfile, buildGraph) from the main entry point
