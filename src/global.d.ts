/// <reference types="@sveltejs/kit" />

// Monaco ships per-language NLS scripts that have no type declarations. Each
// only sets globalThis._VSCODE_NLS_MESSAGES as a side effect (see Editor.svelte).
declare module 'monaco-editor/esm/nls.messages.zh-cn.js';
