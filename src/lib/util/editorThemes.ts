import type * as Monaco from 'monaco-editor';

// Color schemes for the Monaco `mermaid` editor, kept here so the palette can be
// tweaked or swapped without touching the tokenizer/semantic-highlighting logic
// in monacoExtra.ts. To change the editor's colors, add a scheme to
// `editorColorSchemes` and point `activeScheme` at it.
export interface EditorColorScheme {
  dark: Monaco.editor.IStandaloneThemeData;
  light: Monaco.editor.IStandaloneThemeData;
}

// In every scheme the leading Monarch fallback tokens are painted to match their
// tree-sitter semantic role, so the fallback layer blends in with no color flicker
// when semantic tokens take over: typeKeyword/section → keyword, transition
// (arrows) → operator, identifier (node ids) → variable, annotation (<<...>>) →
// attribute, delimiter.bracket → punctuation. custom-error stays a distinct red.
//
// The remaining rules are the tree-sitter semantic token colors. A scheme only
// needs the base categories (keyword, comment, string, number, operator, variable,
// constant, type, namespace, property, function, punctuation, attribute, boolean).
// Dotted grammar captures (string.escape, punctuation.special, …) fall back to
// their base via Monaco's `.`-hierarchical matching; add an explicit rule only to
// override a specific one, as vscode does for keyword.operator / string.escape.
// The full capture list is query.captureNames (see treeSitterHighlight.ts).
export const editorColorSchemes = {
  // GitHub Dark/Light Default palette.
  github: {
    dark: {
      base: 'vs-dark',
      inherit: true,
      colors: {},
      rules: [
        { token: 'typeKeyword', foreground: 'ff7b72' },
        { token: 'transition', foreground: 'ff7b72' },
        { token: 'identifier', foreground: '79c0ff' },
        { token: 'annotation', foreground: '79c0ff' },
        { token: 'delimiter.bracket', foreground: '6e7681' },
        { token: 'custom-error', foreground: 'f85149', fontStyle: 'bold' },
        // tree-sitter semantic token colors — GitHub Dark Default palette.
        { token: 'keyword', foreground: 'ff7b72' },
        { token: 'comment', foreground: '8b949e' },
        { token: 'string', foreground: 'a5d6ff' },
        { token: 'number', foreground: '79c0ff' },
        { token: 'operator', foreground: 'ff7b72' },
        { token: 'variable', foreground: '79c0ff' },
        { token: 'constant', foreground: '79c0ff' },
        { token: 'type', foreground: 'ffa657' },
        { token: 'namespace', foreground: 'ffa657' },
        { token: 'property', foreground: '79c0ff' },
        { token: 'function', foreground: 'd2a8ff' },
        { token: 'punctuation', foreground: '6e7681' },
        { token: 'attribute', foreground: '79c0ff' },
        { token: 'boolean', foreground: 'ff7b72' }
      ]
    },
    light: {
      base: 'vs',
      inherit: true,
      colors: {},
      rules: [
        { token: 'typeKeyword', foreground: 'cf222e' },
        { token: 'custom-error', foreground: 'cf222e', fontStyle: 'bold' },
        { token: 'transition', foreground: 'cf222e' },
        { token: 'delimiter.bracket', foreground: '6e7781' },
        { token: 'annotation', foreground: '0550ae' },
        { token: 'identifier', foreground: '0550ae' },
        // tree-sitter semantic token colors — GitHub Light Default palette.
        { token: 'keyword', foreground: 'cf222e' },
        { token: 'comment', foreground: '6e7781' },
        { token: 'string', foreground: '0a3069' },
        { token: 'number', foreground: '0550ae' },
        { token: 'operator', foreground: 'cf222e' },
        { token: 'variable', foreground: '0550ae' },
        { token: 'constant', foreground: '0550ae' },
        { token: 'type', foreground: '953800' },
        { token: 'namespace', foreground: '953800' },
        { token: 'property', foreground: '0550ae' },
        { token: 'function', foreground: '8250df' },
        { token: 'punctuation', foreground: '6e7781' },
        { token: 'attribute', foreground: '0550ae' },
        { token: 'boolean', foreground: 'cf222e' }
      ]
    }
  },
  // VS Code Dark+/Light+ palette — the editor's original colors. Arrows/operators
  // (transition, operator) are kept neutral (default fg).
  vscode: {
    dark: {
      base: 'vs-dark',
      inherit: true,
      colors: {},
      rules: [
        { token: 'typeKeyword', foreground: '569cd6' },
        { token: 'transition', foreground: 'd4d4d4' },
        { token: 'identifier', foreground: '9cdcfe' },
        { token: 'annotation', foreground: '9cdcfe' },
        { token: 'delimiter.bracket', foreground: '808080' },
        { token: 'custom-error', foreground: 'ff0000', fontStyle: 'bold' },
        // tree-sitter semantic token colors — full VS Code Dark+ palette.
        { token: 'keyword', foreground: '569cd6' },
        { token: 'comment', foreground: '6a9955' },
        { token: 'string', foreground: 'ce9178' },
        { token: 'number', foreground: 'b5cea8' },
        { token: 'operator', foreground: 'd4d4d4' },
        { token: 'keyword.operator', foreground: 'd4d4d4' },
        { token: 'variable', foreground: '9cdcfe' },
        { token: 'constant', foreground: '4fc1ff' },
        { token: 'type', foreground: '4ec9b0' },
        { token: 'namespace', foreground: '4ec9b0' },
        { token: 'property', foreground: '9cdcfe' },
        { token: 'function', foreground: 'dcdcaa' },
        { token: 'punctuation', foreground: '808080' },
        { token: 'attribute', foreground: '9cdcfe' },
        { token: 'boolean', foreground: '569cd6' },
        { token: 'string.escape', foreground: 'd7ba7d' }
      ]
    },
    light: {
      base: 'vs',
      inherit: true,
      colors: {},
      rules: [
        { token: 'typeKeyword', foreground: '0000ff' },
        { token: 'custom-error', foreground: 'ff0000', fontStyle: 'bold' },
        { token: 'transition', foreground: '000000' },
        { token: 'delimiter.bracket', foreground: '808080' },
        { token: 'annotation', foreground: '001080' },
        { token: 'identifier', foreground: '001080' },
        // tree-sitter semantic token colors — full VS Code Light+ palette.
        { token: 'keyword', foreground: '0000ff' },
        { token: 'comment', foreground: '008000' },
        { token: 'string', foreground: 'a31515' },
        { token: 'number', foreground: '098658' },
        { token: 'operator', foreground: '000000' },
        { token: 'keyword.operator', foreground: '000000' },
        { token: 'variable', foreground: '001080' },
        { token: 'constant', foreground: '0070c1' },
        { token: 'type', foreground: '267f99' },
        { token: 'namespace', foreground: '267f99' },
        { token: 'property', foreground: '001080' },
        { token: 'function', foreground: '795e26' },
        { token: 'punctuation', foreground: '808080' },
        { token: 'attribute', foreground: '001080' },
        { token: 'boolean', foreground: '0000ff' },
        { token: 'string.escape', foreground: 'ee0000' }
      ]
    }
  }
} satisfies Record<string, EditorColorScheme>;

// The scheme currently in use, selected at build time via the MERMAID_EDITOR_SCHEME
// env var (see .env). Falls back to vscode when unset or set to an unknown name.
export const activeScheme: EditorColorScheme =
  editorColorSchemes[import.meta.env.MERMAID_EDITOR_SCHEME as keyof typeof editorColorSchemes] ??
  editorColorSchemes.vscode;
