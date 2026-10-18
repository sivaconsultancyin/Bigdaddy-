import dotenv from 'dotenv';
import { AppMode, AppConfigInfo } from '../../../shared/src/types';
import { isDatabaseConnected } from '../db/postgres';
dotenv.config();

export class ProductionConfigError extends Error {
  public missingVariables: string[];

  constructor(missingVariables: string[]) {
    super(
      `PRODUCTION CONFIGURATION ERROR: Cannot run in Production Mode because mandatory production credentials are missing:\n- ${missingVariables.join(
        '\n- '
      )}\n\nTo run safely without credentials, set APP_MODE=development or APP_MODE=preview.`
    );
    this.name = 'ProductionConfigError';
    this.missingVariables = missingVariables;
  }
}

// Mode determination: Default to DEVELOPMENT_PREVIEW unless explicitly configured as production
const rawMode = (process.env.APP_MODE || process.env.NODE_ENV || 'development').toLowerCase();
export const appMode: AppMode =
  rawMode === 'production' ? AppMode.PRODUCTION : AppMode.DEVELOPMENT_PREVIEW;

export const isDevelopmentOrPreview = appMode === AppMode.DEVELOPMENT_PREVIEW;

// Validate production requirements
function checkProductionValidation(): { isValid: boolean; missing: string[] } {
  if (isDevelopmentOrPreview) {
    return { isValid: true, missing: [] };
  }

  const missing: string[] = [];

  // Database verification
  const hasDatabaseUrl = !!process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '';

  // The backend uses direct PostgreSQL transactions for wallet/ledger operations.
  // A Supabase REST/service-role key alone is not a PostgreSQL connection string.
  if (!hasDatabaseUrl) {
    missing.push('DATABASE_URL (Supabase PostgreSQL connection string)');
  }

  // Cryptographic secrets verification
  const defaultDevSecret = 'bigdaddy-casino-super-secret-jwt-key-2026';
  if (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.trim() === '' ||
    process.env.JWT_SECRET === defaultDevSecret ||
    process.env.JWT_SECRET.length < 32
  ) {
    missing.push('JWT_SECRET (must be unique, non-default, >= 32 characters in production)');
  }

  if (
    !process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET.trim() === '' ||
    process.env.SESSION_SECRET.length < 16
  ) {
    missing.push('SESSION_SECRET (must be >= 16 characters in production)');
  }

  return {
    isValid: missing.length === 0,
    missing,
  };
}

const prodValidation = checkProductionValidation();

export const config = {
  mode: appMode,
  isDevelopmentOrPreview,
  isProduction: appMode === AppMode.PRODUCTION,
  isSimulated: isDevelopmentOrPreview,
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'bigdaddy-casino-super-secret-jwt-key-2026',
  jwtExpiresIn: '7d',
  sessionSecret: process.env.SESSION_SECRET || 'dev-preview-session-secret-999',
  corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['*'],
  databaseUrl: process.env.DATABASE_URL || '',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  productionValid: prodValidation.isValid,
  productionMissingVars: prodValidation.missing,
};

export function assertValidConfiguration() {
  if (config.isProduction && !config.productionValid) {
    throw new ProductionConfigError(config.productionMissingVars);
  }
}

export function getPublicConfigInfo(): AppConfigInfo {
  return {
    mode: config.mode,
    isSimulated: config.isSimulated,
    databaseConnected: isDatabaseConnected(),
    authProvider: config.isProduction
      ? 'PRODUCTION_SUPABASE_POSTGRES'
      : 'SIMULATED_LOCAL',
    version: '1.0.0-preview',
  };
}
