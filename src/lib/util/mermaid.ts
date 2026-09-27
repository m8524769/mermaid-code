import { diagramData } from '@mermaid-js/examples';
import tidyTreeLayouts from '@mermaid-js/layout-tidy-tree';
import type { MermaidConfig, RenderResult } from 'mermaid';
import mermaid from 'mermaid';

mermaid.registerLayoutLoaders(tidyTreeLayouts);

// Vertical distance from the alphabetic baseline to the font's central baseline,
// in em. Measured for the bundled "Recursive Variable" face (0.34em ≈ the classic
// SVG text-centering constant) and used to re-center labels engine-independently.
const CENTRAL_BASELINE_EM = 0.34;

/**
 * Make mermaid's vertically-centered text render identically in Blink and WebKit.
 *
 * WebKit (Safari / macOS WKWebView) does NOT apply `dominant-baseline` to a `<text>`
 * that has `<tspan>` children — so mermaid's centered labels (sequence actors, node
 * labels, …) sit ~0.34em too high there, while Blink (Chrome / Windows WebView2)
 * centers them correctly. An external CSS nudge can't fix this because it doesn't
 * travel with the cloned/serialized SVG we export (nor the in-app PNG raster).
 *
 * So we bake the centering into the SVG itself, engine-independently: drop the
 * baseline attributes on such `<text>` and push it down by the same 0.34em via `dy`.
 * The alphabetic baseline is font-metric-defined and rendered identically by both
 * engines, so `alphabetic + 0.34em` reproduces the exact center Blink got from
 * `central` while also fixing WebKit. Direct-text nodes (no `<tspan>`, e.g. sequence
 * message labels) are left untouched — WebKit honors their `dominant-baseline` and
 * Blink already agrees, so rewriting them would only nudge a correct node off-center.
 *
 * Which element gets the extra `dy` matters: a `<tspan>` that declares its own `dy`
 * OVERRIDES the parent `<text>`'s `dy` (they do NOT add — verified in both Blink and
 * WebKit). mermaid puts the vertical offset on different levels per shape — actor/node
 * labels carry it on the tspan (`dy="0"`), sequence notes carry it on the `<text>`
 * (`dy="1em"`, tspan has none). So we add the 0.34em to whichever level already
 * governs positioning (the tspan if it declares a `dy`, else the `<text>`), keeping a
 * single-level `dy` and never creating a conflicting two-level shift.
 *
 * A multi-line label (e.g. `participant X as a<br/>b`) draws one `<text>` per line with
 * the tspan `dy` in USER UNITS (`dy="-8"`/`dy="8"` at font-size 16). For those the
 * compensation must be added in user units too (0.34 × font-size px), NOT as an em
 * suffix — turning `-8` into `-8em` would throw the line ~128px out of its box.
 */
const centerLabelsEngineIndependently = (svg: string): string => {
  // Fast path: nothing to do unless a centered baseline is present.
  if (!svg.includes('dominant-baseline="central"') && !svg.includes('dominant-baseline="middle"')) {
    return svg;
  }
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    return svg; // Malformed parse — leave the original string untouched.
  }
  for (const text of doc.querySelectorAll('text')) {
    const baseline = text.getAttribute('dominant-baseline');
    if (baseline !== 'central' && baseline !== 'middle') {
      continue;
    }
    const tspan = text.querySelector('tspan');
    if (!tspan) {
      continue; // Direct text: WebKit already centers it correctly.
    }
    text.removeAttribute('dominant-baseline');
    text.removeAttribute('alignment-baseline');
    // Add the compensation to the level that actually governs vertical position.
    const governing = tspan.hasAttribute('dy') ? tspan : text;
    governing.setAttribute(
      'dy',
      shiftDy(governing.getAttribute('dy'), CENTRAL_BASELINE_EM, fontSizePx(text))
    );
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
};

/** Read the font-size (px) off a `<text>`'s inline style, defaulting to 16. */
const fontSizePx = (text: Element): number => {
  const match = /font-size:\s*([\d.]+)px/.exec(text.getAttribute('style') ?? '');
  return match ? parseFloat(match[1]) : 16;
};

/**
 * Add `em` worth of downward shift to an existing `dy`, matching its unit:
 * - absent/`"0"`/em values stay in em (font-size-independent);
 * - a numeric user-unit `dy` (multi-line labels) gets the shift in user units
 *   (`em × fontSizePx`) so a small px offset never balloons into a huge em value.
 */
const shiftDy = (dy: string | null, em: number, fontSizePx: number): string => {
  if (!dy || dy === '0') {
    return `${em}em`;
  }
  if (dy.endsWith('em')) {
    return `${round(parseFloat(dy) + em)}em`;
  }
  const n = parseFloat(dy);
  return Number.isNaN(n) ? `${em}em` : `${round(n + em * fontSizePx)}`;
};

/** Trim floating-point noise (e.g. 13.440000000000001) from generated dy values. */
const round = (n: number): number => Math.round(n * 1000) / 1000;

export const render = async (
  config: MermaidConfig,
  code: string,
  id: string
): Promise<RenderResult> => {
  // Should be able to call this multiple times without any issues.
  mermaid.initialize(config);
  const result = await mermaid.render(id, code);
  return { ...result, svg: centerLabelsEngineIndependently(result.svg) };
};

export const parse = async (code: string) => {
  return await mermaid.parse(code);
};

/**
 * @see https://mermaid.js.org/config/schema-docs/config.html
 */
export const defaultMermaidConfig = mermaid.mermaidAPI.defaultConfig ?? {};

export const standardizeDiagramType = (diagramType: string) => {
  switch (diagramType) {
    case 'class':
    case 'classDiagram': {
      return 'classDiagram';
    }
    case 'graph':
    case 'flowchart':
    case 'flowchart-elk':
    case 'flowchart-v2': {
      return 'flowchart';
    }
    default: {
      return diagramType;
    }
  }
};

type DiagramDefinition = (typeof diagramData)[number];

export type SampleExample = DiagramDefinition['examples'][number];

const isValidDiagram = (diagram: DiagramDefinition): diagram is Required<DiagramDefinition> => {
  return Boolean(diagram.name && diagram.examples && diagram.examples.length > 0);
};

export const getSampleDiagrams = (): Record<string, SampleExample[]> => {
  const samples: Record<string, SampleExample[]> = {};
  for (const diagram of diagramData.filter((d) => isValidDiagram(d))) {
    // The default example comes first, so it is loaded when clicking the
    // diagram name and shown at the top of the example dropdown.
    samples[diagram.name.replace(/ (Diagram|Chart|Graph)/, '')] = [...diagram.examples].sort(
      (a, b) => Number(b.isDefault ?? false) - Number(a.isDefault ?? false)
    );
  }
  return samples;
};
