export const env = {
  docsUrl: import.meta.env.MERMAID_DOCS_URL ?? 'https://mermaid.js.org',
  domain: import.meta.env.MERMAID_DOMAIN ?? '',
  krokiRendererUrl: import.meta.env.MERMAID_KROKI_RENDERER_URL ?? '',
  rendererUrl: import.meta.env.MERMAID_RENDERER_URL ?? ''
} as const;
