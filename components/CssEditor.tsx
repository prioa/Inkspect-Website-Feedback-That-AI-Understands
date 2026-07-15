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
  /** Aendert sich bei Reset und zwingt den Editor auf den Originaltext zurueck. */
  nonce: number;
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
  onSelect,
  onChange,
  onReset,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Ohne Ref wuerde der updateListener die erste Closure festhalten.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const active = sheets?.find((s) => s.id === activeId) ?? null;
  const dirty = active != null && overrides[active.id] != null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // `root` ist hier zwingend: sonst legt CodeMirror seine StyleModule-Styles
    // in den <head> des Dokuments, wo sie den Shadow Tree nicht erreichen.
    const view = new EditorView({ parent: host, root: shadowRoot });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [shadowRoot]);

  // Nur beim Wechsel des Sheets neu befuellen — nicht bei jedem Tastendruck,
  // sonst springt der Cursor.
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
          oneDark,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(id, update.state.doc.toString());
          }),
          EditorView.theme({ '&': { height: '100%' } }),
        ],
      }),
    );
    // `overrides` absichtlich nicht in den Deps — sonst wuerde der Editor bei
    // jedem Tastendruck neu aufgebaut und der Cursor springen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.readable, active?.text, nonce]);

  return (
    <div className="editor">
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
