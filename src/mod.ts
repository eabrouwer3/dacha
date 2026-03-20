// Library entry point — re-exports public types and key functions.

export type {
  CommandResource,
  DachaConfig,
  DotfileResource,
  OutputStore,
  PackageManagerType,
  PackageResource,
  ParamDefinition,
  Params,
  Paths,
  Platform,
  PlatformFilter,
  Profile,
  ResolvedResource,
  ResolvedState,
  Resource,
  ResourceExecutor,
  ResourceResult,
  SecretResource,
} from "./types.ts";

export { synth } from "./synth.ts";
export { apply } from "./apply.ts";
export { resolveProfile } from "./profile.ts";
export { buildGraph } from "./graph.ts";
export { detectPlatform } from "./platform.ts";
