import { marked, type Renderer } from 'marked';
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
