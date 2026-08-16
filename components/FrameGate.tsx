/**
 * Full-window card shown instead of the previews when the page refuses to be
 * embedded. It appears *before* loading (the headers are checked up front), so
 * the decision is made before the frames request the page at all.
 *
 * Two equal paths rather than a warning with an emergency exit: load it (with
 * the header change) or carry on without it. The price of the change is stated
 * next to the option it belongs to — not as an alarm above everything.
 */
interface Props {
  url: string;
  /** While the check is still running, a placeholder stands in for the choice. */
  checking?: boolean;
  pending?: boolean;
  onProceed: () => void;
  /** Carry on without the header change — the frames stay empty. */
  onSkip: () => void;
  /**
   * Only set in full window mode: the tool bar is hidden while the card is up,
   * so the way back to the device view belongs here.
   */
  onExitFullscreen?: () => void;
  onClose: () => void;
}

export function FrameGate({
  url,
  checking = false,
  pending = false,
  onProceed,
  onSkip,
  onExitFullscreen,
  onClose,
}: Props) {
  if (checking) {
    return (
      <div className="gate">
        <div className="gate__card gate__card--quiet">
          <span className="gate__spinner" aria-hidden="true" />
          <span>Checking whether this page can be shown in a preview…</span>
        </div>
      </div>
    );
  }

  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* The raw text is good enough to display */
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
          <strong>{host}</strong> can’t be shown in a preview
        </h2>
        <p className="gate__lead">
          This site tells browsers never to display it inside another page — and a device preview
          is exactly that. Nothing has loaded yet, so pick how you’d like to continue.
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
              Inkspect lifts the block for frames of <strong>{host}</strong> — in this tab only, and
              only while Inkspect is open. Other sites embedded in the page keep theirs. The rule
              lives in the <code>X-Frame-Options</code> and <code>frame-ancestors</code> headers.
            </p>
            <p className="gate__option-cost">
              Those headers can’t be lifted one at a time, so the site’s whole security policy comes
              off with them: inside the preview, its protection against injected scripts is gone.
              Best kept for sites you trust.
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
              Nothing is changed. The device frames stay empty, but everything else keeps working —
              the grid, zoom, workspaces and your saved feedback. You can switch the preview on at
              any time.
            </p>
          </div>
        </div>

        <div className="gate__foot">
          <span>
            Showing the preview is remembered for this site, so you won’t be asked again. While the
            block is lifted, a marker sits in the toolbar — click it to put the block back. To work
            on a different site, open it in a new tab and start Inkspect there.
          </span>
          {onExitFullscreen && (
            <button className="gate__link" onClick={onExitFullscreen}>
              Leave fullscreen
            </button>
          )}
          <button className="gate__link" onClick={onClose}>
            Close Inkspect
          </button>
        </div>
      </div>
    </div>
  );
}
