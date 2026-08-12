/** We keep a Y.Doc per collaboratively-editable file.
 * This is the Y.Doc key under which the text content lives. */
export const YTEXT_KEY = 'content'

/** Name of the `collab-server` database file. */
export const COLLAB_DB_FILENAME = 'collab.db'

/** Name of the `collab-server` UDS file. */
export const COLLAB_SOCKET_FILENAME = 'collab.sock'

export function bwrapProjectDir(projectName: string) {
  return `/workspace/${projectName}/`
}

/** Path to workspace metadata file in VSCode bwraps. */
export const BWRAP_METADATA_PATH = '/workspace/.lean-workbench.json'

/** Working directory of collab-server in the VSCode and collab-server bwraps. */
export const BWRAP_COLLAB_SERVER_DIR = '/workspace/.collab-server'

/** Collab-server socket path in the VSCode and collab-server bwraps. */
export const BWRAP_COLLAB_SOCK_PATH = `${BWRAP_COLLAB_SERVER_DIR}/${COLLAB_SOCKET_FILENAME}`
