import { diagramData } from '@mermaid-js/examples';
import tidyTreeLayouts from '@mermaid-js/layout-tidy-tree';
import type { MermaidConfig, RenderResult } from 'mermaid';
import mermaid from 'mermaid';
import { canonicalDiagramId } from './diagramTypes';

mermaid.registerLayoutLoaders(tidyTreeLayouts);

// Icon packs for diagram icon shapes (`@{ icon: "pack:name" }`) and architecture
// diagrams. Mermaid ships none, so each pack is registered here. Bundled (not
// CDN-fetched) to work offline; every loader is lazy, so Vite pulls a pack's icon
// JSON only when a diagram actually uses that pack.
//   logos                → brand/tech/cloud logos (also a dep for the Agent UI icons)
//   fa / fas / far / fab → Font Awesome 7 (fa == fas == solid; far regular; fab brands)
// Note: separate from inline `[fa:fa-user]` labels, which use the Font Awesome
// webfont (see FontAwesome.svelte), not these Iconify packs.
mermaid.registerIconPacks([
  {
    name: 'logos',
    loader: () => import('@iconify-json/logos/icons.json').then((m) => m.default as any)
  },
  {
    name: 'fa',
    loader: () => import('@iconify-json/fa7-solid/icons.json').then((m) => m.default as any)
  },
  {
    name: 'fas',
    loader: () => import('@iconify-json/fa7-solid/icons.json').then((m) => m.default as any)
  },
  {
    name: 'far',
    loader: () => import('@iconify-json/fa7-regular/icons.json').then((m) => m.default as any)
  },
  {
    name: 'fab',
    loader: () => import('@iconify-json/fa7-brands/icons.json').then((m) => m.default as any)
  }
]);

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
