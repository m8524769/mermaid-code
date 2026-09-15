#!/usr/bin/env node
// Aggregate GitHub Release download counts and render a chart.
//
// Only real installers are counted as "downloads": the updater manifest
// (latest.json) and the macOS self-update payload (.app.tar.gz) are excluded
// because they are fetched by already-installed apps, not by new users. The
// latest.json total is reported separately as an "active install" proxy.
//
// Downloads and updater traffic now go through R2 (releases.mermaid-code.com),
// not GitHub — so GitHub's download_count is mostly the R2 mirror workflow, the
// Homebrew CI, and bots. If CF_API_TOKEN is set, the script also pulls the real
// per-file download counts from Cloudflare Analytics (edge traffic) and appends
// an R2 section. Without the token it behaves exactly as before (GitHub only).
//
// Usage:
//   node scripts/download-stats.mjs            # -> download-stats.html + terminal table
//   node scripts/download-stats.mjs --out foo.html
//   node scripts/download-stats.mjs --open     # also open the HTML (macOS)
//   node scripts/download-stats.mjs --days 7   # R2 window (default 7; Free-plan adaptive retention is ~8d)
//   GITHUB_TOKEN=... node scripts/download-stats.mjs   # higher API rate limit
//   CF_API_TOKEN=... node scripts/download-stats.mjs   # add real R2 download stats
//
// Repo can be overridden with REPO=owner/name; zone with CF_ZONE=example.com,
// or CF_ZONE_ID=<zone id> to skip the name lookup (needs only Analytics:Read).

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO = process.env.REPO || 'm8524769/mermaid-code';
const OUT = argValue('--out') || 'download-stats.html';
const OPEN = process.argv.includes('--open');

// R2 real-download stats (opt-in via CF_API_TOKEN). Users download from this
// Cloudflare custom domain now, so the edge request counts are the real signal.
const R2_HOST = 'releases.mermaid-code.com';
const CF_ZONE = process.env.CF_ZONE || 'mermaid-code.com';
// Zone id can be given directly (dashboard → zone → Overview → Zone ID) to skip
// the /zones name lookup, which needs Zone:Read on top of Analytics:Read.
const CF_ZONE_ID = process.env.CF_ZONE_ID || '';
const R2_DAYS = Number(argValue('--days') || process.env.R2_DAYS || 7);

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

// --- R2 (Cloudflare Analytics) --------------------------------------------

// Resolve a zone name to its zone tag (id), which the GraphQL API requires.
async function resolveZoneTag(token, zoneName) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(zoneName)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
  );
  if (!res.ok) throw new Error(`Cloudflare zones API ${res.status} ${res.statusText}`);
  const json = await res.json();
  const zone = json.result && json.result[0];
  if (!zone)
    throw new Error(
      `zone "${zoneName}" not found — the token can't read it. Either add Zone:Read to the token, ` +
        `or set CF_ZONE_ID=<zone id> (dashboard → zone → Overview → Zone ID) to skip this lookup.`
    );
  return zone.id;
}

const DAY_MS = 864e5;

// Per-path counts for the R2 host over a SINGLE window. Only the adaptive dataset
// exposes clientRequestPath, and it is sampled, so the true count is
// count * sampleInterval (≈1 at low volume). GET only (HEAD probes excluded);
// 200 only — 206 (range) responses are excluded because a single download can
// fan out into many range requests, which double-counts. Trade-off: a download
// served entirely via range (no 200) is missed, so this leans conservative.
async function fetchR2Day(token, zoneTag, since, until) {
  const query = `
    query($zoneTag:String!,$since:Time!,$until:Time!){
      viewer{ zones(filter:{zoneTag:$zoneTag}){
        httpRequestsAdaptiveGroups(
          limit:1000, orderBy:[count_DESC],
          filter:{ datetime_geq:$since, datetime_lt:$until,
            clientRequestHTTPHost:"${R2_HOST}",
            clientRequestHTTPMethodName:"GET",
            edgeResponseStatus_in:[200] }
        ){ count avg{ sampleInterval } sum{ edgeResponseBytes } dimensions{ clientRequestPath clientCountryName } }
      }}
    }`;
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { zoneTag, since, until } })
  });
  if (!res.ok) throw new Error(`Cloudflare GraphQL ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.errors && json.errors.length) {
    throw new Error(`Cloudflare GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  const groups = json.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups || [];
  return groups.map((g) => ({
    path: g.dimensions.clientRequestPath,
    country: g.dimensions.clientCountryName || 'XX',
    requests: Math.round(g.count * (g.avg.sampleInterval || 1)),
    bytes: g.sum.edgeResponseBytes || 0
  }));
}

