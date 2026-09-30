/**
 * Everything the app knows about individual diagram types, keyed by the id
 * mermaid's detector returns from `mermaid.parse(code).diagramType`.
 *
 * Kept free of mermaid runtime imports so it stays cheap to import and test.
 */

export interface DiagramDocs {
  code: string;
  config?: string;
}

export interface DiagramInfo {
  /** Canonical id: the detector id, with variants (e.g. `flowchart-v2`) folded together. */
  id: string;
  /** Paths relative to the docs base URL. Absent when there is no docs page. */
  docs?: DiagramDocs;
}

const aliases: Record<string, string> = {
  classDiagram: 'class',
  'flowchart-elk': 'flowchart',
  'flowchart-v2': 'flowchart',
  graph: 'flowchart'
};

const catalog: Record<string, DiagramDocs> = {
  agentflow: { code: '/syntax/agentflow.html', config: '/syntax/agentflow.html#configuration' },
  architecture: { code: '/syntax/architecture.html' },
  block: { code: '/syntax/block.html' },
  c4: { code: '/syntax/c4.html' },
  class: { code: '/syntax/classDiagram.html', config: '/syntax/classDiagram.html#configuration' },
  cynefin: { code: '/syntax/cynefin.html', config: '/syntax/cynefin.html#configuration' },
  er: {
    code: '/syntax/entityRelationshipDiagram.html',
    config: '/syntax/entityRelationshipDiagram.html#styling'
  },
  eventmodeling: { code: '/syntax/eventmodeling.html' },
  flowchart: { code: '/syntax/flowchart.html', config: '/syntax/flowchart.html#configuration' },
  gantt: { code: '/syntax/gantt.html', config: '/syntax/gantt.html#configuration' },
  gitGraph: {
    code: '/syntax/gitgraph.html',
    config: '/syntax/gitgraph.html#gitgraph-specific-configuration-options'
  },
  ishikawa: { code: '/syntax/ishikawa.html' },
  journey: { code: '/syntax/userJourney.html' },
  kanban: { code: '/syntax/kanban.html', config: '/syntax/kanban.html#configuration-options' },
  mindmap: { code: '/syntax/mindmap.html' },
  packet: {
    code: '/syntax/packet.html',
    config: '/config/schema-docs/config-defs-packet-diagram-config.html'
  },
  pie: { code: '/syntax/pie.html', config: '/syntax/pie.html#configuration' },
  quadrantChart: {
    code: '/syntax/quadrantChart.html',
    config: '/syntax/quadrantChart.html#chart-configurations'
  },
  radar: { code: '/syntax/radar.html', config: '/syntax/radar.html#configuration' },
  railroad: { code: '/syntax/railroad.html#ir-primitives-railroad-beta' },
  railroadAbnf: { code: '/syntax/railroad.html#abnf-railroad-abnf-beta' },
  railroadEbnf: { code: '/syntax/railroad.html#ebnf-railroad-ebnf-beta' },
  railroadPeg: { code: '/syntax/railroad.html#peg-railroad-peg-beta' },
  requirement: { code: '/syntax/requirementDiagram.html' },
  sankey: { code: '/syntax/sankey.html', config: '/syntax/sankey.html#configuration' },
  sequence: {
    code: '/syntax/sequenceDiagram.html',
    config: '/syntax/sequenceDiagram.html#configuration'
  },
  stateDiagram: { code: '/syntax/stateDiagram.html' },
  swimlane: { code: '/syntax/swimlanes.html' },
  timeline: { code: '/syntax/timeline.html', config: '/syntax/timeline.html#themes' },
  treeView: { code: '/syntax/treeView.html', config: '/syntax/treeView.html#config-variables' },
  treemap: { code: '/syntax/treemap.html', config: '/syntax/treemap.html#configuration-options' },
  usecase: { code: '/syntax/usecase.html', config: '/syntax/usecase.html#configuration' },
  venn: { code: '/syntax/venn.html' },
  wardley: { code: '/syntax/wardley.html', config: '/syntax/wardley.html#configuration' },
  xychart: { code: '/syntax/xyChart.html', config: '/syntax/xyChart.html#chart-configurations' }
};

/** Fold a detector id (e.g. `flowchart-v2`) to its canonical id (e.g. `flowchart`). */
export const canonicalDiagramId = (detectedType: string): string =>
  aliases[detectedType] ?? detectedType;

export const describeDiagram = (detectedType: string | undefined): DiagramInfo | undefined => {
  if (!detectedType) {
    return undefined;
  }
  const id = canonicalDiagramId(detectedType);
  const docs = catalog[id];
  return { id, ...(docs && { docs }) };
};
