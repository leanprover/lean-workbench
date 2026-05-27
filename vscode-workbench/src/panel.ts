import vs from 'vscode'

export class WorkbenchPanelProvider implements vs.TreeDataProvider<string> {
  getTreeItem(item: string): vs.TreeItem {
    return new vs.TreeItem(item, vs.TreeItemCollapsibleState.Expanded)
  }

  getChildren(item?: string): string[] {
    if (!item) return ['collaborators']
    return []
  }
}
