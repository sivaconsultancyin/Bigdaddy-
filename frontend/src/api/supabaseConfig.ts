// Public browser configuration for the single canonical Supabase project.
// These VITE_* values are intentionally public client configuration, never secrets.
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
export const SUPABASE_PUBLISHABLE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
export const SUPABASE_API_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1/api`
  : '';
export const hasSupabaseRealtimeConfig = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
