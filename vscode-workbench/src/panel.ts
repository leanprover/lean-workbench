import { type WorkspaceMetadata } from '@leanprover/workbench-shared'
import vs from 'vscode'
import { type Awareness } from 'y-protocols/awareness'

import {
  AWARENESS_SELECTION_KEY,
  AWARENESS_USER_KEY,
  type AwarenessSelections,
  type AwarenessUser,
  equalAwarenessUsers,
  equalMaps,
  type Logger,
  logWithPrefix,
} from './util'

type PanelItem = { kind: 'onlineUsersRoot' } | { kind: 'onlineUser'; user: AwarenessUser }
type AwarenessSelection = { filePath: string; selection?: vs.Selection }

const CONTEXT_COLLAB_IS_FOLLOWING_CURSOR = 'leanprover-workbench.collab.isFollowingCursor'
const COMMAND_COLLAB_GO_TO_CURSOR = 'leanprover-workbench.internal.collab.goToCursor'
// These two appear in the tree item context menu (and 'unfollow' in the command palette),
// so they must match `contributes.commands` in package.json.
const COMMAND_COLLAB_FOLLOW_CURSOR = 'leanprover-workbench.internal.collab.followCursor'
const COMMAND_COLLAB_UNFOLLOW_CURSOR = 'leanprover-workbench.collab.unfollowCursor'

// Copied from vscode-lean4
/** With `preserveFocus`, set the selection and scroll it into view, but leave the current panel focused. */
async function revealEditorSelection(fsPath: string, selection?: vs.Selection, preserveFocus = false) {
  let editor = vs.window.visibleTextEditors.find(v => v.document.uri.fsPath === fsPath)
  if (editor === undefined) {
    editor = await vs.window.showTextDocument(vs.Uri.file(fsPath), {
      viewColumn: vs.window.activeTextEditor?.viewColumn ?? vs.ViewColumn.One,
      preserveFocus,
    })
  }
  if (selection !== undefined) {
    editor.revealRange(selection, vs.TextEditorRevealType.InCenterIfOutsideViewport)
    editor.selection = selection
    if (preserveFocus) return
    // ensure the text document has the keyboard focus.
    await vs.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false })
  }
}

// https://code.visualstudio.com/api/extension-guides/tree-view
export class WorkbenchPanelProvider implements vs.TreeDataProvider<PanelItem>, vs.Disposable {
  /** username ↦ client data */
  private onlineUsers = new Map<string, AwarenessUser>()

  /** Username whose cursor we reveal whenever it moves,
   * if a user is currently being followed; otherwise `undefined`. */
  private followedUserName: string | undefined = undefined
  private lastRevealedFollowedPosition: string | undefined = undefined

  private readonly onDidChangeTreeDataEmitter = new vs.EventEmitter<void>()
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event

  private readonly disposables: vs.Disposable[] = []

  private readonly log: Logger

  constructor(
    private readonly awareness: Awareness,
    private readonly mdata: WorkspaceMetadata,
    log_: Logger,
  ) {
    this.log = logWithPrefix(log_, '[WorkbenchPanelProvider]')

    const onAwarenessChange = () => this.onAwarenessChange()
    awareness.on('change', onAwarenessChange)
    this.disposables.push(
      { dispose: () => awareness.off('change', onAwarenessChange) },
      vs.commands.registerCommand(COMMAND_COLLAB_GO_TO_CURSOR, async (userName: string) => {
        const cursor = this.findUserCursor(userName)
        if (cursor) await revealEditorSelection(cursor.filePath, cursor.selection)
      }),
      vs.commands.registerCommand(COMMAND_COLLAB_FOLLOW_CURSOR, (item: PanelItem) => {
        if (item.kind !== 'onlineUser') return
        this.followedUserName = item.user.name
        this.lastRevealedFollowedPosition = undefined
        this.onDidChangeTreeDataEmitter.fire()
        void this.revealFollowedCursor()
        vs.commands.executeCommand('setContext', CONTEXT_COLLAB_IS_FOLLOWING_CURSOR, true)
        this.log.debug(`followed user ${item.user.name}`)
      }),
      vs.commands.registerCommand(COMMAND_COLLAB_UNFOLLOW_CURSOR, () => {
        this.followedUserName = undefined
        this.onDidChangeTreeDataEmitter.fire()
        vs.commands.executeCommand('setContext', CONTEXT_COLLAB_IS_FOLLOWING_CURSOR, false)
        this.log.debug(`unfollowed user ${this.followedUserName}`)
      }),
    )
    this.onAwarenessChange()
  }

