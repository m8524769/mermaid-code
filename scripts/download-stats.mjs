#!/usr/bin/env node
// Aggregate GitHub Release download counts and render a chart.
//
// Only real installers are counted as "downloads": the updater manifest
// (latest.json) and the macOS self-update payload (.app.tar.gz) are excluded
// because they are fetched by already-installed apps, not by new users. The
// latest.json total is reported separately as an "active install" proxy.
//
// Usage:
//   node scripts/download-stats.mjs            # -> download-stats.html + terminal table
//   node scripts/download-stats.mjs --out foo.html
//   node scripts/download-stats.mjs --open     # also open the HTML (macOS)
//   GITHUB_TOKEN=... node scripts/download-stats.mjs   # higher API rate limit
//
// Repo can be overridden with REPO=owner/name.

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO = process.env.REPO || 'm8524769/mermaid-code';
const OUT = argValue('--out') || 'download-stats.html';
const OPEN = process.argv.includes('--open');

// Map an asset filename to an installer-type label, or null to exclude it.
// Order matters: first match wins.
const TYPE_RULES = [
  [/\.dmg$/i, 'macOS (.dmg)'],
  [/\.msi$/i, 'Windows (.msi)'],
  [/[-_]setup\.exe$|\.exe$/i, 'Windows (.exe)'],
  [/\.deb$/i, 'Linux (.deb)'],
  [/\.AppImage$/i, 'Linux (.AppImage)'],
  [/\.rpm$/i, 'Linux (.rpm)']
];
// Assets fetched by installed apps, not new users — tracked separately.
const NON_INSTALL = [/^latest\.json$/i, /\.sig$/i, /\.app\.tar\.gz$/i];

// Homebrew's release CI (GitHub Actions) downloads the macOS .dmg on every
// release to compute its sha256 (x64 + aarch64 = 2 per version). These are
// automated, not real users, so subtract them from each version's .dmg count.
// Only applied from HOMEBREW_SINCE onward (when the cask was introduced).
// Set HOMEBREW_CI_DMG to 0 to disable, or raise if CI fetches more.
const MACOS_TYPE = 'macOS (.dmg)';
const HOMEBREW_CI_DMG = 2;
const HOMEBREW_SINCE = 'v0.3.4';

// Stable colour per type so the chart reads consistently across runs.
const COLORS = {
  'macOS (.dmg)': '#5b8def',
  'Windows (.msi)': '#3ecf8e',
  'Windows (.exe)': '#2fa574',
  'Linux (.deb)': '#f0a13b',
  'Linux (.AppImage)': '#e5673b',
  'Linux (.rpm)': '#c94f9c'
};

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function classify(name) {
  for (const rule of TYPE_RULES) if (rule[0].test(name)) return rule[1];
  return null;
}

function isNonInstall(name) {
  return NON_INSTALL.some((re) => re.test(name));
}

// Compare semver-ish tags ("v0.7.2", "0.3.13") ascending.
function semverCmp(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function fetchAllReleases() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'download-stats' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const releases = [];
  let url = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
  while (url) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(
        `GitHub API ${res.status} ${res.statusText}` +
          (res.status === 403 ? ' — rate limited; set GITHUB_TOKEN to raise the limit.' : '')
      );
    }
    releases.push(...(await res.json()));
    const link = res.headers.get('link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return releases;
}

function aggregate(releases) {
  const types = new Set();
  const perVersion = []; // { version, byType, total, polls, updates }
  let grandInstalls = 0;
  let grandPolls = 0;
  let grandUpdates = 0;
  let grandHomebrewCI = 0; // .dmg downloads attributed to Homebrew release CI

  for (const r of releases) {
    const version = r.tag_name;
    const byType = {};
    let polls = 0;
    let updates = 0; // macOS auto-update payload fetches (.app.tar.gz)
    for (const asset of r.assets || []) {
      if (/\.app\.tar\.gz$/i.test(asset.name)) {
        updates += asset.download_count;
        continue;
      }
      if (isNonInstall(asset.name)) {
        if (/^latest\.json$/i.test(asset.name)) polls += asset.download_count;
        continue;
      }
      const type = classify(asset.name);
      if (!type) continue; // unknown asset -> ignore
      types.add(type);
      byType[type] = (byType[type] || 0) + asset.download_count;
    }
    // Discount Homebrew CI's automated .dmg fetches (clamped at 0), only from
    // the release where the Homebrew cask was introduced.
    if (byType[MACOS_TYPE] && semverCmp(version, HOMEBREW_SINCE) >= 0) {
      const cut = Math.min(HOMEBREW_CI_DMG, byType[MACOS_TYPE]);
      byType[MACOS_TYPE] -= cut;
      grandHomebrewCI += cut;
    }
    const total = Object.values(byType).reduce((s, n) => s + n, 0);
    grandInstalls += total;
    grandPolls += polls;
    grandUpdates += updates;
    perVersion.push({ version, byType, total, polls, updates });
  }

  perVersion.sort((a, b) => semverCmp(a.version, b.version));
  // Order types by overall volume (largest stack segment first).
  const orderedTypes = [...types].sort((a, b) => totalOf(perVersion, b) - totalOf(perVersion, a));
  return { perVersion, orderedTypes, grandInstalls, grandPolls, grandUpdates, grandHomebrewCI };
}

