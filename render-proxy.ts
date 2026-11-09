import express, { type Request, type Response } from 'express';
import process from 'node:process';
import { Buffer } from 'node:buffer';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const EDGE_API_BASE = (
  process.env.SUPABASE_API_BASE_URL ||
  'https://nzvpuoeibqrpcltrszvr.supabase.co/functions/v1/api'
).replace(/\/+$/, '');

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ||
    'https://bigdaddy-frontend.onrender.com,http://localhost:5173,http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

app.disable('x-powered-by');
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization,Content-Type,Idempotency-Key,apikey,X-Client-Info',
  );
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.use(express.json({ limit: '2mb', strict: true }));

app.get(['/health', '/api/health'], (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'bigdaddy-render-api-proxy',
    databaseAccess: 'supabase-edge-functions-only',
  });
});

app.get(['/ready', '/api/ready'], async (_req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const upstream = await fetch(`${EDGE_API_BASE}/health`, {
      method: 'GET',
      headers: process.env.SUPABASE_PUBLISHABLE_KEY
        ? { apikey: process.env.SUPABASE_PUBLISHABLE_KEY }
        : undefined,
      signal: controller.signal,
      redirect: 'manual',
    });
    if (!upstream.ok) {
      res.status(503).json({ status: 'not_ready', dependency: 'supabase_edge_api', upstreamStatus: upstream.status });
      return;
    }
    res.status(200).json({ status: 'ready', dependency: 'supabase_edge_api' });
  } catch {
    res.status(503).json({
      status: 'not_ready',
      dependency: 'supabase_edge_api',
      reason: controller.signal.aborted ? 'upstream_timeout' : 'upstream_unavailable',
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.get('/', (_req, res) => {
  res.status(200).json({ service: 'bigdaddy-render-api-proxy', status: 'ok' });
});

// Render hosts the API entry point; all application/database operations are
// delegated to Supabase Edge Functions. This service intentionally has no
// PostgreSQL client, DATABASE_URL usage, or direct database connection.
app.all('*', async (req: Request, res: Response) => {
  const incomingPath = req.originalUrl;
  const routeAndQuery = incomingPath.startsWith('/api/')
    ? incomingPath.slice('/api'.length)
    : incomingPath;

  if (!routeAndQuery.startsWith('/')) {
    res.status(400).json({ error: 'INVALID_API_PATH' });
    return;
  }

  const headers = new Headers();
  for (const name of ['authorization', 'content-type', 'idempotency-key', 'apikey', 'x-client-info']) {
    const value = req.header(name);
    if (value) headers.set(name, value);
  }

  // A configured publishable/anon key may be used for the Supabase gateway.
  // It is a public project key, never a service-role secret.
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (publishableKey && !headers.has('apikey')) headers.set('apikey', publishableKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40_000);
  try {
    const upstream = await fetch(`${EDGE_API_BASE}${routeAndQuery}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
      signal: controller.signal,
      redirect: 'manual',
    });

    res.status(upstream.status);
    for (const name of ['content-type', 'cache-control', 'retry-after', 'x-request-id']) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }

    if (upstream.status === 204 || upstream.status === 304 || req.method === 'HEAD' || !upstream.body) {
      res.end();
      return;
    }

    // Stream the upstream response instead of buffering it in full. Enforce a
    // hard cap so a compromised or misconfigured upstream cannot exhaust memory.
    const maxResponseBytes = 10 * 1024 * 1024;
    const reader = upstream.body.getReader();
    let responseBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        responseBytes += value.byteLength;
        if (responseBytes > maxResponseBytes) {
          controller.abort();
          res.destroy(new Error('UPSTREAM_RESPONSE_TOO_LARGE'));
          return;
        }
        if (!res.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => res.once('drain', resolve));
        }
      }
      res.end();
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
      return;
    }
    const timedOut = controller.signal.aborted;
    res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'EDGE_API_TIMEOUT' : 'EDGE_API_UNAVAILABLE',
      message: timedOut
        ? 'Supabase Edge API did not respond within 40 seconds.'
        : 'Could not reach the Supabase Edge API.',
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`BigDaddy Render API proxy listening on port ${PORT}`);
  console.log('Database access mode: Supabase Edge Functions only');
});
