import { useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { css as cssLanguage } from '@codemirror/lang-css';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup } from 'codemirror';
import type { SheetSource } from '@/lib/stylesheets';

interface Props {
  shadowRoot: ShadowRoot;
  sheets: SheetSource[] | null;
  activeId: string | null;
  overrides: Record<string, string>;
  /** Changes on reset and forces the editor back to the original text. */
  nonce: number;
  /** The UI is in dark mode — then use CodeMirror's oneDark theme. */
  dark: boolean;
  /** Panel width (draggable) in shell pixels. */
  width: number;
  onSelect: (id: string) => void;
  onChange: (id: string, css: string) => void;
  onReset: (id: string) => void;
}

export function CssEditor({
  shadowRoot,
  sheets,
  activeId,
  overrides,
  nonce,
  dark,
  width,
  onSelect,
  onChange,
  onReset,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Without a ref the update listener would hold on to the first closure.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const active = sheets?.find((s) => s.id === activeId) ?? null;
  const dirty = active != null && overrides[active.id] != null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // `root` is mandatory here: otherwise CodeMirror puts its StyleModule
    // styles in the document <head>, where they never reach the shadow tree.
    const view = new EditorView({ parent: host, root: shadowRoot });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [shadowRoot]);

  // Only refill when the sheet changes — not on every keystroke, or the cursor
  // jumps.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !active || !active.readable) return;

    const id = active.id;
    const doc = overrides[id] ?? active.text;

    view.setState(
      EditorState.create({
        doc,
        extensions: [
          basicSetup,
          cssLanguage(),
          // In the light theme, CodeMirror's own light look; otherwise oneDark.
          ...(dark ? [oneDark] : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(id, update.state.doc.toString());
          }),
          EditorView.theme({ '&': { height: '100%' } }),
        ],
      }),
    );
    // `overrides` deliberately left out of the deps — otherwise the editor
    // would be rebuilt on every keystroke and the cursor would jump. `dark` is
    // in there on purpose: a theme change should rebuild it in the new colour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.readable, active?.text, nonce, dark]);

  return (
    <div className="editor" style={{ width }}>
      <div className="editor__head">
        <select
          value={activeId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          disabled={!sheets || sheets.length === 0}
          aria-label="Stylesheet"
        >
          {!sheets && <option value="">Loading stylesheets…</option>}
          {sheets?.length === 0 && <option value="">No stylesheets found</option>}
          {sheets?.map((s) => (
            <option key={s.id} value={s.id}>
              {overrides[s.id] != null ? '● ' : ''}
              {s.label}
            </option>
          ))}
        </select>
        <button onClick={() => active && onReset(active.id)} disabled={!dirty} title="Reset">
          Reset
        </button>
      </div>

      {active && !active.readable && (
        <div className="editor__status editor__status--error">
          Source could not be loaded{active.error ? `: ${active.error}` : ''}
        </div>
      )}
      {dirty && <div className="editor__status editor__dirty">modified — live in all frames</div>}

      <div className="editor__cm" ref={hostRef} />
    </div>
  );
}
