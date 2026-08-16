import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { DeviceInstance, DevicePreset } from '@/lib/devices';
import type { Shape } from '@/lib/annotations';
import { pinNumbers, shapeReveal, shapeSize, TOOL_LABELS } from '@/lib/annotations';
import type { FeedbackItem } from '@/lib/feedbackStore';
import { feedbackToMarkdown } from '@/lib/exportMarkdown';
import { encodeShare, SHARE_PARAM } from '@/lib/share';
import { useFireHint } from '@/lib/hints';
import { motionOk } from '@/lib/motion';
import { useHideTip, useTip } from './Tooltip';
import {
  IconCheck,
  IconClose,
  IconCopy,
  IconDots,
  IconGrip,
  IconDownload,
  IconEditPen,
  IconLink,
  IconPlus,
  IconTrash,
  IconReveal,
} from './icons';

/**
 * Exit of a deleted entry — must match the duration of `ink-item-remove` in
 * styles.ts. Change one of the two numbers and you have to change the other,
 * or the list jumps at the end of the movement. The app waits the same time
 * before really taking the entry out of state.
 */
export const FEEDBACK_REMOVE_MS = 280;

/**
 * How long a delete button stays armed. Long enough to reach it a second time
 * without hurrying, short enough that an armed button you have forgotten about
 * cannot go off on the next visit to the row.
 */
const ARM_MS = 2600;

/**
 * This many changes an entry shows straight away; the rest waits behind
 * "n more". Three because that is what the element popup shows too
 * (`CHANGES_PREVIEW` in InspectPanel) — the same marker should not be two
 * different lengths depending on where you look at it.
 *
 * A cap is needed at all because one element can carry a dozen: padding on four
 * edges, margin on four, font, weight, colour. Unfolded, a single entry filled
 * the panel and the list underneath it was gone.
 */
const CHANGES_PREVIEW = 3;

interface Props {
  /** All feedback, across pages — the panel groups it by page itself. */
  items: FeedbackItem[];
  /** Feedback from other domains (not currently open) — its own section. */
  otherItems: FeedbackItem[];
  /** Currently loaded page (normalised). */
  url: string;
  /** Built-in plus custom presets — determines the grouping. */
  presets: readonly DevicePreset[];
  devices: DeviceInstance[];
  /**
   * Preset ids of the viewports currently visible (grid devices, or in full
   * window mode only the full-window frame). Everything else concerns a page or
   * size that is not on screen right now, and is dimmed.
   */
  activePresetIds: ReadonlySet<string>;
  /** Set off by the device badge: highlight the group and scroll to it. */
  highlight: { deviceId: string; nonce: number } | null;
  /** Entries the user has not yet seen open — they slide in. */
  freshIds?: readonly string[];
  /**
   * The entry the "Your first note is saved" hint is currently talking about.
   *
   * The hint veils the rest of the card and cuts a hole over this row (see
   * `veilWithin` on `first-marker` in hints.ts) — but a hole is only an absence
   * of blur, and next to nine sharp rows the ring would have to do all the work
   * on its own. The wash makes the row the brightest thing inside the card, so
   * that "everything you mark collects here" has something to point at.
   *
   * Deliberately not `freshIds`: that one is gone after 1.2 s, while the hint
   * stands for ten seconds.
   */
  explainId?: string | null;
  /**
   * Entries whose deletion is confirmed and which are currently showing their
   * exit. They are still in `items` — the app only takes them out of state
   * after the movement.
   */
  removingIds?: readonly string[];
  /** The header as a grip: in full window mode the card can be moved. */
  onHeadPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  dragging?: boolean;
  onJump: (deviceId: string) => void;
  /** Click on an entry: scroll to the marker and let it flash. */
  onJumpItem: (item: FeedbackItem) => void;
  /** Hover over an entry: highlight the marking in the viewport. */
  onPreviewItem: (item: FeedbackItem | null) => void;
  /** The pointer enters or leaves the panel — shows the markers in dev mode. */
  onPanelHover?: (hovering: boolean) => void;
  /** Change or add an entry's note/text. */
  onEditItem: (itemId: string, text: string) => void;
  /** Element marker: reopen the edit popup on the device (values + note). */
  onEditElement?: (item: FeedbackItem) => void;
  /** Switches the previews to another page (where the feedback came from). */
  onNavigate: (url: string) => void;
  onDelete: (itemId: string) => void;
  /** Toggle an entry's done state. */
  onToggleDone: (itemId: string) => void;
  onClearAll: () => void;
  /**
   * Builds the share URL (feedback deflate+base64url in the hash).
   * `extraPages` includes those pages' feedback in addition to the current
   * page — the same selection as the screenshot export.
   */
  onBuildShareLink: (extraPages?: string[]) => Promise<string>;
  /**
   * Downloads annotated full-page screenshots of every page with open feedback
   * (notes at the markers included); returns the number of images.
   * `onProgress` reports captures done/total for the display.
   */
  onExportScreenshots: (
    onProgress?: (done: number, total: number) => void,
    /** Additional pages to photograph (not counting the current one). */
    extraPages?: string[],
  ) => Promise<number>;
  /** Opens the shortcuts/help overlay (out of the empty state). */
  onShowShortcuts: () => void;
  /** Panel width (draggable) in shell pixels. */
  width: number;
  /**
   * Full window: position of the floating card when the feedback button has
   * been moved. Without it, the fixed corner from `styles.ts` stands.
   */
  anchor?: CSSProperties;
  onClose: () => void;
}

/**
 * From this link length (characters) on, we warn. The browser itself could
 * take considerably more — Chrome handles URLs in the megabyte range, and the
 * hash never goes to a server anyway. The limit is drawn by the *transport*:
 * Slack, Jira and mail clients shorten or break longer links. Up to here,
 * about 180 markings without freehand fit, or about 40 with.
 */
const SHARE_URL_WARN = 8000;

/** Display text of an entry: note/text if there is one, otherwise the element/tool label. */
function shapeLabel(shape: Shape): string {
  if (shape.tool === 'pin' || shape.tool === 'text') return shape.text || TOOL_LABELS[shape.tool];
  if (shape.tool === 'element') return shape.note ? `${shape.label} — ${shape.note}` : shape.label;
  if (shape.note) return `${TOOL_LABELS[shape.tool]} — ${shape.note}`;
  return TOOL_LABELS[shape.tool];
}

/** An entry's editable free text. */
function textOf(shape: Shape): string | null {
  if (shape.tool === 'pin' || shape.tool === 'text') return shape.text;
  return shape.note ?? '';
}

