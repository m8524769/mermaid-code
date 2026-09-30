<script lang="ts">
  import { m } from '$/paraglide/messages';
  import { Button } from '$/components/ui/button';
  import { getDiagramDocumentationUrl } from '$/util/diagramDocs';
  import { describeDiagram } from '$/util/diagramTypes';
  import { diagramDisplayName } from '$/util/diagramNames';
  import { validatedState } from '$/util/state.svelte';
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
