// Abstract Resource base class — all resource types extend this.
// Replaces the plain Resource interface + ResourceExecutor pattern with
// a CDK-style class that embeds its own check/apply logic.

import type { App } from "./app.ts";
import type { OutputStore, Platform, ResolvedResource, ResourceResult } from "./types.ts";

export abstract class Resource {
  readonly id: string;
  readonly dependsOn: string[];
  readonly outputs: Record<string, string> = {};
  readonly _children: Resource[] = [];
  contributedBy?: string;

  constructor(scope: Resource | App, id: string, props?: { dependsOn?: string[] }) {
    this.id = id;
    this.dependsOn = props?.dependsOn ?? [];
    scope.addChild(this);
  }

  /** Called by child Resource constructors to register themselves. */
  addChild(child: Resource): void {
    this._children.push(child);
  }

  /** Check whether this resource is already in the desired state. */
  abstract check(platform: Platform): Promise<boolean>;

  /** Converge this resource to the desired state. */
  abstract apply(platform: Platform, outputs: OutputStore): Promise<ResourceResult>;

  /** Serialize to ResolvedResource for the synthesizer/applier pipeline. */
  toResolved(): ResolvedResource {
    const { id, dependsOn, contributedBy: _cb, ...rest } = this.toProps();
    return {
      id,
      type: this.resolvedType(),
      action: rest as Record<string, unknown>,
      dependsOn: (dependsOn as string[] | undefined) ?? [],
      contributedBy: this.contributedBy ?? "unknown",
    };
  }

  /** Return the type string for serialization. Subclasses override via a static field or this method. */
  protected resolvedType(): string {
    return (this.constructor as { resourceType?: string }).resourceType ?? this.constructor.name.toLowerCase();
  }

  /** Return the plain-object representation of this resource's config. Subclasses override. */
  protected abstract toProps(): Record<string, unknown> & { id: string };
}
