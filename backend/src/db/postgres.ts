import postgres from 'postgres';

/**
 * Supabase PostgreSQL connection for the trusted backend only.
 *
 * DATABASE_URL should be the primary database URL. If the direct endpoint is
 * unreachable from the host (for example, IPv6 is unavailable), configure
 * DATABASE_POOLER_URL with the exact Session Pooler URI copied from Supabase.
 * Never expose either URL to Vite or the browser bundle.
 */
let client: ReturnType<typeof postgres> | null = null;
let authClient: ReturnType<typeof postgres> | null = null;
let engineClient: ReturnType<typeof postgres> | null = null;
let activeConnectionString: string | null = null;
let connected = false;

function createClient(
  connectionString: string,
  max = 5,
): ReturnType<typeof postgres> {
  return postgres(connectionString, {
    max,
    idle_timeout: 20,
    connect_timeout: 8,
    // Bound database work even when a request is waiting on a lock or query.
    connection: { statement_timeout: 20000, lock_timeout: 2000 },
    prepare: false,
  });
}

export async function connectDatabase(): Promise<boolean> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    connected = false;
    activeConnectionString = null;
    return false;
  }

  const directClient = createClient(connectionString);
  try {
    await directClient`select 1 as connection_check`;
    client = directClient;
    activeConnectionString = connectionString;
    connected = true;
    return true;
  } catch (error) {
    await directClient.end({ timeout: 2 }).catch(() => undefined);

    const message = error instanceof Error ? error.message : 'unknown error';
    const poolerUrl = process.env.DATABASE_POOLER_URL?.trim();
    const shouldTryPooler = /ENETUNREACH|EHOSTUNREACH/i.test(message);

    if (shouldTryPooler && poolerUrl) {
      const poolerClient = createClient(poolerUrl);
      try {
        await poolerClient`select 1 as connection_check`;
        client = poolerClient;
        activeConnectionString = poolerUrl;
        connected = true;
        console.info('Supabase PostgreSQL connected through the configured session pooler.');
        return true;
      } catch (fallbackError) {
        await poolerClient.end({ timeout: 2 }).catch(() => undefined);
        connected = false;
        activeConnectionString = null;
        const fallbackMessage = fallbackError instanceof Error
          ? fallbackError.message
          : 'unknown error';
        throw new Error(
          `Supabase PostgreSQL direct and session-pooler connections failed. Direct: ${message}. Pooler: ${fallbackMessage}`,
        );
      }
    }

    connected = false;
    activeConnectionString = null;
    if (shouldTryPooler && !poolerUrl) {
      throw new Error(
        `Supabase PostgreSQL direct connection failed: ${message}. Configure DATABASE_POOLER_URL using the exact Session Pooler URI from Supabase Dashboard → Connect.`,
      );
    }
    throw new Error(`Supabase PostgreSQL connection failed: ${message}`);
  }
}

/**
 * Authentication has its own small pool so wallet/bet traffic cannot occupy
 * every connection needed for login and token validation. This is a separate
 * pool in the same API process; the Aviator engine runs in its own process.
 */
export function getAuthDatabaseClient(): ReturnType<typeof postgres> {
  if (!connected || !activeConnectionString) {
    throw new Error('Authentication database is not connected. Configure DATABASE_URL on the backend.');
  }
  if (!authClient) {
    authClient = createClient(activeConnectionString, 2);
  }
  return authClient;
}

export function getDatabaseClient(): ReturnType<typeof postgres> {
  if (!client || !connected) {
    throw new Error('Database is not connected. Configure DATABASE_URL on the backend.');
  }
  return client;
}

/**
 * Keep the persistent game loop off the user/API connection pool. A stalled
 * engine query must not consume every connection used by login, wallet, and
 * bet endpoints. One connection is enough because the engine serializes ticks.
 */
export function getEngineDatabaseClient(): ReturnType<typeof postgres> {
  if (!connected || !activeConnectionString) {
    throw new Error('Database is not connected. Configure DATABASE_URL on the backend.');
  }
  if (!engineClient) {
    engineClient = createClient(activeConnectionString, 1);
  }
  return engineClient;
}

export function isDatabaseConnected(): boolean {
  return connected;
}

export async function closeDatabase(): Promise<void> {
  const current = client;
  const currentAuth = authClient;
  const currentEngine = engineClient;
  client = null;
  authClient = null;
  engineClient = null;
  activeConnectionString = null;
  connected = false;
  await Promise.all([
    current?.end({ timeout: 5 }),
    currentAuth?.end({ timeout: 5 }),
    currentEngine?.end({ timeout: 5 }),
  ]);
}
