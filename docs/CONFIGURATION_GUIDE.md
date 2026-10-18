# BigDaddy Casino — Configuration & Production Deployment Guide

## 1. Dual-Mode Architecture Overview

BigDaddy Casino provides a first-class dual-mode configuration system designed for zero-friction development and previewing while guaranteeing rigorous security and financial safety in production:

| Capability | Development & Preview Mode (`APP_MODE=development`) | Production Mode (`APP_MODE=production`) |
|---|---|---|
| **Environment Variables** | **Zero required** | **Mandatory validation** |
| **Database** | Isolated in-memory authoritative store | Real PostgreSQL / Supabase instance |
| **Token Balances & Wallets** | Simulated demo tokens (clearly labeled) | Real double-entry ledger |
| **Game Outcomes (Aviator)** | In-memory authoritative simulator | Authoritative production server |
| **Missing Secrets Behavior** | Runs out of the box with safe defaults | **Fails safely** with `ProductionConfigError` |
| **Real Money Risk** | None (Non-real money preview) | Authorized production settlement |

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

Production API routes remain intentionally disabled until the in-memory StorageEngine is fully replaced with PostgreSQL-backed business operations. The current connection module checks connectivity only; it does not yet persist wallet, user, bet, or settlement data. Do not launch live financial traffic until that migration and its tests are complete.

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
The base schema was applied to the connected Supabase project and the 16 tables were verified. The base migration is `database/migrations/002_supabase_schema.sql`. The additional migration `database/migrations/003_atomic_wallet_transfer.sql` defines an atomic, idempotent transfer function with wallet row locks, double-entry ledger records, and a fixed-supply check. It is committed to GitHub but has **not** been verified as applied to Supabase; review and apply it manually in the Supabase SQL Editor after confirming the base schema is present.

Production CORS now requires `CORS_ORIGINS` to list the exact trusted HTTPS origins (comma-separated); wildcard origins are rejected in production. The health endpoint remains available, while readiness and financial/game APIs report not-ready until persistence is completed. Production WebSocket game streams are disabled to prevent exposing simulated game state.

Do not run a genesis seed against production until the application storage adapter has been migrated, demo accounts are removed from production startup, UUID mapping is deliberate, and the seed is idempotent.

---

## 4. Fail-Safe Production Verification

To prevent accidental financial anomalies or mock data leakage, the server strictly validates all production requirements during boot:

```typescript
if (config.isProduction && !config.productionValid) {
  // Missing secrets: return 503.
}
// Even with valid secrets, production business APIs return 503 until
// PostgreSQL-backed storage replaces the simulated in-memory engine.
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
