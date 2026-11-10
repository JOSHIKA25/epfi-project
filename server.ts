/**
 * Full-Stack Server Entry Point
 * Express API backend + Vite middleware integration for AI Studio development
 */
import 'dotenv/config';
console.log(
  '[Gemini] API key:',
  process.env.GEMINI_API_KEY ? 'FOUND' : 'NOT FOUND'
);

import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/routes.ts';
import { tepSimulator } from './server/tep/tepSimulator.ts';
import { tepKnowledgeGraph } from './server/kg/neo4jGraph.ts';
import { monitorAlarmNotifications } from './server/tep/alarmMonitor.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '12mb' }));

// Mount API Router
app.use('/api', apiRouter);

// Background TEP Simulation Loop (1 Hz continuous plant dynamics)
setInterval(() => {
  try {
    const snapshot = tepSimulator.step();
    if (Object.values(snapshot.alarms).some((alarm) => alarm === 'TRIP_HIGH' || alarm === 'TRIP_LOW')) {
      // Demo-only trip hold: freeze the simulated plant so the operator can review the event.
      tepSimulator.setRunning(false);
    }
    void monitorAlarmNotifications();
  } catch (err) {
    console.error('Error during simulation step:', err);
  }
}, 1000);

// Integrate Vite in development mode or serve static files in production
async function startServer() {
  try {
    await tepKnowledgeGraph.initialize();
    const graphHealth = await tepKnowledgeGraph.getHealth();
    if (graphHealth.status === 'connected') {
      console.log(
        `[KnowledgeGraph] Connected to Neo4j database "${graphHealth.database}" ` +
        `(${graphHealth.nodeCount} nodes, ${graphHealth.relationshipCount} relationships).`
      );
    } else {
      console.warn('[KnowledgeGraph] Neo4j is not configured; using the local prototype graph.');
    }
  } catch (error) {
    console.error(
      '[KnowledgeGraph] Neo4j initialization failed. The app will start, but graph API requests will report the connection error.',
      error
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true' ? { server } : false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[IndustrialTwin] Server running on http://0.0.0.0:${PORT}`);
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void tepKnowledgeGraph.close().finally(() => server.close(() => process.exit(0)));
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
