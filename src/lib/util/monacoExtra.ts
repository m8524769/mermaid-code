// Modified from https://github.com/Yash-Singh1/monaco-mermaid/blob/main/index.ts

import type * as Monaco from 'monaco-editor';
import {
  computeSemanticTokens,
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES
} from './treeSitterHighlight';

const commentRegex = /(?<!["'])%%(?![^"']*["']\)).*$/;

const SEMANTIC_LEGEND: Monaco.languages.SemanticTokensLegend = {
  tokenTypes: [...SEMANTIC_TOKEN_TYPES],
  tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS]
};

// Matches CSS colors used in Mermaid `style`/`classDef` statements: hex
// (#RGB / #RGBA / #RRGGBB / #RRGGBBAA) and rgb()/rgba(). The negative lookahead
// stops a 6-digit hex from being matched as a 3-digit one plus trailing chars.
const COLOR_REGEX =
  '#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])|rgba?\\([^)]*\\)';

// Parse a color literal into Monaco's IColor (channels in the 0..1 range).
const parseColor = (text: string): Monaco.languages.IColor | null => {
  if (text.startsWith('#')) {
    let hex = text.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = [...hex].map((c) => c + c).join('');
    }
    const red = parseInt(hex.slice(0, 2), 16) / 255;
    const green = parseInt(hex.slice(2, 4), 16) / 255;
    const blue = parseInt(hex.slice(4, 6), 16) / 255;
    const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { red, green, blue, alpha };
  }
  const parts = text
    .slice(text.indexOf('(') + 1, text.lastIndexOf(')'))
    .split(',')
    .map((p) => p.trim());
  if (parts.length < 3) {
    return null;
  }
  const [r, g, b, a] = parts;
  const red = Number(r) / 255;
  const green = Number(g) / 255;
  const blue = Number(b) / 255;
  const alpha = a === undefined ? 1 : Number(a);
  // Bail on percentages / malformed channels (e.g. `rgb(100%,0%,0%)`) rather
  // than handing Monaco an IColor with NaN channels, which breaks the swatch.
  if ([red, green, blue, alpha].some(Number.isNaN)) {
    return null;
  }
  return { red, green, blue, alpha };
};

// Format an IColor back to a hex string (adds the alpha byte only when < 1).
const colorToHex = ({ red, green, blue, alpha }: Monaco.languages.IColor): string => {
  const byte = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, '0');
  const base = `#${byte(red)}${byte(green)}${byte(blue)}`;
  return alpha < 1 ? `${base}${byte(alpha)}` : base;
};

