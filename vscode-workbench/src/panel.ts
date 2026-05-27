import vs from 'vscode'
import { Awareness } from 'y-protocols/awareness'
import { AWARENESS_USER_KEY, AwarenessUser } from './util'

type PanelItem = { kind: 'onlineUsersRoot' } | { kind: 'onlineUser'; user: AwarenessUser }

export class WorkbenchPanelProvider implements vs.TreeDataProvider<PanelItem>, vs.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vs.EventEmitter<void>()
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event

  private readonly disposables: vs.Disposable[] = []

  constructor(private readonly awareness: Awareness) {
    const onAwarenessChange = () => this.onDidChangeTreeDataEmitter.fire()
    awareness.on('change', onAwarenessChange)
    this.disposables.push({ dispose: () => awareness.off('change', onAwarenessChange) })
  }

  getTreeItem(item: PanelItem): vs.TreeItem {
    switch (item.kind) {
      case 'onlineUsersRoot':
        return new vs.TreeItem('Online users', vs.TreeItemCollapsibleState.Expanded)
      case 'onlineUser': {
        const ti = new vs.TreeItem(item.user.name, vs.TreeItemCollapsibleState.None)
        ti.iconPath = item.user.image ? vs.Uri.parse(item.user.image, true) : new vs.ThemeIcon('account')
        return ti
      }
    }
  }

  getChildren(item?: PanelItem): PanelItem[] {
    if (!item) return [{ kind: 'onlineUsersRoot' }]
    if (item.kind !== 'onlineUsersRoot') return []
    const users: AwarenessUser[] = []
    for (const [, state] of this.awareness.getStates()) {
      const user = state[AWARENESS_USER_KEY] as AwarenessUser | undefined
      if (user) users.push(user)
    }
    users.sort((a, b) => a.name.localeCompare(b.name))
    return users.map(user => ({ kind: 'onlineUser', user }))
  }

  dispose() {
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
    this.onDidChangeTreeDataEmitter.dispose()
  }
}
