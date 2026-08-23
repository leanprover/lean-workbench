/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
  /**
   * Detailed information about why a text document changed.
   */
  export interface TextDocumentDetailedChangeReason {
    /**
     * The source of the change (e.g., 'inline-completion', 'chat-edit', 'extension')
     */
    readonly source: string

    /**
     * Additional context-specific metadata
     */
    readonly metadata: { readonly [key: string]: unknown }
  }

  export interface TextDocumentChangeEvent {
    /**
     * The precise reason for the document change.
     * Only available to extensions that have enabled the `textDocumentChangeReason` proposed API.
     */
    readonly detailedReason: TextDocumentDetailedChangeReason | undefined
  }

  export interface WorkspaceEditMetadata {
    /**
     * Caller-supplied tag for this edit.
     * Surfaces as the `tag` property in {@link TextDocumentDetailedChangeReason.metadata}
     * on each resulting {@link TextDocumentChangeEvent}. */
    tag?: string
  }

  export interface TextEditor {
    /**
     * Perform an edit on the document associated with this text editor.
     *
     * The given callback-function is invoked with an {@link TextEditorEdit edit-builder} which must
     * be used to make edits. Note that the edit-builder is only valid while the
     * callback executes.
     *
     * @param callback A function which can create edits using an {@link TextEditorEdit edit-builder}.
     * @param options The undo/redo behavior around this edit. By default, undo stops will be created before and after this edit.
     * @param tag? Caller-supplied tag for this edit.
     *             Surfaces as the `tag` property in {@link TextDocumentDetailedChangeReason.metadata}
     *             on each resulting {@link TextDocumentChangeEvent}.
     * @returns A promise that resolves with a value indicating if the edits could be applied.
     */
    edit(
      callback: (editBuilder: TextEditorEdit) => void,
      options?: {
        /**
         * Add undo stop before making the edits.
         */
        readonly undoStopBefore: boolean
        /**
         * Add undo stop after making the edits.
         */
        readonly undoStopAfter: boolean
      },
      tag?: string,
    ): Thenable<boolean>
  }

  export namespace workspace {
    /**
     * Whether this build of VS Code includes `code-server-patches/001-tagTextDocumentChange.diff`.
     * `undefined` on builds without the patch. */
    export const hasTagTextDocumentChangePatch: boolean | undefined
  }
}
