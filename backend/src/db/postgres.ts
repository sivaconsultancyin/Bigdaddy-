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

function createClient(connectionString: string): ReturnType<typeof postgres> {
  return postgres(connectionString, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
}

/**
 * Supabase direct database hosts may resolve to IPv6 addresses that a host
 * cannot route to. For this project's Sydney region, retry through the
 * Supabase session pooler while preserving the password and URL parameters.
 */
function sessionPoolerUrl(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    const match = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (!match) return null;

    const projectRef = match[1];
    url.hostname = 'aws-0-ap-southeast-2.pooler.supabase.com';
    url.port = '5432';
    url.username = `postgres.${projectRef}`;
    return url.toString();
  } catch {
    return null;
  }
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
    const fallbackUrl = /ENETUNREACH|EHOSTUNREACH|ENETUNREACH/i.test(message)
      ? sessionPoolerUrl(connectionString)
      : null;

    if (fallbackUrl) {
      const poolerClient = createClient(fallbackUrl);
      try {
        await poolerClient`select 1 as connection_check`;
        client = poolerClient;
        connected = true;
        console.info('Supabase PostgreSQL connected through the session pooler fallback.');
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
