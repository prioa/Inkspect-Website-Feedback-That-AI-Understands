# Privacy Policy — Inkspect

*Last updated: July 28, 2026*

Inkspect is a browser extension for visual website feedback and responsive preview on the page currently open in your tab.

## What data Inkspect collects

**None.** Inkspect does not collect, transmit, sell or share any user data. There is no server, no account, no analytics and no tracking.

## What stays on your device

- **Feedback annotations** (marker positions, optional note text, the CSS selector, style and text changes recorded by the element picker, the page URL and device preset they belong to) are stored locally in your browser via `chrome.storage.local`, so your markers reappear when you revisit a page. You can delete individual entries or all entries of a page in the feedback panel at any time. Uninstalling the extension removes this data.
- **Live edits** made with the element picker or the CSS editor change only the preview of the page inside Inkspect. They are never written back to the website and disappear when you close the extension; only the recorded target values stay with your feedback entry, locally.
- **Exports** — annotated PDFs and the Markdown checklist — are created inside your browser. PDFs are saved directly to your local Downloads folder; the Markdown goes to your clipboard when you ask for it. Neither passes through any server.
- **Share links** encode your feedback into the URL itself (compressed, in the URL hash). Such a link is only shared if and when you send it to someone yourself; it never passes through any Inkspect server.

## Network access

Inkspect makes no requests to any server of its own. The only network activity concerns the site you are inspecting: loading its stylesheets (including ones served from a CDN) into the built-in CSS editor, and one request to check whether the page allows being embedded. Both target resources the page itself already serves.

## Permissions

- **Host access** is needed so the preview and feedback tools work on whatever site you choose to open Inkspect on, and to capture the page for the annotated PDF export. The extension is inactive until you click its icon in a tab.
- **storage** persists your feedback and settings locally, as described above.
- **declarativeNetRequestWithHostAccess** is used only when you explicitly click "Bypass blocking" to preview a page that forbids embedding; it removes the blocking response headers for preview frames in that one tab and is reverted when you close Inkspect or the tab.

## Contact

Questions about this policy: open an issue at https://github.com/prioa/inkspect/issues
