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
let connected = false;

function createClient(connectionString: string): ReturnType<typeof postgres> {
  return postgres(connectionString, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    // Apply server-side limits at connection startup so stalled statements/locks fail closed.
    connection: { statement_timeout: 20000, lock_timeout: 2000 },
    prepare: false,
  });
}

export async function connectDatabase(): Promise<boolean> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    connected = false;
    return false;
  }

  const directClient = createClient(connectionString);
  try {
    await directClient`select 1 as connection_check`;
    client = directClient;
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
        connected = true;
        console.info('Supabase PostgreSQL connected through the configured session pooler.');
        return true;
      } catch (fallbackError) {
        await poolerClient.end({ timeout: 2 }).catch(() => undefined);
        connected = false;
        const fallbackMessage = fallbackError instanceof Error
          ? fallbackError.message
          : 'unknown error';
        throw new Error(
          `Supabase PostgreSQL direct and session-pooler connections failed. Direct: ${message}. Pooler: ${fallbackMessage}`,
        );
      }
    }

    connected = false;
    if (shouldTryPooler && !poolerUrl) {
      throw new Error(
        `Supabase PostgreSQL direct connection failed: ${message}. Configure DATABASE_POOLER_URL using the exact Session Pooler URI from Supabase Dashboard → Connect.`,
      );
    }
    throw new Error(`Supabase PostgreSQL connection failed: ${message}`);
  }
}

export function getDatabaseClient(): ReturnType<typeof postgres> {
  if (!client || !connected) {
    throw new Error('Database is not connected. Configure DATABASE_URL on the backend.');
  }
  return client;
}

export function isDatabaseConnected(): boolean {
  return connected;
}

export async function closeDatabase(): Promise<void> {
  const current = client;
  client = null;
  connected = false;
  if (current) await current.end({ timeout: 5 });
}
