import { diagramData } from '@mermaid-js/examples';
import tidyTreeLayouts from '@mermaid-js/layout-tidy-tree';
import type { MermaidConfig, RenderResult } from 'mermaid';
import mermaid from 'mermaid';
import { canonicalDiagramId } from './diagramTypes';

mermaid.registerLayoutLoaders(tidyTreeLayouts);

// Icon packs for diagram icon shapes (`@{ icon: "pack:name" }`) and architecture
// diagrams. Mermaid ships none, so they're registered here — bundled (not
// CDN-fetched) to work offline, and lazily loaded so Vite pulls a pack's JSON
// only on first use. Each pack lists every name it answers to: the common
// prefix(es) plus the canonical Iconify prefix, so names copied from
// icon-sets.iconify.design resolve too.
// (Separate from inline `[fa:fa-user]` labels, which use the Font Awesome
// webfont — see FontAwesome.svelte — not these Iconify packs.)
const ICON_PACKS: { names: string[]; loader: () => Promise<any> }[] = [
  {
    names: ['logos'],
    loader: () => import('@iconify-json/logos/icons.json').then((m) => m.default)
  },
  {
    names: ['fa', 'fas', 'fa7-solid'],
    loader: () => import('@iconify-json/fa7-solid/icons.json').then((m) => m.default)
  },
  {
    names: ['far', 'fa7-regular'],
    loader: () => import('@iconify-json/fa7-regular/icons.json').then((m) => m.default)
  },
  {
    names: ['fab', 'fa7-brands'],
    loader: () => import('@iconify-json/fa7-brands/icons.json').then((m) => m.default)
  }
];

mermaid.registerIconPacks(
  ICON_PACKS.flatMap(({ names, loader }) => names.map((name) => ({ name, loader })))
);

export const render = async (
  config: MermaidConfig,
  code: string,
  id: string
): Promise<RenderResult> => {
  // Should be able to call this multiple times without any issues.
  mermaid.initialize(config);
  return await mermaid.render(id, code);
};

export const parse = async (code: string) => {
  return await mermaid.parse(code);
};

/**
 * @see https://mermaid.js.org/config/schema-docs/config.html
 */
export const defaultMermaidConfig = mermaid.mermaidAPI.defaultConfig ?? {};

type DiagramDefinition = (typeof diagramData)[number];

export type SampleExample = DiagramDefinition['examples'][number];

const isValidDiagram = (diagram: DiagramDefinition): diagram is Required<DiagramDefinition> => {
  return Boolean(diagram.name && diagram.examples && diagram.examples.length > 0);
};

export const getSampleDiagrams = (): Record<
  string,
  { name: string; examples: SampleExample[] }
> => {
  const samples: Record<string, { name: string; examples: SampleExample[] }> = {};
  for (const diagram of diagramData.filter((d) => isValidDiagram(d))) {
    // The default example comes first, so it is loaded when clicking the
    // diagram name and shown at the top of the example dropdown.
    samples[canonicalDiagramId(diagram.id)] = {
      name: diagram.name.replace(/ (Diagram|Chart|Graph)/, ''),
      examples: [...diagram.examples].sort(
        (a, b) => Number(b.isDefault ?? false) - Number(a.isDefault ?? false)
      )
    };
  }
  return samples;
};
