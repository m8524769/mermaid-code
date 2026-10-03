import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { version } from '../package.json';
import iconIndex from './icon-index.generated.json';

const MCP_HTTP_PORT = 37079;
const TAURI_PORT = 37078;
const TOKEN = process.env.MCP_TOKEN ?? '';

async function callMermaidCode(endpoint: string, body?: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${TAURI_PORT}${endpoint}`, {
      method: body !== undefined ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error(
      'Cannot connect to Mermaid Code. Make sure the app is running and MCP Server is enabled in the menu.'
    );
  }
  if (!res.ok) {
    throw new Error(`Mermaid Code returned ${res.status}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Shape of GET /context on the Tauri side (src-tauri/src/mcp.rs `ContextData`).
// Keys are snake_case (no serde rename) and Option fields serialize as null.
const contextSchema = z.object({
  folder: z.string().nullable(),
  files: z.array(z.object({ path: z.string(), name: z.string() })),
  active_tab: z
    .object({ path: z.string().nullable(), name: z.string(), is_draft: z.boolean() })
    .nullable()
});

// ── Icon search ──────────────────────────────────────────────────────────────
// Resolves icon concepts to exact `pack:name` refs from a names-only index built
// from the packs registered in the app (icon-index.generated.json ← gen-icon-index.ts).
type IconPack = { prefix: string; icons: string[] };
const ICON_PACKS = (iconIndex as { packs: IconPack[] }).packs;
// Pack priority for tie-breaks = order in the index (logos first, then fas/far/fab),
// so a tech query surfaces logos:kubernetes above fab:kubernetes, fas:user above far:user.
const PACK_RANK = new Map(ICON_PACKS.map((p, i) => [p.prefix, i] as const));

// Score an icon against a normalized term: 0 exact, 1 prefix, 2 substring, null = no
// match. A `*` makes it an ordered-substring glob (linear scan, no backtracking).
function scoreTerm(icon: string, term: string): number | null {
  if (term.includes('*')) {
    let idx = 0;
    let matched = false;
    for (const seg of term.split('*')) {
      if (!seg) continue;
      matched = true;
      const at = icon.indexOf(seg, idx);
      if (at === -1) return null;
      idx = at + seg.length;
    }
    return matched ? 2 : null; // a lone "*" has no literal to match → matches nothing
  }
  if (icon === term) return 0;
  if (icon.startsWith(term)) return 1;
  return icon.includes(term) ? 2 : null;
}

function searchIcons(terms: string, limit: number) {
  // Split the term string on any non-name character (whitespace, comma, pipe, slash, …)
  // into standalone words, keeping hyphens and `*` which are valid in icon names / globs.
  // LLMs emit synonyms as a free string with varying separators ("user users client",
  // "user,client", "a|b"); splitting on the complement of name chars tolerates all of
  // them without ever breaking a real single name, and "aws" still prefix-matches
  // "aws-s3". For an exact multi-word name, pass it hyphenated.
  const words = [
    ...new Set(
      terms
        .toLowerCase()
        .split(/[^a-z0-9*-]+/)
        .filter(Boolean)
    )
  ];
  const hits: { ref: string; pack: string; score: number; len: number }[] = [];
  for (const p of ICON_PACKS) {
    for (const icon of p.icons) {
      let best: number | null = null;
      for (const t of words) {
        const s = scoreTerm(icon, t);
        if (s !== null && (best === null || s < best)) best = s;
      }
      if (best !== null)
        hits.push({ ref: `${p.prefix}:${icon}`, pack: p.prefix, score: best, len: icon.length });
    }
  }
  hits.sort(
    (a, b) =>
      a.score - b.score ||
      (PACK_RANK.get(a.pack) ?? 99) - (PACK_RANK.get(b.pack) ?? 99) ||
      a.len - b.len ||
      a.ref.localeCompare(b.ref)
  );
  return { matches: hits.slice(0, limit).map((h) => h.ref), total: hits.length };
}

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'mermaid-code-mcp', version },
    {
      instructions:
        'This server lets you interact with the Mermaid Code desktop app. ' +
        'Use list_diagrams to get the currently open folder and active file before making changes. ' +
        'When modifying or creating .mmd/.mermaid files on the filesystem, do NOT call preview_diagram — ' +
        'Mermaid Code automatically detects file changes and refreshes the preview. ' +
        'Use preview_diagram only for temporary, unsaved previews in the Draft tab. ' +
        // Keep in sync with registerIconPacks in src/lib/util/mermaid.ts.
        'Available Iconify icon packs for `pack:name` diagram icons: ' +
        'logos, fas/far/fab (Font Awesome 7). When adding icons, call search_icons to resolve exact names.'
    }
  );

  server.registerTool(
    'preview_diagram',
    {
      description:
        'Preview Mermaid diagram code in the local Mermaid Code desktop app. Opens in the Draft tab and replaces any existing Draft content. To modify an existing diagram, first call list_diagrams to get the current file path, then read and modify the file directly.',
      inputSchema: z.object({ code: z.string().describe('Mermaid diagram code to preview') }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
    },
    async ({ code }) => {
      await callMermaidCode('/preview', { code });
      return { content: [{ type: 'text', text: 'Diagram preview updated in Mermaid Code.' }] };
    }
  );

  server.registerTool(
    'list_diagrams',
    {
      description:
        'Get the current context of the Mermaid Code app: the opened folder, list of .mmd files, and the active tab (path and name). Call this first to understand what diagrams exist and which file is currently active before creating or modifying diagrams.',
      inputSchema: z.object({}),
      outputSchema: contextSchema,
      annotations: { readOnlyHint: true }
    },
    async () => {
      const ctx = await callMermaidCode('/context');
      const structuredContent = contextSchema.parse(ctx);
      return {
        structuredContent,
        content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }]
      };
    }
  );

  server.registerTool(
    'search_icons',
    {
      description:
        "Resolve icon concepts to exact `pack:name` references that render in this app's diagrams " +
        '(flowchart icon shapes). Pass all concepts for a diagram in one call. ' +
        'For each concept put the likely names/aliases in `terms` ' +
        '(e.g. { label: "Kubernetes", terms: "kubernetes k8s" }). Each returned match is a ' +
        'complete, ready-to-use reference like "logos:kubernetes" — use it verbatim; it already ' +
        'includes the pack prefix, do not prepend anything.',
      inputSchema: z.object({
        queries: z
          .array(
            z.object({
              label: z.string().optional().describe('Concept name, echoed in results'),
              terms: z
                .string()
                .min(1)
                .describe(
                  'Candidate names/synonyms, space- or comma-separated, e.g. "user client person". ' +
                    'Each word is matched individually; hyphenate for an exact name like "aws-s3"'
                )
            })
          )
          .min(1),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe('Max matches per concept (default 10)')
      }),
      outputSchema: z.object({
        results: z.array(
          z.object({ label: z.string(), matches: z.array(z.string()), total: z.number() })
        )
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ queries, limit }) => {
      const results = queries.map((q) => {
        const { matches, total } = searchIcons(q.terms, limit ?? 10);
        return { label: q.label ?? q.terms, matches, total };
      });
      return {
        structuredContent: { results },
        content: [{ type: 'text', text: JSON.stringify({ results }, null, 2) }]
      };
    }
  );

  return server;
}

// Stateless Streamable HTTP — one transport per request
Bun.serve({
  hostname: '127.0.0.1',
  port: MCP_HTTP_PORT,
  async fetch(req: Request): Promise<Response> {
    // Reject browser-originated requests to prevent CSRF
    if (req.headers.get('origin')) {
      return new Response('Forbidden', { status: 403 });
    }
    const url = new URL(req.url);
    if (url.pathname === '/mcp') {
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });
      await createMcpServer().connect(transport);
      return transport.handleRequest(req);
    }
    if (url.pathname === '/shutdown') {
      setTimeout(() => process.exit(0), 100);
      return new Response('Shutting down', { status: 200 });
    }
    return new Response('Mermaid Code MCP Server', { status: 200 });
  }
});

console.log(`Mermaid Code MCP server listening on http://127.0.0.1:${MCP_HTTP_PORT}/mcp`);
