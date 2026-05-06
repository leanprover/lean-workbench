// FIXME: use same consts in workbench-app/collab-server for single source of truth.

/** URI scheme for Lean Workbench project file paths.
 * We use absolute paths. */
export const WORKBENCH_URI_SCHEME = 'wrkbnch'

/** VSCode workspace file path in the VSCode bwrap. */
export const BWRAP_WORKSPACE_FILE_PATH = '/workspace/Projects.code-workspace'

/** Collab-server socket path in the VSCode and collab-server bwraps. */
export const BWRAP_COLLAB_SOCK_PATH = '/workspace/.collab-sockets/collab.sock'

/** We keep a unique Y.Doc per file.
 * This is the Y.Doc key under which the text content lives. */
export const YTEXT_KEY = 'content'
