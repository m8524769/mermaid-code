#!/usr/bin/env node
// Render the root CHANGELOG.md into a static, on-brand site/changelog.html.
//
// The marketing site (site/) is plain static HTML served as-is by Cloudflare
// Pages — there is no site build step. To keep CHANGELOG.md as the single
// source of truth while still showing release notes ON the site (good for SEO
// and offline-cacheable), we convert Markdown -> HTML at build time here and
// wrap it in a template that reuses index.html's dark theme.
//
// Usage:
//   node scripts/build-changelog.mjs         # -> site/changelog.html
//   pnpm build:changelog
//
// Run this after editing CHANGELOG.md (typically once the release notes are
// finalized) and commit the regenerated site/changelog.html alongside them.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const root = new URL('../', import.meta.url);
const changelogPath = fileURLToPath(new URL('CHANGELOG.md', root));
const outPath = fileURLToPath(new URL('site/changelog.html', root));
const sitemapPath = fileURLToPath(new URL('site/sitemap.xml', root));

// Local calendar date as YYYY-MM-DD (not UTC — toISOString() would roll back a
// day for timezones ahead of UTC, e.g. writing 09-09 late on the local 09-10).
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
  now.getDate()
).padStart(2, '0')}`;

const markdown = readFileSync(changelogPath, 'utf8');
// GitHub-flavored rendering; the CHANGELOG only uses headings, lists, inline
// code, bold, links and horizontal rules, all handled by marked's defaults.
const body = marked.parse(markdown, { gfm: true });

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Changelog — Mermaid Code</title>
  <meta name="description" content="Release notes and version history for Mermaid Code, the local-first Mermaid diagram editor built for AI-first workflows." />
  <link rel="canonical" href="https://mermaid-code.com/changelog" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://mermaid-code.com/changelog" />
  <meta property="og:title" content="Changelog — Mermaid Code" />
  <meta property="og:description" content="Release notes and version history for Mermaid Code." />
  <meta property="og:image" content="https://mermaid-code.com/showcase.png" />
  <meta property="og:site_name" content="Mermaid Code" />

  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0f1117;
      --bg2: #161b27;
      --bg3: #1e2535;
      --border: #2a3347;
      --text: #e8edf5;
      --muted: #8b96aa;
      --accent: #4f8ef7;
      --accent2: #7c5cbf;
      --radius: 10px;
      --max: 780px;
    }

    html { scroll-behavior: smooth; }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* NAV — mirrors index.html */
    nav {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(15, 17, 23, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
    }
    .nav-inner {
      max-width: var(--max);
      margin: 0 auto;
      padding: 0 24px;
      height: 56px;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .nav-logo {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 15px;
      color: var(--text);
    }
    .nav-logo img { width: 22px; height: 22px; }
    .nav-spacer { flex: 1; }
    .nav-links { display: flex; gap: 4px; align-items: center; }
    .nav-links a {
      font-size: 14px;
      color: var(--muted);
      padding: 6px 10px;
      border-radius: 6px;
      transition: color 0.15s, background 0.15s;
    }
    .nav-links a:hover { color: var(--text); background: var(--bg3); text-decoration: none; }

    /* CONTENT */
    main {
      max-width: var(--max);
      margin: 0 auto;
      padding: 56px 24px 72px;
    }
    .changelog h1 {
      font-size: clamp(30px, 5vw, 44px);
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 8px;
    }
    /* Intro paragraph directly after the H1 */
    .changelog h1 + p {
      color: var(--muted);
      font-size: 16px;
      margin-bottom: 8px;
    }
    .changelog h2 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin-top: 48px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }
    .changelog h3 {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--accent);
      margin-top: 24px;
      margin-bottom: 10px;
    }
    .changelog ul { list-style: none; padding: 0; }
    .changelog li {
      position: relative;
      padding-left: 20px;
      margin-bottom: 10px;
      color: var(--muted);
      font-size: 15px;
    }
    .changelog li::before {
      content: "";
      position: absolute;
      left: 4px;
      top: 11px;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--accent);
    }
    .changelog li strong { color: var(--text); font-weight: 600; }
    .changelog code {
      font-family: 'SF Mono', 'Fira Code', Menlo, monospace;
      font-size: 0.86em;
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: 5px;
      padding: 1px 6px;
      color: var(--accent);
    }
    .changelog hr { display: none; }

    /* FOOTER — mirrors index.html */
    footer {
      max-width: var(--max);
      margin: 0 auto;
      padding: 32px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      border-top: 1px solid var(--border);
    }
    footer .footer-left { display: flex; align-items: center; gap: 8px; }
    footer .footer-left img { width: 18px; height: 18px; opacity: 0.7; }
    footer .footer-left span { font-size: 13px; color: var(--muted); }
    footer .footer-right { margin-left: auto; display: flex; gap: 16px; }
    footer .footer-right a { font-size: 13px; color: var(--muted); }
    footer .footer-right a:hover { color: var(--text); }
  </style>
</head>
<body>

<nav>
  <div class="nav-inner">
    <a class="nav-logo" href="/">
      <img src="favicon.svg" alt="" />
      Mermaid Code
    </a>
    <div class="nav-spacer"></div>
    <div class="nav-links">
      <a href="/#features">Features</a>
      <a href="/#mcp">MCP</a>
      <a href="/#install">Install</a>
      <a href="https://github.com/m8524769/mermaid-code">GitHub</a>
    </div>
  </div>
</nav>

<main class="changelog">
${body}
</main>

<footer>
  <div class="footer-left">
    <img src="favicon.svg" alt="" />
    <span>Mermaid Code — Fork of <a href="https://github.com/mermaid-js/mermaid-live-editor" style="color:var(--muted)">mermaid-live-editor</a></span>
  </div>
  <div class="footer-right">
    <a href="/">Home</a>
    <a href="https://github.com/m8524769/mermaid-code/releases">Releases</a>
    <a href="https://github.com/m8524769/mermaid-code/blob/main/CHANGELOG.md">Source</a>
  </div>
</footer>

</body>
</html>
`;

writeFileSync(outPath, html);
console.log(`✓ site/changelog.html generated from CHANGELOG.md (${html.length} bytes)`);

// Keep the changelog entry's <lastmod> in sitemap.xml in sync with today, so
// search engines see the page as freshly updated. Only the changelog <url>
// block is touched — the homepage entry is left alone.
const sitemap = readFileSync(sitemapPath, 'utf8');
const sitemapRe =
  /(<loc>https:\/\/mermaid-code\.com\/changelog<\/loc>\s*<lastmod>)\d{4}-\d{2}-\d{2}(<\/lastmod>)/;
if (sitemapRe.test(sitemap)) {
  writeFileSync(sitemapPath, sitemap.replace(sitemapRe, `$1${today}$2`));
  console.log(`✓ site/sitemap.xml changelog lastmod → ${today}`);
} else {
  console.warn('⚠ site/sitemap.xml: no /changelog <lastmod> found, left unchanged');
}
