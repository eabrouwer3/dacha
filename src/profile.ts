// Profile merging and inheritance resolution.
// Depth-first, left-to-right traversal of the extends chain.
// Child resources replace parent resources on matching id.

import type {
  Profile,
  ResourceDef,
} from "./types.ts";

/** Resource array key names on a Profile. */
const RESOURCE_KEYS = [
  "packages",
  "files",
  "commands",
  "secrets",
] as const;

type ResourceKey = typeof RESOURCE_KEYS[number];

/**
 * Merge two arrays of resources. Later entries win on id conflict.
 * Returns a new array with parent resources first, then child resources,
 * with duplicates (by id) resolved in favor of the later (child) entry.
 */
export function mergeResources<T extends ResourceDef>(
  parent: T[],
  child: T[],
): T[] {
  const merged = new Map<string, T>();
  for (const r of parent) merged.set(r.id, r);
  for (const r of child) merged.set(r.id, r);
  return [...merged.values()];
}

/** Merge two profiles. Child wins on resource id conflicts. */
function mergeProfiles(base: Profile, overlay: Profile): Profile {
  const result: Profile = { name: overlay.name };

  for (const key of RESOURCE_KEYS) {
    const baseArr = base[key] as ResourceDef[] | undefined;
    const overlayArr = overlay[key] as ResourceDef[] | undefined;

    if (baseArr || overlayArr) {
      (result as Record<ResourceKey, ResourceDef[]>)[key] = mergeResources(
        baseArr ?? [],
        overlayArr ?? [],
      );
    }
  }

  return result;
}

/** Tag every resource in a profile with contributedBy = profile name. */
function tagResources(profile: Profile): Profile {
  const tagged: Profile = { name: profile.name };

  for (const key of RESOURCE_KEYS) {
    const arr = profile[key] as ResourceDef[] | undefined;
    if (arr) {
      (tagged as Record<ResourceKey, ResourceDef[]>)[key] = arr.map((r) => ({
        ...r,
        contributedBy: profile.name,
      }));
    }
  }

  return tagged;
}

/**
 * Resolve a profile by recursively merging its parent chain.
 *
 * Algorithm:
 *  1. If profile has no extends, tag and return as-is
 *  2. For each parent in extends (left to right), recursively resolve
 *  3. Merge all resolved parents into a single base (left to right, later wins)
 *  4. Overlay the current profile on top (child wins on id conflicts)
 *  5. Tag each resource with contributedBy = profile.name
 *  6. Return merged profile
 */
export function resolveProfile(profile: Profile): Profile {
  if (!profile.extends || profile.extends.length === 0) {
    return tagResources(profile);
  }

  // Resolve each parent depth-first, left to right
  const resolvedParents = profile.extends.map((p) => resolveProfile(p));

  // Merge all parents left to right (later parent wins on conflict)
  let base: Profile = resolvedParents[0];
  for (let i = 1; i < resolvedParents.length; i++) {
    base = mergeProfiles(base, resolvedParents[i]);
  }

  // Overlay current profile on top of merged parents
  const merged = mergeProfiles(base, {
    name: profile.name,
    packages: profile.packages,
    files: profile.files,
    commands: profile.commands,
    secrets: profile.secrets,
  });

  return tagResources(merged);
}
