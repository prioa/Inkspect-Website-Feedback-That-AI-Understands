# Privacy Policy — Inkspect

*Last updated: July 15, 2026*

Inkspect is a browser extension for responsive preview and visual feedback on the page currently open in your tab.

## What data Inkspect collects

**None.** Inkspect does not collect, transmit, sell or share any user data. There is no server, no account, no analytics and no tracking.

## What stays on your device

- **Feedback annotations** (marker positions, optional note text, the page URL and device preset they belong to) are stored locally in your browser via `chrome.storage.local`, so your markers reappear when you revisit a page. You can delete individual entries or all entries of a page in the feedback panel at any time. Uninstalling the extension removes this data.
- **Annotated screenshots** are saved directly to your local Downloads folder when you request them.
- **Share links** encode your feedback into the URL itself (compressed, in the URL hash). Such a link is only shared if and when you send it to someone yourself; it never passes through any Inkspect server.

## Network access

Inkspect makes no requests to any server of its own. The only network activity is loading the stylesheets of the page you are inspecting (including ones served from a CDN) into the built-in CSS editor — the same resources the page itself already loads.

## Permissions

- **Host access** is needed so the preview and feedback tools work on whatever site you choose to open Inkspect on. The extension is inactive until you click its icon in a tab.
- **storage** persists your feedback locally, as described above.
- **declarativeNetRequestWithHostAccess** is used only when you explicitly click "Bypass blocking" to preview a page that forbids embedding; it removes the blocking response headers for preview frames in that one tab and is reverted when you close Inkspect or the tab.

## Contact

Questions about this policy: open an issue at https://github.com/prioa/inkspect/issues
