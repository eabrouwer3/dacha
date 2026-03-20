// Platform detection result
export interface Platform {
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
  distro?: string;
  packageManager: PackageManagerType;
}

export type PackageManagerType = "brew" | "apt" | "yum" | "dnf";

export interface PlatformFilter {
  os?: Platform["os"];
  arch?: Platform["arch"];
  distro?: string;
}

/** Minimal resource definition used by the profile system. */
export interface ResourceDef {
  id: string;
  type: string;
  dependsOn?: string[];
  outputs?: Record<string, string>;
  contributedBy?: string;
  [key: string]: unknown;
}

export interface Profile {
  name: string;
  extends?: Profile[];
  packages?: ResourceDef[];
  dotfiles?: ResourceDef[];
  commands?: ResourceDef[];
  secrets?: ResourceDef[];
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
  type: string;
  action: Record<string, unknown>;
  dependsOn: string[];
  contributedBy: string;
}

export interface ResourceResult {
  status: "applied" | "skipped" | "failed";
  outputs?: Record<string, string>;
  error?: string;
}

export type OutputStore = Map<string, Record<string, string>>;
