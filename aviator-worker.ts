import http from 'node:http';
import { config } from './backend/src/config';
import { closeDatabase, connectDatabase, isDatabaseConnected } from './backend/src/db/postgres';
import { startProductionCrashEngine, stopProductionCrashEngine } from './backend/src/games/aviator/production.engine';

async function startWorker() {
  if (!config.isProduction || !config.productionValid) {
    throw new Error('Aviator worker requires valid production configuration and secrets.');
  }
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error('Aviator worker requires DATABASE_URL to be configured in its own service.');
  }

  await connectDatabase();
  if (!isDatabaseConnected()) throw new Error('Aviator worker could not connect to PostgreSQL.');

  startProductionCrashEngine();

  // This health listener is private to the shared container. The public PORT
  // belongs exclusively to the API server; the worker exposes no financial routes.
  const port = Number(process.env.AVIATOR_WORKER_HEALTH_PORT || 10001);
  const healthServer = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/api/health') {
      res.writeHead(isDatabaseConnected() ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        status: isDatabaseConnected() ? 'ok' : 'database_disconnected',
        service: 'BigDaddy Aviator Engine Worker',
        databaseConnected: isDatabaseConnected(),
      }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });
  healthServer.listen(port, '127.0.0.1', () => {
    console.log('Dedicated Aviator engine worker is running; API routes are not exposed.');
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopProductionCrashEngine();
    healthServer.close();
    await closeDatabase();
    process.exit(0);
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}

startWorker().catch((error) => {
  console.error('Dedicated Aviator worker failed to start:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
