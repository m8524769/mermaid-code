/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MERMAID_RENDERER_URL?: string;
  readonly MERMAID_KROKI_RENDERER_URL?: string;
  readonly MERMAID_DOCS_URL?: string;
  readonly MERMAID_DOMAIN?: string;
  readonly MERMAID_EDITOR_SCHEME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
