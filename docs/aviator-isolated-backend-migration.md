# Aviator isolated backend migration

## Ownership boundary

- This Supabase project owns Aviator rounds, bets, game settlement intents, and a durable wallet-operation outbox.
- Shared authentication, user accounts, roles, and wallet balances remain in the central BigDaddy service.
- This database intentionally has no foreign keys to central platform or wallet tables; those tables do not exist in this project.
- Do not copy the old tick_crash_engine() RPC unchanged. It calls central platform.games, wallet RPCs, and settlement functions directly.

## Cross-database money movement

PostgreSQL transactions cannot atomically span the Aviator database and the shared wallet database. All bet debits, cashout credits, and refunds must therefore go through an authenticated internal shared-wallet API using stable idempotency keys. Persist the game-side operation first, call the wallet service, then persist the returned wallet transaction ID and final status. On timeout, retry with the same idempotency key and reconcile by key before attempting a compensating action. Never treat an HTTP timeout as proof that a debit or payout did not happen.

## Deployment sequence

1. Review/apply the isolated schema migration to the target Bigdaddy aviator project.
2. Implement the Aviator API/engine against these tables and the shared-wallet API; retain shared JWT validation.
3. Configure secrets and a trusted engine trigger, then verify state, betting, manual/auto cashout, crash settlement, idempotent retries, and restart recovery.
4. Switch routing only after tests pass. Do not migrate or delete production Aviator records from the source project as part of this change.
