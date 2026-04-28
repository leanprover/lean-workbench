import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  console.log('Hello lean-workbench!')
  context.subscriptions.push({
    dispose() {
      console.log('Bye lean-workbench!')
    },
  })
}

export function deactivate() {}
