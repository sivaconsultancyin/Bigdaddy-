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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  app.use(express.json());

  // CORS middleware for API routes
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Public Configuration Endpoint
  app.get('/api/config', (req, res) => {
    res.json(getPublicConfigInfo());
  });

  // Production Safety Interceptor:
  // Requirement 7: Production Mode must fail safely with a clear configuration error
  // if required credentials or services are missing. Never silently use mock balances.
  if (config.isProduction && !config.productionValid) {
    console.error('❌ PRODUCTION CONFIGURATION ERROR: Mandatory credentials missing:');
    config.productionMissingVars.forEach((v) => console.error(`   - ${v}`));

    app.use('/api', (req, res) => {
      res.status(503).json({
        error: 'PRODUCTION_CONFIGURATION_ERROR',
        message:
          'BigDaddy Casino cannot operate in Production Mode without mandatory database and security secrets. Mock/simulated data is strictly forbidden in Production.',
        missingVariables: config.productionMissingVars,
        instructions:
          'Set APP_MODE=development or provide the required production environment variables. Refer to docs/CONFIGURATION_GUIDE.md.',
      });
    });
  } else {
    // REST API Routes (Active in Development/Preview or Validated Production)
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

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'healthy',
      service: 'BigDaddy Casino Authority',
      mode: config.mode,
      isSimulated: config.isSimulated,
      timestamp: new Date().toISOString(),
    });
  });

  const server = http.createServer(app);

  // Setup WebSocket Server for Live Game Multipliers & Balance Sync
  setupWebSocketServer(server);

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
