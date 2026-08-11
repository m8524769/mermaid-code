import { Marked, marked, type Renderer } from 'marked';
import { getSingletonHighlighter } from 'shiki';

let highlighter: Awaited<ReturnType<typeof getSingletonHighlighter>> | null = null;

async function getHighlighter() {
  if (!highlighter) {
    highlighter = await getSingletonHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: [
        'typescript',
        'javascript',
        'rust',
        'python',
        'bash',
        'sh',
        'json',
        'yaml',
        'toml',
        'markdown',
        'html',
        'css',
        'svelte'
      ]
    });
  }
  return highlighter;
}

export async function renderMarkdown(text: string, dark = true): Promise<string> {
  const hl = await getHighlighter();
  const theme = dark ? 'github-dark' : 'github-light';

  const renderer: Partial<Renderer> = {
    code({ text: code, lang }) {
      const language = lang && hl.getLoadedLanguages().includes(lang as never) ? lang : 'text';
      return hl.codeToHtml(code, { lang: language, theme });
    }
  };

  marked.use({ renderer });
  return marked.parse(text) as string;
}

const _streamingMarked = new Marked({
  renderer: {
    code({ text: code }) {
      const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<pre class="my-2 overflow-x-auto rounded-lg bg-black/10 text-xs dark:bg-white/10"><code class="block p-2">${escaped}</code></pre>`;
    }
  } as Partial<Renderer>
});

export function renderMarkdownSync(text: string): string {
  return _streamingMarked.parse(text) as string;
}
