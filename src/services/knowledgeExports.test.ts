import assert from 'node:assert/strict';
import test from 'node:test';

import type { KnowledgeGraphData, RAGDocumentChunk } from '../types/index.js';
import {
  createKnowledgeGraphCsv,
  createRagHtml,
  createRagMarkdown,
  KNOWLEDGE_EXPORT_NOTICE,
} from './knowledgeExports.js';

const sampleDocument: RAGDocumentChunk = {
  id: 'DOC-TEST-1',
  documentTitle: 'Test <document>',
  section: 'Test section',
  category: 'process_spec',
  content: 'A & B',
  keywords: ['test'],
};

test('RAG exports retain content and include the prototype safety notice', () => {
  const markdown = createRagMarkdown([sampleDocument]);
  const html = createRagHtml([sampleDocument]);

  assert.match(markdown, /DOC-TEST-1/);
  assert.match(markdown, /A & B/);
  assert.ok(markdown.includes(KNOWLEDGE_EXPORT_NOTICE));
  assert.match(html, /&lt;document&gt;/);
  assert.match(html, /A &amp; B/);
  assert.match(html, /@media print/);
  assert.ok(html.includes(KNOWLEDGE_EXPORT_NOTICE));
});

test('knowledge graph CSV quotes cells and includes the export notice', () => {
  const graph: KnowledgeGraphData = {
    nodes: [
      { id: 'UNIT_1', label: 'Unit', name: 'Unit, one', properties: {} },
      { id: 'FAULT_1', label: 'Fault', name: 'Fault "one"', properties: {} },
    ],
    relationships: [
      {
        id: 'rel_1',
        type: 'AFFECTS_UNIT',
        source: 'FAULT_1',
        target: 'UNIT_1',
        properties: { note: 'prototype' },
      },
    ],
  };
  const csv = createKnowledgeGraphCsv(graph);

  assert.match(csv, /"relationship_id","source_id"/);
  assert.match(csv, /"Fault ""one"""/);
  assert.ok(csv.includes(KNOWLEDGE_EXPORT_NOTICE));
});
