# BigDaddy Casino — Configuration & Production Deployment Guide

## 1. Dual-Mode Architecture Overview

BigDaddy has a simulated development/preview mode and a production mode backed by PostgreSQL. Production mode mounts database-backed authentication, wallet/request, and Crash/Aviator routes only when required configuration is valid and the database connects. Unsupported games and production WebSocket streams remain disabled. Treat production settlement as not fully verified until the migrations and end-to-end database tests described below have passed.

| Capability | Development & Preview Mode (`APP_MODE=development`) | Production Mode (`APP_MODE=production`) |
|---|---|---|
| **Environment Variables** | **Zero required** | **Mandatory validation** |
| **Database** | Isolated in-memory preview store | PostgreSQL-backed routes; schema/migration readiness must be checked separately |
| **Token Balances & Wallets** | Simulated demo tokens (clearly labeled) | Database-backed operations with atomic ledger functions |
| **Game Outcomes (Aviator/Crash)** | In-memory preview simulator | Persistent Crash settlement routes; unsupported games and WebSockets remain disabled |
| **Missing Secrets Behavior** | Runs out of the box with safe defaults | **Fails safely** with `ProductionConfigError` |
| **Real Money Risk** | None (Non-real money preview) | Not certified for real-money use; migration and end-to-end verification required |

---

## 2. Development & Preview Mode (Default)

In Development and Preview mode:
- **No `.env` file or environment variables are required.**
- The application automatically initializes in-memory system wallets, the 10 Billion token master supply, and 4 hierarchical demo accounts (`owner`, `superadmin_alpha`, `admin_bravo`, `player_charlie`).
- The frontend renders the complete UI, games lobby, Aviator flight canvas, and administrative dashboards.
- All balances, bets, token requests, and settlements are explicitly labeled with `[SIMULATED]` / `[DEMO]` badges.

### Running in Preview Mode:
```bash
npm run dev
```
Open `http://localhost:3000` to preview the live application immediately.

---

## 3. Transitioning to Production Mode

Production mode uses separate PostgreSQL-backed routes rather than the in-memory preview StorageEngine. The connection module verifies database connectivity; the route handlers use the public schema and atomic SQL functions for supported operations. Do not launch live financial traffic until the migration history is aligned, the pending SQL fixes are applied and verified, and end-to-end wallet/Crash settlement tests pass.

To configure the database connection for the next integration stage, follow these steps:

### Step 1: Set Operational Mode
In your production environment or hosting dashboard (e.g. Google Cloud Run, Docker, Kubernetes):
```env
APP_MODE=production
NODE_ENV=production
PORT=3000
```

### Step 2: Configure Cryptographic Secrets (Backend Only)
Generate high-entropy random secrets (minimum 32 characters for `JWT_SECRET`):
```bash
# Generate secure 256-bit keys
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Set the generated keys in your backend environment:
```env
JWT_SECRET=c9f8a37b12d5e68401a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9
SESSION_SECRET=a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3
```

### Step 3: Configure PostgreSQL or Supabase
Provide a PostgreSQL database connection string:
```env
DATABASE_URL=postgresql://user:password@host:5432/bigdaddy_casino?sslmode=require
```
Get the PostgreSQL URI from the Supabase Dashboard **Connect** panel and use its **Transaction pooler** option for transient/serverless hosts. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` alone do not replace `DATABASE_URL` for direct PostgreSQL transactions. Never paste the URI or password into GitHub.

### Step 4: Apply Database Schema & Migrations
The base schema was applied separately from the tracked Supabase migration history; its source is `database/migrations/002_supabase_schema.sql`. The repository now mirrors the 12 migration versions recorded by the connected Supabase project. The current public schema has 16 tables with RLS enabled. The base schema is not yet a tracked `supabase/migrations` baseline, so a brand-new Supabase project cannot be rebuilt from that directory alone without a deliberate baseline migration.

Production CORS requires `CORS_ORIGINS` to list exact trusted HTTPS origins (comma-separated); wildcard origins are rejected in production. `/api/health` remains a liveness endpoint. `/api/ready` currently checks configuration and database connectivity, not every schema migration/function, so verify the migration ledger and required functions before deployment. Financial/game routes return 503 when production configuration or the database is unavailable. Production WebSocket game streams are disabled.

Do not run a genesis seed against production until the application storage adapter has been migrated, demo accounts are removed from production startup, UUID mapping is deliberate, and the seed is idempotent.

---

## 4. Fail-Safe Production Verification

To prevent accidental financial anomalies or mock data leakage, the server strictly validates all production requirements during boot:

```typescript
if (config.isProduction && !config.productionValid) {
  // Missing secrets: return 503.
}
// With valid secrets and a connected database, supported production routes
// are mounted; unsupported games remain closed. Verify schema/migration state.
```

If any mandatory variable is omitted or if default preview placeholders are used:
1. The server logs a `PRODUCTION CONFIGURATION ERROR`.
2. All `/api/*` endpoints return a `503 Service Unavailable` with details of the missing variables.
3. The frontend displays the **Production Configuration Error Screen** rather than silently falling back to mock wallets or simulated balances.

---

## 5. Security & Isolation Rules

1. **Never Expose Secrets to the Client**:
   `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` must **never** be included in `VITE_` variables or frontend source code.
2. **Client-Facing Variables**:
   Only safe public variables (such as `VITE_API_BASE_URL="/api"`) are exposed to the client.
3. **Double-Entry Auditing**:
   All financial operations (deposits, transfers, bet locks in escrow, pool wins, losses) must produce balanced debit/credit ledger records with cryptographic timestamps.
