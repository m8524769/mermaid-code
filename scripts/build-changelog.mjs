#!/usr/bin/env node
// Render the root CHANGELOG.md into a static, on-brand site/changelog.html.
//
// The marketing site (site/) is plain static HTML served as-is by Cloudflare
// Pages — there is no site build step. To keep CHANGELOG.md as the single
// source of truth while still showing release notes ON the site (good for SEO
// and offline-cacheable), we convert Markdown -> HTML at build time here and
// wrap it in the shared site/styles.css + site/site.js layout.
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

const markdown = readFileSync(changelogPath, 'utf8').replace(/\r\n/g, '\n');

const escapeHtml = (str) =>
  str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

// Split into individual `## ...` release blocks while preserving any intro text.
const lines = markdown.split('\n');
const sections = [];
const introLines = [];
let current = null;

for (const line of lines) {
  const h2 = line.match(/^##\s+(.+)$/);
  if (h2) {
    if (current) sections.push(current);
    current = { heading: h2[1].trim(), bodyLines: [] };
  } else if (current) {
    current.bodyLines.push(line);
  } else if (!line.startsWith('# ')) {
    introLines.push(line);
  }
}
if (current) sections.push(current);

const introText = introLines.join('\n').trim() || 'All notable changes to Mermaid Code.';

const decorateCategoryHeadings = (htmlFragment) =>
  htmlFragment.replace(/<h3>(Added|Changed|Fixed|Removed)<\/h3>/gi, (_, label) => {
    const cls = `cat-${label.toLowerCase()}`;
    return `<h3 class="${cls}">${label}</h3>`;
  });

const latestMatch = sections[0]?.heading.match(/^\[?([^\]]+)\]?\s*(?:-\s*(.+))?$/);
const latestVersion = latestMatch ? latestMatch[1].trim() : '';

const renderedEntries = sections
  .map((sec) => {
    const match = sec.heading.match(/^\[?([^\]]+)\]?\s*-\s*(.+)$/);
    const version = match ? match[1].trim() : sec.heading;
    const date = match ? match[2].trim() : '';
    const slug = version.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
    const bodyHtml = decorateCategoryHeadings(
      marked.parse(sec.bodyLines.join('\n').trim(), { gfm: true })
    );

    return `<article class="release-node" id="${escapeHtml(slug)}">
  <div class="draft-frame">
    <div class="draft-frame-inner release-card">
      <div class="release-header">
        <a class="release-ver" href="#${escapeHtml(slug)}">${escapeHtml(version)}</a>
        ${date ? `<time class="release-date" datetime="${escapeHtml(date)}">${escapeHtml(date)}</time>` : ''}
      </div>
      ${bodyHtml}
    </div>
  </div>
</article>`;
  })
  .join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Changelog — Mermaid Code</title>
  <meta name="description" content="Release notes and version history for Mermaid Code, the desktop Mermaid diagram editor built for AI-first workflows." />
  <link rel="canonical" href="https://mermaid-code.com/changelog" />
  <link rel="alternate" type="text/plain" href="/llms.txt" title="LLMs.txt" />

  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://mermaid-code.com/changelog" />
  <meta property="og:title" content="Changelog — Mermaid Code" />
  <meta property="og:description" content="Release notes and version history for Mermaid Code." />
  <meta property="og:image" content="https://mermaid-code.com/showcase.png" />
  <meta property="og:site_name" content="Mermaid Code" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Changelog — Mermaid Code" />
  <meta name="twitter:description" content="Release notes and version history for Mermaid Code." />
  <meta name="twitter:image" content="https://mermaid-code.com/showcase.png" />

  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
  <link rel="preload" href="fonts/plus-jakarta-sans-latin.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin />
  <script>try{if(localStorage.getItem('mc-theme')==='dark')document.documentElement.dataset.theme='dark';}catch(e){}</script>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>

<header class="site-nav">
  <div class="nav-inner nav-inner--narrow">
    <a class="nav-logo" href="/">
      <img src="favicon.svg" alt="" width="26" height="26" />
      <span>Mermaid Code</span>
    </a>
    <div class="nav-spacer"></div>
    <nav class="nav-links" aria-label="Primary">
      <a href="/#loop">Workflow</a>
      <a href="/#mcp">MCP</a>
      <a href="/changelog" class="active">Changelog</a>
      <a href="https://github.com/m8524769/mermaid-code">GitHub</a>
    </nav>
    <div class="nav-actions">
      <button class="theme-pill" type="button" data-theme-toggle aria-label="Switch to dark blueprint" aria-pressed="false">
        <span class="theme-pill-opt theme-pill-opt--light" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
        </span>
        <span class="theme-pill-opt theme-pill-opt--dark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
        </span>
      </button>
      <a class="nav-cta" href="/download">Download</a>
      <button class="nav-menu-btn" type="button" data-menu-toggle aria-label="Toggle navigation menu" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
    </div>
  </div>
  <div class="mobile-drawer" data-mobile-drawer>
    <nav class="mobile-drawer-links" aria-label="Mobile">
      <a href="/">Home</a>
      <a href="/#loop">01 / Workflow</a>
      <a href="/#mcp">02 / Built-in MCP</a>
      <a href="/download">Download</a>
      <a href="/changelog" class="active">Changelog</a>
      <a href="https://github.com/m8524769/mermaid-code">GitHub</a>
    </nav>
  </div>
</header>

<main>
  <section class="cl-hero">
    <div class="container container--narrow">
      <div class="cl-hero-top">
        <div>
          <div class="hero-spec-line" style="margin-bottom:10px">
            <span style="color:var(--coral)">${latestVersion ? `LATEST · ${escapeHtml(latestVersion)}` : 'RELEASE LOG'}</span>
            <span class="hero-spec-sep">·</span>
            <span>${sections.length} RELEASES</span>
          </div>
          <h1>Changelog</h1>
          <p>${escapeHtml(introText)}</p>
        </div>
        <div class="cl-links">
          <a href="/download">Download latest →</a>
          <a href="https://github.com/m8524769/mermaid-code/releases">GitHub Releases</a>
          <a href="https://github.com/m8524769/mermaid-code/blob/main/CHANGELOG.md">Raw .md</a>
        </div>
      </div>

      <div class="timeline">
${renderedEntries}
      </div>
    </div>
  </section>
</main>

<footer class="site-footer">
  <div class="footer-inner footer-inner--narrow">
    <div class="footer-left">
      <img src="favicon.svg" alt="" width="18" height="18" />
      <span>Mermaid Code — Fork of <a href="https://github.com/mermaid-js/mermaid-live-editor">mermaid-live-editor</a></span>
    </div>
    <div class="footer-right">
      <a href="/">Home</a>
      <a href="/download">Download</a>
      <a href="https://github.com/m8524769/mermaid-code/releases">Releases</a>
      <a href="https://github.com/m8524769/mermaid-code/blob/main/CHANGELOG.md">Source</a>
      <a href="/llms.txt">llms.txt</a>
    </div>
  </div>
</footer>

<script src="site.js" defer></script>
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
