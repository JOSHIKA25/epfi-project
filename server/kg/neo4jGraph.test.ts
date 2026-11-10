import assert from 'node:assert/strict';
import test from 'node:test';

import { TEPKnowledgeGraph } from './neo4jGraph.ts';

const neo4jEnvironmentKeys = [
  'NEO4J_URI',
  'NEO4J_USERNAME',
  'NEO4J_PASSWORD',
  'NEO4J_DATABASE',
] as const;

test('uses the local graph and named read-only queries when Neo4j is not configured', async () => {
  const originalValues = new Map(neo4jEnvironmentKeys.map((key) => [key, process.env[key]]));
  for (const key of neo4jEnvironmentKeys) delete process.env[key];

  try {
    const graph = new TEPKnowledgeGraph();
    await graph.initialize();
    const health = await graph.getHealth();
    const fullGraph = await graph.getFullGraph();
    const query = await graph.executeNamedQuery('unit-flow');

    assert.equal(health.status, 'not_configured');
    assert.equal(health.configured, false);
    assert.ok(fullGraph.nodes.length > 0);
    assert.ok(fullGraph.relationships.length > 0);
    assert.ok(query.results.length > 0);
    assert.match(query.summary, /Local prototype graph/);
  } finally {
    for (const [key, value] of originalValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('reports incomplete Neo4j configuration instead of silently falling back', async () => {
  const originalValues = new Map(neo4jEnvironmentKeys.map((key) => [key, process.env[key]]));
  for (const key of neo4jEnvironmentKeys) delete process.env[key];
  process.env.NEO4J_URI = 'neo4j+s://example.invalid';

  try {
    const graph = new TEPKnowledgeGraph();
    const health = await graph.getHealth();
    assert.equal(health.status, 'error');
    assert.equal(health.configured, true);
    await assert.rejects(graph.getFullGraph(), /Neo4j configuration is incomplete/);
  } finally {
    for (const [key, value] of originalValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
