# Archived isolated Aviator implementation

This directory is retained for audit/history only. It is **not** an active Supabase migration or Edge Function source directory.

The repository now targets one Supabase project only:
- Project ref: `nzvpuoeibqrpcltrszvr`
- General and Aviator API: `supabase/functions/api`
- Aviator scheduler/worker: `supabase/functions/aviator-engine`

Read-only inspection of the current project confirmed:
- The live migration ledger does not contain the eleven isolated migration versions archived here.
- The live Aviator schema is the shared-wallet implementation with `game_rounds`, `game_bets`, `game_settlements`, and `engine_worker_lease`.
- The old isolated wallet-outbox implementation expects a different schema, including `aviator.wallet_operations`, which is absent from the current project.
- The old `aviator-api`, `aviator-round-engine`, `aviator-wallet-worker`, and `aviator-settlement-worker` functions are not deployed in the current project.
- The archived FK-index migration's proposed indexes are already covered by existing live indexes; its `rls_auto_enable()` grant revocation is already in effect.

Do not copy these files back into `supabase/migrations` or `supabase/functions`, and do not deploy them. They describe an abandoned two-project architecture. The active implementation is maintained in the root migration directory and the two active function directories above.

No production database objects or financial data were changed by this archival operation.
