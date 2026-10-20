import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { config, getPublicConfigInfo } from './backend/src/config';
import { connectDatabase, isDatabaseConnected } from './backend/src/db/postgres';
import { productionRouter } from './backend/src/routes/production.routes';
import { productionRequestsRouter } from './backend/src/routes/production.requests.routes';
import { authoritativeGamesRouter } from './backend/src/routes/authoritative-games.routes';
import { bootstrapOwnerFromEnvironment } from './backend/src/services/owner-bootstrap.service';
import { startProductionCrashEngine } from './backend/src/games/aviator/production.engine';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Express 4 does not forward rejected async route promises automatically.
// Wrap every async handler so database timeouts return an HTTP response instead
// of leaving the client waiting until its external 45-second timeout.
function wrapAsyncRouter(router: any) {
  for (const layer of router.stack ?? []) {
    for (const routeLayer of layer.route?.stack ?? []) {
      const handler = routeLayer.handle;
      if (handler?.constructor?.name !== 'AsyncFunction' || handler.__asyncErrorWrapped) continue;
      const wrapped = (req: express.Request, res: express.Response, next: express.NextFunction) => {
        Promise.resolve(handler(req, res, next)).catch(next);
      };
      (wrapped as any).__asyncErrorWrapped = true;
      routeLayer.handle = wrapped;
    }
  }
}

let productionServicesStarted = false;
let persistentAviatorEngineStarted = false;

function startPersistentAviatorEngine() {
  if (persistentAviatorEngineStarted || !config.isProduction || !config.productionValid || !isDatabaseConnected()) return;
  startProductionCrashEngine();
  persistentAviatorEngineStarted = true;
  console.log('Persistent Aviator engine started with PostgreSQL-backed round state.');
}

async function startServer() {
  // Apply the Express 4 async-rejection guard before mounting the routers.
  wrapAsyncRouter(productionRouter);
  wrapAsyncRouter(productionRequestsRouter);
  wrapAsyncRouter(authoritativeGamesRouter);

  // Connect using a backend-only secret. The frontend must never receive DATABASE_URL.
  if (process.env.DATABASE_URL?.trim()) {
    try {
      await connectDatabase();
      console.log('✅ Supabase PostgreSQL connectivity check passed.');
      if (config.isProduction) {
        startPersistentAviatorEngine();
        await bootstrapOwnerFromEnvironment();
        productionServicesStarted = true;
      }
    } catch (error) {
      // In production, keep health/readiness endpoints online when the database
      // is temporarily unreachable. The API middleware below keeps financial
      // traffic closed until a database connection is available.
      if (!config.isProduction) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error('Production database startup check failed; financial APIs remain disabled:', message);
    }
  } else if (config.isProduction) {
    // Keep liveness/readiness endpoints available; config validation below keeps
    // every financial/game API closed until required secrets are configured.
    console.error('Production startup blocked from financial traffic: DATABASE_URL is missing.');
  }

  const app = express();

  // Basic security headers. TLS termination must be configured at the hosting edge.
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // Bound request body size to reduce accidental or abusive memory exhaustion.
  app.use(express.json({ limit: '256kb' }));

  // Explicit CORS allowlist. Production configuration rejects wildcard origins.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const allowed =
        config.corsOrigins.includes(origin) ||
        (!config.isProduction && (config.corsOrigins.length === 0 || config.corsOrigins.includes('*')));
      if (!allowed) {
        return res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
      }
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Idempotency-Key');
    res.header('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Liveness is deliberately available even while financial APIs are disabled.
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'BigDaddy Casino Authority',
      mode: config.mode,
      databaseConnected: isDatabaseConnected(),
      businessDataPersistence: isDatabaseConnected() ? 'POSTGRES_AUTH_WALLET' : 'NOT_CONNECTED',
      productionFinancialApisEnabled: config.isProduction && config.productionValid && isDatabaseConnected(),
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness remains false until durable storage and game settlement are implemented.
  app.get('/api/ready', (_req, res) => {
    const ready = config.isProduction && config.productionValid && isDatabaseConnected();
    res.status(ready ? 200 : 503).json({
      ready,
      reason: ready ? null : 'PRODUCTION_CONFIGURATION_OR_DATABASE_NOT_READY',
      databaseConnected: isDatabaseConnected(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/config', (_req, res) => {
    res.json(getPublicConfigInfo());
  });

  // Production-only API surface: never mount the legacy in-memory routers.
  if (!config.isProduction || !config.productionValid) {
    app.use('/api', (req, res, next) => {
      if (req.path === '/health' || req.path === '/ready' || req.path === '/config') return next();
      return res.status(503).json({
        error: 'PRODUCTION_CONFIGURATION_ERROR',
        message: 'Production mode with valid Supabase PostgreSQL configuration is required.',
        missingVariables: config.productionMissingVars,
      });
    });
  } else {
    // Check readiness per request so the API can recover if PostgreSQL reconnects.
    app.use('/api', (req, res, next) => {
      if (req.path === '/health' || req.path === '/ready' || req.path === '/config') return next();
      if (!isDatabaseConnected()) return res.status(503).json({ error: 'DATABASE_NOT_CONNECTED' });
      next();
    });
    app.use('/api', productionRouter);
    app.use('/api', productionRequestsRouter);
    app.use('/api', authoritativeGamesRouter);
    // Unsupported games remain unavailable until persistent settlement is implemented.
    app.use('/api/games', (_req, res) => res.status(503).json({ error: 'GAME_NOT_AVAILABLE_IN_PRODUCTION' }));
    app.use('/api/audit', (_req, res) => res.status(503).json({ error: 'AUDIT_API_NOT_READY' }));
  }

  // Central fallback for rejected async handlers (including DB timeout errors).
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    console.error('Unhandled API request failure:', error instanceof Error ? error.message : String(error));
    return res.status(503).json({ error: 'REQUEST_FAILED', message: 'The request could not be completed because a backend dependency timed out or failed. Please retry.' });
  });

  const server = http.createServer(app);

  // Mount Vite middleware for dev or serve static dist in production
  if (process.env.NODE_ENV === 'production' && !process.env.DEV_MODE && !config.isDevelopmentOrPreview) {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Retry the initial database connection instead of leaving production APIs permanently closed.
  if (config.isProduction && config.productionValid && process.env.DATABASE_URL?.trim()) {
    setInterval(async () => {
      try {
        if (!isDatabaseConnected()) {
          await connectDatabase();
          console.log('Supabase PostgreSQL connection recovered.');
        }
        if (isDatabaseConnected() && !productionServicesStarted) {
          startPersistentAviatorEngine();
          await bootstrapOwnerFromEnvironment();
          productionServicesStarted = true;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Supabase PostgreSQL reconnect/service initialization attempt failed:', message);
      }
    }, 10000);
  }

  const port = config.port;
  server.listen(port, '0.0.0.0', () => {
    console.log(`🎰 BigDaddy Casino authoritative server listening on http://0.0.0.0:${port}`);
    console.log(`📌 Operational Mode: ${config.mode.toUpperCase()}`);
    console.log('Business APIs require production mode and persistent Supabase PostgreSQL storage.');
  });
}

startServer().catch((err) => {
  console.error('Failed to start BigDaddy Casino server:', err);
  process.exit(1);
});