// The adaptive dataset caps a single query at a 1-day span (Free plan), so walk
// the window one day at a time. Returns one entry per successful day so callers
// can build a daily trend; days beyond the plan's retention error out and are
// skipped and summarized, not fatal.
async function fetchR2Downloads(token, zoneTag, since, until) {
  const days = []; // [{ date, rows }]
  const t0 = new Date(since).getTime();
  const t1 = new Date(until).getTime();
  let failures = 0;
  let lastErr = null;
  for (let start = t0; start < t1; start += DAY_MS) {
    const end = Math.min(start + DAY_MS, t1);
    try {
      const rows = await fetchR2Day(
        token,
        zoneTag,
        new Date(start).toISOString(),
        new Date(end).toISOString()
      );
      days.push({ date: new Date(start).toISOString().slice(0, 10), rows });
    } catch (err) {
      failures++;
      lastErr = err;
    }
  }
  // Every day failing is a real error (bad token / zone), not just old data.
  if (failures && days.length === 0) throw lastErr;
  if (failures) {
    console.warn(
      `  (${failures} day(s) skipped — likely beyond this plan's analytics retention: ${lastErr?.message})`
    );
  }
  return days;
}

// Bucket R2 paths the same way as GitHub assets: /latest/* = website/manual
// downloads, /<version>/* = auto-updater, latest.json = update-checks, and the
// macOS self-update payload (.app.tar.gz) separately. Reuses classify()/isNonInstall().
// Also derives a per-day trend (polls vs downloads) and a by-country breakdown of
// installer downloads from the daily rows.
function aggregateR2(days) {
  const manual = {}; // byType
  const updater = {}; // byType
  const types = new Set();
  const byCountry = {}; // installer downloads by country code
  const daily = []; // [{ date, polls, downloads }]
  let polls = 0;
  let macUpdates = 0;
  for (const { date, rows } of days) {
    let dPolls = 0;
    let dDownloads = 0;
    for (const { path, country, requests } of rows) {
      const name = path.slice(path.lastIndexOf('/') + 1);
      if (/^latest\.json$/i.test(name)) {
        polls += requests;
        dPolls += requests;
        continue;
      }
      if (/\.app\.tar\.gz$/i.test(name)) {
        macUpdates += requests;
        continue;
      }
      if (isNonInstall(name)) continue; // .sig etc.
      const type = classify(name);
      if (!type) continue; // unknown path -> ignore
      types.add(type);
      const bucket = path.startsWith('/latest/') ? manual : updater;
      bucket[type] = (bucket[type] || 0) + requests;
      byCountry[country] = (byCountry[country] || 0) + requests;
      dDownloads += requests;
    }
    daily.push({ date, polls: dPolls, downloads: dDownloads });
  }
  daily.sort((a, b) => (a.date < b.date ? -1 : 1));
  const orderedTypes = [...types].sort(
    (a, b) => (manual[b] || 0) + (updater[b] || 0) - ((manual[a] || 0) + (updater[a] || 0))
  );
  const manualTotal = Object.values(manual).reduce((s, n) => s + n, 0);
  const updaterTotal = Object.values(updater).reduce((s, n) => s + n, 0);
  const countries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]); // [ [code, n], ... ] desc
  return {
    manual,
    updater,
    orderedTypes,
    manualTotal,
    updaterTotal,
    polls,
    macUpdates,
    daily,
    countries
  };
}

