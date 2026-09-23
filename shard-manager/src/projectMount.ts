import fs from "node:fs/promises";

import { execFileAsync } from "@leanprover/workbench-shared/node";

export class ProjectMountHandle implements AsyncDisposable {
  /** `bwrap` args to bind the project tree, passed to sandboxes that access the project. */
  readonly bindArgs
  /** Host overlayfs mount backing {@link bindArgs}, torn down on disposal;
   * absent when the project has no package sets. */
  private readonly overlay

  constructor(bindArgs: string[], overlay?: { mergedDir: string; workDir: string }) {
    this.bindArgs = bindArgs
    this.overlay = overlay
  }

  async [Symbol.asyncDispose]() {
    if (!this.overlay) return
    const { mergedDir, workDir } = this.overlay
    try {
      await execFileAsync('umount', [mergedDir])
      await Promise.all([
        fs.rm(workDir, { recursive: true, force: true }),
        fs.rm(mergedDir, { recursive: true, force: true }),
      ])
    } catch (e) {
      console.error(`[ProjectMountHandle] failed to tear down overlay '${mergedDir}': ${String(e)}`)
    }
  }
}
