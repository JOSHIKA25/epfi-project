import 'dotenv/config';
import neo4j from 'neo4j-driver';

const uri = process.env.NEO4J_URI?.trim();
const username = process.env.NEO4J_USERNAME?.trim();
const password = process.env.NEO4J_PASSWORD;
const database = process.env.NEO4J_DATABASE?.trim() || 'neo4j';
const app = 'tep-digital-twin';

if (!uri || !username || !password) {
  console.error('Neo4j validation failed: set NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD in .env.');
  process.exit(1);
}

const driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
  connectionTimeout: 5000,
  maxConnectionPoolSize: 2,
});

try {
  await driver.verifyConnectivity();
  const session = driver.session({ database, defaultAccessMode: neo4j.session.READ });
  try {
    const counts = await session.executeRead(async (tx) => {
      const nodeResult = await tx.run(
        `MATCH (n {app: $app})
         WHERE NOT n:DeprecatedResearchPlaceholder
         RETURN count(n) AS count`,
        { app },
      );
      const edgeResult = await tx.run(
        `MATCH (a {app: $app})-[r]->(b {app: $app})
         WHERE NOT a:DeprecatedResearchPlaceholder
           AND NOT b:DeprecatedResearchPlaceholder
         RETURN count(r) AS count`,
        { app },
      );
      const queryResult = await tx.run(
        `MATCH (s:Sensor {app: $app})-[:LOCATED_IN]->(u:Unit {app: $app})
         RETURN {unit: u.name, sensor: s.name, code: s.code} AS result
         ORDER BY u.id, s.id LIMIT 100`,
        { app },
      );
      return {
        nodes: nodeResult.records[0]?.get('count').toNumber() ?? 0,
        relationships: edgeResult.records[0]?.get('count').toNumber() ?? 0,
        sensorUnitRows: queryResult.records.length,
      };
    });
    console.log(`Neo4j connectivity: PASS (database ${database})`);
    console.log(`App graph: ${counts.nodes} nodes, ${counts.relationships} relationships`);
    console.log(`Read-only sensor-to-unit query: ${counts.sensorUnitRows} rows`);
  } finally {
    await session.close();
  }
} catch (error) {
  const safeError = error instanceof Error ? error.name : 'UnknownError';
  console.error(`Neo4j validation: FAIL (${safeError}). Check the URI, database, credentials, and network from this machine.`);
  process.exitCode = 1;
} finally {
  await driver.close();
}
