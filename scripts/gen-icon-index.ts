/**
 * Generates a names-only icon index for the MCP search_icons tool.
 *
 * Reads each registered pack's icons.json (from ICON_PACKS, the single source of
 * truth) and writes just the icon names under each pack's preferred prefix. Kept
 * names-only so the MCP sidecar binary doesn't embed the multi-MB SVG bodies — the
 * sidecar resolves `pack:name` strings, the frontend bundle holds the SVGs.
 *
 * Committed, not built in CI: the sidecar is compiled with a bare `bun build`
 * (see .github/workflows/*.yml) that runs no generator. Re-run after editing
 * iconPacks.ts or bumping an @iconify-json/* package:  pnpm gen:icon-index
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { ICON_PACKS } from '../src/lib/util/iconPacks';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, '../mcp-server/src/icon-index.generated.json');

const packs = ICON_PACKS.map(({ pkg, prefixes }) => {
  const jsonPath = require.resolve(`${pkg}/icons.json`);
  const data = JSON.parse(readFileSync(jsonPath, 'utf8')) as { icons: Record<string, unknown> };
  return { prefix: prefixes[0], icons: Object.keys(data.icons).sort() };
});

writeFileSync(outFile, JSON.stringify({ packs }) + '\n');
console.log(
  `Wrote ${outFile}\n  ` + packs.map((p) => `${p.prefix}: ${p.icons.length} icons`).join('\n  ')
);
