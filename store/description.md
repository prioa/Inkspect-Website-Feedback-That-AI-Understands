# Chrome Web Store listing — Inkspect

## Name

Inkspect — Website Feedback That AI Understands

## Summary (max 132 characters)

Mark up any website, edit it live, and hand the feedback to your AI agent — with selectors and exact values. No account.

## Description

"The button is too small" plus a screenshot makes an AI coding agent guess. Inkspect writes down what you actually meant.

Mark up the page you are looking at — pin a comment, draw on it, pick an element, nudge its padding until it looks right — and hand the result over as a Markdown checklist that names the CSS selector, the current value, the target value and the position of every single note. Paste it into Claude Code, Cursor, Copilot or any agent, drop it into a ticket, or send it as a link that opens the markings live on the page.

No external tools, no uploads, no account. Open it on any page with one click.

FEEDBACK YOUR AGENT CAN ACT ON
• Copy all feedback of a site as a Markdown checklist: note, CSS selector (Shadow DOM boundaries included), style changes as from → to, rewritten text, measured spacings, position, done state
• Every entry points at a place in your source code instead of at a pixel in a screenshot
• The checklist is plain text — it goes into an agent prompt, a pull request, a ticket or a chat message unchanged

MARK UP THE RUNNING PAGE
• Element picker, comment pins, freehand drawing, rectangles, ellipses, arrows and text notes — everything takes an optional comment
• Guide lines across the full width or height — drag a second one and the gap between them is measured in pixels, straight into the export
• Markings stick to the content while you scroll and re-anchor to their element after a reload
• Move and resize your own markings by their outline; element picks stay locked to the DOM box they measured
• A tidy panel groups all feedback per page and per device — check items off as you fix them, badges count what is still open
• A guided tour on first open, and a shortcut sheet behind "?" whenever you need it

ELEMENT PICKER WITH LIVE EDITS
• Pick an element and rewrite its text, change font weight and size, drag padding and margins per edge or all four linked
• The change happens on the page — you see the result before you write it down, and it is recorded as from → to on the marker
• Class or element scope: edit .btn-primary and every one of them moves (the panel tells you how many elements the rule hits), or restrict the change to the one element you picked
• Boxes laid out by their container keep max-width and auto margins read-only instead of freezing a pixel value that breaks at other widths
• Every edit is listed and can be reverted one by one

SHARE IT — WITHOUT A SERVER
• All feedback of a page is compressed and encoded directly into the URL hash
• Anyone with Inkspect installed opens your link and sees the markings live on the page
• Nothing is uploaded anywhere — there is no Inkspect server to upload to

ANNOTATED PDFs, ONE CLICK
• Download an annotated PDF of every page that has open feedback — one file per device viewport, the whole page, not just the visible part
• All drawings are baked in and every note is rendered right at its marker, so the file speaks for itself in tickets, chats and reviews
• A header bar carries the page, the date and a live "Open on web" link back to the annotated page

SYNCED DEVICE PREVIEWS
• See the current page in phone, tablet and desktop viewports side by side
• Scrolling, clicks, typing, hover states (JS and CSS :hover, even inside Shadow DOM) and link navigation are mirrored across all frames in real time
• A navigation watchdog keeps every frame aligned — including SPA routing via pushState
• Add, rotate and remove devices freely, define your own viewport sizes, save a grid as a named set — your setup is remembered across sessions

FULL WINDOW MODE
• The page at full size with a floating feedback bar you can drag anywhere — it snaps to the left edge or the bottom
• An optional floating phone mockup runs the same page in mobile width next to it
• Inkspect can start in this mode by default

LIVE CSS EDITOR
• Edit the page's stylesheets in a full CodeMirror editor — cross-origin sheets included
• Changes apply instantly across all device frames and survive reloads
• Reset any sheet back to the original with one click

WORKS WITH STUBBORN PAGES
• Pages that refuse to be embedded (X-Frame-Options / frame-ancestors) can still be previewed via an explicit opt-in — scoped to the current tab and its preview frames only

PRIVACY
Inkspect stores your feedback locally in your browser. Nothing is uploaded anywhere — shared links carry the data inside the URL itself.

## Category

Developer Tools

## Image assets (rendered from store/src via `pnpm store-assets`)

- `marquee-1400x560.jpg` — marquee promo tile
- `tile-440x280.jpg` — small promo tile
- `screenshot-1-feedback-1280x800.jpg` — feedback on the running page, with the export it produces
- `screenshot-2-inspect-1280x800.jpg` — element picker with live edits (text, font, spacing)
- `screenshot-3-export-1280x800.jpg` — Markdown for an agent, share link, annotated PDF
- `screenshot-4-sync-1280x800.jpg` — synced device previews
- `screenshot-5-css-1280x800.jpg` — live CSS editor