  /** Find the current cursor position of `userName`.
   * One user can have multiple active sessions (and client IDs).
   * We choose the first remote session with a non-empty selection. */
  private findUserCursor(userName: string): AwarenessSelection | undefined {
    let cursor: AwarenessSelection | undefined
    for (const [_, state] of this.awareness.getStates()) {
      const user = state[AWARENESS_USER_KEY] as AwarenessUser | undefined
      const sels = state[AWARENESS_SELECTION_KEY] as AwarenessSelections | undefined
      if (!user || user.name !== userName || !sels) continue
      cursor = { filePath: sels.filePath }
      if (0 < sels.selections.length) {
        const active = sels.selections[0]!.active
        const pos = new vs.Position(active.line, active.character)
        cursor.selection = new vs.Selection(pos, pos)
        break
      }
    }
    return cursor
  }

  /** When following a user who is online, reveal their cursor position
   * unless that same position has already been revealed. */
  private async revealFollowedCursor() {
    if (this.followedUserName === undefined) return
    const cursor = this.findUserCursor(this.followedUserName)
    if (!cursor) return

    const serialized = JSON.stringify([cursor.filePath, cursor.selection])
    if (serialized === this.lastRevealedFollowedPosition) return
    this.lastRevealedFollowedPosition = serialized

    await revealEditorSelection(cursor.filePath, cursor.selection, /* preserveFocus */ true)
  }

  onAwarenessChange() {
    void this.revealFollowedCursor()
    const newUsers = new Map<string, AwarenessUser>()
    for (const [, state] of this.awareness.getStates()) {
      const user = state[AWARENESS_USER_KEY] as AwarenessUser | undefined
      // The same user can appear multiple times, e.g. when opening a project tab twice.
      // FIXME: show with multiplicity?
      if (user) newUsers.set(user.name, user)
    }
    if (equalMaps(this.onlineUsers, newUsers, equalAwarenessUsers)) return
    this.log.debug(`users changed: ${JSON.stringify([...newUsers])}`)
    this.onlineUsers = newUsers
    this.onDidChangeTreeDataEmitter.fire()
  }

  getTreeItem(item: PanelItem): vs.TreeItem {
    switch (item.kind) {
      case 'onlineUsersRoot':
        return new vs.TreeItem('Online users', vs.TreeItemCollapsibleState.Expanded)
      case 'onlineUser': {
        const isSelf = item.user.name === this.mdata.viewer.name
        const isFollowed = item.user.name === this.followedUserName
        const ti = new vs.TreeItem(item.user.name, vs.TreeItemCollapsibleState.None)

        let description: string | undefined
        if (isSelf) description = 'You'
        if (isFollowed) description = 'Following'
        ti.description = description

        let iconUri: vs.Uri | undefined = undefined
        try {
          if (item.user.image) iconUri = vs.Uri.parse(item.user.image, true)
        } catch {
          this.log.debug(`ignoring unparsable avatar URL for ${item.user.name}`)
        }
        ti.iconPath = iconUri ? iconUri : new vs.ThemeIcon('account')

        if (!isSelf) {
          ti.command = { command: COMMAND_COLLAB_GO_TO_CURSOR, title: 'Jump to Cursor', arguments: [item.user.name] }
          // `viewItem` values in `contributes.menus.view/item/context` in package.json must match these.
          ti.contextValue = isFollowed ? 'followedOnlineUser' : 'followableOnlineUser'
        }

        return ti
      }
    }
  }

  getChildren(item?: PanelItem): PanelItem[] {
    if (!item) return [{ kind: 'onlineUsersRoot' }]
    if (item.kind !== 'onlineUsersRoot') return []
    const items = this.onlineUsers
      .values()
      .map(user => ({ kind: 'onlineUser', user }) satisfies PanelItem)
      .toArray()
    items.sort((a, b) => a.user.name.localeCompare(b.user.name))
    return items
  }

  dispose() {
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
    this.onDidChangeTreeDataEmitter.dispose()
  }
}
