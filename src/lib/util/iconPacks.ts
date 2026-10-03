/**
 * Single source of truth for the Iconify icon packs this app bundles.
 *
 * No `mermaid` import, so it can be consumed by:
 *   1. src/lib/util/mermaid.ts    — registers each prefix + loader with Mermaid for rendering.
 *   2. scripts/gen-icon-index.ts  — bakes a names-only index for the MCP search_icons tool.
 *
 * `prefixes[0]` is the preferred prefix returned by search results; the rest are
 * aliases that also render (e.g. `fa`/`fa7-solid` alongside `fas`). `loader` is a
 * lazy import of the pack's IconifyJSON; the generator never calls it (so no icon
 * JSON is pulled into the Node script). After editing this list, regenerate the MCP
 * index: `pnpm gen:icon-index`.
 */
export interface IconPack {
  /** npm package providing the Iconify JSON (`<pkg>/icons.json`); used by the index generator. */
  pkg: string;
  /** Names this pack registers under; prefixes[0] is preferred for search results. */
  prefixes: string[];
  /**
   * Lazy loader of the pack's IconifyJSON for Mermaid. The specifier must be a
   * literal string so Vite code-splits each pack into its own on-demand chunk.
   * `any` because @iconify/types is only a transitive dep (not worth importing).
   */
  loader: () => Promise<any>;
}

export const ICON_PACKS: IconPack[] = [
  {
    pkg: '@iconify-json/logos',
    prefixes: ['logos'],
    loader: () => import('@iconify-json/logos/icons.json').then((m) => m.default)
  },
  {
    pkg: '@iconify-json/fa7-solid',
    prefixes: ['fas', 'fa', 'fa7-solid'],
    loader: () => import('@iconify-json/fa7-solid/icons.json').then((m) => m.default)
  },
  {
    pkg: '@iconify-json/fa7-regular',
    prefixes: ['far', 'fa7-regular'],
    loader: () => import('@iconify-json/fa7-regular/icons.json').then((m) => m.default)
  },
  {
    pkg: '@iconify-json/fa7-brands',
    prefixes: ['fab', 'fa7-brands'],
    loader: () => import('@iconify-json/fa7-brands/icons.json').then((m) => m.default)
  }
];
