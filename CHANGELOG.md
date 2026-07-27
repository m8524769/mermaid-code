# Changelog

All notable changes to Mermaid Code are documented here.

## [v0.3.12] - 2026-07-27

### Added

- **Content Security Policy (CSP)**: configured CSP for the WebView to restrict resource loading
- **External link confirmation**: clicking a diagram link now shows a "Do you trust this link?" dialog before opening in the system browser

### Fixed

- **PNG export with external links**: diagrams containing `click href` links can now be exported as PNG; external hrefs are stripped from the canvas SVG to prevent canvas taint
- **External link navigation**: links in diagrams no longer navigate inside the app; they open in the system browser instead
- **Vim `:w`/`:q`/`:wq` on Draft tab**: correctly triggers Save As when the Draft tab is active instead of doing nothing
- **Thumbnail security level**: thumbnail rendering now uses `strict` security level instead of `loose`
- **Unsaved changes on folder switch**: switching to a different folder with unsaved changes now prompts to save instead of silently discarding them
- **Delete directory on Windows**: deleting a directory now correctly closes all tabs whose files are inside it (fixed path separator mismatch on Windows)
- **Rename directory**: renaming a directory now correctly updates paths of all open tabs inside it and re-registers file watchers

## [v0.3.11] - 2026-07-25

### Added

- **Window state persistence**: window size and position are now saved and restored on next launch

### Fixed

- **"Open with" tab activation**: opening a file via "Open with Mermaid Code" now correctly activates the corresponding tab instead of staying on the previously active tab

## [v0.3.10] - 2026-07-21

### Fixed

- **"Open with" on macOS**: fixed file association so that double-clicking or using "Open with Mermaid Code" in Finder correctly opens the file on first launch
- **"Open with" on Windows**: fixed file association for first launch when the app is not already running

## [v0.3.8] - 2026-07-20

### Added

- **Syntax error display**: syntax error message now appears above the VIM status bar, integrated into the editor

### Fixed

- **Editor undo loop**: fixed undo/redo cycling between the last two states when typing
- **Auto-save false alarm**: auto-saving a file no longer triggers "modified externally but has unsaved changes" notification

### Changed

- **Build output directory**: changed from `docs/` to `dist/`
- **Removed web support**: app is now desktop-only; CodeMirror removed
- **Removed analytics**: Plausible Analytics and all usage statistics removed

## [v0.3.7] - 2026-07-20

### Added

- **Draft tab**: always-visible "Draft" tab for unsaved work; prompts to save before quitting if draft has content
- **Editor expand button**: when the editor pane is collapsed, a button appears on the left edge of the preview to expand it

### Changed

- **TabBar**: always visible; shows a "＋" button when no files are open; standalone style (rounded, bordered) when sidebar is collapsed

## [v0.3.6] - 2026-07-17

### Added

- **Sub-directory file watching**: clicking a file from a sub-directory in grid view now registers a file watcher for that directory

### Fixed

- **Sub-directory watching**: fixed file change detection for files outside the root directory

## [v0.3.5] - 2026-07-14

### Changed

- **Presentation mode**: full-screen now hides the editor pane; ESC or macOS green button exits correctly

## [v0.3.4] - 2026-07-13

### Added

- **Config reset button**: added a Reset button in the Config tab to restore default Mermaid config

### Changed

- **Homebrew tap auto-update**: GitHub Actions workflow now automatically updates the Homebrew tap on release

## [v0.3.3] - 2026-07-13

### Added

- **Homebrew tap**: available via `brew tap m8524769/tap && brew install --cask mermaid-code`

### Fixed

- **macOS relaunch after update**: app now correctly relaunches after installing an update

## [v0.3.2] - 2026-07-13

### Changed

- **Update flow**: download and install are now separate steps; "Install & Restart" button appears after download completes

## [v0.3.1] - 2026-07-13

### Added

- **Update progress**: download progress shown inline next to the version badge
- **✓ latest badge**: shown next to version number when the app is confirmed up to date

## [v0.3.0] - 2026-07-12

### Added

- **Auto-update**: app checks for updates on launch and prompts the user to install; a version badge appears next to the title when an update is available, clicking it triggers the install

## [v0.2.5] - 2026-07-12

### Added