function printR2Table(r2, sinceISO, untilISO) {
  const { manual, updater, orderedTypes, manualTotal, updaterTotal, polls, macUpdates } = r2;
  console.log(
    `\n\n=== R2 real downloads (${sinceISO.slice(0, 10)} → ${untilISO.slice(0, 10)} UTC · ${R2_HOST}) ===`
  );
  if (!orderedTypes.length && !polls && !macUpdates) {
    console.log('(no R2 traffic in window — check token scope / retention / zone)');
    return;
  }
  const tw = Math.max(18, ...orderedTypes.map((t) => t.length));
  const header = [
    'type'.padEnd(tw),
    'Manual /latest/'.padStart(16),
    'Updater /<ver>/'.padStart(16),
    'TOTAL'.padStart(9)
  ];
  const line = '-'.repeat(header.join('  ').length);
  console.log(header.join('  '));
  console.log(line);
  for (const t of orderedTypes) {
    const m = manual[t] || 0;
    const u = updater[t] || 0;
    console.log(
      [t.padEnd(tw), String(m).padStart(16), String(u).padStart(16), String(m + u).padStart(9)].join(
        '  '
      )
    );
  }
  console.log(line);
  console.log(
    [
      'TOTAL'.padEnd(tw),
      String(manualTotal).padStart(16),
      String(updaterTotal).padStart(16),
      String(manualTotal + updaterTotal).padStart(9)
    ].join('  ')
  );
  console.log(
    `\nlatest.json update-checks (active-install proxy): ${polls}` +
      `   |   macOS update payload (.app.tar.gz): ${macUpdates}`
  );

  // Daily trend: update-checks (active-install proxy) vs installer downloads.
  const daily = r2.daily.filter((d) => d.polls || d.downloads);
  if (daily.length) {
    console.log('\n--- daily trend (date · update-checks · downloads) ---');
    for (const d of daily) {
      console.log(
        `${d.date}  ${String(d.polls).padStart(6)}  ${String(d.downloads).padStart(6)}`
      );
    }
  }

  // Installer downloads by country (top 10).
  if (r2.countries.length) {
    const dlTotal = manualTotal + updaterTotal || 1;
    console.log('\n--- installer downloads by country (top 10) ---');
    for (const [code, n] of r2.countries.slice(0, 10)) {
      const pct = ((n / dlTotal) * 100).toFixed(0);
      console.log(`${code.padEnd(4)} ${String(n).padStart(6)}  (${pct}%)`);
    }
  }

  console.log(
    '\n(edge requests, extrapolated by sampleInterval; 200-only GET, so 206 range requests are excluded; cache hits included, bots not filtered — upper bound)'
  );
}

