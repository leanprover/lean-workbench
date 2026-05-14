import vs from 'vscode'
import { Awareness } from 'y-protocols/awareness'
import { AWARENESS_SELECTION_KEY, AWARENESS_USER_KEY, AwarenessSelection, AwarenessState, User } from './util'

/** Colors cycled through for remote collaborators, one per client. */
const REMOTE_COLORS = ['#f78da7', '#7bdcb5', '#8ed1fc', '#fcb900', '#9900ef']

/** Listens for awareness changes from other clients
 * (see `textBinding.ts` for the sending side)
 * and shows remote selections as decorations in the appropriate editor view. */
export class RemoteSelectionDecorator implements vs.Disposable {
  private readonly localClientId: number
  private readonly decorationTypes = new Map<number, vs.TextEditorDecorationType>()
  private states = new Map<number, AwarenessState>()
  private readonly disposables: vs.Disposable[] = []

  constructor(private readonly awareness: Awareness) {
    this.localClientId = awareness.clientID
    const onAwarenessChange = () => this.onAwarenessChange()
    awareness.on('change', onAwarenessChange)
    this.disposables.push(
      { dispose: () => awareness.off('change', onAwarenessChange) },
      // Redraw indicators on editor visibility changes, too.
      vs.window.onDidChangeVisibleTextEditors(() => this.render()),
    )
    this.onAwarenessChange()
  }

  private decorationType(clientId: number): vs.TextEditorDecorationType {
    let deco = this.decorationTypes.get(clientId)
    if (!deco) {
      const color = REMOTE_COLORS[clientId % REMOTE_COLORS.length]
      deco = vs.window.createTextEditorDecorationType({
        backgroundColor: `${color}40`,
        border: `1px solid ${color}`,
        borderRadius: '2px',
        overviewRulerColor: color,
        overviewRulerLane: vs.OverviewRulerLane.Center,
        // after: {
        //   contentText: String(clientId)
        // }
      })
      this.decorationTypes.set(clientId, deco)
    }
    return deco
  }

  private onAwarenessChange(): void {
    const states = this.awareness.getStates()
    const next = new Map<number, AwarenessState>()
    for (const [clientId, state] of states.entries()) {
      if (clientId === this.localClientId) continue
      const selection = state[AWARENESS_SELECTION_KEY] as AwarenessSelection | undefined
      if (!selection) continue
      next.set(clientId, { selection, user: state[AWARENESS_USER_KEY] as User | undefined })
    }
    // Drop decoration types for clients that are gone.
    for (const [clientId, deco] of this.decorationTypes) {
      if (next.has(clientId)) continue
      deco.dispose()
      this.decorationTypes.delete(clientId)
    }
    this.states = next
    this.render()
  }

  private render(): void {
    for (const editor of vs.window.visibleTextEditors) {
      if (editor.document.uri.scheme !== 'file') continue
      const filePath = editor.document.uri.fsPath
      for (const [clientId, { selection, user }] of this.states) {
        const ranges =
          selection?.filePath === filePath
            ? selection.selections.map(s => ({
                range: new vs.Range(s.anchor.line, s.anchor.character, s.active.line, s.active.character),
                hoverMessage: user?.name,
              }))
            : []
        editor.setDecorations(this.decorationType(clientId), ranges)
      }
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
    for (const deco of this.decorationTypes.values()) deco.dispose()
    this.decorationTypes.clear()
    this.states.clear()
  }
}