export const initEditor = (monacoEditor: typeof Monaco): void => {
  monacoEditor.languages.register({ id: 'mermaid' });
  const requirementDiagrams = [
    'requirement',
    'functionalRequirement',
    'interfaceRequirement',
    'performanceRequirement',
    'physicalRequirement',
    'designConstraint'
  ];
  const keywords: Record<
    string,
    {
      typeKeywords: string[];
      blockKeywords: string[];
      keywords: string[];
    }
  > = {
    c4Diagram: {
      blockKeywords: [
        'Boundary',
        'Enterprise_Boundary',
        'System_Boundary',
        'Container_Boundary',
        'Node',
        'Node_L',
        'Node_R'
      ],
      keywords: [
        'title',
        'accDescription',
        'direction',
        'TB',
        'BT',
        'RL',
        'LR',
        'Person_Ext',
        'Person',
        'SystemQueue_Ext',
        'SystemDb_Ext',
        'System_Ext',
        'SystemQueue',
        'SystemDb',
        'System',
        'ContainerQueue_Ext',
        'ContainerDb_Ext',
        'Container_Ext',
        'ContainerQueue',
        'ContainerDb',
        'Container',
        'ComponentQueue_Ext',
        'ComponentDb_Ext',
        'Component_Ext',
        'ComponentQueue',
        'ComponentDb',
        'Component',
        'Deployment_Node',
        'Rel',
        'BiRel',
        'Rel_Up',
        'Rel_U',
        'Rel_Down',
        'Rel_D',
        'Rel_Left',
        'Rel_L',
        'Rel_Right',
        'Rel_R',
        'Rel_Back',
        'RelIndex'
      ],
      typeKeywords: ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment']
    },
    classDiagram: {
      blockKeywords: ['class'],
      keywords: [
        'link',
        'click',
        'callback',
        'call',
        'href',
        'cssClass',
        'direction',
        'TB',
        'BT',
        'RL',
        'LR',
        'title',
        'accDescription',
        'order'
      ],
      typeKeywords: ['classDiagram', 'classDiagram-v2']
    },
    erDiagram: {
      blockKeywords: [],
      keywords: ['title', 'accDescription'],
      typeKeywords: ['erDiagram']
    },
    flowchart: {
      blockKeywords: ['subgraph', 'end'],
      keywords: [
        'TB',
        'TD',
        'BT',
        'RL',
        'LR',
        'click',
        'call',
        'href',
        '_self',
        '_blank',
        '_parent',
        '_top',
        'linkStyle',
        'style',
        'classDef',
        'class',
        'direction',
        'interpolate'
      ],
      typeKeywords: ['flowchart', 'flowchart-v2', 'graph']
    },
    gantt: {
      blockKeywords: [],
      keywords: [
        'title',
        'dateFormat',
        'axisFormat',
        'todayMarker',
        'section',
        'excludes',
        'inclusiveEndDates'
      ],
      typeKeywords: ['gantt']
    },
    gitGraph: {
      blockKeywords: [],
      keywords: [
        'accTitle',
        'accDescr',
        'commit',
        'cherry-pick',
        'branch',
        'merge',
        'reset',
        'checkout',
        'LR',
        'BT',
        'id',
        'msg',
        'type',
        'tag',
        'NORMAL',
        'REVERSE',
        'HIGHLIGHT'
      ],
      typeKeywords: ['gitGraph']
    },
    info: {
      blockKeywords: [],
      keywords: ['showInfo'],
      typeKeywords: ['info']
    },
    journey: {
      blockKeywords: ['section'],
      keywords: ['title'],
      typeKeywords: ['journey']
    },
    pie: {
      blockKeywords: [],
      keywords: ['showData', 'title', 'accDescr', 'accTitle'],
      typeKeywords: ['pie']
    },
    requirementDiagram: {
      blockKeywords: [...requirementDiagrams, 'element'],
      keywords: [],
      typeKeywords: ['requirement', 'requirementDiagram']
    },
    sankey: {
      blockKeywords: [],
      keywords: [],
      typeKeywords: ['sankey-beta']
    },
    sequenceDiagram: {
      blockKeywords: ['alt', 'par', 'and', 'loop', 'else', 'end', 'rect', 'opt', 'alt', 'rect'],
      keywords: [
        'participant',
        'as',
        'Note',
        'note',
        'right of',
        'left of',
        'over',
        'activate',
        'deactivate',
        'autonumber',
        'title',
        'actor',
        'accDescription',
        'link',
        'links'
      ],
      typeKeywords: ['sequenceDiagram']
    },
    stateDiagram: {
      blockKeywords: ['state', 'note', 'end'],
      keywords: ['state', 'as', 'hide empty description', 'direction', 'TB', 'BT', 'RL', 'LR'],
      typeKeywords: ['stateDiagram', 'stateDiagram-v2']
    }
  };

  const configDirectiveHandler = [
    /^\s*%%(?={)/,
    {
      next: '@configDirective',
      nextEmbedded: 'javascript',
      token: 'string'
    }
  ] as Monaco.languages.IShortMonarchLanguageRule1;

  // Register a tokens provider for the mermaid language
  monacoEditor.languages.setMonarchTokensProvider('mermaid', {
    ...Object.entries(keywords)
      .map((entry) =>
        Object.fromEntries(
          Object.entries(entry[1]).map((deepEntry) => [
            entry[0] + deepEntry[0][0].toUpperCase() + deepEntry[0].slice(1),
            deepEntry[1]
          ])
        )
      )
      .reduce(
        (overallKeywords, nextKeyword) => ({
          ...overallKeywords,
          ...nextKeyword
        }),
        {}
      ),
    // Monaco Monarch uses the FIRST tokenizer state as the initial state unless
    // `start` is set. Our states are spread in alphabetical order, so without
    // this the lexer would start (and get stuck) in `c4Diagram` — never reaching
    // `root`, so diagram-type detection and every per-diagram state never fire.
    start: 'root',
    tokenizer: {
      c4Diagram: [
        configDirectiveHandler,
        [/(title|accDescription)(.*$)/, ['keyword', 'string']],
        [/\(/, { next: 'c4DiagramParenthesis', token: 'delimiter.bracket' }],
        [
          /[A-Z_a-z-][\w$]*/,
          {
            cases: {
              '@c4DiagramBlockKeywords': 'typeKeyword',
              '@c4DiagramKeywords': 'keyword',
              '@default': 'variable'
            }
          }
        ],
        [commentRegex, 'comment']
      ],
      c4DiagramParenthesis: [
        [/,/, 'delimiter.bracket'],
        [/\)/, { next: '@pop', token: 'delimiter.bracket' }],
        [/[^),]/, 'string']
      ],
      classDiagram: [
        configDirectiveHandler,
        [/(^\s*(?:title|accDescription))(\s+.*$)/, ['keyword', 'string']],
        [
          /(\*|<\|?|o|)(--|\.\.)(\*|\|?>|o|)([\t ]*[A-Za-z]+[\t ]*)(:)(.*?$)/,
          ['transition', 'transition', 'transition', 'variable', 'delimiter.bracket', 'string']
        ],
        [/(?!class\s)([A-Za-z]+)(\s+[A-Za-z]+)/, ['type', 'variable']],
        [/(\*|<\|?|o)?(--|\.\.)(\*|\|?>|o)?/, 'transition'],
        [/^\s*class\s(?!.*{)/, 'keyword'],
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@classDiagramBlockKeywords': 'typeKeyword',
              '@classDiagramKeywords': 'keyword',
              '@default': 'variable'
            }
          }
        ],
        [commentRegex, 'comment'],
        [/(<<)(.+?)(>>)/, ['delimiter.bracket', 'annotation', 'delimiter.bracket']],
        [/".*?"/, 'string'],
        [/:::/, 'transition'],
        [/:|\+|-|#|~|\*\s*$|\$\s*$|\(|\)|{|}/, 'delimiter.bracket']
      ],
      configDirective: [[/%%$/, { next: '@pop', nextEmbedded: '@pop', token: 'string' }]],
      erDiagram: [
        configDirectiveHandler,
        [/(title|accDescription)(.*$)/, ['keyword', 'string']],
        [/[|}][o|](--|\.\.)[o|][{|]/, 'transition'],
        [/".*?"/, 'string'],
        [/(:)(.*?$)/, ['delimiter.bracket', 'string']],
        [/[:{}]/, 'delimiter.bracket'],
        [/([A-Za-z]+)(\s+[A-Za-z]+)/, ['type', 'variable']],
        [commentRegex, 'comment'],
        [/[A-Z_a-z-][\w$]*/, 'variable']
      ],
      flowchart: [
        configDirectiveHandler,
        [/[ox]?(--+|==+)[ox]/, 'transition'],
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@default': 'variable',
              '@flowchartBlockKeywords': 'typeKeyword',
              '@flowchartKeywords': 'keyword'
            }
          }
        ],
        [/\|+.+?\|+/, 'string'],
        [/\[+(\\.+?[/\\]|\/.+?[/\\])]+/, 'string'],
        [/[>[]+[^[\]|]+?]+/, 'string'],
        [/{+.+?}+/, 'string'],
        [/\(+.+?\)+/, 'string'],
        [/-\.+->?/, 'transition'],
        [/(-[.-])([^>-][^-]+?)(-{3,}|-{2,}>|\.-+>)/, ['transition', 'string', 'transition']],
        [/(==+)([^=]+?)(={3,}|={2,}>)/, ['transition', 'string', 'transition']],
        [/<?(--+|==+)>|===+|---+/, 'transition'],
        [/:::/, 'transition'],
        [/[&;]/, 'delimiter.bracket'],
        [/".*?"/, 'string'],
        [commentRegex, 'comment']
      ],
      gantt: [
        configDirectiveHandler,
        [/(title)(.*)/, ['keyword', 'string']],
        [/(section)(.*)/, ['typeKeyword', 'string']],
        [/^\s*([^\n:]*?)(:)/, ['string', 'delimiter.bracket']],
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@ganttBlockKeywords': 'typeKeyword',
              '@ganttKeywords': 'keyword'
            }
          }
        ],
        [commentRegex, 'comment'],
        [/:/, 'delimiter.bracket']
      ],
      gitGraph: [
        configDirectiveHandler,
        [/option(?=s)/, { next: 'optionsGitGraph', token: 'typeKeyword' }],
        [/(accTitle|accDescr)(\s*:)(\s*[^\n\r]+$)/, ['keyword', 'delimiter.bracket', 'string']],
        [
          /(^\s*branch)(.*?)(\s+order)(:\s*)(\d+\s*$)/,
          ['keyword', 'variable', 'keyword', 'delimiter.bracket', 'number']
        ],
        [/".*?"/, 'string'],
        [
          /(^\s*)(branch|reset|merge|checkout)(\s*\S+)/m,
          ['delimiter.bracket', 'keyword', 'variable']
        ],
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@gitGraphBlockKeywords': 'typeKeyword',
              '@gitGraphKeywords': 'keyword'
            }
          }
        ],
        [commentRegex, 'comment'],
        [/\^/, 'delimiter.bracket']
      ],
      info: [
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@infoBlockKeywords': 'typeKeyword',
              '@infoKeywords': 'keyword'
            }
          }
        ]
      ],
      journey: [
        configDirectiveHandler,
        [/(title)(.*)/, ['keyword', 'string']],
        [/(section)(.*)/, ['typeKeyword', 'string']],
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@default': 'variable',
              '@journeyBlockKeywords': 'typeKeyword',
              '@journeyKeywords': 'keyword'
            }
          }
        ],
        [
          /(^\s*.+?)(:)(.*?)(:)(.*?)([$,])/,
          [
            'string',
            'delimiter.bracket',
            'number',
            'delimiter.bracket',
            'variable',
            'delimiter.bracket'
          ]
        ],
        [/,/, 'delimiter.bracket'],
        [/(^\s*.+?)(:)([^:]*?)$/, ['string', 'delimiter.bracket', 'variable']],
        [commentRegex, 'comment']
      ],
      optionsGitGraph: [
        [
          /s$/,
          {
            nextEmbedded: 'json',
            token: 'typeKeyword'
          }
        ],
        ['end', { next: '@pop', nextEmbedded: '@pop', token: 'typeKeyword' }]
      ],
      pie: [
        configDirectiveHandler,
        [/(title|accDescription)(.*$)/, ['keyword', 'string']],
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@pieBlockKeywords': 'typeKeyword',
              '@pieKeywords': 'keyword'
            }
          }
        ],
        [/".*?"/, 'string'],
        [/\s*\d+/, 'number'],
        [/:/, 'delimiter.bracket'],
        [commentRegex, 'comment']
      ],
      requirementDiagram: [
        configDirectiveHandler,
        [/->|<-|-/, 'transition'],
        [/(\d+\.)*\d+/, 'number'],
        [
          /[A-Z_a-z-][\w$]*/,
          {
            cases: {
              '@default': 'variable',
              '@requirementDiagramBlockKeywords': 'typeKeyword'
            }
          }
        ],
        [/[/:{}]/, 'delimiter.bracket'],
        [commentRegex, 'comment'],
        [/".*?"/, 'string']
      ],
      root: [
        [/^\s*gitGraph/m, 'typeKeyword', 'gitGraph'],
        [/^\s*info/m, 'typeKeyword', 'info'],
        [/^\s*pie/m, 'typeKeyword', 'pie'],
        [/^\s*(flowchart|flowchart-v2|graph)/m, 'typeKeyword', 'flowchart'],
        [/^\s*sequenceDiagram/, 'typeKeyword', 'sequenceDiagram'],
        [/^\s*classDiagram(-v2)?/, 'typeKeyword', 'classDiagram'],
        [/^\s*journey/, 'typeKeyword', 'journey'],
        [/^\s*gantt/, 'typeKeyword', 'gantt'],
        [/^\s*stateDiagram(-v2)?/, 'typeKeyword', 'stateDiagram'],
        [/^\s*er(Diagram)?/, 'typeKeyword', 'erDiagram'],
        [/^\s*requirement(Diagram)?/, 'typeKeyword', 'requirementDiagram'],
        [/^\s*sankey-beta/m, 'typeKeyword', 'sankey'],
        [
          /^\s*(C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)/m,
          'typeKeyword',
          'c4Diagram'
        ],
        configDirectiveHandler,
        [/%%[^${].*$/, 'comment']
      ],
      sankey: [
        configDirectiveHandler,
        [/(title)(.*)/, ['keyword', 'string']],
        [/(accTitle|accDescr)(\s*:)(\s*[^\n\r]+$)/, ['keyword', 'delimiter.bracket', 'string']],
        [/".*?"/, 'string'],
        [/[A-Za-z]+/, 'string'],
        [/\s*\d+/, 'number'],
        [/,/, 'delimiter.bracket'],
        [commentRegex, 'comment']
      ],
      sequenceDiagram: [
        configDirectiveHandler,
        [/(title:?|accDescription)([^\n\r;]*$)/, ['keyword', 'string']],
        [/(autonumber)([^\S\n\r]+off[^\S\n\r]*$)/, ['keyword', 'keyword']],
        [/(autonumber)((?:[^\S\n\r]+\d+){2}[^\S\n\r]*$)/, ['keyword', 'number']],
        [/(autonumber)([^\S\n\r]+\d+[^\S\n\r]*$)/, ['keyword', 'number']],
        [
          /(link\s+)(.*?)(:)(\s*.*?)(\s*@)(\s*[^\n\r;]+)/,
          ['keyword', 'variable', 'delimiter.bracket', 'string', 'delimiter.bracket', 'string']
        ],
        [
          /((?:links|properties)\s+)([^\n\r:]*?)(:\s+)/,
          [
            { token: 'keyword' },
            { token: 'variable' },
            {
              next: '@sequenceDiagramLinksProps',
              nextEmbedded: 'javascript',
              token: 'delimiter.bracket'
            }
          ]
        ],
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@default': 'variable',
              '@sequenceDiagramBlockKeywords': 'typeKeyword',
              '@sequenceDiagramKeywords': 'keyword'
            }
          }
        ],
        [/(--?>?>|--?[)x])[+-]?/, 'transition'],
        [/(:)([^\n:]*?$)/, ['delimiter.bracket', 'string']],
        [commentRegex, 'comment']
      ],
      sequenceDiagramLinksProps: [
        // [/^:/, { token: 'delimiter.bracket', nextEmbedded: 'json' }],
        [/$|;/, { next: '@pop', nextEmbedded: '@pop', token: 'delimiter.bracket' }]
      ],
      stateDiagram: [
        configDirectiveHandler,
        [/note[^:]*$/, { next: 'stateDiagramNote', token: 'typeKeyword' }],
        ['hide empty description', 'keyword'],
        [/^\s*state\s(?!.*{)/, 'keyword'],
        [/(<<)(fork|join|choice)(>>)/, 'annotation'],
        [/(\[\[)(fork|join|choice)(]])/, ['delimiter.bracket', 'annotation', 'delimiter.bracket']],
        [
          /[A-Za-z][\w$]*/,
          {
            cases: {
              '@default': 'variable',
              '@stateDiagramBlockKeywords': 'typeKeyword',
              '@stateDiagramKeywords': 'keyword'
            }
          }
        ],
        [/".*?"/, 'string'],
        [/(:)([^\n:]*?$)/, ['delimiter.bracket', 'string']],
        [/{|}/, 'delimiter.bracket'],
        [commentRegex, 'comment'],
        [/-->/, 'transition'],
        [/\[.*?]/, 'string']
      ],
      stateDiagramNote: [
        [/^\s*end note$/, { next: '@pop', token: 'typeKeyword' }],
        [/.*/, 'string']
      ]
    }
  });

  // tree-sitter semantic highlighting, layered on top of the Monarch tokenizer
  // above. Registered per-language so it applies to every `mermaid` model with
  // no per-model wiring. If the wasm fails to load the provider throws and
  // Monaco silently keeps the Monarch colors — graceful degradation.
  monacoEditor.languages.registerDocumentSemanticTokensProvider('mermaid', {
    getLegend: () => SEMANTIC_LEGEND,
    provideDocumentSemanticTokens: async (model) => {
      const data = await computeSemanticTokens(model.getValue());
      return { data, resultId: undefined };
    },
    releaseDocumentSemanticTokens: () => {}
  });

  // Color decorators: render a swatch before each color literal in `style` /
  // `classDef` statements and enable Monaco's built-in color picker on click.
  monacoEditor.languages.registerColorProvider('mermaid', {
    provideDocumentColors: (model) => {
      const matches = model.findMatches(COLOR_REGEX, false, true, false, null, false);
      const colors: Monaco.languages.IColorInformation[] = [];
      for (const { range } of matches) {
        const color = parseColor(model.getValueInRange(range));
        if (color) {
          colors.push({ range, color });
        }
      }
      return colors;
    },
    provideColorPresentations: (_model, colorInfo) => [{ label: colorToHex(colorInfo.color) }]
  });

  monacoEditor.editor.defineTheme('mermaid-dark', {
    base: 'vs-dark',
    colors: {},
    inherit: true,
    rules: [
      // Monarch fallback tokens, repainted to match their tree-sitter semantic
      // role (the palette below) so the fallback layer blends in and there is no
      // color flicker when semantic tokens take over: typeKeyword/section →
      // keyword, transition (arrows) → operator, identifier (node ids) →
      // variable, annotation (<<...>>) → attribute, brackets → punctuation.
      { foreground: '569cd6', token: 'typeKeyword' },
      { foreground: 'd4d4d4', token: 'transition' },
      { foreground: '9cdcfe', token: 'identifier' },
      { foreground: '9cdcfe', token: 'annotation' },
      { foreground: '808080', token: 'delimiter.bracket' },
      { fontStyle: 'bold', foreground: 'ff0000', token: 'custom-error' },
      // tree-sitter semantic token colors — full VS Code Dark+ palette.
      { foreground: '569cd6', token: 'keyword' },
      { foreground: '6a9955', token: 'comment' },
      { foreground: 'ce9178', token: 'string' },
      { foreground: 'b5cea8', token: 'number' },
      { foreground: 'd4d4d4', token: 'operator' },
      { foreground: '9cdcfe', token: 'variable' },
      { foreground: '4fc1ff', token: 'constant' },
      { foreground: '4ec9b0', token: 'type' },
      { foreground: '4ec9b0', token: 'namespace' },
      { foreground: '9cdcfe', token: 'property' },
      { foreground: 'dcdcaa', token: 'function' },
      { foreground: '808080', token: 'punctuation' },
      { foreground: '9cdcfe', token: 'attribute' },
      { foreground: '569cd6', token: 'boolean' }
    ]
  });

  monacoEditor.editor.defineTheme('mermaid', {
    base: 'vs',
    colors: {},
    inherit: true,
    rules: [
      // Monarch fallback tokens, repainted to match their tree-sitter semantic
      // role (the Light+ palette below) so the fallback blends in with no flicker
      // when semantic tokens take over. custom-error stays a distinct red.
      { foreground: '0000ff', token: 'typeKeyword' },
      { fontStyle: 'bold', foreground: 'ff0000', token: 'custom-error' },
      { foreground: '0000ff', token: 'transition' },
      { foreground: '808080', token: 'delimiter.bracket' },
      { foreground: '001080', token: 'annotation' },
      { foreground: '001080', token: 'identifier' },
      // tree-sitter semantic token colors — full VS Code Light+ palette (mirrors
      // the Dark+ set in the mermaid-dark theme).
      { foreground: '0000ff', token: 'keyword' },
      { foreground: '008000', token: 'comment' },
      { foreground: 'a31515', token: 'string' },
      { foreground: '098658', token: 'number' },
      { foreground: '0000ff', token: 'operator' },
      { foreground: '001080', token: 'variable' },
      { foreground: '0070c1', token: 'constant' },
      { foreground: '267f99', token: 'type' },
      { foreground: '267f99', token: 'namespace' },
      { foreground: '001080', token: 'property' },
      { foreground: '795e26', token: 'function' },
      { foreground: '808080', token: 'punctuation' },
      { foreground: '001080', token: 'attribute' },
      { foreground: '0000ff', token: 'boolean' }
    ]
  });

  monacoEditor.languages.registerCompletionItemProvider('mermaid', {
    provideCompletionItems: (model, position) => {
      const firstLine = model.getLineContent(1);
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      };

      // Detect current diagram type from first line
      const diagramEntry = Object.entries(keywords).find(([, def]) =>
        def.typeKeywords.some((tk) => new RegExp(`^\\s*${tk}\\b`, 'i').test(firstLine))
      );

      const allTypeKeywords = Object.values(keywords).flatMap((d) => d.typeKeywords);
      const CompletionItemKind = monacoEditor.languages.CompletionItemKind;

      // On the first line (or if no diagram detected yet), suggest diagram type names
      if (position.lineNumber === 1 || !diagramEntry) {
        const typeSuggestions = allTypeKeywords.map((tk) => ({
          detail: 'diagram type',
          insertText: tk,
          kind: CompletionItemKind.Module,
          label: tk,
          range
        }));

        // If a diagram type is already present on line 1, also offer its inline keywords
        // (e.g. direction flags like TD/LR that follow "flowchart" on the same line)
        const inlineKeywords = diagramEntry
          ? diagramEntry[1].keywords.map((kw) => ({
              detail: 'keyword',
              insertText: kw,
              kind: CompletionItemKind.Keyword,
              label: kw,
              range
            }))
          : [];

        return { suggestions: [...typeSuggestions, ...inlineKeywords] };
      }

      const [, def] = diagramEntry;
      const suggestions = [
        ...def.keywords.map((kw) => ({
          detail: 'keyword',
          insertText: kw,
          kind: CompletionItemKind.Keyword,
          label: kw,
          range
        })),
        ...def.blockKeywords.map((kw) => ({
          detail: 'block keyword',
          insertText: kw,
          kind: CompletionItemKind.Class,
          label: kw,
          range
        }))
      ];

      return { suggestions };
    }
  });

  monacoEditor.languages.setLanguageConfiguration('mermaid', {
    autoClosingPairs: [
      {
        close: ')',
        open: '('
      },
      {
        close: '}',
        open: '{'
      },
      {
        close: ']',
        open: '['
      }
    ],
    brackets: [
      ['(', ')'],
      ['{', '}'],
      ['[', ']']
    ],
    comments: {
      lineComment: '%%'
    }
  });
};
