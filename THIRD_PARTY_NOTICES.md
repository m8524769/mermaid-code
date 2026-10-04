# Third-Party Notices

Mermaid Code bundles third-party code, icons, and fonts.

## Bundled npm dependencies

Licenses for every npm package in the production bundle — including the
[SVG Logos](https://icon-sets.iconify.design/logos) (CC0) and
[Font Awesome 7](https://fontawesome.com) (CC BY 4.0 / OFL 1.1 / MIT) icon packs —
are collected at build time by Vite's `build.license` option (see
[vite.config.js](vite.config.js)) and written to `third-party-licenses.md`, which
ships alongside the application. Refer to that generated file for the full list
and license texts.

Note: the brand marks in the SVG Logos set are trademarks of their respective
owners. The licenses waive copyright only and grant no trademark rights; the
logos identify the corresponding products and do not imply any endorsement.

## Fonts and icons outside the JS dependency graph

The assets below ship with the app but are not npm modules in the bundle graph
(static files, CSS-imported webfonts, build-time-inlined SVGs, or a sub-asset of
another package), so `build.license` cannot see them. They are acknowledged here,
and their license texts are bundled under `static/` so they ship with the app.

### Fira Code

- Source: https://github.com/tonsky/FiraCode
- Author: The Fira Code Project Authors
- License: SIL OFL 1.1 — https://openfontlicense.org/
- Used for: the code editor font (`static/fonts/FiraCode-VF.woff2`)
- License text: [static/fonts/LICENSE](static/fonts/LICENSE)

### Recursive

- Source: https://github.com/arrowtype/recursive (via `@fontsource-variable/recursive`)
- Author: The Recursive Project Authors
- License: SIL OFL 1.1 — https://openfontlicense.org/
- Used for: the application UI font
- License text: [static/licenses/Recursive.txt](static/licenses/Recursive.txt)

### Material Symbols

- Source: https://github.com/google/material-design-icons (via `@iconify-json/material-symbols`, inlined by unplugin-icons)
- Author: Google
- License: Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0
- Used for: application UI icons (toolbar, menus)
- License text: [static/licenses/MaterialSymbols.txt](static/licenses/MaterialSymbols.txt)

### Codicon

- Source: https://github.com/microsoft/vscode-codicons (bundled via `monaco-editor`)
- Author: Microsoft Corporation
- License: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
- Used for: Monaco editor UI icons (`codicon.ttf`)
- License text: [static/licenses/Codicon.txt](static/licenses/Codicon.txt)