/** Main line: free text, otherwise the element selector or the tool name. */
function primaryOf(shape: Shape): { text: string; empty: boolean } {
  const value = textOf(shape);
  if (value) return { text: value, empty: false };
  if (shape.tool === 'element') return { text: shape.label, empty: false };
  return { text: 'Add note…', empty: true };
}

/** Context line under the main line: the tool, and for elements the selector. */
function metaOf(shape: Shape): string | null {
  if (shape.tool === 'element') return shape.note ? shape.label : TOOL_LABELS.element;
  return TOOL_LABELS[shape.tool];
}

/**
 * The path including query parameters, made readable for display: `%C3%BC`
 * becomes `ü` again. If decoding fails (a broken percent sequence), the raw
 * form stands.
 */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const raw = u.pathname + u.search;
    try {
      return decodeURI(raw);
    } catch {
      return raw;
    }
  } catch {
    return url;
  }
}

/** Display order of the list: newest first. */
function newestFirst(a: FeedbackItem, b: FeedbackItem): number {
  return b.createdAt - a.createdAt;
}

/** Timestamp of a group's newest entry (0 when empty). */
function newestOf(list: readonly FeedbackItem[]): number {
  let newest = 0;
  for (const item of list) if (item.createdAt > newest) newest = item.createdAt;
  return newest;
}

/**
 * Like `ago`, but written out. There is room in the page picker, and there the
 * figure should be readable without deciphering — it helps decide whether a
 * page goes into the link.
 */
