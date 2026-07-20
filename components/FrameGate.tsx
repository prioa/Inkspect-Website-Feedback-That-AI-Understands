/**
 * Vollbild-Karte anstelle der Previews, wenn die Seite das Einbetten
 * verbietet. Erscheint *vor* dem Laden (Header-Vorabpruefung), damit die
 * Entscheidung faellt, bevor die Seite in den Frames angefordert wird.
 *
 * Zwei gleichwertige Wege statt einer Warnung mit Notausgang: laden (mit
 * Header-Eingriff) oder ohne Eingriff weiterarbeiten. Der Preis des Eingriffs
 * steht bei der Option, zu der er gehoert — nicht als Alarm ueber allem.
 */
interface Props {
  url: string;
  /** Laeuft die Pruefung noch, steht statt der Auswahl ein Platzhalter. */
  checking?: boolean;
  pending?: boolean;
  onProceed: () => void;
  /** Ohne Header-Eingriff weiter — die Frames bleiben leer. */
  onSkip: () => void;
  onClose: () => void;
}

export function FrameGate({
  url,
  checking = false,
  pending = false,
  onProceed,
  onSkip,
  onClose,
}: Props) {
  if (checking) {
    return (
      <div className="gate">
        <div className="gate__card gate__card--quiet">
          <span className="gate__spinner" aria-hidden="true" />
          <span>Checking whether this page allows a preview…</span>
        </div>
      </div>
    );
  }

  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* Rohtext ist als Anzeige gut genug */
  }

  return (
    <div className="gate" role="alertdialog" aria-labelledby="ink-gate-title">
      <div className="gate__card">
        <div className="gate__badge" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <rect x="3" y="4" width="18" height="14" rx="2" strokeWidth="1.7" />
            <path d="M3 9h18" strokeWidth="1.7" />
            <path d="M9.5 12.5l5 3M14.5 12.5l-5 3" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </div>

        <h2 className="gate__title" id="ink-gate-title">
          <strong>{host}</strong> doesn’t allow being embedded
        </h2>
        <p className="gate__lead">
          The site sends <code>X-Frame-Options</code> or <code>frame-ancestors</code>, so browsers
          refuse to show it inside another page — including its own preview. Nothing has been
          loaded yet; pick how you’d like to continue.
        </p>

        <div className="gate__options">
          <div className="gate__option gate__option--primary">
            <div className="gate__option-head">
              <h3 className="gate__option-title">Show the preview</h3>
              <button className="gate__btn gate__btn--primary" onClick={onProceed} disabled={pending}>
                {pending ? 'Loading…' : 'Show preview'}
              </button>
            </div>
            <p className="gate__option-text">
              Inkspect removes those headers for frames of <strong>{host}</strong> — only in this
              tab, only while Inkspect is open. Other sites embedded in the page keep theirs.
            </p>
            <p className="gate__option-cost">
              Browsers can’t drop a single rule, so the site’s Content-Security-Policy goes with it:
              inside the preview its XSS protection is off. Best kept for sites you trust.
            </p>
          </div>

          <div className="gate__option">
            <div className="gate__option-head">
              <h3 className="gate__option-title">Continue without it</h3>
              <button className="gate__btn" onClick={onSkip}>
                Continue
              </button>
            </div>
            <p className="gate__option-text">
              Nothing is changed. The device frames stay empty, but the grid, zoom, workspaces and
              the rest of Inkspect keep working — and you can switch on the preview any time.
            </p>
          </div>
        </div>

        <div className="gate__foot">
          <span>
            Showing the preview is remembered for this site, so you won’t be asked again. While the
            change is active, a marker sits in the toolbar — click it to undo. For a different
            site, open it in a new tab and start Inkspect there.
          </span>
          <button className="gate__link" onClick={onClose}>
            Close Inkspect
          </button>
        </div>
      </div>
    </div>
  );
}
