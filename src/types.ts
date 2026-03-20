// Platform detection result
export interface Platform {
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
  distro?: string;
  packageManager: PackageManagerType;
}

export type PackageManagerType = "brew" | "apt" | "yum" | "dnf";

// Base resource — all resources extend this
export interface Resource {
  id: string;
  type: "package" | "dotfile" | "command" | "secret";
  dependsOn?: string[];
  outputs?: Record<string, string>;
  contributedBy?: string;
}

export interface PackageResource extends Resource {
  type: "package";
  name: string;
  brew?: string;
  brewCask?: string;
  apt?: string;
  yum?: string;
  onlyOn?: PlatformFilter;
}

export interface DotfileResource extends Resource {
  type: "dotfile";
  source: string;
  destination: string;
  template?: boolean;
}

export interface CommandResource extends Resource {
  type: "command";
  run: string;
  check?: string;
  critical?: boolean;
  onlyOn?: PlatformFilter;
  captureOutput?: string;
}

export interface SecretResource extends Resource {
  type: "secret";
  source: string;
  destination: string;
  permissions?: string;
}

export interface PlatformFilter {
  os?: Platform["os"];
  arch?: Platform["arch"];
  distro?: string;
}

export interface Profile {
  name: string;
  extends?: Profile[];
  packages?: PackageResource[];
  dotfiles?: DotfileResource[];
  commands?: CommandResource[];
  secrets?: SecretResource[];
}

export interface DachaConfig {
  repoPath: string;
  target: Profile;
  params?: ParamDefinition[];
  sync?: {
    enabled: boolean;
    debounceMs?: number;
  };
  update?: {
    enabled: boolean;
    intervalHours?: number;
  };
}

export interface ParamDefinition {
  name: string;
  message: string;
  type: "text" | "confirm" | "select";
  default?: string | boolean;
  choices?: string[];
}

export type Params = Record<string, string | boolean>;

export interface Paths {
  home: string;
  configDir: string;
  dataDir: string;
  cacheDir: string;
  tmpDir: string;
  repoDir: string;
}

export interface ResolvedState {
  platform: Platform;
  resources: ResolvedResource[];
  metadata: {
    generatedAt: string;
    repoPath: string;
    profileChain: string[];
    params: Params;
  };
}

export interface ResolvedResource {
  id: string;
  type: Resource["type"];
  action: Record<string, unknown>;
  dependsOn: string[];
  contributedBy: string;
}

export interface ResourceExecutor<T extends Resource> {
  check(resource: T, platform: Platform): Promise<boolean>;
  apply(
    resource: T,
    platform: Platform,
    outputs: OutputStore,
  ): Promise<ResourceResult>;
}

export interface ResourceResult {
  status: "applied" | "skipped" | "failed";
  outputs?: Record<string, string>;
  error?: string;
}

export type OutputStore = Map<string, Record<string, string>>;
