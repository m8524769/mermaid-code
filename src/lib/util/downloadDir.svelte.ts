import { persisted } from './persist.svelte';

// User-chosen export directory for PNG/SVG downloads. `null` means "use the
// system default download folder". Persisted to localStorage so the choice
// survives restarts.
export const customDownloadDir = persisted<string | null>('mermaid-download-dir', null);
