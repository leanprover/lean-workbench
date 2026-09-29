/** We keep a Y.Doc per collaboratively-editable file.
 * This is the Y.Doc key under which the text content lives. */
export const YTEXT_KEY: string = 'content'

/** Name of the Y.Doc whose awareness is shared by all collab clients.
 * Clients also send RPC requests on this document. */
export const AWARENESS_DOC_NAME: string = '<awareness>'
