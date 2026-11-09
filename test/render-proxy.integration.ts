import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

let healthMode: 'ok' | 'unavailable' | 'slow' = 'ok';
const upstream = createServer((req, res) => {
  if (req.url === '/health') {
    if (healthMode === 'unavailable') {
      res.writeHead(503).end('unavailable');
      return;
    }
    if (healthMode === 'slow') {
      setTimeout(() => res.writeHead(200).end('ok'), 4_000);
      return;
    }
    res.writeHead(200).end('ok');
    return;
  }
  if (req.url === '/stream') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write('chunk-one');
    setTimeout(() => res.end('chunk-two'), 100);
    return;
  }
  if (req.url === '/large') {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(Buffer.alloc(10 * 1024 * 1024 + 1));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ path: req.url }));
});

const upstreamPort = await freePort();
const proxyPort = await freePort();
upstream.listen(upstreamPort, '127.0.0.1');

let proxy: ChildProcess | undefined;
try {
  proxy = spawn(process.execPath, ['--import', 'tsx', 'render-proxy.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(proxyPort),
      SUPABASE_API_BASE_URL: 'http://127.0.0.1:' + upstreamPort,
      CORS_ORIGINS: 'http://allowed.test',
    },
    stdio: 'ignore',
  });

  let started = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (proxy.exitCode !== null) throw new Error('Render proxy exited before listening');
    try {
      const response = await fetch('http://127.0.0.1:' + proxyPort + '/health');
      if (response.ok) { started = true; break; }
    } catch {
      await delay(100);
    }
  }
  assert.equal(started, true, 'Render proxy should start and expose liveness');

  const live = await fetch('http://127.0.0.1:' + proxyPort + '/health');
  assert.equal(live.status, 200);

  const ready = await fetch('http://127.0.0.1:' + proxyPort + '/ready');
  assert.equal(ready.status, 200);

  healthMode = 'unavailable';
  const unavailable = await fetch('http://127.0.0.1:' + proxyPort + '/ready');
  assert.equal(unavailable.status, 503);

  healthMode = 'slow';
  const timedOut = await fetch('http://127.0.0.1:' + proxyPort + '/ready');
  assert.equal(timedOut.status, 503);

  healthMode = 'ok';
  const streamed = await fetch('http://127.0.0.1:' + proxyPort + '/stream');
  assert.equal(streamed.status, 200);
  assert.equal(await streamed.text(), 'chunk-onechunk-two');

  await assert.rejects(
    async () => {
      const response = await fetch('http://127.0.0.1:' + proxyPort + '/large');
      await response.arrayBuffer();
    },
    'oversized upstream response should be terminated',
  );

  console.log('Render proxy integration tests passed: liveness, upstream readiness, timeout, streaming, response-size cap.');
} finally {
  proxy?.kill('SIGTERM');
  await closeServer(upstream);
}