- **Version info**: app version is now displayed next to the title in the navbar
- **Single instance**: launching a second instance focuses the existing window instead of opening a new one
- **File associations**: `.mmd` and `.mermaid` files are now associated with Mermaid Code on Windows

## [v0.2.4] - 2026-07-11

### Added

- **Vim mode**: `:q` closes the current tab (exits the app when no tabs are open); `:wq` saves and closes; `H`/`L` mapped to `^`/`$`; `jk` mapped to `<Esc>` in insert mode
- **Export filename**: PNG and SVG exports now use the current file's name instead of a timestamp
- **Download notification**: a toast shows the download folder path after exporting PNG or SVG
- **Rename warning**: renaming a file to an unsupported extension now prompts for confirmation

### Fixed

- **`:q` permission**: added `core:window:allow-close` capability so `:q` can close the window

## [v0.2.3] - 2026-07-10

### Added

- **Drag and drop**: drag `.mmd`/`.mermaid` files or folders onto the app window to open them

## [v0.2.2] - 2026-07-10

### Added

- **`look` config field**: Config tab now includes a Look selector (`classic` / `neo`)
- **Thumbnail stale tracking**: changing the config immediately re-renders the current file's thumbnail; other files' thumbnails are refreshed on next click

### Changed

- Default mermaid config changed from `{"theme": "default"}` to `{}` (same behavior, cleaner)

## [v0.2.1] - 2026-07-10

### Added

- **Sidebar search bar**: filter files by filename in both tree and grid views; search auto-clears when switching folders
- **Dirty indicator in thumbnail view**: unsaved files now show the orange dot in the thumbnail grid, matching the tree view

### Fixed

- **Thumbnail rename sorting**: renaming a file no longer incorrectly pins it to the top of the grid

## [v0.2.0] - 2026-07-10

### Added

- **Thumbnail grid view**: sidebar now supports a thumbnail grid view showing SVG previews of all `.mmd`/`.mermaid` files in the opened folder (including subdirectories); switch between tree and grid view with the toggle buttons in the sidebar header; view preference is persisted
- **Onboarding tooltip**: first-time users see a tooltip pointing to the File Explorer button after 3 seconds, which disappears once the sidebar is opened

### Fixed

- **Editor horizontal scrollbar**: VIM status bar no longer overlaps the Monaco editor's horizontal scrollbar
- **Ignored files**: `.DS_Store`, `Thumbs.db`, and `desktop.ini` are now excluded from the file tree

## [v0.1.13] - 2026-07-09

### Added

- **Relative line numbers in Vim mode**: editor switches to `lineNumbers: 'relative'` when Vim mode is enabled, restores to absolute on disable

### Fixed

- **ZenUML infinite reload loop**: switching away from ZenUML no longer triggers repeated page reloads
- **Pin to code preserves existing frontmatter**: other fields (e.g. `title`, nested `flowchart` config) are no longer overwritten when pinning theme/layout/fontFamily

### Changed

- **ZenUML removed from Sample Diagrams**: due to global style injection side effects that cannot be cleaned up without a page reload

## [v0.1.12] - 2026-07-09

### Added

- **Pin to code**: Config tab now has a "Pin to code" button that inserts the current config as YAML frontmatter into the diagram code

### Changed

- **`@mermaid-js/layout-elk` upgraded to 0.2.2**

## [v0.1.11] - 2026-07-09

### Added

- **Config form**: theme, layout, and font family can now be set via a visual form at the top of the Config tab, synchronized with the JSON editor below

## [v0.1.10] - 2026-07-09

### Added

- **Theme hint in Config tab**: available mermaid theme names are now listed as badges at the top of the Config editor

### Fixed

- **Config tab empty on first open**: switching to the Config tab now correctly populates the editor with the current mermaid config
- **Dirty indicator dot**: replaced Unicode `●` with a CSS `rounded-full` element for consistent cross-platform sizing

## [v0.1.9] - 2026-07-08

### Fixed

- **Deleted folder closes tabs**: deleting a folder now automatically closes all tabs whose files were inside it
- **UI polish**: muted icon colors on inactive states for sidebar buttons, file tree action buttons, tab bar close button, and New File button; hover states now use consistent foreground color

### Changed

- Zoom scroll sensitivity increased from `0.1` (library default) to `0.2`
- Sidebar title tooltip now shows the full folder path on hover

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
