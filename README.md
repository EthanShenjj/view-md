# View MD

View MD is a read-only macOS desktop app for quickly previewing Markdown files and copying the generated HTML.

## What It Does

- Opens `.md` and `.markdown` files from the app button, app menu, or drag and drop.
- Keeps a local recent-files sidebar for quick switching.
- Shows a side-by-side layout with the original Markdown on the left and a preview on the right.
- Switches the right pane between Markdown preview and generated HTML page preview.
- Copies the generated HTML to the clipboard.
- Refreshes the current preview when the open file changes on disk.

## Getting Started

```bash
npm install
npm run dev
```

## Build a Mac App

```bash
npm run package:mac
```

The packaged app will be written to `release/`.

## Useful Checks

```bash
npm run typecheck
npm test
```

## Troubleshooting

- Use `npm run dev` to start the desktop app. If you open the Vite renderer directly in a browser, the app uses a browser fallback file picker instead of native desktop file access.
- If the window is blank after changing Electron preload code, stop the app and run `npm run dev` again so `out/main` and `out/preload` are regenerated together.
- If Rollup reports a missing optional native package, reinstall dependencies with a fresh `npm install`.
