// Library entry point — re-exports public classes, types, and key functions.

// App root scope
export { App } from "./app.ts";

// Resource classes
export { Resource } from "./resource.ts";
export { Package } from "./resources/package.ts";
export type { PackageProps } from "./resources/package.ts";
export { Dotfile } from "./resources/dotfile.ts";
export type { DotfileProps } from "./resources/dotfile.ts";
export { Command } from "./resources/command.ts";
export type { CommandProps } from "./resources/command.ts";
export { Secret } from "./resources/secret.ts";
export type { SecretProps } from "./resources/secret.ts";

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
export { apply } from "./apply.ts";
export { resolveProfile } from "./profile.ts";
export { buildGraph } from "./graph.ts";
export { detectPlatform } from "./platform.ts";
