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

## Shared-wallet RPC (additive source-project change)

The source BigDaddy project now has the service-role-only RPC
`wallet.aviator_wallet_operation(action, user_id, bet_id, round_id, amount, liability, multiplier, idempotency_key)`.
It supports `DEBIT_BET`, `CASHOUT`, `CRASH_LOSS`, and `REFUND_BET` and performs each wallet transfer plus pool-liability reservation/release in one source-database transaction. It is deliberately not callable by `anon` or `authenticated`. The migration does not move funds when installed; only a subsequent service-role call executes an operation.

Important integration rules:

- Create and persist the Aviator-side bet/outbox intent before calling the shared-wallet RPC.
- Use one stable operation key for each bet/action and retry with exactly the same parameters.
- On a successful debit, only then allow the bet to be treated as funded.
- Cashout payout and stake recycling plus liability release are atomic inside the shared wallet database.
- Crash loss/refund operations are allowed to finish even if the account becomes inactive after the bet was placed.
- Never infer a failed debit/payout from an HTTP timeout; retry the same key and reconcile.
- The RPC has been installed and its grants verified. No real-money operation was invoked during verification. End-to-end calls and engine deployment remain pending.

## Isolated round lifecycle primitives

Migration `20261025130000_aviator_round_lifecycle.sql` is applied to the target Aviator project and committed to the feature branch. It adds service-role-only functions to create a waiting round, start it, atomically accept a cashout intent, and crash a running round. Round creation uses a transaction advisory lock to prevent two concurrent workers creating active rounds. Cashout checks the bet's user ID and serializes against crash on the round row. A successful cashout creates a pending settlement intent; it does **not** pay the wallet itself.

The target was verified to contain all four functions, with service-role execution and no anonymous cashout permission. The target still has zero rounds/bets/settlements because verification did not create test rounds or move money.

Important remaining safeguards before these primitives are wired to HTTP routes:
- Only accept a cashout multiplier calculated by the trusted server engine from server time; never trust a client-supplied multiplier.
- Before treating a bet as funded, implement a cross-database saga: persist debit intent, call the shared-wallet RPC with a stable key, then reconcile the result.
- Add a complete settlement worker that retries payout/loss/refund operations and only marks a round SETTLED after all operations are reconciled.
- Verify the shared wallet RPC's transaction type and liability behavior against real source-schema definitions in staging before enabling any money movement.
