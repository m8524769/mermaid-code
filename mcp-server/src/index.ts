import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { version } from '../package.json';

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

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'mermaid-code-mcp', version },
    {
      instructions:
        'This server lets you interact with the Mermaid Code desktop app. ' +
        'Use list_diagrams to get the currently open folder and active file before making changes. ' +
        'When modifying or creating .mmd/.mermaid files on the filesystem, do NOT call preview_diagram — ' +
        'Mermaid Code automatically detects file changes and refreshes the preview. ' +
        'Use preview_diagram only for temporary, unsaved previews in the Draft tab.'
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
      annotations: { readOnlyHint: true }
    },
    async () => {
      const ctx = await callMermaidCode('/context');
      return { content: [{ type: 'text', text: JSON.stringify(ctx, null, 2) }] };
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
      setTimeout(() => Bun.exit(0), 100);
      return new Response('Shutting down', { status: 200 });
    }
    return new Response('Mermaid Code MCP Server', { status: 200 });
  }
});

console.log(`Mermaid Code MCP server listening on http://127.0.0.1:${MCP_HTTP_PORT}/mcp`);
