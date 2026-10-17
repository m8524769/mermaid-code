<script lang="ts">
  import { m } from '#lib/paraglide/messages.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import { getDiagramDocumentationUrl } from '#lib/util/diagramDocs.js';
  import { describeDiagram } from '#lib/util/diagramTypes.js';
  import { diagramDisplayName } from '#lib/util/diagramNames.js';
  import { validatedState } from '#lib/util/state.svelte.js';
  import BookIcon from '~icons/material-symbols/book-2-outline-rounded';

  const doc = $derived.by(() => {
    const { diagramType, editorMode } = validatedState.current;
    return {
      key: describeDiagram(diagramType)?.id ?? '',
      url: getDiagramDocumentationUrl(diagramType, editorMode)
    };
  });
</script>

<Button
  variant="ghost"
  href={doc.url}
  target="_blank"
  title={doc.key ? m.doc_view_for({ type: diagramDisplayName(doc.key) }) : m.doc_view()}
  class="mb-1 p-2">
  <BookIcon />
  {m.docs_label()}
</Button>
