import vs from 'vscode'
import { Awareness } from 'y-protocols/awareness'
import {
  AWARENESS_SELECTION_KEY,
  AWARENESS_USER_KEY,
  AwarenessSelection,
  AwarenessUser,
  equalAwarenessUsers,
  equalMaps,
  Logger,
  logWithPrefix,
  WorkspaceMetadata,
} from './util'

type PanelItem = { kind: 'onlineUsersRoot' } | { kind: 'onlineUser'; user: AwarenessUser }

const COMMAND_GOTO_AWARENESS_USER = 'leanprover.workbench.internal.goToAwarenessUser'

// Copied from vscode-lean4
async function revealEditorSelection(fsPath: string, selection?: vs.Selection) {
  let editor = vs.window.visibleTextEditors.find(v => v.document.uri.fsPath === fsPath)
  if (editor === undefined) {
    editor = await vs.window.showTextDocument(vs.Uri.file(fsPath), {
      viewColumn: vs.window.activeTextEditor?.viewColumn ?? vs.ViewColumn.One,
      preserveFocus: false,
    })
  }
  if (selection !== undefined) {
    editor.revealRange(selection, vs.TextEditorRevealType.InCenterIfOutsideViewport)
    editor.selection = selection
    // ensure the text document has the keyboard focus.
    await vs.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false })
  }
}

// https://code.visualstudio.com/api/extension-guides/tree-view
export class WorkbenchPanelProvider implements vs.TreeDataProvider<PanelItem>, vs.Disposable {
  /** username ↦ client data */
  private onlineUsers = new Map<string, AwarenessUser>()

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
      vs.commands.registerCommand(COMMAND_GOTO_AWARENESS_USER, async (userName: string) => {
        let filePath: string | undefined = undefined
        let sel: vs.Selection | undefined = undefined
        // One user can have multiple active sessions.
        // We arbitrarily choose the first remote session with a non-empty selection.
        for (const [clientId, state] of awareness.getStates()) {
          if (this.awareness.clientID === clientId) continue
          const user = state[AWARENESS_USER_KEY] as AwarenessUser | undefined
          if (!user || user.name !== userName) continue
          const sels = state[AWARENESS_SELECTION_KEY] as AwarenessSelection | undefined
          if (!sels) continue
          filePath = sels.filePath
          if (0 < sels.selections.length) {
            const active = sels.selections[0].active
            const pos = new vs.Position(active.line, active.character)
            sel = new vs.Selection(pos, pos)
            break
          }
        }
        if (filePath) await revealEditorSelection(filePath, sel)
      }),
    )
    this.onAwarenessChange()
  }

  onAwarenessChange() {
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
        let displayName = item.user.name
        if (item.user.name === this.mdata.viewer.name) displayName += ' (You)'
        const ti = new vs.TreeItem(displayName, vs.TreeItemCollapsibleState.None)
        let iconUri: vs.Uri | undefined = undefined
        try {
          if (item.user.image) iconUri = vs.Uri.parse(item.user.image, true)
        } catch {}
        ti.iconPath = iconUri ? iconUri : new vs.ThemeIcon('account')
        ti.command = { command: COMMAND_GOTO_AWARENESS_USER, title: 'Jump to cursor', arguments: [item.user.name] }
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
