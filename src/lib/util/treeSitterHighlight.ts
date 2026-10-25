// Tree-sitter powered semantic highlighting for Mermaid.
//
// This module turns Mermaid source into Monaco "semantic tokens" using the
// tolerant `tree-sitter-mermaid` grammar + its portable highlight query. It is
// layered on TOP of the existing Monarch tokenizer (see monacoExtra.ts): where
// tree-sitter produces a token the semantic color wins; everywhere else Monarch
// remains the fallback. This is why newer beta diagram types (mindmap, timeline,
// block-beta, ...) that Monarch never covered still get accurate highlighting.
//
// Everything runs in the browser via WebAssembly — no backend, no LSP.

import { Language, Parser, Query } from 'web-tree-sitter';
// Vite asset imports: `?url` yields a servable URL string, `?raw` the file text.
import wtsRuntimeWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url';
import mermaidLangWasmUrl from '@mermanjs/tree-sitter-mermaid/tree-sitter-mermaid.wasm?url';
import highlightsQuery from '@mermanjs/tree-sitter-mermaid/queries/portable/highlights.scm?raw';

// The semantic-token legend is the set of capture names the grammar emits
// (`query.captureNames`), handed to Monaco as-is. Monaco encodes the INDEX in the
// token stream and resolves the NAME against the theme by HIERARCHICAL matching
// (splitting on `.`), so a dotted capture like `string.special` falls back to its
// `string` rule. editorThemes.ts therefore only defines the base categories plus
// the few captures whose color must deviate from that base (e.g. string.escape);
// every other capture resolves through the fallback.
//
// Populated once the query loads (see ensureReady); empty until then, but Monaco
// reads the legend only after provideDocumentSemanticTokens resolves — which
// awaits ensureReady — so the empty value is never observed.
let legend: string[] = [];
let captureIndex = new Map<string, number>();

// The legend Monaco encodes token-type indices against. Wired into the
// provider's getLegend() in monacoExtra.ts.
export function getSemanticTokenTypes(): string[] {
  return legend;
}

interface TreeSitterContext {
  parser: Parser;
  query: Query;
}

// Lazy singleton. First call kicks off wasm loading; the editor first paint is
// never blocked because Monaco only asks for semantic tokens after the model
// exists. On failure we reset so a later call can retry, and the provider simply
// falls back to Monarch highlighting.
let readyPromise: Promise<TreeSitterContext> | null = null;

export function ensureReady(): Promise<TreeSitterContext> {
  if (!readyPromise) {
    readyPromise = (async () => {
      // `locateFile` tells the Emscripten runtime where its own .wasm lives.
      await Parser.init({ locateFile: () => wtsRuntimeWasmUrl });
      const language = await Language.load(mermaidLangWasmUrl);
      const parser = new Parser();
      parser.setLanguage(language);
      const query = new Query(language, highlightsQuery);
      legend = [...query.captureNames];
      captureIndex = new Map(legend.map((name, index) => [name, index]));
      return { parser, query };
    })().catch((error: unknown) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

// A single-line highlight span in Monaco coordinates (0-based line, 0-based
// UTF-16 char column). tree-sitter already reports row/column/index in UTF-16
// code units when parsing a JS string, so no byte conversion is needed — CJK
// labels align correctly.
interface RawToken {
  line: number;
  char: number;
  length: number;
  typeIndex: number;
}

// Parse `text` and encode Monaco semantic tokens in the delta format:
// [deltaLine, deltaStartChar, length, tokenTypeIndex, tokenModifiers].
export async function computeSemanticTokens(text: string): Promise<Uint32Array> {
  const { parser, query } = await ensureReady();

  const tree = parser.parse(text);
  if (!tree) {
    return new Uint32Array();
  }

  let raw: RawToken[];
  try {
    const captures = query.captures(tree.rootNode);
    const lineLengths = text.split('\n').map((line) => line.length);
    raw = [];

    for (const { name, node } of captures) {
      const typeIndex = captureIndex.get(name);
      if (typeIndex === undefined) {
        continue; // not a highlight capture (unexpected for a query capture)
      }
      const { startPosition: start, endPosition: end } = node;

      if (start.row === end.row) {
        if (end.column > start.column) {
          raw.push({
            line: start.row,
            char: start.column,
            length: end.column - start.column,
            typeIndex
          });
        }
        continue;
      }

      // Monaco tokens must be single-line: split a multi-line capture per row.
      for (let row = start.row; row <= end.row; row++) {
        const from = row === start.row ? start.column : 0;
        const to = row === end.row ? end.column : (lineLengths[row] ?? from);
        if (to > from) {
          raw.push({ line: row, char: from, length: to - from, typeIndex });
        }
      }
    }
  } finally {
    // Free the wasm-heap tree; parser and query are reused across calls.
    tree.delete();
  }

  // Resolve overlaps with "innermost wins". Some highlight queries tag a whole
  // multi-line construct with a coarse type — e.g. the C4 grammar captures an
  // entire `Enterprise_Boundary(...) { ... }` block as punctuation.bracket. If
  // the widest span won, it would drown the string/type/variable colors inside.
  // So we paint each line and let the NARROWER (more specific) capture overwrite
  // the wider one, matching standard tree-sitter highlighting semantics.
  const byLine = new Map<number, RawToken[]>();
  for (const token of raw) {
    let bucket = byLine.get(token.line);
    if (!bucket) {
      bucket = [];
      byLine.set(token.line, bucket);
    }
    bucket.push(token);
  }

  const resolved: RawToken[] = [];
  for (const [line, tokens] of byLine) {
    // Paint widest-first so the narrowest capture at each column wins.
    tokens.sort((a, b) => b.length - a.length);
    let width = 0;
    for (const token of tokens) {
      width = Math.max(width, token.char + token.length);
    }
    const cover = new Int32Array(width).fill(-1);
    for (const token of tokens) {
      cover.fill(token.typeIndex, token.char, token.char + token.length);
    }
    // Coalesce runs of equal type into single spans.
    for (let i = 0; i < width;) {
      if (cover[i] === -1) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < width && cover[j] === cover[i]) {
        j++;
      }
      resolved.push({ line, char: i, length: j - i, typeIndex: cover[i] });
      i = j;
    }
  }

  // Order the (now strictly non-overlapping) spans and delta-encode them.
  resolved.sort((a, b) => a.line - b.line || a.char - b.char);

  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;

  for (const token of resolved) {
    const deltaLine = token.line - prevLine;
    const deltaChar = deltaLine === 0 ? token.char - prevChar : token.char;
    data.push(deltaLine, deltaChar, token.length, token.typeIndex, 0);
    prevLine = token.line;
    prevChar = token.char;
  }

  return new Uint32Array(data);
}
