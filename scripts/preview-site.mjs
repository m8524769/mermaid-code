#!/usr/bin/env node
// Local static preview server for site/ with Cloudflare Pages-style clean URLs
// (/download -> download.html, /changelog -> changelog.html).
//
// Usage:
//   pnpm preview:site
//   PORT=8080 node scripts/preview-site.mjs

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = resolve(fileURLToPath(new URL('../site', import.meta.url)));
const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  let filePath = resolve(siteDir, relative);

  // Prevent path traversal outside site/
  if (!filePath.startsWith(siteDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  // Clean URL resolution (e.g. /download -> /download.html)
  if (!existsSync(filePath) && existsSync(`${filePath}.html`)) {
    filePath = `${filePath}.html`;
  } else if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    const indexFile = join(filePath, 'index.html');
    if (existsSync(indexFile)) filePath = indexFile;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const contentType = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  const base = `http://${host}:${port}`;
  console.log(`Mermaid Code site preview running:`);
  console.log(`  Home:      ${base}/`);
  console.log(`  Download:  ${base}/download`);
  console.log(`  Changelog: ${base}/changelog`);
});
