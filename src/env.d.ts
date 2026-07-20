/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MERMAID_RENDERER_URL?: string;
  readonly MERMAID_KROKI_RENDERER_URL?: string;
  readonly MERMAID_DOCS_URL?: string;
  readonly MERMAID_DOMAIN?: string;
  readonly MERMAID_IS_ENABLED_MERMAID_CHART_LINKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
