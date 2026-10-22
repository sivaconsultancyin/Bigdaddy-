/**
 * Server-only Supabase Data API client.
 *
 * This module deliberately does not replace the existing PostgreSQL client yet.
 * Route-by-route migration is required before removing the SQL connection layer.
 * Never import this module into frontend/Vite code or expose the service-role key.
 */
const DEFAULT_TIMEOUT_MS = 10_000;
const IDENTIFIER = /^[a-z][a-z0-9_]*$/i;

export class SupabaseApiError extends Error {
  readonly status: number;
  readonly details: string;

  constructor(message: string, status: number, details: string) {
    super(message);
    this.name = 'SupabaseApiError';
    this.status = status;
    this.details = details;
  }
}

function getConfig(): { url: string; key: string } {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!rawUrl || !key) {
    throw new Error(
      'Supabase HTTPS API is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the backend only.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTPS URL.');
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('SUPABASE_URL must use HTTPS and must not contain credentials.');
  }

  return { url: parsed.toString().replace(/\/$/, ''), key };
}

function validateIdentifier(value: string, label: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`Invalid Supabase ${label} identifier.`);
  }
  return value;
}

export interface SupabaseRequestOptions {
  /** Supabase schema that has been explicitly enabled for the Data API. */
  schema?: string;
  /** Extra PostgREST headers such as Prefer; do not override auth headers. */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

/**
 * Make an authenticated request to Supabase's HTTPS Data API.
 * Errors include HTTP status and a bounded response body, never the API key.
 */
export async function supabaseApiRequest<T>(
  path: string,
  init: RequestInit = {},
  options: SupabaseRequestOptions = {},
): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('Supabase API path must be an absolute path within the API.');
  }

  const { url, key } = getConfig();
  const schema = validateIdentifier(options.schema ?? 'public', 'schema');
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers(init.headers);
    headers.set('apikey', key);
    headers.set('Authorization', `Bearer ${key}`);
    headers.set('Accept-Profile', schema);
    headers.set('Content-Profile', schema);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      if (/^(authorization|apikey)$/i.test(name)) {
        throw new Error('Supabase authentication headers cannot be overridden.');
      }
      headers.set(name, value);
    }

    const response = await fetch(`${url}/rest/v1${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const body = await response.text();

    if (!response.ok) {
      // Bound log/error size and avoid echoing request headers or secrets.
      throw new SupabaseApiError(
        `Supabase Data API request failed with HTTP ${response.status}.`,
        response.status,
        body.slice(0, 1_500),
      );
    }

    if (!body) return undefined as T;
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new Error('Supabase Data API returned a non-JSON success response.');
    }
  } catch (error) {
    if (error instanceof SupabaseApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Supabase Data API request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Read rows through PostgREST, e.g. GET /platform/users?select=id,username&id=eq.<uuid>. */
export function supabaseSelect<T>(
  table: string,
  query: URLSearchParams,
  options: SupabaseRequestOptions & { schema: string },
): Promise<T> {
  const safeTable = validateIdentifier(table, 'table');
  const suffix = query.toString();
  return supabaseApiRequest<T>(
    `/${safeTable}${suffix ? `?${suffix}` : ''}`,
    { method: 'GET' },
    options,
  );
}

/** Call an existing PostgreSQL function exposed through Supabase RPC. */
export function supabaseRpc<T>(
  functionName: string,
  args: Record<string, unknown>,
  options: SupabaseRequestOptions & { schema?: string } = {},
): Promise<T> {
  const safeFunction = validateIdentifier(functionName, 'function');
  return supabaseApiRequest<T>(
    `/rpc/${safeFunction}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    },
    options,
  );
}
