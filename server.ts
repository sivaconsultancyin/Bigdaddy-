import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { config, getPublicConfigInfo } from './backend/src/config';
import { authRouter } from './backend/src/routes/auth.routes';
import { walletRouter } from './backend/src/routes/wallet.routes';
import { tokenRequestRouter } from './backend/src/routes/tokenRequest.routes';
import { gameRouter } from './backend/src/routes/game.routes';
import { auditRouter } from './backend/src/routes/audit.routes';
import { aviatorRouter } from './backend/src/games/aviator/aviator.routes';
import { rouletteRouter } from './backend/src/games/roulette/roulette.routes';
import { teenPattiRouter } from './backend/src/games/teen-patti/teen-patti.routes';
import { diceRouter } from './backend/src/games/dice/dice.routes';
import { dragonTigerRouter } from './backend/src/games/dragon-tiger/dragon-tiger.routes';
import { andarBaharRouter } from './backend/src/games/andar-bahar/andar-bahar.routes';
import { setupWebSocketServer } from './backend/src/websocket/wsServer';
import { connectDatabase, isDatabaseConnected } from './backend/src/db/postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  // Connect using a backend-only secret. The frontend must never receive DATABASE_URL.
  if (process.env.DATABASE_URL?.trim()) {
    await connectDatabase();
    console.log('✅ Supabase PostgreSQL connectivity check passed.');
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
      businessDataPersistence: 'IN_MEMORY_NOT_MIGRATED',
      productionFinancialApisEnabled: false,
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness remains false until durable storage and game settlement are implemented.
  app.get('/api/ready', (_req, res) => {
    const ready = !config.isProduction;
    res.status(ready ? 200 : 503).json({
      ready,
      reason: ready ? null : 'PERSISTENT_STORAGE_AND_SETTLEMENT_NOT_READY',
      databaseConnected: isDatabaseConnected(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/config', (_req, res) => {
    res.json(getPublicConfigInfo());
  });

  // Fail closed in production: no mock/in-memory financial or game operations.
  if (config.isProduction && !config.productionValid) {
    console.error('Production configuration invalid:', config.productionMissingVars.join(', '));
    app.use('/api', (req, res, next) => {
      if (req.path === '/health' || req.path === '/ready' || req.path === '/config') return next();
      return res.status(503).json({
        error: 'PRODUCTION_CONFIGURATION_ERROR',
        message: 'Production configuration is incomplete. Financial and game APIs remain disabled.',
        missingVariables: config.productionMissingVars,
      });
    });
  } else if (config.isProduction) {
    app.use('/api', (req, res, next) => {
      if (req.path === '/health' || req.path === '/ready' || req.path === '/config') return next();
      return res.status(503).json({
        error: 'PERSISTENT_STORAGE_NOT_READY',
        message: 'PostgreSQL-backed user, wallet, ledger, bet, and settlement operations have not completed production verification.',
      });
    });
  } else {
    app.use('/api/auth', authRouter);
    app.use('/api/wallet', walletRouter);
    app.use('/api/requests', tokenRequestRouter);
    app.use('/api/games', gameRouter);
    app.use('/api/audit', auditRouter);
    app.use('/api/games/aviator', aviatorRouter);
    app.use('/api/games/roulette', rouletteRouter);
    app.use('/api/games/teen-patti', teenPattiRouter);
    app.use('/api/games/dice', diceRouter);
    app.use('/api/games/dragon-tiger', dragonTigerRouter);
    app.use('/api/games/andar-bahar', andarBaharRouter);
  }

  const server = http.createServer(app);

  // WebSocket game streams are simulated and must not be exposed in production.
  if (!config.isProduction) {
    setupWebSocketServer(server);
  }

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

  const port = config.port;
  server.listen(port, '0.0.0.0', () => {
    console.log(`🎰 BigDaddy Casino authoritative server listening on http://0.0.0.0:${port}`);
    console.log(`📌 Operational Mode: ${config.mode.toUpperCase()}`);
    if (config.isDevelopmentOrPreview) {
      console.log(`💡 Mode Info: Development & Preview mode active.`);
      console.log(`   - Zero external credentials required.`);
      console.log(`   - All balances, bets, and token transfers are SIMULATED in-memory.`);
    }
    console.log(`⚡ WebSocket available at ws://0.0.0.0:${port}/ws`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start BigDaddy Casino server:', err);
  process.exit(1);
});