function totalOf(perVersion, type) {
  return perVersion.reduce((s, v) => s + (v.byType[type] || 0), 0);
}

function printTable({
  perVersion,
  orderedTypes,
  grandInstalls,
  grandPolls,
  grandUpdates,
  grandHomebrewCI
}) {
  const rows = perVersion.filter((v) => v.total > 0);
  const vw = Math.max(7, ...rows.map((r) => r.version.length));
  const header = [
    'version'.padEnd(vw),
    ...orderedTypes.map((t) => t.padStart(16)),
    'TOTAL'.padStart(7)
  ];
  console.log(header.join('  '));
  console.log('-'.repeat(header.join('  ').length));
  for (const r of rows) {
    const cells = [
      r.version.padEnd(vw),
      ...orderedTypes.map((t) => String(r.byType[t] || 0).padStart(16)),
      String(r.total).padStart(7)
    ];
    console.log(cells.join('  '));
  }
  console.log('-'.repeat(header.join('  ').length));
  const totalsRow = [
    'TOTAL'.padEnd(vw),
    ...orderedTypes.map((t) => String(totalOf(perVersion, t)).padStart(16)),
    String(grandInstalls).padStart(7)
  ];
  console.log(totalsRow.join('  '));
  console.log(
    `\nReal installers: ${grandInstalls}` +
      `   |   latest.json update-checks (active-install proxy, excluded): ${grandPolls}` +
      `   |   macOS update events (.app.tar.gz, macOS-only): ${grandUpdates}`
  );
  console.log(
    `(macOS .dmg discounted by ${HOMEBREW_CI_DMG}/version for Homebrew CI — ${grandHomebrewCI} downloads removed)`
  );
}