function agoLong(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** "3 days ago" rather than a date — the order should land immediately. */
function ago(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function FeedbackPanel({
  items,
  otherItems,
  url,
  presets,
  devices,
  activePresetIds,
  highlight,
  freshIds,
  explainId,
  removingIds,
  onHeadPointerDown,
  dragging = false,
  onJump,
  onJumpItem,
  onPreviewItem,
  onPanelHover,
  onEditItem,
  onEditElement,
  onNavigate,
  onDelete,
  onToggleDone,
  onClearAll,
  onBuildShareLink,
  onExportScreenshots,
  onShowShortcuts,
  width,
  anchor,
  onClose,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [mdCopied, setMdCopied] = useState(false);
  /** Fold the section with other domains' feedback open or shut. */
  const [showOther, setShowOther] = useState(false);

  /**
   * The entry whose delete button is armed.
   *
   * Deleting asks twice rather than through a dialog: the first click turns the
   * button red and puts a bin in it, the second removes the entry. A modal for
   * a single line was heavier than the action it guarded — it covered the very
   * list you were working in, and the answer lay a mouse journey away from the
   * button you had just hit. Here the question stands where the answer is
   * given. It expires on its own, so that no armed button lies in wait.
   */
  /**
   * Entries whose change list is unfolded. A set rather than a single id:
   * comparing two markers means having both open, and closing one to open the
   * other turns a comparison into a memory game.
   */
  const [openChanges, setOpenChanges] = useState<ReadonlySet<string>>(new Set());
  const toggleChanges = useCallback((id: string) => {
    setOpenChanges((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const [armedId, setArmedId] = useState<string | null>(null);
  const armTimer = useRef(0);
  /**
   * The same value as a ref, and the one the button actually decides on: two
   * clicks in quick succession are one React batch, and the handler would then
   * read on the second click the state from before the first — a real double
   * click would only ever arm, never fire.
   */
  const armedRef = useRef<string | null>(null);
  const arm = useCallback((id: string | null) => {
    window.clearTimeout(armTimer.current);
    armedRef.current = id;
    setArmedId(id);
    if (id)
      armTimer.current = window.setTimeout(() => {
        armedRef.current = null;
        setArmedId(null);
      }, ARM_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(armTimer.current), []);

  // Hover deliberately hangs off React state rather than CSS :hover — Chrome
  // leaves :hover in place when the entry under the pointer disappears or
  // shifts, or when the pointer moves into the device iframe; the action
  // buttons would then stay visible. The effect below cleans such cases up.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hoverElRef = useRef<HTMLElement | null>(null);
  const enterItem = (el: HTMLElement, item: FeedbackItem, preview: boolean) => {
    hoverElRef.current = el;
    setHoverId(item.id);
    if (preview) onPreviewItem(item);
  };
  const leaveItem = (item: FeedbackItem, preview: boolean) => {
    hoverElRef.current = null;
    setHoverId((id) => (id === item.id ? null : id));
    // The action buttons go with the hover — an armed delete would come back
    // armed the next time you brush the row, and go off on the first click.
    arm(null);
    if (preview) onPreviewItem(null);
  };

  useEffect(() => {
    if (!hoverId) return;
    const clear = () => {
      hoverElRef.current = null;
      setHoverId(null);
      arm(null);
      onPreviewItem(null);
    };
    // Every pointer movement outside the remembered entry ends the hover — even
    // when its mouseleave never arrived.
    //
    // The check runs over `composedPath()`, not over `e.target`: the listener
    // hangs off the document, but the panel lives in the shadow root. Events
    // originating there are *retargeted* onto the host — so `e.target` would
    // never be the hovered entry, and the very first pointer movement would
    // clear the hover. The action buttons therefore disappeared before you
    // could reach them. The composed path contains the real elements.
    const check = (e: Event) => {
      const el = hoverElRef.current;
      if (!el || !e.composedPath().includes(el)) clear();
    };
    document.addEventListener('pointerover', check, true);
    document.addEventListener('pointermove', check, true);
    // The pointer leaves the window, or focus moves into the iframe.
    document.addEventListener('mouseleave', clear);
    window.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('pointerover', check, true);
      document.removeEventListener('pointermove', check, true);
      document.removeEventListener('mouseleave', clear);
      window.removeEventListener('blur', clear);
    };
    // onPreviewItem is a stable callback prop of the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverId]);

  // Inline editor for an entry's note/text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const startEdit = (item: FeedbackItem) => {
    setEditingId(item.id);
    setEditDraft(textOf(item.shape) ?? '');
  };
  const commitEdit = (item: FeedbackItem) => {
    // Escape has already closed the editor — the blur that follows must not
    // save after all.
    if (editingId !== item.id) return;
    setEditingId(null);
    const before = (textOf(item.shape) ?? '').trim();
    if (editDraft.trim() !== before) onEditItem(item.id, editDraft);
  };

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  /** How many pages are in the link last built (for the hint text). */
  const [sharePages, setSharePages] = useState(1);

  /**
   * Page selection before triggering — for the link *and* the screenshot. It
   * slides out of whichever button it belongs to, and that same button then
   * triggers: so the mouse does not have to travel between list and confirm.
   * `pickFor` says who opened it; only ever one is open.
   */
  const [pickFor, setPickFor] = useState<'share' | 'shots' | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const fire = useFireHint();
  const tip = useTip();
  const hideTip = useHideTip();

  /**
   * The two-click delete button — the same one in both lists.
   *
   * Armed, it does not merely change colour: the question slides in beside it.
   * A 26 px square that has quietly turned red asks nothing — you have to
   * already know that a second click kills. The words say it.
   *
   * The question lies *over* the row rather than in it — a little sheet like a
   * tooltip, anchored to the button. In the flow it took its own width, and
   * every entry re-wrapped its text the moment you armed the button: the row
   * you were about to delete rearranged itself under your cursor. Taken out of
   * the flow it costs no width at all.
   *
   * The red belongs to the answer, not the question: filled, the words read as
   * a second button and the eye had two things to hit instead of one.
   */
  const deleteButton = (itemId: string) => {
    const armed = armedId === itemId;
    return (
      <span className="fb-del-wrap">
        {armed && <span className="fb-item__confirm">Sure, delete?</span>}
        <button
          className={`icon-btn icon-btn--small icon-btn--danger fb-del${
            armed ? ' icon-btn--armed' : ''
          }`}
          {...tip(armed ? 'Click again to delete' : 'Delete entry')}
          onClick={(e) => {
            e.stopPropagation();
            if (armedRef.current !== itemId) {
              arm(itemId);
              return;
            }
            arm(null);
            // The bubble labelled the button in its previous state — after the
            // click it would be lying, and the row is gone underneath it anyway.
            hideTip();
            onDelete(itemId);
          }}
        >
          {armed ? <IconTrash size={12} /> : <IconClose size={12} />}
        </button>
      </span>
    );
  };

  // A click outside closes the page selection. Checked via the composed path:
  // the panel lives in the shadow root, so `e.target` at the document would be
  // retargeted onto the host. The ref hangs off the *row* with the triggering
  // button — otherwise a click on it would close the list and the second click
  // would merely reopen it instead of triggering.
  const pickRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!pickFor) return;
    const close = (e: Event) => {
      const el = pickRef.current;
      if (el && !e.composedPath().includes(el)) setPickFor(null);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [pickFor]);

  const [shotsPending, setShotsPending] = useState(false);
  const [shotsCount, setShotsCount] = useState<number | null>(null);
  const [shotsProgress, setShotsProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // On a page change within the (stable) list, scroll to the current page —
  // the order itself stays unchanged.
  const currentPageRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    currentPageRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, [url]);

  const fresh = useMemo(() => new Set(freshIds ?? []), [freshIds]);

  /**
   * Entries on their way out. This is set off not by the delete button but by
   * the app, when the deletion really happens — the safety prompt sits in
   * between, and an entry that collapsed on the click and unfolded again on
   * cancel would simply be lying.
   *
   * The layout effect measures the height on the row while it still stands and
   * writes it to the element as --fb-h: entries with a note and a value list are
   * several times the height of a bare row, and a fixed value would make some
   * jerk and others lag. Directly on the element rather than through state, so
   * that the number is there before the animation's first frame.
   */
  const rootRef = useRef<HTMLElement | null>(null);
  const removing = useMemo(() => new Set(removingIds ?? []), [removingIds]);
  useLayoutEffect(() => {
    removing.forEach((id) => {
      const row = rootRef.current?.querySelector<HTMLElement>(
        `.fb-item[data-item-id="${CSS.escape(id)}"]`,
      );
      if (row && !row.style.getPropertyValue('--fb-h')) {
        // Layout height, for the same reason as below: while the card is still
        // scaling in, a bounding box would measure the scale as well.
        row.style.setProperty('--fb-h', `${row.offsetHeight}px`);
      }
    });
  }, [removing]);
  /**
   * Smooth out the card's own resizing — full window mode only, where it floats
   * above its button rather than standing as a column of fixed height.
   *
   * The row itself glides out, but a few of the steps around it are not gradual
   * at all. The last entry of a device group takes the group heading with it,
   * the last one on a page takes the page block *and* the share row, and in
   * their place the empty state unfolds — which is taller than what just left.
   * The card then grew by some eighty pixels in a single frame, and because it
   * hangs above its button it grows upwards: the whole thing leapt while your
   * eye was still on the row that disappeared.
   *
   * So: remember the height, and on the next render animate the box from the
   * old value to the new one. The content is already laid out at its new size,
   * only the frame catches up — which is exactly what makes it read as one
   * movement. Floating UI measures the card every frame anyway, so the card's
   * resting place follows along by itself.
   */
  const lastH = useRef(0);
  const resizeAnim = useRef<Animation | null>(null);
  /** Last resting height with entries in it — the fallback for `heldH`. */
  const fullH = useRef(0);
  /**
   * Deleting the last entry: the card keeps the height it just had.
   *
   * Otherwise it collapses under the very hand that deleted — and since it
   * hangs above its button, it does so upwards: the list one was working in
   * jumps away, and the empty state arrives somewhere the eye no longer is.
   * The height is held only for as long as the card stays empty and open;
   * opened afresh, or as soon as something is marked again, it comes up at its
   * own size.
   *
   * The height is nailed down the moment the last row *starts* leaving, not
   * once it is gone. Waiting produced the very jitter this is meant to
   * prevent: for the length of the row's exit the card shrank with it, and
   * when the list then ran empty the held height pulled it back up again —
   * smaller, taller, and only then still. Now the frame stands from the first
   * frame of the deletion; the row collapses inside it, and the empty state
   * takes the place that has become free.
   *
   * Derived during the render rather than in an effect: the height has to be
   * in place for the first layout after the deletion, or the resize animation
   * below would measure the collapse and smooth out a step that is not
   * supposed to happen at all.
   */
  const [heldH, setHeldH] = useState<number | null>(null);
  const emptying = items.length === 0 || items.every((item) => removing.has(item.id));
  const wasEmptying = useRef(emptying);
  if (emptying !== wasEmptying.current) {
    wasEmptying.current = emptying;
    // Only the floating card has a height of its own; on the grid the panel is
    // a full-height column, and a fixed height would cut it short.
    setHeldH(emptying && anchor ? fullH.current || null : null);
  }
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    /*
     * While our own animation runs, keep hands off.
     *
     * Floating UI remeasures the card every frame and moves it after — so an
     * animated height produces a render on every one of those frames, this
     * effect runs again, measures the box mid-flight and takes that for the new
     * resting height. The card then chased its own tail: it flickered between
     * two heights, thirty pixels apart, for as long as the animation lasted.
     * `lastH` already holds the target, so there is nothing to catch up on.
     */
    if (resizeAnim.current?.playState === 'running') return;
    /*
     * `offsetHeight`, not the bounding box: the card comes in scaled up from
     * .82 (`fs-sheet-in`), and a bounding box measures that scale along with
     * it. The height noted during the entrance was therefore only four fifths
     * of the real one — and the moment the scaling finished, the difference
     * looked like a step of a hundred pixels that had to be smoothed out. The
     * card thus grew a second time after opening, upwards, for another fifth
     * of a second. The layout height knows nothing of transforms and stays the
     * same throughout the entrance.
     */
    const next = el.offsetHeight;
    const prev = lastH.current;
    lastH.current = next;
    // The height to fall back on when the list runs empty — see `heldH`. Only
    // noted while the list is at rest: during a removal the row is already
    // collapsing, and a card measured mid-flight would hand on a height that
    // was never a resting state.
    if (items.length > 0 && removing.size === 0) fullH.current = next;
    // `anchor` only exists for the floating card; on the grid the panel is a
    // full-height column and never resizes with its content.
    if (!anchor || !prev || !motionOk()) return;
    // Anything under a few pixels is the list breathing, not a step — animating
    // it would only put a lag between typing and seeing.
    if (Math.abs(next - prev) < 12) return;
    resizeAnim.current = el.animate(
      [{ height: `${prev}px` }, { height: `${next}px` }],
      { duration: 220, easing: 'cubic-bezier(.33, 0, .2, 1)' },
    );
  });

  /**
   * A newly slid-in entry moves into view — otherwise the animation plays
   * outside the visible area and is never seen. A callback ref, so that it
   * fires exactly once on appearing.
   */
  const scrollFresh = useCallback((node: HTMLLIElement | null) => {
    node?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  // Device badge clicked: scroll to the group concerned and flash it briefly.
  const [flashDevice, setFlashDevice] = useState<string | null>(null);
  const groupRefs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (!highlight) return;
    setFlashDevice(highlight.deviceId);
    groupRefs.current
      .get(highlight.deviceId)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const timer = window.setTimeout(() => setFlashDevice(null), 1600);
    return () => clearTimeout(timer);
  }, [highlight]);

  useEffect(() => {
    if (!shareCopied) return;
    const timer = window.setTimeout(() => setShareCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [shareCopied]);

  useEffect(() => {
    if (!mdCopied) return;
    const timer = window.setTimeout(() => setMdCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [mdCopied]);

  // The whole domain's feedback as a Markdown checklist on the clipboard — to
  // hand on into a ticket or documentation tool.
  const copyMarkdown = () => {
    if (items.length === 0) return;
    // The payload is appended at the end, so that the state can be restored out
    // of the text — if encoding fails, the list still goes out.
    void encodeShare(items)
      .catch(() => undefined)
      .then((payload) => {
        const md = feedbackToMarkdown(
          items,
          presets,
          payload && `#${SHARE_PARAM}=${payload}`,
        );
        if (!md) return;
        return navigator.clipboard.writeText(md).then(() => {
          setMdCopied(true);
          // Copying is invisible — and where the result went, even more so.
          fire('first-markdown');
        });
      })
      .catch(() => {
        /* clipboard refused — no fallback, screenshot/link remain */
      });
  };

  /**
   * Fingerprint of the feedback state — not the array's identity.
   *
   * `items` is filtered in the app from `feedback` *and* the current page. Every
   * navigation therefore yields a fresh array, even when nothing changed in
   * substance (the filter goes by origin, not by page). The screenshot export
   * navigates the previews through every selected page and back — hanging off
   * the identity, that cleared the success message away again within the same
   * run: the PDFs were in the downloads folder and the interface said not a
   * word about it.
   */
  const itemsFingerprint = useMemo(() => JSON.stringify(items), [items]);

  // The link encodes the feedback state — on real changes it goes stale.
  useEffect(() => {
    setShareUrl(null);
    setShareError(false);
    setShotsCount(null);
  }, [itemsFingerprint]);

  // Build the link AND put it straight on the clipboard — the box below stays
  // visible as a fallback for copying by hand.
  const runShare = (extra: string[]) => {
    setPickFor(null);
    setShareError(false);
    setShotsCount(null);
    setSharePages(extra.length + 1);
    onBuildShareLink(extra)
      .then(async (link) => {
        setShareUrl(link);
        try {
          await navigator.clipboard.writeText(link);
          setShareCopied(true);
        } catch {
          /* clipboard refused — the box with the copy button remains as a fallback */
        }
      })
      .catch(() => setShareError(true));
  };

  const createShareLink = () => {
    // Without other pages there is nothing to choose — off we go.
    if (otherPages.length === 0) return runShare([]);
    // The first click opens the list, the second triggers.
    if (pickFor !== 'share') {
      setPicked(new Set());
      setPickFor('share');
      // The intermediate step looks like a click with no effect.
      fire('first-share-armed');
      return;
    }
    runShare([...picked]);
  };

  const copyShareLink = () => {
    if (!shareUrl) return;
    void navigator.clipboard.writeText(shareUrl).then(() => setShareCopied(true));
  };

  /**
   * Per-page figures for the selection list: open markings in total, broken
   * down by device, and when the last one was added. Completed ones do not
   * count — the list is meant to show what is still open.
   */
  interface PageStats {
    count: number;
    updatedAt: number;
    /** deviceId → count, unordered; `deviceSummary` sorts it for display. */
    devices: Map<string, number>;
  }
  const pageStats = (() => {
    const map = new Map<string, PageStats>();
    for (const item of items) {
      if (item.done) continue;
      let entry = map.get(item.url);
      if (!entry) {
        entry = { count: 0, updatedAt: 0, devices: new Map() };
        map.set(item.url, entry);
      }
      entry.count += 1;
      entry.updatedAt = Math.max(entry.updatedAt, item.createdAt);
      entry.devices.set(item.deviceId, (entry.devices.get(item.deviceId) ?? 0) + 1);
    }
    return map;
  })();

  /** Deleted custom presets no longer have a name — then the raw id. */
  const deviceName = (id: string) => presets.find((p) => p.id === id)?.name ?? id;

  /**
   * "iPhone SE 2 · Desktop HD 1". Sorted by preset order, not by count: that
   * way every row of the selection lists the same devices in the same order and
   * the numbers can be compared down the column.
   */
  const deviceSummary = (devices: Map<string, number>): string => {
    const rank = (id: string) => {
      const i = presets.findIndex((p) => p.id === id);
      return i === -1 ? presets.length : i;
    };
    return [...devices]
      .sort(([idA], [idB]) => rank(idA) - rank(idB) || idA.localeCompare(idB))
      .map(([id, n]) => `${deviceName(id)} ${n}`)
      .join(' · ');
  };

  /**
   * Other pages of the same domain with open feedback — most recently edited
   * first. Only when there are some is there anything to choose at all.
   */
  const otherPages = [...pageStats.entries()]
    .filter(([pageUrl]) => pageUrl !== url)
    .map(([pageUrl, stats]) => ({ url: pageUrl, ...stats }))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const runShots = (extra: string[]) => {
    setPickFor(null);
    setShareUrl(null);
    setShareError(false);
    setShotsCount(null);
    setShotsPending(true);
    onExportScreenshots((done, total) => setShotsProgress({ done, total }), extra)
      .then(setShotsCount)
      .catch(() => setShotsCount(0))
      .finally(() => {
        setShotsPending(false);
        setShotsProgress(null);
      });
  };

  const exportShots = () => {
    if (shotsPending) return;
    // Without other pages there is nothing to choose — off we go.
    if (otherPages.length === 0) return runShots([]);
    // The first click opens the list, the second triggers.
    if (pickFor !== 'shots') {
      setPicked(new Set());
      setPickFor('shots');
      fire('first-share-armed');
      return;
    }
    runShots([...picked]);
  };

  const currentStats = pageStats.get(url);

  /**
   * Figures under the path: the total carries the decision and therefore stands
   * at the top and bold; devices and age explain it below. Staggered rather than
   * on one line — the numbers should not hide from each other in running text.
   */
  const pickRowStats = (stats: PageStats | undefined) => {
    if (!stats) return <span className="shotpick__meta">nothing open</span>;
    return (
      <>
        <span className="shotpick__count">
          {stats.count} change{stats.count === 1 ? '' : 's'}
        </span>
        <span className="shotpick__meta">{deviceSummary(stats.devices)}</span>
        <span className="shotpick__meta">{agoLong(stats.updatedAt)}</span>
      </>
    );
  };

  /**
   * The page selection. It sits in the row of the button that opened it and
   * slides upwards out of it — which is why it is built here and hung into
   * exactly one of the two rows below.
   */
  const pagePicker = (
    <div className="shotpick" role="group" aria-label="Pages to include">
      <div className="shotpick__head">
        {pickFor === 'share' ? 'Also share…' : 'Also capture…'}
        <button
          type="button"
          className="icon-btn icon-btn--small"
          aria-label="Close"
          onClick={() => setPickFor(null)}
        >
          <IconClose size={13} />
        </button>
      </div>
      <div className="shotpick__list">
        <label className="shotpick__row shotpick__row--fixed">
          <span className="shotpick__box is-on">
            <IconCheck size={11} />
          </span>
          <span className="shotpick__info">
            <span className="shotpick__top">
              <span className="shotpick__path">{pathOf(url) || '/'}</span>
              <span className="shotpick__tag">this page</span>
            </span>
            {pickRowStats(currentStats)}
          </span>
        </label>
        {otherPages.map((page) => (
          <label key={page.url} className="shotpick__row">
            <span className={`shotpick__box${picked.has(page.url) ? ' is-on' : ''}`}>
              {picked.has(page.url) && <IconCheck size={11} />}
            </span>
            <input
              type="checkbox"
              className="shotpick__input"
              checked={picked.has(page.url)}
              onChange={() =>
                setPicked((set) => {
                  const next = new Set(set);
                  if (!next.delete(page.url)) next.add(page.url);
                  return next;
                })
              }
            />
            <span className="shotpick__info">
              <span className="shotpick__top">
                <span className="shotpick__path" title={page.url}>
                  {pathOf(page.url) || '/'}
                </span>
              </span>
              {pickRowStats(page)}
            </span>
          </label>
        ))}
      </div>
    </div>
  );

  // Grouped by page, and within that by device preset. The page with the newest
  // entry stands at the top — you should not have to hunt for what you just
  // marked. Deliberately *not* "current page first": the order must not jump on
  // a mere page change (the badge marks the current page), and without new
  // feedback nothing changes here.
  const byUrl = new Map<string, FeedbackItem[]>();
  for (const item of items) {
    const list = byUrl.get(item.url);
    if (list) list.push(item);
    else byUrl.set(item.url, [item]);
  }
  const pages = [...byUrl.entries()].sort(
    ([urlA, a], [urlB, b]) => newestOf(b) - newestOf(a) || urlA.localeCompare(urlB),
  );

  const pageCount = byUrl.get(url)?.length ?? 0;
  const openCount = items.filter((item) => !item.done).length;

  return (
    <aside
      ref={rootRef}
      className={`panel panel--right${dragging ? ' panel--dragging' : ''}`}
      aria-label="Feedback"
      style={{ width, ...anchor, ...(anchor && heldH ? { height: heldH } : null) }}
      onMouseEnter={() => onPanelHover?.(true)}
      onMouseLeave={() => onPanelHover?.(false)}
    >
      <div
        className={`panel__head${onHeadPointerDown ? ' panel__head--grab' : ''}`}
        {...(onHeadPointerDown ? tip('Drag to move — snaps above the button or to an edge') : {})}
        // Explicitly *after* the tooltip props, and therefore in place of their
        // own `onPointerDown`: without hiding the bubble by hand it would hang
        // where the header used to be for the whole drag — the card travels
        // with the pointer, the label stays put, and it reads as if the cursor
        // had got caught on something. `pointerleave` does not help here, the
        // header holds the pointer capture.
        onPointerDown={(e) => {
          hideTip();
          onHeadPointerDown?.(e);
        }}
      >
        {onHeadPointerDown && (
          <span className="panel__grip" aria-hidden="true">
            <IconGrip size={13} />
          </span>
        )}
        <span className="panel__title">Feedback</span>
        {openCount > 0 && <span className="panel__count">{openCount}</span>}
        <span className="panel__spacer" />

        <span className="panel__menu">
          <button
            className={`icon-btn icon-btn--small${menuOpen ? ' icon-btn--active' : ''}`}
            {...tip('Manage feedback')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <IconDots size={14} />
          </button>
          {menuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="menu" role="menu">
                <button
                  className="menu__item"
                  role="menuitem"
                  onClick={() => {
                    setHideDone((v) => !v);
                    setMenuOpen(false);
                  }}
                >
                  <span className="menu__item-icon">
                    <IconCheck size={15} />
                  </span>
                  <span className="menu__item-name">
                    {hideDone ? 'Show completed' : 'Hide completed'}
                  </span>
                </button>
                <button
                  className="menu__item menu__item--danger"
                  role="menuitem"
                  disabled={pageCount === 0}
                  onClick={() => {
                    onClearAll();
                    setMenuOpen(false);
                  }}
                >
                  <span className="menu__item-icon">
                    <IconTrash size={15} />
                  </span>
                  <span className="menu__item-name">Delete all (this page)</span>
                </button>
              </div>
            </>
          )}
        </span>

        <button className="icon-btn icon-btn--small" {...tip('Close panel')} onClick={onClose}>
          <IconClose size={14} />
        </button>
      </div>

      {/* The view switch ("My edits") used to sit here. It acts globally and
          therefore lives in the bar (toolbar or fsbar) — in the panel it was
          hidden behind something collapsible, and the hints could no longer
          find their anchor once it was shut. */}

      <div className="panel__url" title={url}>
        {pathOf(url)}
      </div>

      {items.length === 0 && (
        <div className="panel__empty">
          <div className="panel__empty-art" aria-hidden="true">
            <svg width="112" height="72" viewBox="0 0 112 72" fill="none">
              <rect
                x="1"
                y="1"
                width="70"
                height="70"
                rx="6"
                stroke="currentColor"
                strokeWidth="1.5"
                opacity="0.5"
              />
              <rect
                x="80"
                y="14"
                width="31"
                height="46"
                rx="5"
                stroke="currentColor"
                strokeWidth="1.5"
                opacity="0.5"
              />
              <circle cx="30" cy="30" r="9" fill="var(--accent)" />
              <path
                d="M30 26v8M26 30h8"
                stroke="#fff"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M44 52c4-9 7-12 10-9 3 3-3 9 1 9 3 0 6-9 12-13"
                stroke="var(--accent)"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <p>
            <strong>No feedback yet.</strong>
            <br />
            {/* Deliberately without a reference to the bar: in full window mode
                it only carries the two modes, pin and drawing live in the
                right-click menu. */}
            Right-click anywhere on the page to grab an element or pick up a pen.
          </p>
          <p className="panel__empty-tip">
            <button className="link-btn" onClick={onShowShortcuts}>
              Show shortcuts
            </button>
          </p>
        </div>
      )}

      <div className="panel__scroll">
        {pages.map(([pageUrl, pageItems]) => {
          const isCurrent = pageUrl === url;
          // Unknown deviceIds (a deleted custom preset) get a group of their own
          // rather than quietly disappearing.
          const known = new Set(presets.map((p) => p.id));
          const unknown = [...new Set(pageItems.map((i) => i.deviceId))]
            .filter((id) => !known.has(id))
            .map((id): DevicePreset => ({ id, name: id, width: 0, height: 0 }));
          // `items` stays complete *and* in drawing order (the pin numbers have
          // to match those on the frames); `visible` is the display: reduced by
          // completed ones where applicable, and newest first.
          const groups = [...presets, ...unknown]
            .map((preset) => {
              const groupItems = pageItems.filter((item) => item.deviceId === preset.id);
              return {
                preset,
                items: groupItems,
                visible: (hideDone ? groupItems.filter((item) => !item.done) : groupItems)
                  .slice()
                  .sort(newestFirst),
              };
            })
            .filter((g) => g.visible.length > 0)
            // The device groups also go by their newest entry — otherwise what
            // was just marked lands in the middle of the panel.
            .sort((a, b) => newestOf(b.visible) - newestOf(a.visible));
          if (groups.length === 0) return null;

          return (
            <div
              key={pageUrl}
              className={`fb-page${isCurrent ? '' : ' fb-page--other'}`}
              ref={isCurrent ? currentPageRef : undefined}
            >
              {(pages.length > 1 || !isCurrent) && (
                <button
                  className="fb-page__head"
                  {...tip(isCurrent ? 'Current page' : 'Switch the previews to this page')}
                  disabled={isCurrent}
                  onClick={() => onNavigate(pageUrl)}
                >
                  <span className="fb-page__path">{pathOf(pageUrl)}</span>
                  {isCurrent && <span className="fb-page__badge">current</span>}
                </button>
              )}

              {groups.map(({ preset, items: groupItems, visible }) => {
                const inGrid = devices.some((d) => d.id === preset.id);
                // Another page, or a viewport that is not open right now: dimmed,
                // so that it is clear at a glance what belongs to the current
                // picture and what does not.
                const offContext = !isCurrent || !activePresetIds.has(preset.id);
                const numbers = pinNumbers(groupItems.map((i) => i.shape));
                return (
                  <section
                    key={preset.id}
                    className={`fb-group${offContext ? ' fb-group--off' : ''}${
                      isCurrent && flashDevice === preset.id ? ' fb-group--flash' : ''
                    }`}
                    ref={(el) => {
                      if (!isCurrent) return;
                      if (el) groupRefs.current.set(preset.id, el);
                      else groupRefs.current.delete(preset.id);
                    }}
                  >
                    <button
                      className="fb-group__head"
                      {...tip(
                        isCurrent
                          ? inGrid
                            ? 'Jump to device'
                            : 'Add device to the grid'
                          : 'Switch the previews to this page',
                      )}
                      onClick={() => (isCurrent ? onJump(preset.id) : onNavigate(pageUrl))}
                    >
                      <span className="fb-group__name">{preset.name}</span>
                      {preset.width > 0 && (
                        <span className="fb-group__size">
                          {preset.width}×{preset.height}
                        </span>
                      )}
                      {isCurrent && !inGrid && (
                        <span className="fb-group__add">
                          <IconPlus size={12} />
                        </span>
                      )}
                    </button>

                    <ul className="fb-list">
                      {visible.map((item) => {
                        const editing = editingId === item.id;
                        const primary = primaryOf(item.shape);
                        const meta = metaOf(item.shape);
                        const size = shapeSize(item.shape);
                        return (
                          <li
                            key={item.id}
                            ref={fresh.has(item.id) ? scrollFresh : undefined}
                            data-item-id={item.id}
                            className={`fb-item${item.done ? ' fb-item--done' : ''}${editing ? ' fb-item--editing' : ''}${hoverId === item.id ? ' fb-item--hover' : ''}${fresh.has(item.id) ? ' fb-item--fresh' : ''}${explainId === item.id ? ' fb-item--explained' : ''}${removing.has(item.id) ? ' fb-item--removing' : ''}`}
                            title={
                              editing
                                ? undefined
                                : isCurrent
                                  ? 'Double-click to edit · single click jumps to the marker'
                                  : 'Double-click to edit · single click opens the page and jumps'
                            }
                            onDoubleClick={() => {
                              if (editing) return;
                              // Like the pen button: element markers open their
                              // popup, everything else the inline note editor.
                              if (item.shape.tool === 'element' && onEditElement) {
                                onEditElement(item);
                              } else {
                                startEdit(item);
                              }
                            }}
                            onClick={() => {
                              if (!editing) onJumpItem(item);
                            }}
                            onMouseEnter={(e) => enterItem(e.currentTarget, item, true)}
                            onMouseLeave={() => leaveItem(item, true)}
                          >
                            <button
                              className={`fb-check${item.done ? ' fb-check--done' : ''}`}
                              {...tip(item.done ? 'Mark as open' : 'Mark as done')}
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleDone(item.id);
                              }}
                            >
                              {item.done && <IconCheck size={10} />}
                            </button>
                            {item.shape.tool === 'pin' ? (
                              <span
                                className="fb-item__pin"
                                style={{ background: item.shape.color }}
                              >
                                {numbers.get(item.shape.id)}
                              </span>
                            ) : (
                              <span
                                className="fb-item__dot"
                                style={{ background: item.shape.color }}
                              />
                            )}
                            <div className="fb-item__body">
                              {editing ? (
                                <textarea
                                  className="fb-item__edit"
                                  value={editDraft}
                                  autoFocus
                                  rows={2}
                                  spellCheck={false}
                                  placeholder="Add a note…"
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => setEditDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault();
                                      commitEdit(item);
                                    }
                                    if (e.key === 'Escape') setEditingId(null);
                                  }}
                                  onBlur={() => commitEdit(item)}
                                />
                              ) : (
                                <>
                                  <span
                                    className={`fb-item__label${primary.empty ? ' fb-item__label--empty' : ''}`}
                                    onClick={
                                      primary.empty
                                        ? (e) => {
                                            e.stopPropagation();
                                            startEdit(item);
                                          }
                                        : undefined
                                    }
                                  >
                                    {primary.text}
                                  </span>
                                  <span className="fb-item__meta-row">
                                    {meta && <span className="fb-item__meta">{meta}</span>}
                                    {size && <span className="fb-item__size">{size}</span>}
                                    {/* Says up front why the marker is nowhere to
                                        be seen on the page right now. */}
                                    {shapeReveal(item.shape) && (
                                      <span
                                        className="fb-item__reveal"
                                        {...tip(
                                          'Behind an interaction — clicking the entry unfolds it',
                                        )}
                                      >
                                        <IconReveal size={11} />
                                      </span>
                                    )}
                                  </span>
                                  {item.shape.tool === 'element' &&
                                    ((item.shape.styleChanges?.length ?? 0) > 0 ||
                                      item.shape.textChange) &&
                                    (() => {
                                        // Text change first: it is the one you
                                        // recognise the marker by, so it must
                                        // never be the one that gets folded
                                        // away.
                                        const chips = [
                                          ...(item.shape.textChange
                                            ? [
                                                {
                                                  key: 'text',
                                                  long: true,
                                                  prop: 'text',
                                                  from: item.shape.textChange.from,
                                                  to: item.shape.textChange.to,
                                                },
                                              ]
                                            : []),
                                          ...(item.shape.styleChanges ?? []).map((c) => ({
                                            key: c.prop,
                                            long: false,
                                            prop: c.prop,
                                            from: c.from,
                                            to: c.to,
                                          })),
                                        ];
                                        const open = openChanges.has(item.id);
                                        const hidden = chips.length - CHANGES_PREVIEW;
                                        const shown = open
                                          ? chips
                                          : chips.slice(0, CHANGES_PREVIEW);
                                        return (
                                          <span className="fb-item__changes">
                                            {/* Only where it says something the
                                                line above does not: for an
                                                element-scoped change the target
                                                *is* the label, and the selector
                                                stood there twice. A class scope
                                                (".btn--primary") is the case
                                                worth the line. */}
                                            {item.shape.styleTarget &&
                                              item.shape.styleTarget !== meta && (
                                                <span className="fb-chg-target">
                                                  {item.shape.styleTarget}
                                                </span>
                                              )}
                                            {shown.map((c) => (
                                              <span
                                                className={`fb-chg${c.long ? ' fb-chg--text' : ''}`}
                                                key={c.key}
                                              >
                                                <span className="fb-chg-prop">{c.prop}</span>
                                                <span className="fb-chg-from">{c.from}</span>
                                                <span className="fb-chg-arr">→</span>
                                                <span className="fb-chg-to">{c.to}</span>
                                              </span>
                                            ))}
                                            {hidden > 0 && (
                                              <button
                                                className="fb-chg-more"
                                                aria-expanded={open}
                                                // The row itself jumps to the
                                                // marker — unfolding must not.
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  toggleChanges(item.id);
                                                }}
                                              >
                                                {open ? '▾ Show less' : `▸ ${hidden} more`}
                                              </button>
                                            )}
                                          </span>
                                        );
                                      })()}
                                </>
                              )}
                            </div>
                            <div className="fb-item__actions">
                              {/* Goes invisible while the delete button is
                                  armed, but keeps its place: unmounted, the row
                                  would gain its 26 px back and re-wrap its text
                                  exactly as you take aim. Hidden rather than
                                  merely transparent — it also has to stop
                                  catching the click meant for the bin under the
                                  question lying over it. */}
                              {textOf(item.shape) != null && !editing && (
                                <button
                                  className={`icon-btn icon-btn--small${
                                    armedId === item.id ? ' fb-item__edit-hidden' : ''
                                  }`}
                                  {...tip(
                                    item.shape.tool === 'element' && onEditElement
                                      ? 'Edit marker (values and note)'
                                      : 'Edit note',
                                  )}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Element marker: reopen the popup on the
                                    // device — the values are attached there too.
                                    if (item.shape.tool === 'element' && onEditElement) {
                                      onEditElement(item);
                                    } else {
                                      startEdit(item);
                                    }
                                  }}
                                >
                                  <IconEditPen size={12} />
                                </button>
                              )}
                              {deleteButton(item.id)}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          );
        })}

        {otherItems.length > 0 &&
          (() => {
            // Other domains: grouped by host, and within that by page. Viewing,
            // ticking off and deleting only — jumping to the marker requires
            // being on that domain (cross-origin is blocked in the previews).
            const byDomain = new Map<string, FeedbackItem[]>();
            for (const item of otherItems) {
              const host = hostOf(item.url);
              const list = byDomain.get(host);
              if (list) list.push(item);
              else byDomain.set(host, [item]);
            }
            // Here too, whatever is newest goes on top — hosts by their newest
            // entry, the entries themselves descending.
            const domains = [...byDomain.entries()]
              .map(([host, list]): [string, FeedbackItem[]] => [
                host,
                list.slice().sort(newestFirst),
              ])
              .sort(([, a], [, b]) => newestOf(b) - newestOf(a));
            const openOther = otherItems.filter((item) => !item.done).length;

            return (
              <div className="fb-other">
                <button
                  className="fb-other__head"
                  aria-expanded={showOther}
                  {...tip('Feedback saved on other domains')}
                  onClick={() => setShowOther((v) => !v)}
                >
                  <span className={`fb-other__chev${showOther ? ' fb-other__chev--open' : ''}`} />
                  <span className="fb-other__title">Other domains</span>
                  {openOther > 0 && <span className="panel__count">{openOther}</span>}
                </button>

                {showOther &&
                  domains.map(([host, domainItems]) => (
                    <div key={host} className="fb-page fb-page--other">
                      <div className="fb-page__head fb-other__domain" title={`Open ${host} and start Inkspect there to jump to these markers`}>
                        <span className="fb-page__path">{host}</span>
                        <span className="fb-page__badge">{domainItems.length}</span>
                      </div>
                      <ul className="fb-list">
                        {domainItems.map((item) => (
                          <li
                            key={item.id}
                            data-item-id={item.id}
                            className={`fb-item fb-item--static${item.done ? ' fb-item--done' : ''}${hoverId === item.id ? ' fb-item--hover' : ''}${removing.has(item.id) ? ' fb-item--removing' : ''}`}
                            title={`${shapeLabel(item.shape)} — on ${pathOf(item.url)}`}
                            onMouseEnter={(e) => enterItem(e.currentTarget, item, false)}
                            onMouseLeave={() => leaveItem(item, false)}
                          >
                            <button
                              className={`fb-check${item.done ? ' fb-check--done' : ''}`}
                              {...tip(item.done ? 'Mark as open' : 'Mark as done')}
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleDone(item.id);
                              }}
                            >
                              {item.done && <IconCheck size={10} />}
                            </button>
                            <span className="fb-item__dot" style={{ background: item.shape.color }} />
                            <div className="fb-item__body">
                              <span className="fb-item__label">{shapeLabel(item.shape)}</span>
                              <span className="fb-item__meta">{pathOf(item.url)}</span>
                            </div>
                            <div className="fb-item__actions">{deleteButton(item.id)}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            );
          })()}
      </div>

      {items.length > 0 && (
        <div className="panel__share">
          {/* Sharing stands alone in the first row — it is the main action;
              screenshot and Markdown share the row below. The page selection
              hangs off the *row*, not the button: otherwise it would inherit its
              half width and the paths would be cut off. */}
          <div
            className="share-row share-row--pick"
            ref={pickFor === 'share' ? pickRef : undefined}
          >
            {pickFor === 'share' && pagePicker}
            <button
              className={`share-btn${pickFor === 'share' ? ' share-btn--armed' : ''}`}
              onClick={createShareLink}
              // Even without feedback on *this* page the button stays usable, as
              // long as other pages have some — those can be selected.
              disabled={pageCount === 0 && otherPages.length === 0}
              {...tip(
                pickFor === 'share'
                  ? 'Create a link for the selected pages'
                  : 'Copy a link that carries the markings of this page',
              )}
            >
              <IconLink size={14} />
              {pickFor === 'share'
                ? `Share as link${picked.size > 0 ? ` (${picked.size + 1})` : ''}`
                : 'Share as link'}
            </button>
          </div>
          <div
            className="share-row share-row--pick"
            ref={pickFor === 'shots' ? pickRef : undefined}
          >
            {pickFor === 'shots' && pagePicker}
            <button
              className={`share-btn share-btn--alt${pickFor === 'shots' ? ' share-btn--armed' : ''}`}
              onClick={exportShots}
              disabled={shotsPending}
              {...tip(
                pickFor === 'shots'
                  ? 'Capture the selected pages'
                  : 'Download annotated PDFs of this page',
              )}
            >
              <IconDownload size={14} />
              {shotsPending
                ? shotsProgress && shotsProgress.total > 0
                  ? `Capturing ${Math.min(shotsProgress.done + 1, shotsProgress.total)}/${shotsProgress.total}…`
                  : 'Capturing…'
                : pickFor === 'shots'
                  ? `Screenshot${picked.size > 0 ? ` (${picked.size + 1})` : ''}`
                  : 'PDFs'}
            </button>
            <button
              className="share-btn share-btn--alt"
              onClick={copyMarkdown}
              disabled={items.length === 0}
              {...tip('Copy all feedback of this domain as a Markdown checklist')}
            >
              <IconCopy size={14} />
              Markdown
            </button>
          </div>

          {shareUrl !== null && (
            <>
              <div className="share-box">
                <input
                  className="share-box__url"
                  readOnly
                  value={shareUrl}
                  spellCheck={false}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  className="icon-btn icon-btn--small"
                  {...tip(shareCopied ? 'Copied' : 'Copy link')}
                  onClick={copyShareLink}
                >
                  {shareCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                </button>
              </div>
              <div className={`share-hint${shareCopied ? ' share-hint--ok' : ''}`}>
                {shareCopied
                  ? `Link copied to your clipboard — ${sharePages === 1 ? 'this page' : `${sharePages} pages`}.`
                  : `The link carries every marking of ${sharePages === 1 ? 'this page' : `these ${sharePages} pages`}. Whoever opens it with Inkspect installed sees them right on the page.`}
              </div>
              {/* The link itself works even when long — the limit is drawn by
                  the transport. So we warn rather than block. */}
              {shareUrl.length > SHARE_URL_WARN && (
                <div className="share-hint share-hint--error">
                  This link is {Math.round(shareUrl.length / 1024)} KB long. Chat and mail apps
                  often cut links that long in half — pick fewer pages, or send the PDFs
                  instead.
                </div>
              )}
            </>
          )}

          {/* Negative means: cancelled (the page selection was clicked away) —
              there is nothing to report about that. */}
          {shotsCount !== null && shotsCount >= 0 && (
            <div className={`share-hint${shotsCount === 0 ? ' share-hint--error' : ''}`}>
              {shotsCount === 0
                ? 'No screenshots could be captured.'
                : `${shotsCount} annotated PDF${shotsCount === 1 ? '' : 's'} saved to your Downloads folder — markings and notes included.`}
            </div>
          )}

          {shareError && (
            <div className="share-hint share-hint--error">The link could not be created.</div>
          )}

          {mdCopied && (
            <div className="share-hint share-hint--ok">
              Feedback copied as a Markdown checklist.
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
