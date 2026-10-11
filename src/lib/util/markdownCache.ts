import { renderMarkdown } from './markdown';

// Per-message cache for rendered markdown HTML, keyed by `${id}|${theme}`.
// Finalized messages have stable text, so caching by id + theme is safe; the
// streaming message renders via renderMarkdownSync (not cached) and only lands
// here once it finalizes (cache miss → render once). Cleared on session switch
// to avoid unbounded growth across sessions.
const cache = new Map<string, Promise<string>>();

export function renderMarkdownCached(id: string, text: string, dark: boolean): Promise<string> {
  const key = `${id}|${dark ? 'd' : 'l'}`;
  let html = cache.get(key);
  if (!html) {
    html = renderMarkdown(text, dark);
    cache.set(key, html);
  }
  return html;
}

export function clearMarkdownCache(): void {
  cache.clear();
}
