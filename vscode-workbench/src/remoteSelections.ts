import vs from 'vscode'
import { Awareness } from 'y-protocols/awareness'

import { AWARENESS_SELECTION_KEY, AWARENESS_USER_KEY, AwarenessSelection, AwarenessUser } from './util'

interface AwarenessState {
  [AWARENESS_USER_KEY]: AwarenessUser
  [AWARENESS_SELECTION_KEY]: AwarenessSelection
}

class ClientDecorations implements vs.Disposable {
  readonly cursorBefore: vs.TextEditorDecorationType
  readonly cursorAfter: vs.TextEditorDecorationType

  constructor(color: string) {
    const selectionStyle: vs.DecorationRenderOptions = {
      backgroundColor: `${color}40`,
      rangeBehavior: vs.DecorationRangeBehavior.ClosedClosed,
      overviewRulerColor: color,
      overviewRulerLane: vs.OverviewRulerLane.Center,
    }
    const cursorStyle: vs.ThemableDecorationAttachmentRenderOptions = {
      contentText: '',
      border: `1px solid ${color}`,
      margin: '0px -1px',
    }
    this.cursorBefore = vs.window.createTextEditorDecorationType({
      ...selectionStyle,
      before: cursorStyle,
    })
    this.cursorAfter = vs.window.createTextEditorDecorationType({
      ...selectionStyle,
      after: cursorStyle,
    })
  }

  dispose() {
    this.cursorBefore.dispose()
    this.cursorAfter.dispose()
  }
}

/** Listens for awareness changes from other clients
 * (see `textBinding.ts` for the sending side)
 * and shows remote selections as decorations in the appropriate editor view. */
export class RemoteSelectionDecorator implements vs.Disposable {
  private readonly localClientId: number
  private readonly decorationTypes = new Map<number, ClientDecorations>()
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
      vs.window.onDidChangeTextEditorSelection(e => {
        if (e.textEditor.document.uri.scheme !== 'file') return
        this.awareness.setLocalStateField(AWARENESS_SELECTION_KEY, {
          filePath: e.textEditor.document.uri.fsPath,
          // FIXME: use LSP types
          selections: e.selections.map(s => ({
            anchor: { line: s.anchor.line, character: s.anchor.character },
            active: { line: s.active.line, character: s.active.character },
          })),
        } satisfies AwarenessSelection)
      }),
      vs.workspace.onDidCloseTextDocument(doc => {
        if (doc.uri.scheme !== 'file') return
        // If cursor was in the now-closed doc, clear it.
        const sel = this.awareness.getLocalState()?.[AWARENESS_SELECTION_KEY] as AwarenessSelection | undefined
        if (sel?.filePath === doc.uri.fsPath) {
          this.awareness.setLocalStateField(AWARENESS_SELECTION_KEY, null)
        }
      }),
    )
    this.onAwarenessChange()
  }

  private decorationsFor(clientId: number, color: string): ClientDecorations {
    let decos = this.decorationTypes.get(clientId)
    if (!decos) {
      decos = new ClientDecorations(color)
      this.decorationTypes.set(clientId, decos)
    }
    return decos
  }

  private onAwarenessChange(): void {
    const states = this.awareness.getStates()
    const next = new Map<number, AwarenessState>()
    for (const [clientId, state] of states.entries()) {
      if (clientId === this.localClientId) continue
      const selection = state[AWARENESS_SELECTION_KEY] as AwarenessSelection | undefined
      const user = state[AWARENESS_USER_KEY] as AwarenessUser | undefined
      if (!selection || !user) continue
      next.set(clientId, { selection, user })
    }
    // Drop decoration types for clients that are gone.
    for (const [clientId, decos] of this.decorationTypes) {
      if (next.has(clientId)) continue
      decos.dispose()
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
        const decos = this.decorationsFor(clientId, user.color)
        const beforeRanges: vs.DecorationOptions[] = []
        const afterRanges: vs.DecorationOptions[] = []
        if (selection.filePath === filePath) {
          for (const s of selection.selections) {
            const range = new vs.Range(s.anchor.line, s.anchor.character, s.active.line, s.active.character)
            const opts = { range, hoverMessage: user.name }
            // Is `active` at the start or the end of the selection?
            if (
              s.active.line < s.anchor.line ||
              (s.active.line === s.anchor.line && s.active.character < s.anchor.character)
            ) {
              beforeRanges.push(opts)
            } else {
              afterRanges.push(opts)
            }
          }
        }
        editor.setDecorations(decos.cursorBefore, beforeRanges)
        editor.setDecorations(decos.cursorAfter, afterRanges)
      }
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
    for (const decos of this.decorationTypes.values()) {
      decos.dispose()
    }
    this.decorationTypes.clear()
    this.states.clear()
  }
}
