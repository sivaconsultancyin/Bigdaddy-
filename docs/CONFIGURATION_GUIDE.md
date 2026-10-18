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

To deploy BigDaddy Casino to production, follow these steps:

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
Or use Supabase backend credentials:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key-here
```

### Step 4: Apply Database Schema & Migrations
Before accepting live traffic, run the DDL schema and genesis seed:
```bash
psql $DATABASE_URL -f database/schema.sql
psql $DATABASE_URL -f database/seed.sql
```
This initializes the 16 normalized relational tables and the genesis 10 Billion token supply into the Owner Treasury exactly once.

---

## 4. Fail-Safe Production Verification

To prevent accidental financial anomalies or mock data leakage, the server strictly validates all production requirements during boot:

```typescript
if (config.isProduction && !config.productionValid) {
  // Halts API with 503 and returns missing variables
}
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
