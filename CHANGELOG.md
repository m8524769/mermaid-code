# Changelog

All notable changes to Mermaid Code are documented here.

## [v0.1.8] - 2026-07-08

### Fixed

- **Copy Image**: works correctly in Tauri desktop mode via a custom Rust command; the PNG is decoded on the Rust side and written to the system clipboard using `arboard`, bypassing WKWebView's restriction on `navigator.clipboard.write`

## [v0.1.7] - 2026-07-08

### Fixed

- **Per-tab undo isolation**: each tab now uses its own Monaco model; switching tabs no longer leaks undo history from other files
- **Vim clipboard**: `y`/`d`/`c` operations now correctly write to the system clipboard via unnamed register override
- **Per-tab pan/zoom state**: viewport position is saved and restored per tab; panning/zooming in one tab no longer affects others
- **File tree actions**: replaced context menu (broken in Tauri) with inline hover action buttons

## [v0.1.6] - 2026-07-08

### Fixed

- **File rename**: extension is preserved automatically when the user omits it; text selection excludes the extension so only the stem is selected

## [v0.1.5] - 2026-07-08

### Fixed

- Sidebar now shows "This folder is empty." when the opened folder has no supported files
- Tab tooltip shows the full file path
- File watcher no longer causes UI lag when opening large directories

## [v0.1.4] - 2026-07-08

### Changed

- Bumped GitHub Actions versions
- Minor release workflow configuration fixes

## [v0.1.3] - 2026-07-07

### Changed

- Release workflow now uses GitHub's native auto-generated release notes

## [v0.1.2] - 2026-07-07

### Added

- **Save / Save As buttons**: toolbar Save button in Tauri desktop mode; Save As dialog when no tab is active
- **File type association**: `.mmd` and `.mermaid` registered via `Info.plist`
- **Date-stamped default names**: new files default to `Diagram YYYY-MM-DD at HH.MM.SS.mmd`; new folders to `New Folder YYYY-MM-DD at HH.MM.SS`
- **Auto-expand on new file**: creating a file inside a collapsed directory now expands that directory automatically

### Fixed

- Tab persistence no longer overwrites the current folder's tab list when opening an individual file from a different directory

## [v0.1.1] - 2026-07-07

### Added

- **Vim mode**: Monaco editor supports Vim keybindings (`monaco-vim`); `:w` triggers file save
- **Full-screen preview**: new "Full Screen" button opens the diagram preview in a separate Tauri WebviewWindow (or new browser tab on web)

## [v0.1.0] - 2026-07-07

Initial release of Mermaid Code, forked from mermaid-live-editor.

### Added

- **Tauri desktop app**: packaged as a native app for macOS, Windows, and Linux using Tauri v2
- **File manager sidebar**: open a local folder and browse, create, rename, and delete `.mmd` and `.mermaid` files
- **Multi-tab editing**: open multiple files simultaneously with independent undo history per tab; drag to reorder tabs
- **Per-folder tab persistence**: reopening a folder restores the previously open tabs and active tab
- **Auto-save**: sidebar toggle enables auto-save with a 2-second idle delay
- **Keyword autocomplete**: Monaco editor provides diagram-type-aware keyword completions
- **Mermaid upgraded to 11.16.0**; pako upgraded to 3.0.0
- **Performance improvements**: pan/zoom change throttle set to 200 ms; editor update debounce set to 100 ms
- **Shareable links**: domain changed to `mermaid.live` (no longer shows `localhost`)
- **Multi-platform release workflow**: GitHub Actions builds and publishes installers for macOS, Windows, and Linux
