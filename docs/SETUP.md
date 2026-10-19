# BigDaddy Casino — Production Setup

## Production-only runtime

The application no longer auto-logs into demo accounts and the frontend does not fabricate users, wallets, balances, requests, or game history when the backend is unavailable. Business APIs require a valid production configuration and a reachable Supabase PostgreSQL database; otherwise they return an error instead of simulated data.

## Configure the backend

1. Copy `.env.example` to `.env` for local configuration, or set the same variables in your hosting provider.
2. Set `APP_MODE=production` and `NODE_ENV=production`.
3. Set `DATABASE_URL` to the PostgreSQL connection URI from Supabase Dashboard → Connect. Keep it server-side; never put it in a `VITE_` variable.
4. Generate unique `JWT_SECRET` and `SESSION_SECRET` values and configure the exact HTTPS origin in `CORS_ORIGINS`.
5. Configure `OWNER_BOOTSTRAP_USERNAME`, `OWNER_BOOTSTRAP_EMAIL`, and `OWNER_BOOTSTRAP_PASSWORD` for the initial owner if needed.
6. Apply and verify the pending migrations through the approved Supabase migration workflow before enabling financial traffic.

## Build and verify

```bash
npm install
npm run lint
npm test
npm run build
```

`npm run dev` may start the Vite development UI, but it does not enable a simulated backend. Without production credentials and a connected database, business APIs remain closed.

## Production scope and safety

- Authentication, wallet, ledger, user management, and supported Crash/Aviator settlement use backend PostgreSQL operations.
- Other game routes remain unavailable until persistent settlement and recovery have been implemented and tested for each game.
- The old in-memory storage/game modules remain in the repository for legacy/test code but are not mounted by the production server.
- A new Supabase project is not yet reproducible from `supabase/migrations` alone because the initial baseline schema still lives in `database/migrations/002_supabase_schema.sql`.

Never use demo credentials or simulated balances for a production deployment.