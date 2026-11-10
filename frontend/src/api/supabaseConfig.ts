import { resolveSupabasePublicConfig } from "./supabaseConfigValidation";

// Public browser configuration for the single canonical Supabase project.
// These VITE_* values are intentionally public client configuration, never secrets.
// A production bundle must fail closed when either value is missing or invalid.
const publicConfig = resolveSupabasePublicConfig(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  import.meta.env.PROD,
);

export const SUPABASE_URL = publicConfig.url;
export const SUPABASE_PUBLISHABLE_KEY = publicConfig.publishableKey;
export const SUPABASE_API_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1/api`
  : '';
export const hasSupabaseRealtimeConfig = publicConfig.hasRealtime;
