# Inkspect

Browser extension (Chrome & Firefox, Manifest V3): responsive preview with synced device frames, a live CSS editor and feedback tools — right on the running page, no external tools.

## Features

- **Synced device previews** — the current page in multiple viewports side by side; scrolling, clicks, inputs, hover (JS and CSS `:hover`, including Shadow DOM) and link navigation run on all frames simultaneously. A URL watchdog realigns frames whose navigation drifts apart (including SPA routing via `pushState`). Custom viewport sizes can be added; the device grid, rotation and zoom persist across sessions.
- **Feedback tools** — element picker (highlights DOM elements on hover, a click captures them along with a label), comment pins, freehand, shapes, arrows and text; every marking with an optional note. Markings stick to the content (document coordinates) and are bound to page + device. Entries can be checked off (done markers render dimmed; badges count open items).
- **Share feedback** — all markings of a page deflate-compressed and base64url-encoded in the URL hash (`#ink-feedback=…`); no server. Recipients with the extension installed get the feedback imported and displayed automatically. Alternatively export as text or download annotated full-page screenshots of every page with open feedback (scroll-stitched, drawings and notes rendered right at their markers).
- **Live CSS editor** — edit the page's stylesheets (including cross-origin via background fetch) in a CodeMirror editor; changes apply debounced across all frames and survive frame reloads.
- **Frame-blocking bypass** — pages with `X-Frame-Options`/`frame-ancestors` can still be embedded via opt-in (DNR session rule, only for the current tab and only for sub-frames).

## Development

```sh
pnpm install
pnpm dev            # Chrome with live reload
pnpm dev:firefox
pnpm build          # production build to .output/
pnpm compile        # typecheck
pnpm icons          # render PNG icons from assets/icon.svg
pnpm test:e2e       # E2E suite (needs Google Chrome under /Applications)
```

Built with [WXT](https://wxt.dev), React 19 and CodeMirror 6. The E2E suite (`scripts/e2e-sync.mjs`) starts a local test server, installs the extension in real Chrome (headless, via CDP) and verifies sync, tools, the share round-trip and navigation.
