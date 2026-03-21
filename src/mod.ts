// Library entry point — re-exports public classes, types, and key functions.

// App root scope
export { Machine } from "./app.ts";

// Resource classes
export { Resource } from "./resource.ts";
export { Package } from "./resources/package.ts";
export type { PackageProps } from "./resources/package.ts";
export { BrewCaskPackage } from "./resources/brew-cask-package.ts";
export type { BrewCaskPackageProps } from "./resources/brew-cask-package.ts";
export { File } from "./resources/file.ts";
export type { FileProps } from "./resources/file.ts";
export { Directory } from "./resources/directory.ts";
export type { DirectoryProps } from "./resources/directory.ts";
export { Command } from "./resources/command.ts";
export type { CommandProps } from "./resources/command.ts";
export { Secret } from "./resources/secret.ts";
export type { SecretProps } from "./resources/secret.ts";
export { MacDefault } from "./resources/mac-default.ts";
export type { MacDefaultProps, DefaultsValue } from "./resources/mac-default.ts";
export { GitRepo } from "./resources/git-repo.ts";
export type { GitRepoProps } from "./resources/git-repo.ts";

// Types
export type {
  DachaConfig,
  OutputStore,
  PackageManagerType,
  ParamDefinition,
  Params,
  Paths,
  Platform,
  PlatformFilter,
  Profile,
  ResolvedResource,
  ResolvedState,
  ResourceResult,
} from "./types.ts";

// Utility functions
export { synth } from "./synth.ts";
export type { SynthResult } from "./synth.ts";
export { apply } from "./apply.ts";
export { resolveProfile } from "./profile.ts";
export { buildGraph } from "./graph.ts";
export { detectPlatform } from "./platform.ts";
