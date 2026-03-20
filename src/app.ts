// App root scope — top-level parent for all resources in the scope tree.

import type { Resource } from "./resource.ts";

export class App {
  readonly _children: Resource[] = [];

  /** Called by Resource constructors to register themselves. */
  addChild(child: Resource): void {
    this._children.push(child);
  }

  /** Recursively collect all leaf resources from the scope tree. */
  collectResources(): Resource[] {
    const leaves: Resource[] = [];
    function walk(children: Resource[]): void {
      for (const child of children) {
        if (child._children.length === 0) {
          leaves.push(child);
        } else {
          walk(child._children);
        }
      }
    }
    walk(this._children);
    return leaves;
  }
}
