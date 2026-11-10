import type { GraphNode, GraphRelationship, KnowledgeGraphData, RAGDocumentChunk } from '../types/index.js';

export const KNOWLEDGE_EXPORT_NOTICE =
  'Research reference material only. Each RAG entry includes its source and evidence status. Graph mappings and relationships may require review and are not proof of causality. This pack contains no approved site operating procedures, safety limits, or work instructions.';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function csvCell(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

export function createRagMarkdown(documents: RAGDocumentChunk[]): string {
  const sections = documents.map((document) => [
    `## ${document.documentTitle}`,
    '',
    `- **Entry:** ${document.id}`,
    `- **Section:** ${document.section}`,
    `- **Category:** ${document.category.replaceAll('_', ' ')}`,
    `- **Applicable fault IDs:** ${document.applicableFaults?.join(', ') || 'Not specified'}`,
    `- **Applicable sensors:** ${document.applicableSensors?.join(', ') || 'Not specified'}`,
    `- **Search keywords:** ${document.keywords.join(', ')}`,
    `- **Evidence status:** ${document.source?.verificationStatus || 'UNVERIFIED_ILLUSTRATIVE'}`,
    `- **Citation:** ${document.source?.citation || 'No verified citation attached'}`,
    `- **Source URL:** ${document.source?.url || 'Not available'}`,
    `- **Source note:** ${document.source?.note || 'Illustrative entry; verify against an authoritative source.'}`,
    '',
    document.content,
  ].join('\n'));

  return [
    '# Tennessee Eastman Process — Research Knowledge Pack',
    '',
    `> **Important:** ${KNOWLEDGE_EXPORT_NOTICE}`,
    '',
    `Exported ${new Date().toISOString()}. Contains ${documents.length} corpus entries.`,
    '',
    ...sections,
    '',
  ].join('\n');
}

export function createRagHtml(documents: RAGDocumentChunk[]): string {
  const cards = documents.map((document) => `
    <article>
      <p class="meta">${escapeHtml(document.id)} · ${escapeHtml(document.category.replaceAll('_', ' '))}</p>
      <h2>${escapeHtml(document.documentTitle)}</h2>
      <h3>${escapeHtml(document.section)}</h3>
      <p>${escapeHtml(document.content)}</p>
      <dl>
        <dt>Evidence status</dt><dd>${escapeHtml(document.source?.verificationStatus || 'UNVERIFIED_ILLUSTRATIVE')}</dd>
        <dt>Citation</dt><dd>${escapeHtml(document.source?.citation || 'No verified citation attached')}</dd>
        <dt>Source URL</dt><dd>${document.source?.url ? `<a href="${escapeHtml(document.source.url)}">${escapeHtml(document.source.url)}</a>` : 'Not available'}</dd>
        <dt>Applicable fault IDs</dt><dd>${escapeHtml(document.applicableFaults?.join(', ') || 'Not specified')}</dd>
        <dt>Applicable sensors</dt><dd>${escapeHtml(document.applicableSensors?.join(', ') || 'Not specified')}</dd>
        <dt>Search keywords</dt><dd>${escapeHtml(document.keywords.join(', '))}</dd>
      </dl>
    </article>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TEP Research Knowledge Pack</title>
  <style>
    :root { color-scheme: light; font: 16px/1.6 Arial, sans-serif; color: #172033; }
    body { max-width: 900px; margin: 40px auto; padding: 0 24px; }
    header { border-bottom: 2px solid #0e7490; margin-bottom: 28px; padding-bottom: 18px; }
    .notice { background: #fff7ed; border: 1px solid #c2410c; padding: 16px; }
    article { break-inside: avoid; border-bottom: 1px solid #cbd5e1; padding: 18px 0; }
    h1, h2 { color: #0e7490; } h2 { margin-bottom: 4px; } h3 { margin-top: 4px; color: #475569; font-size: 1rem; }
    .meta, dt { color: #475569; font-size: .85rem; text-transform: uppercase; }
    dt { font-weight: bold; } dd { margin: 0 0 8px; }
    @media print { body { max-width: none; margin: 0; padding: 0; } a { color: inherit; } }
  </style>
</head>
<body>
  <header>
    <h1>Tennessee Eastman Process — Research Knowledge Pack</h1>
    <p>Exported ${escapeHtml(new Date().toISOString())} · ${documents.length} entries</p>
    <p class="notice"><strong>Important:</strong> ${escapeHtml(KNOWLEDGE_EXPORT_NOTICE)}</p>
  </header>
  ${cards}
</body>
</html>`;
}

export function createKnowledgeGraphCsv(graph: KnowledgeGraphData): string {
  const nodes = new Map<string, GraphNode>(graph.nodes.map((node) => [node.id, node]));
  const header = ['relationship_id', 'source_id', 'source_label', 'source_name', 'relationship_type', 'target_id', 'target_label', 'target_name', 'properties', 'export_notice'];
  const rows = graph.relationships.map((relationship: GraphRelationship) => {
    const source = nodes.get(relationship.source);
    const target = nodes.get(relationship.target);
    return [
      relationship.id,
      relationship.source,
      source?.label || '',
      source?.name || '',
      relationship.type,
      relationship.target,
      target?.label || '',
      target?.name || '',
      relationship.properties || {},
      KNOWLEDGE_EXPORT_NOTICE,
    ].map(csvCell).join(',');
  });

  return [
    header.map(csvCell).join(','),
    ...rows,
    '',
  ].join('\n');
}
