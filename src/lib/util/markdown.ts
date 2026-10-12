import DOMPurify from 'dompurify';
import { Marked, type Renderer } from 'marked';
import { getSingletonHighlighter } from 'shiki';

let highlighter: Awaited<ReturnType<typeof getSingletonHighlighter>> | null = null;
type Highlighter = Awaited<ReturnType<typeof getSingletonHighlighter>>;

async function getHighlighter() {
  if (!highlighter) {
    highlighter = await getSingletonHighlighter({
      themes: ['github-dark', 'github-light'],
      // Warm set: stack-agnostic languages that appear in almost any session
      // regardless of the user's project — shell commands, JSON tool
      // output/config, and Mermaid (this app's whole domain, so the agent emits
      // it constantly). Everything else is loaded lazily by ensureLangs().
      langs: ['bash', 'json', 'mermaid']
    });
  }
  return highlighter;
}

// Fenced-code info strings in the text (``` or ~~~, optionally indented).
const FENCE_LANG = /^[ \t]*(?:```|~~~)([\w#+-]+)/gm;

// Load any grammar used by a code fence that isn't already loaded. Unknown or
// misspelled languages reject and are swallowed, so the renderer falls back to
// plain 'text'. Shiki caches loaded grammars, so each language loads at most once.
async function ensureLangs(hl: Highlighter, text: string): Promise<void> {
  const loaded = new Set(hl.getLoadedLanguages());
  const wanted = new Set(
    [...text.matchAll(FENCE_LANG)].map((m) => m[1].toLowerCase()).filter((l) => !loaded.has(l))
  );
  if (wanted.size === 0) return;
  await Promise.all([...wanted].map((lang) => hl.loadLanguage(lang as never).catch(() => {})));
}

export async function renderMarkdown(text: string, dark = true): Promise<string> {
  const hl = await getHighlighter();
  await ensureLangs(hl, text);
  const theme = dark ? 'github-dark' : 'github-light';

  const renderer: Partial<Renderer> = {
    code({ text: code, lang }) {
      const id = lang?.toLowerCase();
      const language = id && hl.getLoadedLanguages().includes(id as never) ? id : 'text';
      return hl.codeToHtml(code, { lang: language, theme });
    }
  };

  // Local instance, not the global `marked`: marked.use() chains the renderer
  // onto a singleton, so calling it per render would retain a closure (capturing
  // `hl`/`theme`) on every call — an unbounded leak over a long session.
  const md = new Marked({ renderer });
  return DOMPurify.sanitize(md.parse(text) as string);
}

const _streamingMarked = new Marked({
  renderer: {
    code({ text: code }) {
      const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<pre class="my-2 overflow-x-auto rounded-lg text-xs"><code class="block px-3 py-2">${escaped}</code></pre>`;
    }
  } as Partial<Renderer>
});

export function renderMarkdownSync(text: string): string {
  return DOMPurify.sanitize(_streamingMarked.parse(text) as string);
}