function renderHtml(data) {
  const { perVersion, orderedTypes, grandInstalls, grandPolls, grandUpdates, grandHomebrewCI } =
    data;
  const rows = perVersion.filter((v) => v.total > 0 || v.updates > 0);
  const labels = rows.map((r) => r.version);
  const datasets = orderedTypes.map((type) => ({
    label: type,
    data: rows.map((r) => r.byType[type] || 0),
    backgroundColor: COLORS[type] || '#888',
    stack: 'installs',
    order: 2 // higher order = drawn first (below the line)
  }));
  // Overlay macOS update events as a line on a secondary axis — its scale (1–4)
  // is an order of magnitude below installer counts, so it needs its own axis.
  // Lower order than the bars so Chart.js draws it last (on top), with a white
  // point halo so it stays legible over the stacked columns.
  datasets.push({
    type: 'line',
    label: 'macOS updates (.app.tar.gz)',
    data: rows.map((r) => r.updates || 0),
    borderColor: '#e5484d',
    backgroundColor: '#e5484d',
    borderWidth: 2,
    yAxisID: 'y1',
    tension: 0.3,
    pointRadius: 3,
    pointBackgroundColor: '#e5484d',
    pointBorderColor: '#fff',
    pointBorderWidth: 1.5,
    order: 1
  });
  const typeTotals = orderedTypes.map((t) => totalOf(perVersion, t));

  const payload = JSON.stringify({ labels, datasets, orderedTypes, typeTotals, colors: COLORS });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${REPO} — download stats</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 0; padding: 32px;
         max-width: 1100px; margin-inline: auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #888; margin: 0 0 24px; }
  .cards { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 28px; }
  .card { border: 1px solid #8883; border-radius: 12px; padding: 16px 20px; min-width: 180px; }
  .card .n { font-size: 28px; font-weight: 700; }
  .card .l { color: #888; font-size: 13px; }
  .chart-wrap { position: relative; height: 420px; margin-bottom: 40px; }
  .chart-wrap.small { height: 300px; max-width: 420px; }
  .note { color: #888; font-size: 13px; border-left: 3px solid #8884; padding-left: 12px; }
  .links { display: flex; gap: 10px; flex-wrap: wrap; margin: 0 0 28px; }
  .links a { display: inline-flex; align-items: center; gap: 6px; text-decoration: none;
             font-size: 13px; color: inherit; border: 1px solid #8883; border-radius: 8px;
             padding: 6px 12px; }
  .links a:hover { border-color: #8886; background: #8881; }
  .links a::after { content: "↗"; color: #888; font-size: 11px; }
</style>
</head>
<body>
  <h1>${REPO}</h1>
  <p class="sub">Release download statistics · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</p>

  <nav class="links">
    <a href="https://github.com/${REPO}/graphs/traffic" target="_blank" rel="noopener">GitHub Traffic</a>
    <a href="https://dash.cloudflare.com/20aac98680debb413853c1a0adffe28f/mermaid-code.com/dashboards/d61f26dc-9f06-43c0-9bbf-4766bd4907f7" target="_blank" rel="noopener">Cloudflare Analytics</a>
    <a href="https://dash.cloudflare.com/20aac98680debb413853c1a0adffe28f/mermaid-code.com/ai/overview" target="_blank" rel="noopener">Cloudflare AI Crawlers</a>
  </nav>

  <div class="cards">
    <div class="card"><div class="n">${grandInstalls.toLocaleString()}</div><div class="l">Real installer downloads</div></div>
    <div class="card"><div class="n">${grandUpdates.toLocaleString()}</div><div class="l">macOS update events<br>(.app.tar.gz, macOS-only)</div></div>
    <div class="card"><div class="n">${grandPolls.toLocaleString()}</div><div class="l">latest.json update-checks<br>(active-install proxy, excluded)</div></div>
    <div class="card"><div class="n">${rows.length}</div><div class="l">Released versions with downloads</div></div>
  </div>

  <h2 style="font-size:16px">Downloads per version, by installer type <span style="color:#e5484d">— with macOS updates (line)</span></h2>
  <div class="chart-wrap"><canvas id="perVersion"></canvas></div>

  <h2 style="font-size:16px">Total by installer type</h2>
  <div class="chart-wrap small"><canvas id="byType"></canvas></div>

  <p class="note"><b>Installer downloads</b> count only real installers (.dmg/.msi/.exe/.deb/.AppImage/.rpm),
  the closest proxy for new installs. Fetches made by already-installed apps are tracked separately, not
  mixed in: <code>.app.tar.gz</code> (macOS self-update payload) is shown as the <b>macOS updates</b> line,
  and <code>latest.json</code> (updater manifest, polled on every update check) as the active-install
  proxy. On Windows/Linux, updates re-download the same installer artifacts as fresh installs, so they
  can't be separated. GitHub counts also include some bots (security scanners, mirrors), so treat installer
  totals as an upper bound. The macOS (.dmg) count is also reduced by ${HOMEBREW_CI_DMG} per version
  (${grandHomebrewCI} downloads total, from ${HOMEBREW_SINCE} onward) to remove Homebrew's release CI,
  which auto-downloads the .dmg to compute its checksum.</p>

<script>
  const D = ${payload};
  new Chart(document.getElementById('perVersion'), {
    type: 'bar',
    data: { labels: D.labels, datasets: D.datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Installer downloads' } },
        y1: {
          position: 'right',
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'macOS updates' },
          ticks: { precision: 0 }
        }
      },
      plugins: { tooltip: { mode: 'index' }, legend: { position: 'bottom' } }
    }
  });
  new Chart(document.getElementById('byType'), {
    type: 'doughnut',
    data: {
      labels: D.orderedTypes,
      datasets: [{ data: D.typeTotals, backgroundColor: D.orderedTypes.map((t) => D.colors[t] || '#888') }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
  });
</script>
</body>
</html>`;
}

async function main() {
  console.log(`Fetching releases for ${REPO}…`);
  const releases = await fetchAllReleases();
  const data = aggregate(releases);
  printTable(data);
  writeFileSync(OUT, renderHtml(data));
  console.log(`\n✓ Chart written to ${OUT}`);
  if (OPEN && process.platform === 'darwin') {
    try {
      execFileSync('open', [OUT]);
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
