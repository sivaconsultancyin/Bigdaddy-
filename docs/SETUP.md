# BigDaddy Casino — Local Development & Deployment Setup

## 1. Quick Start (Development & Preview Mode)
BigDaddy Casino runs out of the box in **Development & Preview Mode** with **zero required environment variables or database setup**:

```bash
# 1. Install dependencies
npm install

# 2. Start full-stack dev server (Express + Vite + WebSockets on port 3000)
npm run dev
```

Visit `http://localhost:3000` to interact with the complete live casino UI, Aviator flight canvas, and administrative dashboards.

In this mode:
- An isolated in-memory authoritative store handles the 10 Billion token master supply.
- All balances, bets, and settlements are simulated and clearly labeled as `[SIMULATED]`.
- No real-money transactions, external PostgreSQL database, or Supabase credentials are required.

---

## 2. Default Seed Accounts for Testing

Use the **1-Click Role Inspector** at the top of the application to test any role instantly, or sign in using:

| Role | Username | Password | Notes |
|---|---|---|---|
| **OWNER** | `owner` | `Owner@1234` | Master Treasury, Audit, Game Pools |
| **SUPER_ADMIN** | `superadmin_alpha` | `SuperAdmin@1234` | Subordinate to Owner |
| **ADMIN** | `admin_bravo` | `Admin@1234` | Subordinate to Super Admin |
| **PLAYER** | `player_charlie` | `Player@1234` | Referral Code: `BIGDADDY777` |

---

## 3. Automated Invariant & Security Tests
Run the automated test suite verifying all 12 core invariants:
```bash
npm test
```

---

## 4. Production Mode Deployment
For full production deployment instructions, environment variable validation, and database migrations, see:
👉 [docs/CONFIGURATION_GUIDE.md](docs/CONFIGURATION_GUIDE.md)