function renderHtml(data) {
  const { perVersion, orderedTypes, grandInstalls, grandPolls, grandUpdates, grandHomebrewCI, r2, r2Window } =
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

  // Optional R2 section — only rendered when Cloudflare stats were fetched.
  let r2Cards = '';
  let r2Script = '';
  if (r2) {
    const topCountries = r2.countries.slice(0, 12);
    const r2Payload = JSON.stringify({
      labels: r2.orderedTypes,
      manual: r2.orderedTypes.map((t) => r2.manual[t] || 0),
      updater: r2.orderedTypes.map((t) => r2.updater[t] || 0),
      days: r2.daily.map((d) => d.date),
      dailyPolls: r2.daily.map((d) => d.polls),
      dailyDownloads: r2.daily.map((d) => d.downloads),
      countryLabels: topCountries.map((c) => c[0]),
      countryData: topCountries.map((c) => c[1])
    });
    r2Cards = `
  <h2 style="font-size:16px">R2 real downloads <span style="color:#888">— ${r2Window} UTC · Cloudflare edge</span></h2>
  <div class="cards">
    <div class="card"><div class="n">${r2.manualTotal.toLocaleString()}</div><div class="l">Manual downloads<br>(/latest/*, website)</div></div>
    <div class="card"><div class="n">${r2.updaterTotal.toLocaleString()}</div><div class="l">Updater fetches<br>(/&lt;version&gt;/*)</div></div>
    <div class="card"><div class="n">${r2.polls.toLocaleString()}</div><div class="l">Update-checks<br>(latest.json)</div></div>
    <div class="card"><div class="n">${r2.macUpdates.toLocaleString()}</div><div class="l">macOS update payload<br>(.app.tar.gz)</div></div>
  </div>
  <div class="chart-wrap"><canvas id="r2ByType"></canvas></div>
  <h2 style="font-size:16px">Daily trend <span style="color:#888">— update-checks (active-install proxy) vs downloads</span></h2>
  <div class="chart-wrap"><canvas id="r2Daily"></canvas></div>
  <h2 style="font-size:16px">Installer downloads by country <span style="color:#888">— top ${topCountries.length}</span></h2>
  <div class="chart-wrap small"><canvas id="r2Country"></canvas></div>
  <p class="note"><b>R2 (Cloudflare edge)</b> is where real users download now — the GitHub counts above are
  historical / mirror-CI / bots. These are edge HTTP requests over the window, extrapolated by Cloudflare's sample
  interval; only <code>200</code> GET responses are counted (<code>206</code> range requests are excluded to
  avoid double-counting a single download), cache hits are included, and bots are not filtered, so
  treat them as an upper bound. <code>/latest/*</code> = website/manual, <code>/&lt;version&gt;/*</code> = auto-updater.
  <b>Update-checks</b> (latest.json, polled by every running app) approximate the live install base; the country
  breakdown counts installer downloads only. Adding the country dimension splits the sampled dataset finer, so
  low-volume buckets are noisier.</p>`;
    r2Script = `
  const R = ${r2Payload};
  new Chart(document.getElementById('r2ByType'), {
    type: 'bar',
    data: { labels: R.labels, datasets: [
      { label: 'Manual (/latest/)', data: R.manual, backgroundColor: '#5b8def' },
      { label: 'Updater (/<version>/)', data: R.updater, backgroundColor: '#f0a13b' }
    ] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, title: { display: true, text: 'Downloads (edge requests)' } } },
      plugins: { tooltip: { mode: 'index' }, legend: { position: 'bottom' } }
    }
  });
  new Chart(document.getElementById('r2Daily'), {
    data: { labels: R.days, datasets: [
      { type: 'line', label: 'Update-checks (latest.json)', data: R.dailyPolls,
        borderColor: '#3ecf8e', backgroundColor: '#3ecf8e', tension: 0.3, pointRadius: 2, yAxisID: 'y' },
      { type: 'bar', label: 'Downloads', data: R.dailyDownloads, backgroundColor: '#5b8def', yAxisID: 'y1' }
    ] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, position: 'left', title: { display: true, text: 'Update-checks' } },
        y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false },
              title: { display: true, text: 'Downloads' }, ticks: { precision: 0 } }
      },
      plugins: { tooltip: { mode: 'index' }, legend: { position: 'bottom' } }
    }
  });
  new Chart(document.getElementById('r2Country'), {
    type: 'bar',
    data: { labels: R.countryLabels, datasets: [
      { label: 'Downloads', data: R.countryData, backgroundColor: '#7c5cbf' }
    ] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: { x: { beginAtZero: true } },
      plugins: { legend: { display: false } }
    }
  });`;
  }

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
${r2Cards}
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
${r2Script}
</script>
</body>
</html>`;
}

async function main() {
  console.log(`Fetching releases for ${REPO}…`);
  const releases = await fetchAllReleases();
  const data = aggregate(releases);
  printTable(data);

  // Opt-in: real R2 download stats from Cloudflare Analytics. Isolated in its
  // own try/catch so any failure (bad token, retention, network) degrades to
  // GitHub-only output instead of crashing.
  if (process.env.CF_API_TOKEN) {
    const until = new Date();
    const since = new Date(until.getTime() - R2_DAYS * 864e5);
    const sinceISO = since.toISOString();
    const untilISO = until.toISOString();
    try {
      console.log(`\nFetching R2 downloads from Cloudflare (last ${R2_DAYS}d · ${CF_ZONE})…`);
      const zoneTag = CF_ZONE_ID || (await resolveZoneTag(process.env.CF_API_TOKEN, CF_ZONE));
      const rows = await fetchR2Downloads(process.env.CF_API_TOKEN, zoneTag, sinceISO, untilISO);
      const r2 = aggregateR2(rows);
      printR2Table(r2, sinceISO, untilISO);
      data.r2 = r2;
      data.r2Window = `${sinceISO.slice(0, 10)} → ${untilISO.slice(0, 10)}`;
    } catch (err) {
      console.warn(`R2 stats skipped: ${err.message}`);
    }
  } else {
    console.log('\n(Tip: set CF_API_TOKEN to add real R2 download stats from Cloudflare Analytics.)');
  }

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
