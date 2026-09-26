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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

// Mount API Router
app.use('/api', apiRouter);

// Background TEP Simulation Loop (1 Hz continuous plant dynamics)
setInterval(() => {
  try {
    tepSimulator.step();
  } catch (err) {
    console.error('Error during simulation step:', err);
  }
}, 1000);

// Integrate Vite in development mode or serve static files in production
async function startServer() {
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

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
