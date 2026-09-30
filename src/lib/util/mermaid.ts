import { diagramData } from '@mermaid-js/examples';
import tidyTreeLayouts from '@mermaid-js/layout-tidy-tree';
import type { MermaidConfig, RenderResult } from 'mermaid';
import mermaid from 'mermaid';
import { canonicalDiagramId } from './diagramTypes';

mermaid.registerLayoutLoaders(tidyTreeLayouts);

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
