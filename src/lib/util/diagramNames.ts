import { m } from '$/paraglide/messages';

/**
 * Localized display names for diagram types, keyed by canonical id
 * (see canonicalDiagramId in diagramTypes.ts). Types not listed here — proper
 * nouns like C4/Git/Kanban and the railroad variants — fall back to the English
 * name the caller provides, or to the id.
 */
const names: Record<string, () => string> = {
  flowchart: m.diagram_name_flowchart,
  class: m.diagram_name_class,
  sequence: m.diagram_name_sequence,
  er: m.diagram_name_er,
  stateDiagram: m.diagram_name_stateDiagram,
  mindmap: m.diagram_name_mindmap,
  journey: m.diagram_name_journey,
  requirement: m.diagram_name_requirement,
  usecase: m.diagram_name_usecase,
  eventmodeling: m.diagram_name_eventmodeling,
  timeline: m.diagram_name_timeline,
  pie: m.diagram_name_pie,
  radar: m.diagram_name_radar,
  quadrantChart: m.diagram_name_quadrantChart,
  packet: m.diagram_name_packet,
  block: m.diagram_name_block,
  treemap: m.diagram_name_treemap,
  venn: m.diagram_name_venn,
  gantt: m.diagram_name_gantt,
  sankey: m.diagram_name_sankey,
  treeView: m.diagram_name_treeView,
  architecture: m.diagram_name_architecture,
  cynefin: m.diagram_name_cynefin,
  wardley: m.diagram_name_wardley,
  ishikawa: m.diagram_name_ishikawa,
  xychart: m.diagram_name_xychart,
  kanban: m.diagram_name_kanban,
  railroad: m.diagram_name_railroad,
  railroadEbnf: m.diagram_name_railroadEbnf,
  railroadAbnf: m.diagram_name_railroadAbnf,
  railroadPeg: m.diagram_name_railroadPeg
};

/**
 * Localized name for a diagram type. `id` should be a canonical id.
 * Falls back to the provided English name, then the id itself.
 */
export const diagramDisplayName = (id: string | undefined, fallback?: string): string => {
  if (!id) {
    return fallback ?? '';
  }
  return names[id]?.() ?? fallback ?? id;
};
