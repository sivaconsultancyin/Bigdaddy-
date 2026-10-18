import postgres from 'postgres';

/**
 * Supabase PostgreSQL connection for the trusted backend only.
 *
 * Set DATABASE_URL to the project's PostgreSQL connection string in the
 * hosting provider's secret/environment settings. Never expose it to Vite
 * or the browser bundle.
 */
let client: ReturnType<typeof postgres> | null = null;
let connected = false;

export async function connectDatabase(): Promise<boolean> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    connected = false;
    return false;
  }

  const nextClient = postgres(connectionString, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

  try {
    await nextClient`select 1 as connection_check`;
    client = nextClient;
    connected = true;
    return true;
  } catch (error) {
    connected = false;
    await nextClient.end({ timeout: 2 }).catch(() => undefined);
    throw new Error(
      `Supabase PostgreSQL connection failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
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
